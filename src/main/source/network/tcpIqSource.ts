/**
 * TcpIqSource：GNU Radio / 任意 TCP IQ 源的主进程适配器。
 *
 * 数据流：
 *   TCP bytes → IqRingBuffer（原始字节）→ 60fps drain → 抽取/格式转换 → SourceFrame
 *
 * 设计要点：
 * - 不在 data 事件里逐样本转换，避免高采样率拖垮主进程；
 * - 60fps 固定节奏产出 SourceFrame，帧率稳定、下游（录制/分析/组件）无需感知网络抖动；
 * - 环形缓冲溢出时丢弃最旧样本并计数，UI 可看到 droppedSamples；
 * - 断线自动重连（指数退避，最多 10s）；状态由调用方轮询 networkStatus。
 */
import net from 'node:net'
import type { SourceFrame } from '../../../shared/sourceEngine'
import {
  networkBytesPerSample,
  resolveDecimation,
  resolveDisplaySampleRate,
  resolvePointsPerFrame,
  type NetworkSourceConfig,
  type NetworkSourceStatus,
  type NetworkFormat
} from '../../../shared/sourceNetwork'
import { IqRingBuffer } from './iqRingBuffer'
import { IqStreamParser, type IqPacketMeta } from './iqStreamParser'
import { splitInterleaved } from './iqChannelSplit'
import { RawTcpLink } from './rawTcpLink'
import {
  RawIqRecorder,
  type RawExportResult,
  type RawRecordOptions,
  type RawRecordStatus
} from './rawIqRecorder'

export interface TcpIqSourceOptions {
  onFrame: (frame: SourceFrame) => void
  onStatus?: (status: NetworkSourceStatus) => void
}

const CONNECT_TIMEOUT_MS = 5000
const DRAIN_INTERVAL_MS = 16

export class TcpIqSource {
  private readonly cfg: NetworkSourceConfig
  private readonly opts: TcpIqSourceOptions
  private points: number
  private stride: number
  private displayRate: number
  private readonly bps: number
  private readonly rings: IqRingBuffer[]
  private channels: number
  private readonly parser: IqStreamParser
  private highWater = 0
  private lowWater = 0
  private framed = false
  private droppedPackets = 0
  private dualMode: boolean
  private metaSampleRate = 0
  private metaCenterHz = 0
  private frameCenterHz = 0
  private rawMetaSampleRate = 0
  private rawMetaCenterHz = 0
  private rawMetaFormat: NetworkFormat
  private rawMetaChannels = 1
  private rawRecorder: RawIqRecorder | null = null
  private readonly splitMode: boolean
  private readonly rawLink: RawTcpLink | null

  private socket: net.Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false
  private connected = false
  private everConnected = false
  private connecting = false
  private seq: number[] = [0]
  private sampleIndexes: number[] = [0]
  private frames = 0
  private samples = 0
  private receivedBytes = 0
  private bytesWindow = 0
  private bytesPerSecond = 0
  private rateAt = Date.now()
  private reconnects = 0
  private lastError = ''
  private startedAt = 0

  constructor(cfg: NetworkSourceConfig, opts: TcpIqSourceOptions) {
    this.cfg = cfg
    this.opts = opts
    this.points = resolvePointsPerFrame(cfg)
    this.stride = resolveDecimation(cfg)
    this.displayRate = resolveDisplaySampleRate(cfg)
    this.bps = networkBytesPerSample(cfg.format)
    this.channels = cfg.channels === 2 ? 2 : 1
    const capacity = Math.max(
      1024 * 1024,
      Math.floor((cfg.maxBufferBytes ?? 32 * 1024 * 1024) / this.channels)
    )
    this.rings = Array.from({ length: this.channels }, () => new IqRingBuffer(capacity, cfg.format))
    this.seq = Array.from({ length: this.channels }, () => 0)
    this.sampleIndexes = Array.from({ length: this.channels }, () => 0)
    this.parser = new IqStreamParser(cfg.format)
    this.frameCenterHz = cfg.centerHz
    this.dualMode = cfg.dualStream === true
    this.rawMetaFormat = cfg.recordFormat ?? cfg.format
    this.rawMetaChannels = this.channels
    this.splitMode = (cfg.recordPort ?? 0) > 0
    this.rawLink = this.splitMode
      ? new RawTcpLink(
          cfg.recordHost || cfg.host,
          cfg.recordPort as number,
          cfg.recordFormat ?? cfg.format,
          (payload, meta) => this.handleRawPacket(payload, meta),
          () => this.rawRecorder?.shouldPause() ?? false,
          () => this.emitStatus()
        )
      : null
    this.updateWater()
  }

