/**
 * SourceService（主进程独立源服务）
 *
 * - 持有 SourceEngine / Playback / 录制器
 * - 通过 source:frame 推送 SourceFrame，不做 FFT/时频
 * - LocalAnalysisSource 消费同一 SourceFrame 生成 signal:analysis
 * - 支持模拟源、录制回放、任意 IQ、内存/流式录制
 */
import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { defaultAnalysisConfig, type SignalAnalysisConfig } from '../../shared/signal'
import { SourceEngine, type SourceFrame } from '../../shared/sourceEngine'
import {
  defaultDualSimConfig,
  sanitizeDualSimConfig,
  type DualSimConfig
} from '../../shared/sourceDualSim'
import { PlaybackOutputBackend, SimulatedOutputBackend } from '../../shared/sourceBackend'
import { SourcePlayback, type PlaybackSource } from '../../shared/sourcePlayback'
import { SourceRecorder } from '../../shared/sourceRecorder'
import type { RecordedFrameMeta } from '../../shared/sourceRecorder'
import { SourceStreamRecorder } from './streamRecorder'
import { TcpIqSource } from './network/tcpIqSource'
import { RawIqPlayback, type RawPlaybackConfig } from './network/rawIqPlayback'
import { RawArchivePlayback, type RawArchivePlaybackConfig } from './network/rawArchivePlayback'
import type { NetworkSourceConfig, NetworkSourceStatus } from '../../shared/sourceNetwork'

export interface SourceStatus {
  running: boolean
  mode: 'live' | 'playback'
  backend: 'simulated' | 'playback' | 'network' | 'dual-sim'
  /** 回放是否处于暂停（live 恒为 false） */
  paused: boolean
  config: SignalAnalysisConfig
  /** 网络源状态（仅 backend=network 时存在） */
  network?: NetworkSourceStatus
}

