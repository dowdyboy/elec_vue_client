/**
 * SourceService（主进程独立源服务）
 *
 * - 持有 SourceEngine / Playback / 录制器
 * - 通过 source:frame 推送 SourceFrame，不做 FFT/时频
 * - LocalAnalysisSource 消费同一 SourceFrame 生成 signal:analysis
 * - 支持模拟源、录制回放、任意 IQ、内存/流式录制
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import {
  defaultAnalysisConfig,
  sanitizeConfigPatch,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { SourceEngine, type SourceFrame } from '../../shared/sourceEngine'
import { PlaybackOutputBackend, SimulatedOutputBackend } from '../../shared/sourceBackend'
import { SourcePlayback } from '../../shared/sourcePlayback'
import { SourceRecorder } from '../../shared/sourceRecorder'
import type { RecordedFrameMeta } from '../../shared/sourceRecorder'
import { SourceStreamRecorder } from './streamRecorder'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

export interface SourceStatus {
  running: boolean
  mode: 'live' | 'playback'
  backend: 'simulated' | 'playback'
  /** 回放是否处于暂停（live 恒为 false） */
  paused: boolean
  config: SignalAnalysisConfig
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
  private recorder = new SourceRecorder()
  private streamRecorder = new SourceStreamRecorder()
  private recordMode: 'memory' | 'stream' = 'memory'
  private playback: SourcePlayback | null = null
  private playbackSpeed = 1
  /** 当前录制是否已导出成功（start 置 false；导出成功后置 true） */
  private recordExported = true

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    this.engine = new SourceEngine(this.config)
    this.liveBackend = new SimulatedOutputBackend(this.engine, () => this.config.pointsPerFrame)
  }

  start(): void {
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
    this.playback = null
    this.playbackBackend = null
    this.clearTimers()
  }

  async loadPlayback(frames: SourceFrame[]): Promise<boolean> {
    if (frames.length === 0) return false
    await this.recordStop()
    this.recorder.reset()
    this.streamRecorder.dispose()
    this.recordMode = 'memory'
    this.clearTimers()
    this.playback = new SourcePlayback(frames)
    this.playbackBackend = new PlaybackOutputBackend(this.playback)
    return true
  }

  playbackStatus():
    | (ReturnType<SourcePlayback['getStatus']> & {
        speed: number
        timing: 'fixed' | 'timestamp'
      })
    | null {
    const st = this.playback?.getStatus()
    return st ? { ...st, speed: this.playbackSpeed, timing: this.playbackTiming } : null
  }

  stop(): void {
    this.clearTimers()
    // 停止输出时同步把回放置为停止（回放对象保留，可重新回放）；避免「已停止」但 playbackStatus.playing 仍为 true
    if (this.playback?.getStatus().playing) this.playback.stop()
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.engine.setConfig(this.config)
  }

  getStatus(): SourceStatus {
    const pb = this.playback?.getStatus()
    return {
      running: !!this.timer || !!this.playbackTimer || !!pb?.playing,
      mode: this.playback ? 'playback' : 'live',
      backend: this.playbackBackend?.kind ?? 'simulated',
      paused: !!pb?.paused,
      config: { ...this.config }
    }
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

  /** 单帧触发：返回是否真的产生并广播了一帧 */
  trigger(): boolean {
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
      } catch {
        // 窗口销毁/重载竞态：跳过该窗口，不影响其它消费者
      }
    }
  }

  dispose(): void {
    this.stop()
    this.subscribers.clear()
    this.windowSubscribers.clear()
    this.recorder.reset()
    this.streamRecorder.dispose()
  }

  /** 是否存在「已录制但尚未导出」的数据（加载回放/导入 IQ/新录制会丢弃它，需先确认） */
  hasUnexportedRecording(): boolean {
    const status =
      this.recordMode === 'stream' ? this.streamRecorder.getStatus() : this.recorder.getStatus()
    return status.frames > 0 && !this.recordExported
  }

  markRecordingExported(): void {
    this.recordExported = true
  }

  recordStart(
    stream = false,
    opts: { confirmDiscard?: boolean } = {}
  ): { ok: boolean; needsConfirm?: boolean } {
    if (this.hasUnexportedRecording() && !opts.confirmDiscard)
      return { ok: false, needsConfirm: true }
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
    if (this.recordMode === 'stream') await this.streamRecorder.stop()
    else this.recorder.stop()
  }

  recordStatus(): ReturnType<SourceRecorder['getStatus']> & {
    mode: 'memory' | 'stream'
    hasUnexported: boolean
  } {
    const status =
      this.recordMode === 'stream' ? this.streamRecorder.getStatus() : this.recorder.getStatus()
    return {
      ...status,
      mode: this.recordMode,
      hasUnexported: this.hasUnexportedRecording()
    }
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

interface LoadRecordingResult {
  ok: boolean
  canceled?: boolean
  error?: string
  path?: string
  frames?: SourceFrame[]
}

/** 选择 .f32/.json 录制文件并重建 SourceFrame */
async function pickRecording(): Promise<LoadRecordingResult> {
  const focused = BrowserWindow.getFocusedWindow()
  const opts = {
    title: '打开源录制（.f32 + .json）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [
      { name: 'Source IQ', extensions: ['f32', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const ret = focused
    ? await dialog.showOpenDialog(focused, opts)
    : await dialog.showOpenDialog(opts)
  if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
  const selected = ret.filePaths[0]!
  const f32Path = selected.toLowerCase().endsWith('.f32')
    ? selected
    : selected.replace(/\.json$/i, '.f32')
  const jsonPath = selected.toLowerCase().endsWith('.json')
    ? selected
    : selected.replace(/\.f32$/i, '.json')
  try {
    const metaRaw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
      format?: string
      /** 新录制写 signal；旧录制缺省按 wall（用累计采样时间换算成信号时间） */
      timebase?: 'signal' | 'wall'
      sampleRate?: number | null
      frames?: Array<{
        seq: number
        timestamp: number
        wallTimestamp?: number
        sampleRate: number | null
        centerFrequencyHz: number | null
        outputMode: 'real' | 'complex'
        waveform: SourceFrame['waveform']
        modType: SourceFrame['modType']
        samplesPerSymbol: number
        amplitude: number
        sampleCount: number
      }>
    }
    if (metaRaw.format !== 'source-iq-f32-v1' || !Array.isArray(metaRaw.frames))
      return { ok: false, error: '元数据格式不是 source-iq-f32-v1' }
    const buf = await fs.readFile(f32Path)
    // 大录制（1GB 级）不再逐帧拷贝：整体只保有一份 Float32 视图，帧用 subarray 共享内存。
    // readFile 返回的 Buffer 通常自成一块 ArrayBuffer（byteOffset 0），此时零拷贝；否则退回一次拷贝。
    const all =
      buf.byteOffset % 4 === 0
        ? new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
        : (() => {
            const copy = new Uint8Array(buf.byteLength)
            copy.set(buf)
            return new Float32Array(copy.buffer)
          })()
    const fallbackRate =
      typeof metaRaw.sampleRate === 'number' && metaRaw.sampleRate > 0 ? metaRaw.sampleRate : 4096
    const wallTimebase = metaRaw.timebase !== 'signal'
    const frames: SourceFrame[] = []
    let off = 0
    let signalMs = 0
    for (const m of metaRaw.frames) {
      const n = m.sampleCount >>> 0
      if (n === 0 || off + n * 8 > buf.length)
        return { ok: false, error: 'IQ 文件与元数据长度不匹配' }
      const data = all.subarray(off / 4, off / 4 + n * 2)
      off += n * 8
      // 录制中途改过采样率时元数据顶层的 sampleRate 为 null，逐帧优先、再回退顶层/默认
      const frameSampleRate =
        typeof m.sampleRate === 'number' && m.sampleRate > 0 ? m.sampleRate : fallbackRate
      // 旧录制只有墙钟 timestamp：按累计采样时间重算信号时间，保证按时间戳回放是信号实时
      const timestamp = wallTimebase ? signalMs : m.timestamp
      signalMs += (n / frameSampleRate) * 1000
      frames.push({
        seq: m.seq,
        timestamp,
        wallTimestamp: m.wallTimestamp ?? (wallTimebase ? m.timestamp : undefined),
        sampleRate: frameSampleRate,
        centerFrequencyHz:
          typeof m.centerFrequencyHz === 'number' && Number.isFinite(m.centerFrequencyHz)
            ? m.centerFrequencyHz
            : 0,
        outputMode: m.outputMode,
        waveform: m.waveform,
        modType: m.modType,
        samplesPerSymbol: m.samplesPerSymbol,
        amplitude: m.amplitude,
        data
      })
    }
    if (frames.length === 0) return { ok: false, error: '录制文件没有帧' }
    return { ok: true, path: f32Path, frames }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 任意原始 IQ 文件（little-endian interleaved f32）→ SourceFrame */
async function pickArbitraryIq(
  config: SignalAnalysisConfig
): Promise<LoadRecordingResult & { truncated?: boolean }> {
  const focused = BrowserWindow.getFocusedWindow()
  const opts = {
    title: '导入任意 IQ（little-endian interleaved f32）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [
      { name: 'Raw IQ', extensions: ['f32', 'bin', 'raw'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const ret = focused
    ? await dialog.showOpenDialog(focused, opts)
    : await dialog.showOpenDialog(opts)
  if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
  const path = ret.filePaths[0]!
  try {
    const stat = await fs.stat(path)
    const maxSamples = 8_000_000
    const readBytes = Math.min(stat.size, maxSamples * 8)
    if (readBytes < 16) return { ok: false, error: 'IQ 文件过短' }
    const fh = await fs.open(path, 'r')
    let buf: Buffer
    try {
      buf = Buffer.alloc(readBytes)
      const { bytesRead } = await fh.read(buf, 0, readBytes, 0)
      if (bytesRead < 16) return { ok: false, error: 'IQ 文件过短' }
      buf = buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
    const totalSamples = Math.floor(stat.size / 8)
    const samples = Math.floor(buf.length / 8)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + samples * 8)
    const all = new Float32Array(ab)
    const perFrame = Math.max(1, Math.floor(config.pointsPerFrame))
    const frames: SourceFrame[] = []
    const wallNow = Date.now()
    for (let start = 0, seq = 1; start < samples; start += perFrame, seq++) {
      const count = Math.min(perFrame, samples - start)
      frames.push({
        seq,
        // 文件回放的信号时间由采样位置推导（与 sampleRate 一致）
        timestamp: (start / config.sampleRate) * 1000,
        wallTimestamp: wallNow,
        sampleRate: config.sampleRate,
        centerFrequencyHz: config.freq,
        outputMode: config.outputMode,
        waveform: 'file',
        modType: 'sine',
        samplesPerSymbol: config.samplesPerSymbol,
        amplitude: config.amplitude,
        data: all.slice(start * 2, (start + count) * 2)
      })
    }
    return { ok: true, path, frames, truncated: samples < totalSamples }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerSourceService(): () => void {
  const service = getSourceService()
  /** 已挂过 destroyed/navigation 监听的 webContents，避免重复挂 */
  const watchedSenders = new Set<number>()

  ipcMain.handle('source:subscribe', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const id = e.sender.id
    service.subscribeWindow(id)
    if (!watchedSenders.has(id)) {
      watchedSenders.add(id)
      e.sender.once('destroyed', () => {
        watchedSenders.delete(id)
        service.clearWindowSubscriber(id)
      })
      // 跨文档导航/刷新后旧订阅作废（did-navigate 不含 hash 路由切换）
      e.sender.on('did-navigate', () => service.clearWindowSubscriber(id))
      e.sender.on('render-process-gone', () => {
        watchedSenders.delete(id)
        service.clearWindowSubscriber(id)
      })
    }
    return { ok: true }
  })

  ipcMain.handle('source:unsubscribe', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.unsubscribeWindow(e.sender.id)
    return { ok: true }
  })

  ipcMain.handle('source:start', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.start()
    return { ok: true, status: service.getStatus() }
  })

  ipcMain.handle('source:stop', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stop()
    return { ok: true, status: service.getStatus() }
  })

  ipcMain.handle('source:getStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.getStatus()
  })

  ipcMain.handle('source:setConfig', (e, patch: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = sanitizeConfigPatch(patch)
    if (!r.ok) return { ok: false, error: r.error }
    service.setConfig(r.value ?? {})
    return { ok: true, config: service.getStatus().config }
  })

  ipcMain.handle('source:trigger', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const emitted = service.trigger()
    return { ok: true, emitted, seq: service.lastSeq }
  })

  ipcMain.handle(
    'source:recordStart',
    (e, stream: unknown, opts?: { confirmDiscard?: boolean }) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      const r = service.recordStart(!!stream, { confirmDiscard: opts?.confirmDiscard === true })
      return { ...r, status: service.recordStatus() }
    }
  )

  ipcMain.handle('source:recordStop', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    await service.recordStop()
    return { ok: true, status: service.recordStatus() }
  })

  ipcMain.handle('source:recordStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.recordStatus()
  })

  ipcMain.handle('source:recordExport', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const streamMode = service.isStreamRecordingMode()
    // 先确认有数据、再弹保存框；取消保存不会顺手停掉正在进行的录制
    const preview = streamMode ? service.streamFrames() : service.recordFrames()
    if (preview.length === 0) return { ok: false, error: '没有可导出的录制帧' }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const opts = {
      title: '导出源录制（原始 IQ + 元数据）',
      defaultPath: `source-recording-${stamp}.f32`,
      filters: [
        { name: 'Float32 IQ', extensions: ['f32'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const focused = BrowserWindow.getFocusedWindow()
    const ret = focused
      ? await dialog.showSaveDialog(focused, opts)
      : await dialog.showSaveDialog(opts)
    if (ret.canceled || !ret.filePath) return { ok: false, canceled: true }
    const f32Path = ret.filePath.toLowerCase().endsWith('.f32')
      ? ret.filePath
      : `${ret.filePath}.f32`
    const jsonPath = f32Path.replace(/\.f32$/i, '.json')
    try {
      await service.recordStop()
      const frames = streamMode ? service.streamFrames() : service.recordFrames()
      if (streamMode) {
        await service.copyStreamRecording(f32Path)
      } else {
        const rawFrames = frames as ReturnType<SourceRecorder['getFrames']>
        const totalFloats = rawFrames.reduce((n, f) => n + f.data.length, 0)
        const buf = Buffer.allocUnsafe(totalFloats * 4)
        let off = 0
        for (const f of rawFrames) {
          for (let i = 0; i < f.data.length; i++) {
            buf.writeFloatLE(f.data[i]!, off)
            off += 4
          }
        }
        await fs.writeFile(f32Path, buf)
      }
      const sampleRates = new Set(frames.map((f) => f.sampleRate))
      const totalSamples = frames.reduce((n, f) => n + f.sampleCount, 0)
      const meta = {
        format: 'source-iq-f32-v1',
        endianness: 'little',
        layout: 'interleaved IQ',
        // 新录制时间基：timestamp 为信号时间；wallTimestamp 保留真实采集时刻
        timebase: 'signal' as const,
        createdAt: new Date().toISOString(),
        sampleRate: sampleRates.size === 1 ? frames[0]!.sampleRate : null,
        totalSamples,
        frames: frames.map((f) => ({
          seq: f.seq,
          timestamp: f.timestamp,
          wallTimestamp: f.wallTimestamp,
          sampleRate: f.sampleRate,
          centerFrequencyHz: f.centerFrequencyHz,
          outputMode: f.outputMode,
          waveform: f.waveform,
          modType: f.modType,
          samplesPerSymbol: f.samplesPerSymbol,
          amplitude: f.amplitude,
          sampleCount: f.sampleCount
        }))
      }
      await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')
      service.markRecordingExported()
      return {
        ok: true,
        path: f32Path,
        metaPath: jsonPath,
        frames: frames.length,
        samples: totalSamples
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('source:importIq', async (e, opts?: { confirmDiscard?: boolean }) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
      return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
    const r = await pickArbitraryIq(service.getStatus().config)
    if (!r.ok || !r.frames) return { ok: false, canceled: r.canceled, error: r.error }
    await service.loadPlayback(r.frames)
    service.startPlayback()
    return { ok: true, path: r.path, truncated: r.truncated, status: service.playbackStatus() }
  })

  ipcMain.handle('source:loadPlayback', async (e, opts?: { confirmDiscard?: boolean }) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
      return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
    const r = await pickRecording()
    if (!r.ok || !r.frames) return { ok: false, canceled: r.canceled, error: r.error }
    await service.loadPlayback(r.frames)
    service.startPlayback()
    return { ok: true, path: r.path, status: service.playbackStatus() }
  })

  ipcMain.handle('source:startPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.startPlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:pausePlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.pausePlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:resumePlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.resumePlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:stepPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.stepPlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackSpeed', (e, speed: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (typeof speed !== 'number') return { ok: false, error: 'speed 非法' }
    return { ok: service.setPlaybackSpeed(speed), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackTiming', (e, timing: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (timing !== 'fixed' && timing !== 'timestamp') return { ok: false, error: 'timing 非法' }
    return { ok: service.setPlaybackTiming(timing), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackLoop', (e, loop: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.setPlaybackLoop(!!loop), status: service.playbackStatus() }
  })

  ipcMain.handle('source:seekPlayback', (e, index: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (typeof index !== 'number') return { ok: false, error: 'index 非法' }
    return { ok: service.seekPlayback(index), status: service.playbackStatus() }
  })

  ipcMain.handle('source:stopPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stopPlayback()
    return { ok: true, status: service.playbackStatus() }
  })

  ipcMain.handle('source:playbackStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.playbackStatus()
  })

  return () => {
    service.dispose()
    sourceServiceInstance = null
    watchedSenders.clear()
    ipcMain.removeHandler('source:subscribe')
    ipcMain.removeHandler('source:unsubscribe')
    ipcMain.removeHandler('source:start')
    ipcMain.removeHandler('source:stop')
    ipcMain.removeHandler('source:getStatus')
    ipcMain.removeHandler('source:setConfig')
    ipcMain.removeHandler('source:trigger')
    ipcMain.removeHandler('source:recordStart')
    ipcMain.removeHandler('source:recordStop')
    ipcMain.removeHandler('source:recordStatus')
    ipcMain.removeHandler('source:recordExport')
    ipcMain.removeHandler('source:importIq')
    ipcMain.removeHandler('source:loadPlayback')
    ipcMain.removeHandler('source:startPlayback')
    ipcMain.removeHandler('source:pausePlayback')
    ipcMain.removeHandler('source:resumePlayback')
    ipcMain.removeHandler('source:stepPlayback')
    ipcMain.removeHandler('source:setPlaybackSpeed')
    ipcMain.removeHandler('source:setPlaybackTiming')
    ipcMain.removeHandler('source:setPlaybackLoop')
    ipcMain.removeHandler('source:seekPlayback')
    ipcMain.removeHandler('source:stopPlayback')
    ipcMain.removeHandler('source:playbackStatus')
  }
}
