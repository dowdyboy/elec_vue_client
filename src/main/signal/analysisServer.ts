/**
 * 信号分析服务端（统一抽象，替代原 signalMockServer）
 * 【设计】信号处理（FFT / 窗 / dB / 重叠）全部在此完成：
 *   - LocalAnalysisSource：消费独立 SourceService 的 SourceFrame，计算频谱/时频（演示用）
 *   - RemoteAnalysisSource：连接外部 socket.io 后端，消费其算好的帧
 *   渲染进程只通过 IPC 'signal:analysis' 收「显示就绪」帧，不感知来源。
 *
 * 外部后端协议（RemoteAnalysisSource 消费）：
 *   emit('signal:analysis', { type:0|1|2, seq, fftSize?, buffer })  // buffer 为 Float32Array 的二进制
 *   后端可反过来接收：
 *   on('signal:analysis:config', patch)  // 配置下发
 *   on('signal:analysis:trigger')        // 触发单帧
 */

import { BrowserWindow, ipcMain } from 'electron'
import { io as socketIoClient, type Socket as ClientSocket } from 'socket.io-client'
import {
  defaultAnalysisConfig,
  FRAME_TYPE_BY_CODE,
  sanitizeConfigPatch,
  type AnalysisFrame,
  type ModType,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { getSourceService, type SourceService } from '../source/sourceService'
import type { SourceFrame } from '../../shared/sourceEngine'
import { SpectrogramAccumulator, SpectrumAnalyzer } from '../../shared/signalFrames'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

/** 仍在接收信号帧的 webContents（引用计数，由渲染进程 subscribe/unsubscribe 维护） */
const analysisSubscribers = new Map<number, number>()
/** 已挂过 destroyed 监听的 webContents，避免重复挂 */
const analysisWatchedSenders = new Set<number>()
/** 未知远端帧类型的告警节流 */
let lastUnknownTypeAt = 0
/** 不支持的 typed-array 负载告警节流 */
let lastTypedArrayWarnAt = 0

export interface SignalAnalysisSource {
  readonly mode: 'local' | 'remote'
  start(onFrame: (f: AnalysisFrame) => void): void
  stop(): void
  setConfig(patch: Partial<SignalAnalysisConfig>): void
  getConfig(): SignalAnalysisConfig
  trigger(): void
}

// ──────────────────────────────────────────────────
// 本地分析：消费 SourceService 的 SourceFrame，只做 FFT/时频
// ──────────────────────────────────────────────────

/** 从源配置提取输出域字段；FFT/窗/重叠仍归分析器所有 */
function sourceFields(c: SignalAnalysisConfig): Partial<SignalAnalysisConfig> {
  return {
    freq: c.freq,
    snr: c.snr,
    amplitude: c.amplitude,
    modType: c.modType,
    outputMode: c.outputMode,
    waveform: c.waveform,
    modFreq: c.modFreq,
    amDepth: c.amDepth,
    fmDeviation: c.fmDeviation,
    pulsePeriod: c.pulsePeriod,
    pulseDuty: c.pulseDuty,
    toneSpacing: c.toneSpacing,
    sampleRate: c.sampleRate,
    pointsPerFrame: c.pointsPerFrame,
    samplesPerSymbol: c.samplesPerSymbol,
    ofdmSubcarriers: c.ofdmSubcarriers,
    ofdmCpRatio: c.ofdmCpRatio,
    enabled: c.enabled,
    imageDb: c.imageDb
  }
}

class LocalAnalysisSource implements SignalAnalysisSource {
  readonly mode = 'local' as const
  private config: SignalAnalysisConfig
  private seq = 0
  private acc = new SpectrogramAccumulator()
  /** 跨帧频谱分析器：pointsPerFrame < fftSize 时凑满窗再算，避免零填充 */
  private spec = new SpectrumAnalyzer()
  /** 源由独立 SourceService 生成；分析只订阅 SourceFrame */
  private sourceService: SourceService
  private sourceUnsub: (() => void) | null = null
  private ownsSource = false
  private onFrame: ((f: AnalysisFrame) => void) | null = null
  private lastErrAt = 0
  /** 消费者守卫：无订阅者且无外部 socket 观众时跳过重计算 */
  hasConsumers: (() => boolean) | null = null

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    this.sourceService = getSourceService()
  }

  start(onFrame: (f: AnalysisFrame) => void): void {
    this.onFrame = onFrame
    if (this.sourceUnsub) return
    const st = this.sourceService.getStatus()
    if (!st.running) {
      this.sourceService.setConfig(this.config)
      this.sourceService.start()
      this.ownsSource = true
    } else {
      // 源已在源工作台运行：以源配置为准，保留本分析器的 FFT/窗参数
      this.config = { ...this.config, ...sourceFields(st.config) }
    }
    this.sourceUnsub = this.sourceService.subscribe((frame) => this.handleSourceFrame(frame))
  }

  stop(): void {
    this.sourceUnsub?.()
    this.sourceUnsub = null
    if (this.ownsSource) {
      this.sourceService.stop()
      this.ownsSource = false
    }
    this.onFrame = null
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.sourceService.setConfig(patch)
    this.acc.reset()
    this.spec.reset()
  }

  getConfig(): SignalAnalysisConfig {
    return { ...this.config }
  }

  trigger(): void {
    if (!this.sourceService.getStatus().running) {
      this.sourceService.setConfig(this.config)
      this.sourceService.start()
      this.ownsSource = true
    }
    this.sourceService.trigger()
  }

  private logError(e: unknown): void {
    const now = Date.now()
    if (now - this.lastErrAt > 5000) {
      this.lastErrAt = now
      console.error('[signal:local] tick failed', e)
    }
  }

  private handleSourceFrame(frame: SourceFrame): void {
    if (!this.onFrame) return
    if (this.hasConsumers && !this.hasConsumers()) return
    try {
      const cfg = this.config
      const iq = frame.data
      const seq = ++this.seq
      const sampleRate = frame.sampleRate
      // IQ（时域图）
      this.onFrame({
        type: 'iq',
        seq,
        data: iq,
        sampleRate,
        carrierHz: frame.centerFrequencyHz,
        samplesPerSymbol: frame.samplesPerSymbol,
        outputMode: frame.outputMode,
        waveform: frame.waveform,
        modType: frame.modType
      })
      // 频谱（跨帧凑满 fftSize；窗增益已在 computeSpectrumRow 内补偿）
      const spec = this.spec.push(iq, cfg)
      if (spec) {
        this.onFrame({
          type: 'spectrum',
          seq,
          data: spec,
          fftSize: cfg.fftSize,
          sampleRate,
          carrierHz: frame.centerFrequencyHz,
          samplesPerSymbol: frame.samplesPerSymbol,
          dbScale: cfg.dbScale,
          spectrumMode: cfg.spectrumMode,
          freqStartHz: cfg.spectrumMode === 'complex' ? -sampleRate / 2 : 0,
          binHz: sampleRate / cfg.fftSize,
          fftShift: cfg.spectrumMode === 'complex',
          outputMode: frame.outputMode,
          waveform: frame.waveform,
          modType: frame.modType
        })
      }
      // 时频（重叠行，固定 dB 行——与谱图的 dbScale 显示开关解耦）
      const rows = this.acc.push(iq, cfg)
      for (const row of rows) {
        this.onFrame({
          type: 'spectrogram',
          seq: ++this.seq,
          data: row,
          fftSize: cfg.fftSize,
          sampleRate,
          carrierHz: frame.centerFrequencyHz,
          samplesPerSymbol: frame.samplesPerSymbol,
          dbScale: true,
          spectrumMode: cfg.spectrumMode,
          freqStartHz: cfg.spectrumMode === 'complex' ? -sampleRate / 2 : 0,
          binHz: sampleRate / cfg.fftSize,
          fftShift: cfg.spectrumMode === 'complex',
          timeStepSec: (cfg.fftSize * (1 - cfg.overlap)) / sampleRate,
          outputMode: frame.outputMode,
          waveform: frame.waveform,
          modType: frame.modType
        })
      }
    } catch (e) {
      // 防御：非法配置（如非 2 的幂 fftSize）不应让主进程定时器反复抛未捕获异常
      this.logError(e)
    }
  }
}

