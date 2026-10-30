/**
 * SourceService（主进程独立源服务）
 *
 * 与 analysisServer 解耦：
 *   - 只持有 SourceEngine，生成 SourceFrame
 *   - 通过 IPC 'source:frame' 推送原始 IQ，不做 FFT/时频
 *   - 分析侧后续可消费同一 SourceFrame；当前分析页仍走旧 signalAnalysis
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import {
  defaultAnalysisConfig,
  sanitizeConfigPatch,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { SourceEngine, type SourceFrame } from '../../shared/sourceEngine'
import { SourcePlayback } from '../../shared/sourcePlayback'
import { SourceRecorder } from '../../shared/sourceRecorder'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

export interface SourceStatus {
  running: boolean
  mode: 'live' | 'playback'
  config: SignalAnalysisConfig
}

export class SourceService {
  private engine: SourceEngine
  private config: SignalAnalysisConfig
  private timer: NodeJS.Timeout | null = null
  private playbackTimer: NodeJS.Timeout | null = null
  private playbackTiming: 'fixed' | 'timestamp' = 'fixed'
  private frameSeq = 0
  private subscribers = new Set<(frame: SourceFrame) => void>()
  private recorder = new SourceRecorder()
  private playback: SourcePlayback | null = null
  private playbackSpeed = 1

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    this.engine = new SourceEngine(this.config)
  }

  start(): void {
    this.playback = null
    this.clearTimers()
    this.startTimer()
  }

  private startTimer(): void {
    if (this.timer) return
    const interval = Math.max(4, Math.round(1000 / 60 / this.playbackSpeed))
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
    if (this.playback && this.playbackTiming === 'timestamp') {
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
    return true
  }

  resumePlayback(): boolean {
    if (!this.playback) return false
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
    this.clearTimers()
  }

  loadPlayback(frames: SourceFrame[]): boolean {
    if (frames.length === 0) return false
    this.clearTimers()
    this.playback = new SourcePlayback(frames)
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
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.engine.setConfig(this.config)
  }

  getStatus(): SourceStatus {
    return {
      running: !!this.timer || !!this.playbackTimer,
      mode: this.playback ? 'playback' : 'live',
      config: { ...this.config }
    }
  }

  subscribe(cb: (frame: SourceFrame) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  trigger(): void {
    this.tick(true)
  }

  private tick(force = false): void {
    if (!force && !this.config.enabled) return
    try {
      const frame = this.playback
        ? this.playback.next()
        : this.engine.next(this.config.pointsPerFrame)
      if (!frame) {
        if (this.playback && !this.playback.getStatus().playing) this.stop()
        return
      }
      this.emitFrame(frame)
    } catch (e) {
      console.error('[source] tick failed', e)
    }
  }

  private emitFrame(frame: SourceFrame): void {
    this.frameSeq = frame.seq
    this.recorder.push(frame)
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
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('source:frame', frame)
    }
  }

  dispose(): void {
    this.stop()
    this.subscribers.clear()
    this.recorder.reset()
  }

  recordStart(): void {
    this.recorder.start()
  }

  recordStop(): void {
    this.recorder.stop()
  }

  recordStatus(): ReturnType<SourceRecorder['getStatus']> {
    return this.recorder.getStatus()
  }

  recordFrames(): ReturnType<SourceRecorder['getFrames']> {
    return this.recorder.getFrames()
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
      frames?: Array<{
        seq: number
        timestamp: number
        sampleRate: number
        centerFrequencyHz: number
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
    const frames: SourceFrame[] = []
    let off = 0
    for (const m of metaRaw.frames) {
      const n = m.sampleCount >>> 0
      if (n === 0 || off + n * 8 > buf.length)
        return { ok: false, error: 'IQ 文件与元数据长度不匹配' }
      const data = new Float32Array(n * 2)
      for (let k = 0; k < n * 2; k++) {
        data[k] = buf.readFloatLE(off + k * 4)
      }
      off += n * 8
      frames.push({
        seq: m.seq,
        timestamp: m.timestamp,
        sampleRate: m.sampleRate,
        centerFrequencyHz: m.centerFrequencyHz,
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

export function registerSourceService(): () => void {
  const service = getSourceService()

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
    service.trigger()
    return { ok: true, seq: service.lastSeq }
  })

  ipcMain.handle('source:recordStart', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.recordStart()
    return { ok: true, status: service.recordStatus() }
  })

  ipcMain.handle('source:recordStop', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.recordStop()
    return { ok: true, status: service.recordStatus() }
  })

  ipcMain.handle('source:recordStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.recordStatus()
  })

  ipcMain.handle('source:recordExport', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const frames = service.recordFrames()
    if (frames.length === 0) return { ok: false, error: '没有可导出的录制帧' }
    service.recordStop()
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
    const totalFloats = frames.reduce((n, f) => n + f.data.length, 0)
    const buf = Buffer.allocUnsafe(totalFloats * 4)
    let off = 0
    for (const f of frames) {
      for (let i = 0; i < f.data.length; i++) {
        buf.writeFloatLE(f.data[i]!, off)
        off += 4
      }
    }
    const sampleRates = new Set(frames.map((f) => f.sampleRate))
    const meta = {
      format: 'source-iq-f32-v1',
      endianness: 'little',
      layout: 'interleaved IQ',
      createdAt: new Date().toISOString(),
      sampleRate: sampleRates.size === 1 ? frames[0]!.sampleRate : null,
      totalSamples: totalFloats / 2,
      frames: frames.map((f) => ({
        seq: f.seq,
        timestamp: f.timestamp,
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
    await fs.writeFile(f32Path, buf)
    await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')
    return {
      ok: true,
      path: f32Path,
      metaPath: jsonPath,
      frames: frames.length,
      samples: meta.totalSamples
    }
  })

  ipcMain.handle('source:loadPlayback', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = await pickRecording()
    if (!r.ok || !r.frames) return { ok: false, canceled: r.canceled, error: r.error }
    service.loadPlayback(r.frames)
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
    ipcMain.removeHandler('source:start')
    ipcMain.removeHandler('source:stop')
    ipcMain.removeHandler('source:getStatus')
    ipcMain.removeHandler('source:setConfig')
    ipcMain.removeHandler('source:trigger')
    ipcMain.removeHandler('source:recordStart')
    ipcMain.removeHandler('source:recordStop')
    ipcMain.removeHandler('source:recordStatus')
    ipcMain.removeHandler('source:recordExport')
    ipcMain.removeHandler('source:loadPlayback')
    ipcMain.removeHandler('source:startPlayback')
    ipcMain.removeHandler('source:pausePlayback')
    ipcMain.removeHandler('source:resumePlayback')
    ipcMain.removeHandler('source:stepPlayback')
    ipcMain.removeHandler('source:setPlaybackSpeed')
    ipcMain.removeHandler('source:setPlaybackTiming')
    ipcMain.removeHandler('source:setPlaybackLoop')
    ipcMain.removeHandler('source:stopPlayback')
    ipcMain.removeHandler('source:playbackStatus')
  }
}