  isConnected(): boolean {
    return this.connected
  }

  /** 全速 raw 录制（ci16/cf32/ci8 原始 payload 直写，不做 Float32 转换） */
  async startRawRecord(opts?: RawRecordOptions): Promise<RawRecordStatus> {
    if (this.rawRecorder) {
      await this.rawRecorder.dispose()
      this.rawRecorder = null
    }
    const rm = this.rawLink?.metadata
    const rate = rm?.sampleRate || this.rawMetaSampleRate || this.cfg.sampleRate
    const center = rm
      ? rm.centerHz
      : this.rawMetaSampleRate
        ? this.rawMetaCenterHz
        : this.cfg.centerHz
    const format = rm?.format || this.rawMetaFormat
    const channels = rm?.channels || this.rawMetaChannels
    const rec = new RawIqRecorder(format, rate, center, channels)
    await rec.start(opts)
    this.rawRecorder = rec
    return rec.getStatus()
  }

  async stopRawRecord(): Promise<RawRecordStatus | null> {
    await this.rawRecorder?.stop()
    return this.rawRecorder?.getStatus() ?? null
  }

  rawRecordStatus(): RawRecordStatus | null {
    return this.rawRecorder?.getStatus() ?? null
  }

  async exportRawRecord(target: string): Promise<RawExportResult> {
    if (!this.rawRecorder) throw new Error('没有 raw 录制')
    return this.rawRecorder.exportTo(target)
  }

  async disposeRawRecorder(): Promise<void> {
    await this.rawRecorder?.dispose()
    this.rawRecorder = null
  }

  /** 建立连接；失败时 reject（重连由 close 事件负责） */ async start(): Promise<void> {
    this.stopped = false
    this.everConnected = false
    this.connected = false
    this.connecting = false
    this.seq = Array.from({ length: this.channels }, () => 0)
    this.sampleIndexes = Array.from({ length: this.channels }, () => 0)
    this.frames = 0
    this.samples = 0
    this.receivedBytes = 0
    this.bytesWindow = 0
    this.bytesPerSecond = 0
    this.rateAt = Date.now()
    this.reconnects = 0
    this.lastError = ''
    this.startedAt = 0
    this.framed = false
    this.droppedPackets = 0
    this.metaSampleRate = 0
    this.metaCenterHz = 0
    this.frameCenterHz = this.cfg.centerHz
    this.rawMetaSampleRate = 0
    this.rawMetaCenterHz = 0
    this.rawMetaFormat = this.cfg.recordFormat ?? this.cfg.format
    this.rawMetaChannels = this.channels
    this.dualMode = this.cfg.dualStream === true || this.splitMode
    this.parser.reset()
    this.rings.forEach((ring) => ring.clear())
    await this.connectOnce()
    if (this.rawLink) {
      try {
        await this.rawLink.start()
      } catch (err) {
        this.lastError = `录制端口连接失败：${err instanceof Error ? err.message : String(err)}`
        this.emitStatus()
        throw err
      }
    }
  }

  stop(): void {
    this.stopped = true
    this.stopDrain()
    this.rawLink?.stop()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const sock = this.socket
    this.socket = null
    this.connected = false
    this.parser.reset()
    if (sock) {
      // 不 removeAllListeners：保留 error 监听，避免 destroy 期间的 socket 错误变成
      // uncaughtException；close/error 处理器用 this.socket !== socket 自行忽略旧连接。
      sock.destroy()
    }
    // 显式 stop 的状态由调用方（页面/服务）刷新；这里不再广播，
    // 避免 stop 与后续 IPC 调用交错时把旧状态对象带进下一次 send。
  }

  private pushDisplayPayload(payload: Uint8Array, channels: number): void {
    if (channels !== this.channels) {
      this.lastError = `通道数 ${channels} 与配置 ${this.channels} 不一致`
      return
    }
    if (channels === 1) {
      this.rings[0]!.push(payload)
      return
    }
    const parts = splitInterleaved(payload, this.cfg.format, channels)
    parts.forEach((part, ch) => this.rings[ch]!.push(part))
  }

  private handleRawPacket(payload: Uint8Array, meta: IqPacketMeta): void {
    const expected = this.cfg.recordFormat ?? this.cfg.format
    if (meta.format !== expected) {
      this.lastError = `录制包格式 ${meta.format} 与配置 ${expected} 不一致`
      this.emitStatus()
      return
    }
    this.rawMetaSampleRate = meta.sampleRate
    this.rawMetaCenterHz = meta.centerHz
    this.rawMetaFormat = meta.format
    this.rawMetaChannels = meta.channels
    this.rawRecorder?.push(payload, meta)
  }