// ──────────────────────────────────────────────────
// 远程后端（socket.io 客户端）
// ──────────────────────────────────────────────────

/** 字节流 → Float32Array（先拷贝到对齐缓冲，避免池化 Buffer 的 byteOffset 陷阱） */
function bytesToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) return new Float32Array(0)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}

function toFloat32(buffer: unknown): Float32Array {
  if (!buffer) return new Float32Array(0)
  if (buffer instanceof ArrayBuffer) return bytesToFloat32(new Uint8Array(buffer))
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer))
    return bytesToFloat32(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  if (buffer instanceof Float32Array) return buffer
  if (buffer instanceof Uint8Array) return bytesToFloat32(buffer)
  if (buffer instanceof DataView)
    return bytesToFloat32(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  if (ArrayBuffer.isView(buffer)) {
    // Int16/Int32/Float64 等：协议约定 Float32 二进制；按字节重新解释只会得到垃圾数据，
    // 这里显式丢弃并告警（比静默画出一条错误谱线更容易定位）。
    const now = Date.now()
    if (now - lastTypedArrayWarnAt > 5000) {
      lastTypedArrayWarnAt = now
      const name = (buffer as object).constructor?.name ?? 'unknown'
      console.warn(`[signal:remote] unsupported typed-array payload: ${name} (expect Float32Array)`)
    }
    return new Float32Array(0)
  }
  if (Array.isArray(buffer)) {
    try {
      return new Float32Array(buffer as number[])
    } catch {
      return new Float32Array(0)
    }
  }
  if (typeof buffer === 'string') {
    try {
      return bytesToFloat32(Buffer.from(buffer, 'base64'))
    } catch {
      return new Float32Array(0)
    }
  }
  if (typeof buffer === 'object') {
    const obj = buffer as Record<string, unknown>
    // 兼容 {data: number[]}（含 JSON 反序列化出的 {type:'Buffer', data:[...]} 形态）
    if (Array.isArray(obj.data)) {
      try {
        return new Float32Array(obj.data as number[])
      } catch {
        return new Float32Array(0)
      }
    }
  }
  return new Float32Array(0)
}

function extractRemotePayload(p: Record<string, unknown>): unknown {
  // 容错：buffer / data / payload / samples / timeData / i / payloadData 等
  return (
    p.buffer ?? p.data ?? p.payload ?? p.samples ?? p.timeData ?? (p.payloadData as unknown) ?? p
  )
}

function parseRemoteType(raw: unknown): import('../../shared/signal').AnalysisFrameType | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return FRAME_TYPE_BY_CODE[raw] ?? null
  }
  if (typeof raw === 'string') {
    const s = raw.toLowerCase()
    if (s === 'spectrum' || s === 'spectrogram' || s === 'iq')
      return s as import('../../shared/signal').AnalysisFrameType
    const map: Record<string, import('../../shared/signal').AnalysisFrameType> = {
      '0': 'spectrum',
      '1': 'spectrogram',
      '2': 'iq',
      psd: 'spectrum',
      waterfall: 'spectrogram'
    }
    if (map[s]) return map[s]
    // string numeric "0"/"1"/"2"
    const n = Number(s)
    if (!Number.isNaN(n)) return FRAME_TYPE_BY_CODE[n] ?? null
  }
  // 未知类型不再静默按 IQ 解释（会把频谱/时频数据画成时域波形）
  return null
}