export class SourceService {
  private engine: SourceEngine
  private config: SignalAnalysisConfig
  private liveBackend: SimulatedOutputBackend
  private playbackBackend: PlaybackOutputBackend | null = null
  private timer: NodeJS.Timeout | null = null
  private playbackTimer: NodeJS.Timeout | null = null
  private playbackTiming: 'fixed' | 'timestamp' = 'fixed'
  private frameSeq = 0
  private subscribers = new Set<(frame: SourceFrame) => void>()
  /** 渲染进程窗口订阅计数（source:frame 只投递给订阅窗口） */
  private windowSubscribers = new Map<number, number>()
  private dualWindowSubscribers = new Map<number, number>()
  private recorder = new SourceRecorder()
  private streamRecorder = new SourceStreamRecorder()
  private recordMode: 'memory' | 'stream' | 'raw' = 'memory'
  private playback: PlaybackSource | null = null
  private playbackSpeed = 1
  /** 当前网络源（GNU Radio / TCP IQ）；与 simulated/playback 互斥 */
  private network: TcpIqSource | null = null
  private activeChannel = 0
  private dualSimTimer: NodeJS.Timeout | null = null
  private dualSimEngines: [SourceEngine, SourceEngine] | null = null
  private dualSimConfig: DualSimConfig | null = null
  /** 当前录制是否已导出成功（start 置 false；导出成功后置 true） */
  private recordExported = true

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    this.engine = new SourceEngine(this.config)
    this.liveBackend = new SimulatedOutputBackend(this.engine, () => this.config.pointsPerFrame)
  }

  start(): void {
    this.stopDualSim()
    this.stopNetwork()
    this.playback?.dispose?.()
    this.playback = null
    this.playbackBackend = null
    this.clearTimers()
    this.startTimer()
  }

  private startTimer(): void {
    if (this.timer) return
    // 回放倍速只作用于回放；直播源固定 60fps（否则 4x 回放后直播会变成 240fps）
    const speed = this.playbackBackend ? this.playbackSpeed : 1
    const interval = Math.max(4, Math.round(1000 / 60 / speed))
    this.timer = setInterval(() => this.tick(), interval)
  }

  private clearTimers(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
  }

  setPlaybackSpeed(speed: number): boolean {
    const allowed = [0.25, 0.5, 1, 2, 4]
    if (!allowed.includes(speed)) return false
    this.playbackSpeed = speed
    // 没有回放对象时倍速不影响直播源；回放暂停时也不应重启空闲定时器
    if (!this.playback) return true
    const st = this.playback.getStatus()
    if (!st.playing || st.paused) return true
    if (this.playbackTiming === 'timestamp') {
      this.scheduleTimestampPlayback()
    } else if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.startTimer()
    }
    return true
  }

  setPlaybackTiming(timing: 'fixed' | 'timestamp'): boolean {
    if (timing !== 'fixed' && timing !== 'timestamp') return false
    this.playbackTiming = timing
    if (this.playback) {
      this.clearTimers()
      const st = this.playback.getStatus()
      if (!st.playing || st.paused) return true
      if (timing === 'fixed') this.startTimer()
      else this.scheduleTimestampPlayback()
    }
    return true
  }

  setPlaybackLoop(loop: boolean): boolean {
    if (!this.playback) return false
    this.playback.setLoop(!!loop)
    return true
  }

  seekPlayback(index: number): boolean {
    if (!this.playback) return false
    const ok = this.playback.seek(index)
    if (ok && this.playbackTiming === 'timestamp') this.scheduleTimestampPlayback()
    return ok
  }

  startPlayback(): boolean {
    if (!this.playback) return false
    this.clearTimers()
    this.playback.start()
    if (this.playbackTiming === 'timestamp') this.scheduleTimestampPlayback()
    else this.startTimer()
    return true
  }

  pausePlayback(): boolean {
    if (!this.playback) return false
    this.playback.pause()
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    // 固定帧率模式暂停时停掉空闲定时器：否则 running 仍为 true，且每秒空转 60 次
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    return true
  }

  resumePlayback(): boolean {
    if (!this.playback) return false
    const st = this.playback.getStatus()
    if (!st.playing) return false
    this.playback.resume()
    if (this.playbackTiming === 'timestamp') this.scheduleTimestampPlayback()
    else this.startTimer()
    return true
  }

  stepPlayback(): boolean {
    if (!this.playback) return false
    this.playback.pause()
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    const frame = this.playback.step()
    if (!frame) return false
    this.emitFrame(frame)
    return true
  }

  stopPlayback(): void {
    this.playback?.stop()
    this.playback?.dispose?.()
    this.playback = null
    this.playbackBackend = null
    this.clearTimers()
  }

  async loadPlayback(frames: SourceFrame[]): Promise<boolean> {
    if (frames.length === 0) return false
    this.stopDualSim()
    await this.disposeNetworkAsync()
    await this.recordStop()
    this.recorder.reset()
    this.streamRecorder.dispose()
    this.recordMode = 'memory'
    this.clearTimers()
    this.playback?.dispose?.()
    this.playback = new SourcePlayback(frames)
    this.playbackBackend = new PlaybackOutputBackend(this.playback)
    return true
  }

  /** 载入网络源 raw 录制（ci16/cf32/ci8），按显示率抽取回放 */
  async loadRawPlayback(cfg: RawPlaybackConfig): Promise<boolean> {
    this.stopDualSim()
    await this.disposeNetworkAsync()
    await this.recordStop()
    this.recorder.reset()
    this.streamRecorder.dispose()
    this.recordMode = 'memory'
    this.clearTimers()
    this.playback?.dispose?.()
    this.playback = new RawIqPlayback(cfg)
    this.playbackBackend = new PlaybackOutputBackend(this.playback)
    return true
  }

  async loadArchivePlayback(cfg: RawArchivePlaybackConfig): Promise<boolean> {
    this.stopDualSim()
    await this.disposeNetworkAsync()
    await this.recordStop()
    this.recorder.reset()
    this.streamRecorder.dispose()
    this.recordMode = 'memory'
    this.clearTimers()
    this.playback?.dispose?.()
    this.playback = new RawArchivePlayback(cfg)
    this.playbackBackend = new PlaybackOutputBackend(this.playback)
    return true
  }

  playbackStatus():
    | (ReturnType<PlaybackSource['getStatus']> & {
        speed: number
        timing: 'fixed' | 'timestamp'
      })
    | null {
    const st = this.playback?.getStatus()
    return st ? { ...st, speed: this.playbackSpeed, timing: this.playbackTiming } : null
  }

  stop(): void {
    this.stopDualSim()
    this.stopNetwork()
    this.clearTimers()
    // 停止输出时同步把回放置为停止（回放对象保留，可重新回放）；避免「已停止」但 playbackStatus.playing 仍为 true
    if (this.playback?.getStatus().playing) this.playback.stop()
  }

  /** 应用内双通道合成源：无 GNU Radio/硬件也能演示 RX0/RX1。 */
  startDualSim(raw?: unknown): { ok: boolean; error?: string; config?: DualSimConfig } {
    const parsed = sanitizeDualSimConfig(raw ?? defaultDualSimConfig())
    if (!parsed.ok || !parsed.value) return { ok: false, error: parsed.error }
    this.stop()
    this.stopPlayback()
    this.activeChannel = 0
    this.recorder.reset()
    this.recordMode = 'memory'
    const cfg = parsed.value
    const base = defaultAnalysisConfig()
    const make = (freq: number, amplitude: number): SourceEngine =>
      new SourceEngine({
        ...base,
        sampleRate: cfg.sampleRate,
        pointsPerFrame: cfg.pointsPerFrame,
        freq,
        amplitude,
        snr: cfg.snr,
        outputMode: 'complex',
        waveform: 'cw',
        modType: 'sine',
        enabled: true
      })
    this.dualSimEngines = [make(cfg.freq0, cfg.amplitude0), make(cfg.freq1, cfg.amplitude1)]
    this.dualSimConfig = cfg
    this.dualSimTimer = setInterval(() => this.dualSimTick(), 16)
    return { ok: true, config: cfg }
  }

  stopDualSim(): void {
    if (this.dualSimTimer) {
      clearInterval(this.dualSimTimer)
      this.dualSimTimer = null
    }
    this.dualSimEngines = null
    this.dualSimConfig = null
  }

  isDualSimRunning(): boolean {
    return this.dualSimTimer !== null
  }

  private dualSimTick(): void {
    const engines = this.dualSimEngines
    const cfg = this.dualSimConfig
    if (!engines || !cfg) return
    try {
      const [e0, e1] = engines
      const f0 = e0.next(cfg.pointsPerFrame)
      const f1 = e1.next(cfg.pointsPerFrame)
      f0.channel = 0
      f1.channel = 1
      if (cfg.phaseDeg !== 0) {
        const rad = (cfg.phaseDeg * Math.PI) / 180
        const c = Math.cos(rad)
        const s = Math.sin(rad)
        const d = f1.data
        for (let i = 0; i < d.length; i += 2) {
          const i0 = d[i]!
          const q0 = d[i + 1]!
          d[i] = i0 * c - q0 * s
          d[i + 1] = i0 * s + q0 * c
        }
      }
      this.emitDualFrame(f0)
      this.emitDualFrame(f1)
      this.emitFrame(this.activeChannel === 1 ? f1 : f0)
    } catch (e) {
      console.error('[source] dual simulator failed', e)
      this.stopDualSim()
    }
  }

  /**
   * 启动网络源（GNU Radio / 任意 TCP IQ）。
   * 与模拟源/回放互斥；连接成功后才返回 ok。
   */
  async startNetwork(
    cfg: NetworkSourceConfig
  ): Promise<{ ok: boolean; error?: string; status?: NetworkSourceStatus }> {
    this.activeChannel = 0
    // 先等旧网络源的 raw 临时文件删完，再切新源（避免切换时的目录残留）
    await this.disposeNetworkAsync()
    this.stop()
    // 与回放/录制互斥：清掉回放对象，停止正在进行的录制（已录数据保留可导出）
    this.playback?.dispose?.()
    this.playback = null
    this.playbackBackend = null
    await this.recordStop()
    const src = new TcpIqSource(cfg, {
      onFrame: (frame) => {
        // 双通道并排预览：所有通道都推给订阅了 source:dualFrame 的窗口
        this.emitDualFrame(frame)
        if ((frame.channel ?? 0) !== this.activeChannel) return
        this.emitFrame(frame)
      }
      // 状态由渲染进程 1s 轮询 networkStatus；避免 stop 边界的事件推送与后续 IPC 交错。
    })
    this.network = src
    try {
      await src.start()
      return { ok: true, status: src.getStatus() }
    } catch (e) {
      this.network = null
      src.stop()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  stopNetwork(): void {
    const net = this.network
    if (net) {
      // 显式断开/切换源时清理 raw 临时文件；页面会先拦截未导出的断开。
      void net.disposeRawRecorder()
      net.stop()
    }
    this.network = null
  }

  /** 显式断开（IPC）：等 raw 临时文件删完再返回，避免测试/退出后留下大目录 */
  async disposeNetworkAsync(): Promise<void> {
    const net = this.network
    this.network = null
    this.activeChannel = 0
    if (net) {
      await net.disposeRawRecorder()
      net.stop()
    }
  }

  networkStatus(): NetworkSourceStatus | null {
    const status = this.network?.getStatus()
    if (status) status.activeChannel = this.activeChannel
    return status ?? null
  }

  setActiveChannel(channel: number): boolean {
    this.activeChannel = channel === 1 ? 1 : 0
    return true
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.engine.setConfig(this.config)
  }

  getStatus(): SourceStatus {
    const pb = this.playback?.getStatus()
    const net = this.networkStatus()
    const out: SourceStatus = {
      running:
        !!this.timer ||
        !!this.playbackTimer ||
        !!pb?.playing ||
        !!this.network?.isConnected() ||
        this.isDualSimRunning(),
      mode: this.playback ? 'playback' : 'live',
      backend: this.network
        ? 'network'
        : this.isDualSimRunning()
          ? 'dual-sim'
          : (this.playbackBackend?.kind ?? 'simulated'),
      paused: !!pb?.paused,
      config: { ...this.config }
    }
    // 不把 undefined 放进 IPC 响应（部分序列化路径对 undefined 属性不友好）
    if (net) out.network = net
    return out
  }

  subscribe(cb: (frame: SourceFrame) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  /** 渲染进程窗口订阅 source:frame（按 webContents 引用计数；未订阅窗口不再收到 60fps 原始帧） */
  subscribeWindow(id: number): void {
    this.windowSubscribers.set(id, (this.windowSubscribers.get(id) ?? 0) + 1)
  }

  unsubscribeWindow(id: number): void {
    const left = (this.windowSubscribers.get(id) ?? 0) - 1
    if (left > 0) this.windowSubscribers.set(id, left)
    else this.windowSubscribers.delete(id)
  }

  /** 页面 reload/销毁时清空该窗口计数（旧页面不会再 unsubscribe） */
  clearWindowSubscriber(id: number): void {
    this.windowSubscribers.delete(id)
  }

  hasWindowSubscribers(): boolean {
    return this.windowSubscribers.size > 0
  }

  /** 双通道并排预览：独立引用计数，不把两路都塞进普通 source:frame */
  subscribeDualWindow(id: number): void {
    this.dualWindowSubscribers.set(id, (this.dualWindowSubscribers.get(id) ?? 0) + 1)
  }

  unsubscribeDualWindow(id: number): void {
    const left = (this.dualWindowSubscribers.get(id) ?? 0) - 1
    if (left > 0) this.dualWindowSubscribers.set(id, left)
    else this.dualWindowSubscribers.delete(id)
  }

  clearDualWindowSubscriber(id: number): void {
    this.dualWindowSubscribers.delete(id)
  }

  hasDualWindowSubscribers(): boolean {
    return this.dualWindowSubscribers.size > 0
  }

  /** 单帧触发：返回是否真的产生并广播了一帧（网络源由数据到达驱动，不支持手动触发） */
  trigger(): boolean {
    if (this.network) return false
    return this.tick(true)
  }

  private tick(force = false): boolean {
    // 「输出/推送」只门控直播生成；回放由用户显式播放控制，两种调度方式保持一致
    if (!force && !this.playbackBackend && !this.config.enabled) return false
    try {
      const frame = this.playbackBackend ? this.playbackBackend.next() : this.liveBackend.next()
      if (!frame) {
        if (this.playback && !this.playback.getStatus().playing) this.stop()
        return false
      }
      this.emitFrame(frame)
      return true
    } catch (e) {
      console.error('[source] tick failed', e)
      return false
    }
  }

  private emitDualFrame(frame: SourceFrame): void {
    if (this.dualWindowSubscribers.size === 0) return
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      const wc = win.webContents
      if (wc.isDestroyed() || !this.dualWindowSubscribers.has(wc.id)) continue
      try {
        wc.send('source:dualFrame', frame)
      } catch {
        // 窗口销毁竞态：忽略
      }
    }
  }

  private emitFrame(frame: SourceFrame): void {
    this.frameSeq = frame.seq
    if (this.recordMode === 'stream') this.streamRecorder.push(frame)
    else this.recorder.push(frame)
    this.broadcast(frame)
  }

  private scheduleTimestampPlayback(delayMs = 0): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    const st = this.playback?.getStatus()
    if (!st?.playing || st.paused) return
    const wait = Math.max(0, Math.min(5000, Math.round(delayMs)))
    this.playbackTimer = setTimeout(() => this.playbackTick(), wait)
  }

  private playbackTick(): void {
    const frame = this.playback?.next()
    if (!frame) {
      if (this.playback && !this.playback.getStatus().playing) {
        this.playbackTimer = null
      }
      return
    }
    this.emitFrame(frame)
    const next = this.playback?.peek()
    if (next) {
      const dt = (next.timestamp - frame.timestamp) / this.playbackSpeed
      this.scheduleTimestampPlayback(dt > 0 ? dt : 16)
    } else {
      if (this.playback && !this.playback.getStatus().loop) this.playback.stop()
      this.playbackTimer = null
    }
  }

  private broadcast(frame: SourceFrame): void {
    for (const cb of this.subscribers) {
      try {
        cb(frame)
      } catch (e) {
        console.error('[source] subscriber failed', e)
      }
    }
    // 原始源帧只投递给已订阅窗口：无人看图时不再对每个窗口做 60fps 的宽 IPC 序列化
    if (this.windowSubscribers.size === 0) return
    const ids = new Set(this.windowSubscribers.keys())
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      const wc = win.webContents
      if (wc.isDestroyed() || !ids.has(wc.id)) continue
      try {
        wc.send('source:frame', frame)
      } catch (e) {
        // 窗口销毁/重载竞态：跳过该窗口，不影响其它消费者
        console.error('[source] frame send failed', e)
      }
    }
  }

  dispose(): void {
    void this.network?.disposeRawRecorder()
    this.stop()
    this.playback?.dispose?.()
    this.playback = null
    this.subscribers.clear()
    this.windowSubscribers.clear()
    this.dualWindowSubscribers.clear()
    this.recorder.reset()
    this.streamRecorder.dispose()
  }

  /** 是否存在「已录制但尚未导出」的数据（加载回放/导入 IQ/新录制会丢弃它，需先确认） */
  hasUnexportedRecording(): boolean {
    if (this.network) {
      const raw = this.network.rawRecordStatus()
      if (raw && raw.bytes > 0) return raw.hasUnexported && !this.recordExported
    }
    const status =
      this.recordMode === 'stream' ? this.streamRecorder.getStatus() : this.recorder.getStatus()
    return status.frames > 0 && !this.recordExported
  }

  markRecordingExported(): void {
    this.recordExported = true
  }

  async recordStart(
    stream = false,
    opts: { confirmDiscard?: boolean; rawArchive?: boolean; rawSegmentMB?: number } = {}
  ): Promise<{ ok: boolean; needsConfirm?: boolean }> {
    if (this.hasUnexportedRecording() && !opts.confirmDiscard)
      return { ok: false, needsConfirm: true }
    if (this.network) {
      const segmentMB =
        typeof opts.rawSegmentMB === 'number' && opts.rawSegmentMB > 0
          ? Math.max(1, Math.floor(opts.rawSegmentMB))
          : undefined
      await this.network.startRawRecord(
        opts.rawArchive || segmentMB
          ? {
              archiveDir: opts.rawArchive
                ? join(app.getPath('userData'), 'raw-archive')
                : undefined,
              maxBytes: opts.rawArchive ? 0 : undefined,
              segmentBytes: segmentMB ? segmentMB * 1024 * 1024 : undefined
            }
          : undefined
      )
      this.recordMode = 'raw'
      this.recordExported = false
      return { ok: true }
    }
    if (stream) {
      this.recorder.reset()
      this.recordMode = 'stream'
      this.streamRecorder.start()
    } else {
      this.streamRecorder.dispose()
      this.recordMode = 'memory'
      this.recorder.start()
    }
    this.recordExported = false
    return { ok: true }
  }

  async recordStop(): Promise<void> {
    if (this.network && this.recordMode === 'raw') {
      await this.network.stopRawRecord()
      return
    }
    if (this.recordMode === 'stream') await this.streamRecorder.stop()
    else this.recorder.stop()
  }

  recordStatus(): ReturnType<SourceRecorder['getStatus']> & {
    mode: 'memory' | 'stream' | 'raw'
    hasUnexported: boolean
    channels?: number
    archiveDir?: string
    archivedFiles?: number
    archivedBytes?: number
    archiveIndexPath?: string
    diskFreeBytes?: number
    lowDisk?: boolean
  } {
    if (this.network && this.recordMode === 'raw') {
      const raw = this.network.rawRecordStatus()
      if (raw) {
        return {
          recording: raw.recording,
          frames: raw.frames,
          samples: raw.samples,
          durationMs: raw.durationMs,
          truncated: raw.truncated,
          channels: raw.channels,
          archiveDir: raw.archiveDir,
          archivedFiles: raw.archivedFiles,
          archivedBytes: raw.archivedBytes,
          archiveIndexPath: raw.archiveIndexPath,
          diskFreeBytes: raw.diskFreeBytes,
          lowDisk: raw.lowDisk,
          mode: 'raw',
          hasUnexported: this.hasUnexportedRecording()
        }
      }
    }
    const status =
      this.recordMode === 'stream' ? this.streamRecorder.getStatus() : this.recorder.getStatus()
    return {
      ...status,
      mode: this.recordMode,
      hasUnexported: this.hasUnexportedRecording()
    }
  }

  isRawRecordingMode(): boolean {
    return this.network !== null && this.recordMode === 'raw'
  }

  rawRecordStatus(): ReturnType<NonNullable<SourceService['network']>['rawRecordStatus']> | null {
    return this.network?.rawRecordStatus() ?? null
  }

  async exportRawRecording(target: string): Promise<{
    path: string
    metaPath: string
    bytes: number
    samples: number
    frames: number
    segments: number
  }> {
    if (!this.network) throw new Error('网络源未连接')
    const r = await this.network.exportRawRecord(target)
    this.recordExported = true
    return r
  }

  recordFrames(): ReturnType<SourceRecorder['getFrames']> {
    return this.recorder.getFrames()
  }

  streamFrames(): RecordedFrameMeta[] {
    return this.streamRecorder.getFrames()
  }

  async copyStreamRecording(target: string): Promise<void> {
    await this.streamRecorder.copyTo(target)
  }

  isStreamRecordingMode(): boolean {
    return this.recordMode === 'stream'
  }

  get lastSeq(): number {
    return this.frameSeq
  }
}

let sourceServiceInstance: SourceService | null = null

/** analysisServer 等主进程消费者获取同一个源服务实例 */
export function getSourceService(): SourceService {
  if (!sourceServiceInstance) sourceServiceInstance = new SourceService()
  return sourceServiceInstance
}

/** 释放后重置单例（由 sourceIpc 的 disposer 调用，避免持有已 dispose 的实例） */
export function resetSourceService(): void {
  sourceServiceInstance = null
}

// ── 已拆分（纯结构搬家，行为不变）──
// 文件选择/文件解析 → ./sourceFiles.ts
// IPC 注册（33 个 source:* 通道）→ ./sourceIpc.ts（不再从这里转出，避免循环依赖）