  /** 双流显示包：桥已经抽取过，app 不再二次抽取；按帧头采样率刷新显示节奏 */
  private applyDisplayMeta(meta: IqPacketMeta): void {
    if (meta.sampleRate > 0) {
      this.displayRate = meta.sampleRate
      this.stride = 1
      const nextPoints = resolvePointsPerFrame({
        ...this.cfg,
        sampleRate: meta.sampleRate,
        displaySampleRate: meta.sampleRate
      })
      if (nextPoints !== this.points) {
        this.points = nextPoints
        this.updateWater()
      }
    }
    this.frameCenterHz = meta.centerHz
    this.metaSampleRate = meta.sampleRate
    this.metaCenterHz = meta.centerHz
  }

  private updateWater(): void {
    const frameBytes = this.points * this.stride * this.bps
    this.highWater = Math.max(frameBytes * 4, 256 * 1024)
    this.lowWater = Math.max(frameBytes * 2, 128 * 1024)
  }

  getStatus(): NetworkSourceStatus {
    const raw = this.rawLink?.getStatus()
    return {
      connected: this.connected,
      host: this.cfg.host,
      port: this.cfg.port,
      format: this.cfg.format,
      wireSampleRate: this.cfg.sampleRate,
      channels: this.channels,
      activeChannel: 0,
      displaySampleRate: this.displayRate,
      pointsPerFrame: this.points,
      bytesPerSecond: this.bytesPerSecond,
      frames: this.frames,
      samples: this.samples,
      framed: this.framed,
      packets: this.parser.packetCount + (raw?.packets ?? 0),
      displayPackets: this.splitMode ? this.parser.packetCount : this.parser.displayPacketCount,
      rawPackets: raw ? raw.packets : this.parser.rawPacketCount,
      dualStream: this.dualMode,
      splitStream: this.splitMode,
      recordConnected: raw?.connected ?? false,
      recordReconnects: raw?.reconnects ?? 0,
      recordBytesPerSecond: raw?.bytesPerSecond ?? 0,
      recordSampleRate: this.rawMetaSampleRate || this.cfg.recordSampleRate || this.cfg.sampleRate,
      recordFormat: this.rawMetaFormat,
      droppedPackets: this.droppedPackets,
      metadataSampleRate: this.metaSampleRate,
      metadataCenterHz: this.metaCenterHz,
      droppedSamples: this.rings.reduce((sum, ring) => sum + ring.droppedSamples, 0),
      receivedBytes: this.receivedBytes,
      reconnects: this.reconnects,
      lastError: this.lastError || raw?.lastError || '',
      startedAt: this.connected ? this.startedAt : 0
    }
  }

