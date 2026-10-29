/**
 * SourceService（主进程独立源服务）
 *
 * 与 analysisServer 解耦：
 *   - 只持有 SourceEngine，生成 SourceFrame
 *   - 通过 IPC 'source:frame' 推送原始 IQ，不做 FFT/时频
 *   - 分析侧后续可消费同一 SourceFrame；当前分析页仍走旧 signalAnalysis
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  defaultAnalysisConfig,
  sanitizeConfigPatch,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { SourceEngine, type SourceFrame } from '../../shared/sourceEngine'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

export interface SourceStatus {
  running: boolean
  config: SignalAnalysisConfig
}

export class SourceService {
  private engine: SourceEngine
  private config: SignalAnalysisConfig
  private timer: NodeJS.Timeout | null = null
  private frameSeq = 0
  private subscribers = new Set<(frame: SourceFrame) => void>()

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    this.engine = new SourceEngine(this.config)
  }

  start(): void {
    if (this.timer) return
    const interval = Math.max(16, Math.floor(1000 / 60))
    this.timer = setInterval(() => this.tick(), interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.engine.setConfig(this.config)
  }

  getStatus(): SourceStatus {
    return { running: !!this.timer, config: { ...this.config } }
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
      const frame = this.engine.next(this.config.pointsPerFrame)
      // SourceEngine.seq 是源域序号；service 额外保留帧计数用于诊断
      this.frameSeq = frame.seq
      this.broadcast(frame)
    } catch (e) {
      console.error('[source] tick failed', e)
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

  return () => {
    service.dispose()
    sourceServiceInstance = null
    ipcMain.removeHandler('source:start')
    ipcMain.removeHandler('source:stop')
    ipcMain.removeHandler('source:getStatus')
    ipcMain.removeHandler('source:setConfig')
    ipcMain.removeHandler('source:trigger')
  }
}