function parseRemoteModType(raw: unknown): ModType | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toUpperCase()
  if (s === 'SINE' || s === 'BPSK' || s === 'QPSK' || s === '16QAM') return s as ModType
  return undefined
}

class RemoteAnalysisSource implements SignalAnalysisSource {
  readonly mode = 'remote' as const
  private config: SignalAnalysisConfig
  private sock: ClientSocket | null = null
  private onFrame: ((f: AnalysisFrame) => void) | null = null
  private url: string

  constructor(
    private rawUrl: string,
    initial?: SignalAnalysisConfig,
    private onStatus?: (s: { connected: boolean; error?: string }) => void
  ) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    // socket.io 需 http(s) 握手，若传入 ws(s) 则转 http(s)
    if (rawUrl.startsWith('ws://')) this.url = 'http://' + rawUrl.slice(5)
    else if (rawUrl.startsWith('wss://')) this.url = 'https://' + rawUrl.slice(6)
    else this.url = rawUrl
  }

  start(onFrame: (f: AnalysisFrame) => void): void {
    this.onFrame = onFrame
    console.log(`[signal:remote] connecting to ${this.url} (raw=${this.rawUrl})`)
    this.sock = socketIoClient(this.url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      timeout: 5000
    })
    this.sock.on('signal:analysis', (raw: unknown) => {
      try {
        const p = (raw ?? {}) as Record<string, unknown>
        const rawType = p.type as unknown
        const type = parseRemoteType(rawType)
        if (!type) {
          const now = Date.now()
          if (now - lastUnknownTypeAt > 5000) {
            lastUnknownTypeAt = now
            console.warn('[signal:remote] unknown frame type, dropped:', rawType)
          }
          return
        }
        const seq = typeof p.seq === 'number' ? p.seq : Date.now()
        const fftSize =
          typeof p.fftSize === 'number'
            ? p.fftSize
            : typeof p.fft_size === 'number'
              ? (p.fft_size as number)
              : undefined
        const modType = parseRemoteModType(p.modType) ?? parseRemoteModType(p.mod_type)
        const sampleRate =
          typeof p.sampleRate === 'number'
            ? p.sampleRate
            : typeof p.sample_rate === 'number'
              ? (p.sample_rate as number)
              : undefined
        const dbScale =
          typeof p.dbScale === 'boolean'
            ? p.dbScale
            : typeof p.dbScale === 'number'
              ? p.dbScale !== 0
              : undefined
        const timeStepSec =
          typeof p.timeStepSec === 'number'
            ? p.timeStepSec
            : typeof p.time_step_sec === 'number'
              ? (p.time_step_sec as number)
              : undefined
        const spectrumMode =
          p.spectrumMode === 'complex' || p.spectrumMode === 'real'
            ? p.spectrumMode
            : p.spectrum_mode === 'complex' || p.spectrum_mode === 'real'
              ? p.spectrum_mode
              : undefined
        const outputMode =
          p.outputMode === 'complex' || p.outputMode === 'real'
            ? p.outputMode
            : p.output_mode === 'complex' || p.output_mode === 'real'
              ? p.output_mode
              : undefined
        const carrierHz =
          typeof p.carrierHz === 'number'
            ? p.carrierHz
            : typeof p.carrier_hz === 'number'
              ? p.carrier_hz
              : typeof p.freq === 'number'
                ? p.freq
                : undefined
        const samplesPerSymbol =
          typeof p.samplesPerSymbol === 'number'
            ? p.samplesPerSymbol
            : typeof p.samples_per_symbol === 'number'
              ? p.samples_per_symbol
              : undefined
        const waveform =
          typeof p.waveform === 'string' &&
          ['cw', 'am', 'fm', 'pulse', 'twoTone', 'noise', 'digital'].includes(p.waveform)
            ? (p.waveform as import('../../shared/signal').SourceWaveform)
            : undefined
        const freqStartHz =
          typeof p.freqStartHz === 'number'
            ? p.freqStartHz
            : typeof p.freq_start_hz === 'number'
              ? (p.freq_start_hz as number)
              : undefined
        const binHz =
          typeof p.binHz === 'number'
            ? p.binHz
            : typeof p.bin_hz === 'number'
              ? (p.bin_hz as number)
              : undefined
        const fftShift =
          typeof p.fftShift === 'boolean'
            ? p.fftShift
            : typeof p.fft_shift === 'boolean'
              ? (p.fft_shift as boolean)
              : undefined
        const payload = extractRemotePayload(p)
        let data: Float32Array
        if (
          payload &&
          typeof payload === 'object' &&
          !ArrayBuffer.isView(payload as ArrayBufferView) &&
          !(payload instanceof ArrayBuffer) &&
          !Array.isArray(payload) &&
          typeof (payload as Record<string, unknown>).buffer !== 'string'
        ) {
          const obj = payload as Record<string, unknown>
          const hasIQ =
            (Array.isArray(obj.i) ||
              obj.i instanceof Float32Array ||
              ArrayBuffer.isView(obj.i as ArrayBufferView)) &&
            (Array.isArray(obj.q) ||
              obj.q instanceof Float32Array ||
              ArrayBuffer.isView(obj.q as ArrayBufferView))
          const hasCh =
            (Array.isArray(obj.ch0) || Array.isArray(obj.I) || Array.isArray(obj.iData)) &&
            (Array.isArray(obj.ch1) || Array.isArray(obj.Q) || Array.isArray(obj.qData))
          if (hasIQ || hasCh) {
            const getArr = (v: unknown): number[] | null => {
              if (Array.isArray(v)) return v as number[]
              if (v instanceof Float32Array) return Array.from(v)
              if (ArrayBuffer.isView(v as ArrayBufferView))
                return Array.from(v as unknown as number[])
              return null
            }
            const iArr = getArr(obj.i ?? obj.I ?? obj.ch0 ?? obj.iData)
            const qArr = getArr(obj.q ?? obj.Q ?? obj.ch1 ?? obj.qData)
            if (iArr && qArr) {
              const n = Math.min(iArr.length, qArr.length)
              const inter = new Float32Array(n * 2)
              for (let k = 0; k < n; k++) {
                inter[2 * k] = iArr[k] ?? 0
                inter[2 * k + 1] = qArr[k] ?? 0
              }
              data = inter
            } else {
              data = toFloat32(payload)
            }
          } else if (typeof obj.data === 'string' && typeof payload === 'object') {
            data = toFloat32(obj.data)
          } else {
            data = toFloat32(payload)
          }
        } else {
          data = toFloat32(payload)
        }
        if (!data || data.length === 0) {
          console.warn('[signal:remote] empty payload', {
            keys: Object.keys(p),
            rawType,
            fftSize,
            payloadType: payload
              ? ((payload as object).constructor?.name ?? typeof payload)
              : 'null'
          })
        }
        this.onFrame?.({
          type,
          seq,
          data: data ?? new Float32Array(0),
          fftSize,
          sampleRate,
          dbScale,
          timeStepSec,
          spectrumMode,
          outputMode,
          carrierHz,
          samplesPerSymbol,
          waveform,
          freqStartHz,
          binHz,
          fftShift,
          modType
        })
      } catch (e) {
        console.error('[signal:remote] parse failed', e)
      }
    })
    this.sock.on('connect', () => {
      this.sock?.emit('signal:analysis:config', this.config)
      this.onStatus?.({ connected: true })
    })
    this.sock.on('disconnect', (reason: string) => {
      this.onStatus?.({ connected: false, error: `disconnect: ${reason}` })
    })
    let lastErrMsg = ''
    this.sock.on('connect_error', (err: Error) => {
      const rawMsg = err?.message ?? String(err)
      if (rawMsg === lastErrMsg) return
      lastErrMsg = rawMsg
      // 常见：远端未启动 / 非 socket.io / 端口/协议错
      const hint =
        rawMsg.includes('websocket error') || rawMsg.includes('xhr poll error')
          ? ` (url=${this.url}) - 请确认已在独立终端运行: npm run mock:remote 或 node scripts/remote-signal-mock.mjs`
          : ` (url=${this.url})`
      const msg = `${rawMsg}${hint}`
      console.error('[signal:remote] connect_error', msg)
      this.onStatus?.({ connected: false, error: msg })
      // 避免刷屏：3秒后允许再次提示
      setTimeout(() => {
        lastErrMsg = ''
      }, 3000)
    })
  }

  stop(): void {
    this.sock?.close()
    this.sock = null
    this.onFrame = null
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.sock?.emit('signal:analysis:config', patch)
  }

  getConfig(): SignalAnalysisConfig {
    return { ...this.config }
  }

  trigger(): void {
    this.sock?.emit('signal:analysis:trigger')
  }
}