  private connectOnce(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('已停止'))
    if (this.connecting) return Promise.reject(new Error('正在连接'))
    this.connecting = true

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const socket = net.connect({ host: this.cfg.host, port: this.cfg.port })
      this.socket = socket
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.connecting = false
        this.lastError = `连接超时（${this.cfg.host}:${this.cfg.port}）`
        this.emitStatus()
        socket.destroy()
        reject(new Error(this.lastError))
      }, CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.connecting = false
        this.connected = true
        this.everConnected = true
        this.lastError = ''
        this.startedAt = Date.now()
        this.rateAt = Date.now()
        this.bytesWindow = 0
        this.parser.reset()
        this.framed = false
        this.droppedPackets = 0
        this.metaSampleRate = 0
        this.metaCenterHz = 0
        this.frameCenterHz = this.cfg.centerHz
        this.rawMetaSampleRate = 0
        this.rawMetaCenterHz = 0
        this.rawMetaFormat = this.cfg.recordFormat ?? this.cfg.format
        this.rawMetaChannels = this.channels
        this.dualMode = this.cfg.dualStream === true || this.splitMode
        this.rings.forEach((ring) => ring.clear())
        this.startDrain()
        this.emitStatus()
        resolve()
      })

      socket.on('data', (chunk: Buffer) => {
        if (this.socket !== socket) return
        this.receivedBytes += chunk.length
        this.bytesWindow += chunk.length
        this.parser.push(chunk, (payload, meta) => {
          // 独立端口：显示连接只喂显示环；raw 在 RawTcpLink 单独处理
          if (this.splitMode) {
            if (!meta) return
            if (meta.format !== this.cfg.format) {
              this.lastError = `显示包格式 ${meta.format} 与配置 ${this.cfg.format} 不一致`
              return
            }
            this.applyDisplayMeta(meta)
            this.pushDisplayPayload(payload, meta.channels)
            return
          }
          const msgType = meta?.msgType ?? 1
          if (msgType === 4) {
            if (!meta) return
            if (meta.format !== this.cfg.format) {
              this.lastError = `显示包格式 ${meta.format} 与配置 ${this.cfg.format} 不一致`
              return
            }
            this.dualMode = true
            this.applyDisplayMeta(meta)
            this.pushDisplayPayload(payload, meta.channels)
            return
          }
          // msgType=1：raw/full
          if (meta) {
            this.rawMetaSampleRate = meta.sampleRate
            this.rawMetaCenterHz = meta.centerHz
            this.rawMetaFormat = meta.format
            this.rawMetaChannels = meta.channels
          }
          this.rawRecorder?.push(payload, meta)
          if (!this.dualMode) {
            if (meta) {
              if (meta.format !== this.cfg.format) {
                this.lastError = `帧头格式 ${meta.format} 与配置 ${this.cfg.format} 不一致`
                return
              }
              this.frameCenterHz = meta.centerHz
              this.metaSampleRate = meta.sampleRate
              this.metaCenterHz = meta.centerHz
              if (meta.sampleRate > 0 && meta.sampleRate !== this.cfg.sampleRate) {
                this.lastError = `帧头采样率 ${meta.sampleRate} 与配置 ${this.cfg.sampleRate} 不一致，频率轴可能错误`
              }
            }
            this.pushDisplayPayload(payload, meta?.channels ?? 1)
          }
        })
        this.framed = this.parser.isFramed
        this.droppedPackets = this.parser.droppedPackets
        if (socket.isPaused()) return
        const ringHigh = this.rings.some((ring) => ring.availableBytes > this.highWater)
        if (ringHigh || this.rawRecorder?.shouldPause()) socket.pause()
      })

      socket.once('error', (err: Error) => {
        if (this.socket !== socket) return
        this.lastError = err.message
        this.emitStatus()
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.connecting = false
        this.connected = false
        reject(err)
      })

      socket.once('close', () => {
        // 旧 socket 的 close 不能影响新连接（重连竞态）
        if (this.socket !== socket) return
        clearTimeout(timer)
        const wasConnected = this.connected
        this.connected = false
        this.connecting = false
        this.stopDrain()
        if (wasConnected) this.emitStatus()
        if (this.everConnected && !this.stopped && this.cfg.reconnect !== false) {
          this.scheduleReconnect()
        }
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const attempt = Math.min(this.reconnects, 3)
    const delay = Math.min(10_000, 1000 * 2 ** attempt)
    this.reconnects++
    this.lastError = `连接断开，${delay / 1000}s 后重连（第 ${this.reconnects} 次）`
    this.emitStatus()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      this.connectOnce().catch(() => {
        // error/close 会继续安排下一次重连
      })
    }, delay)
  }

  private startDrain(): void {
    this.stopDrain()
    this.timer = setInterval(() => this.drain(), DRAIN_INTERVAL_MS)
  }

  private stopDrain(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private drain(): void {
    if (!this.connected) return
    const now = Date.now()
    if (now - this.rateAt >= 1000) {
      this.bytesPerSecond = this.bytesWindow / ((now - this.rateAt) / 1000)
      this.bytesWindow = 0
      this.rateAt = now
      this.emitStatus()
    }

    for (let ch = 0; ch < this.channels; ch++) {
      const data = this.rings[ch]!.read(this.points, this.stride)
      if (!data) continue
      const timestamp = (this.sampleIndexes[ch]! / this.displayRate) * 1000
      this.sampleIndexes[ch] = this.sampleIndexes[ch]! + this.points
      this.seq[ch] = this.seq[ch]! + 1
      this.frames++
      this.samples += this.points
      this.opts.onFrame({
        seq: this.seq[ch]!,
        timestamp,
        wallTimestamp: now,
        sampleRate: this.displayRate,
        centerFrequencyHz: this.frameCenterHz,
        outputMode: 'complex',
        waveform: 'network',
        modType: 'sine',
        samplesPerSymbol: 1,
        amplitude: 1,
        data,
        channel: ch
      })
    }

    this.maybeResume()
  }

  /** 只有环形缓冲和 raw 录制都不再高水位时才恢复 TCP */
  private maybeResume(): void {
    this.rawLink?.maybeResume()
    const sock = this.socket
    if (!sock?.isPaused()) return
    if (this.rings.some((ring) => ring.availableBytes >= this.lowWater)) return
    if (this.rawRecorder?.shouldPause()) return
    sock.resume()
  }

  private emitStatus(): void {
    this.opts.onStatus?.(this.getStatus())
  }
}