// ──────────────────────────────────────────────────
// 注册（主进程）：本地 SourceFrame 消费者 / 远程 socket 客户端 → 渲染进程
// ──────────────────────────────────────────────────

export function registerSignalAnalysisServer(): () => void {
  let source: SignalAnalysisSource | null = null
  // 持久化配置（未运行时保留，供下次 start；setConfig 即时更新运行中的 source）
  let persistedConfig: SignalAnalysisConfig = defaultAnalysisConfig()
  let persistedRemoteUrl = 'http://127.0.0.1:8768'
  let lastEmptyWarnAt = 0

  function isValidUrl(u: string): boolean {
    try {
      const parsed = new URL(u)
      return (
        parsed.protocol === 'http:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'ws:' ||
        parsed.protocol === 'wss:'
      )
    } catch {
      return false
    }
  }

  function emitFrame(f: AnalysisFrame): void {
    if (!f.data || f.data.length === 0) {
      const now = Date.now()
      if (now - lastEmptyWarnAt > 5000) {
        lastEmptyWarnAt = now
        console.warn('[signal] emit empty frame', f.type, f.seq)
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('signal:analysis', f)
    }
  }

  function broadcastRemoteStatus(s: { connected: boolean; error?: string; url?: string }): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('signal:analysis:status', s)
    }
  }

  ipcMain.handle(
    'signalAnalysis:start',
    async (e, opts?: { mode?: 'local' | 'remote'; port?: number; remoteUrl?: string }) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      if (source) return { ok: false, error: '已运行，请先停止' }
      const mode = opts?.mode ?? 'local'
      // 本地分析是纯 IPC SourceFrame 消费者，不监听端口；port 仅保留给远端 Mock/旧调用兼容
      if (mode === 'remote') {
        const u = opts?.remoteUrl ?? persistedRemoteUrl
        if (!isValidUrl(u)) return { ok: false, error: `remoteUrl 非法: ${u}` }
      } else if (mode !== 'local') {
        return { ok: false, error: `未知模式: ${mode}` }
      }
      try {
        if (mode === 'remote') {
          const u = opts?.remoteUrl ?? persistedRemoteUrl
          persistedRemoteUrl = u
          source = new RemoteAnalysisSource(u, persistedConfig, (s) =>
            broadcastRemoteStatus({ ...s, url: u })
          )
          // 立即告知前端“连接中”
          broadcastRemoteStatus({ connected: false, url: u })
          source.start(emitFrame)
          return { ok: true, mode, remoteUrl: persistedRemoteUrl }
        } else {
          const local = new LocalAnalysisSource(persistedConfig)
          local.hasConsumers = () => analysisSubscribers.size > 0
          source = local
          local.start(emitFrame)
          return { ok: true, mode, port: 0, remoteUrl: persistedRemoteUrl }
        }
      } catch (err) {
        source = null
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('signalAnalysis:stop', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const wasRemote = source?.mode === 'remote'
    source?.stop()
    source = null
    if (wasRemote)
      broadcastRemoteStatus({ connected: false, error: 'stopped', url: persistedRemoteUrl })
    return { ok: true }
  })

  ipcMain.handle('signalAnalysis:getStatus', () => ({
    running: source !== null,
    mode: source?.mode ?? 'none',
    port: 0,
    remoteUrl: persistedRemoteUrl,
    config: source?.getConfig() ?? persistedConfig
  }))

  ipcMain.handle('signalAnalysis:setConfig', (e, patch: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    // 即时生效：校验 → 更新持久化配置 → 同步运行中的 source（FFT/窗等变更由前端组件自适应）
    const res = sanitizeConfigPatch(patch)
    if (!res.ok || !res.value) return { ok: false, error: res.error }
    const merged = { ...persistedConfig, ...res.value }
    if (!(merged.freq > 0 && merged.freq < merged.sampleRate / 2))
      return {
        ok: false,
        error: `freq(${merged.freq}) 须小于 sampleRate/2(${merged.sampleRate / 2})`
      }
    persistedConfig = merged
    if (source) source.setConfig(res.value)
    // remoteUrl 若随配置下发（可选），同步处理
    const maybeUrl = (patch as Record<string, unknown>).remoteUrl
    if (typeof maybeUrl === 'string' && maybeUrl && isValidUrl(maybeUrl))
      persistedRemoteUrl = maybeUrl
    return {
      ok: true,
      config: source?.getConfig() ?? persistedConfig,
      remoteUrl: persistedRemoteUrl
    }
  })

  ipcMain.handle('signalAnalysis:trigger', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    source?.trigger()
    return { ok: true }
  })

  // 订阅登记：只有真正有人看图时才做 60fps 的生成/FFT/IPC（按 webContents 引用计数）
  ipcMain.handle('signalAnalysis:subscribe', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const id = e.sender.id
    analysisSubscribers.set(id, (analysisSubscribers.get(id) ?? 0) + 1)
    if (!analysisWatchedSenders.has(id)) {
      analysisWatchedSenders.add(id)
      e.sender.once('destroyed', () => {
        analysisWatchedSenders.delete(id)
        analysisSubscribers.delete(id)
      })
    }
    return { ok: true }
  })
  ipcMain.handle('signalAnalysis:unsubscribe', (e) => {
    const id = e.sender.id
    const left = (analysisSubscribers.get(id) ?? 0) - 1
    if (left > 0) analysisSubscribers.set(id, left)
    else analysisSubscribers.delete(id)
    return { ok: true }
  })

  return () => {
    source?.stop()
    source = null
    ipcMain.removeHandler('signalAnalysis:start')
    ipcMain.removeHandler('signalAnalysis:stop')
    ipcMain.removeHandler('signalAnalysis:getStatus')
    ipcMain.removeHandler('signalAnalysis:setConfig')
    ipcMain.removeHandler('signalAnalysis:trigger')
    ipcMain.removeHandler('signalAnalysis:subscribe')
    ipcMain.removeHandler('signalAnalysis:unsubscribe')
  }
}
