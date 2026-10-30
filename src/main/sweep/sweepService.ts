/**
 * SweepService：S11 扫频源（独立于 IQ SourceService）。
 * 通过 sweep:frame 推送频点/Γ，供 Smith 圆图使用；不做 IQ/FFT。
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  defaultSweepConfig,
  sanitizeSweepConfig,
  SweepGenerator,
  type SweepConfig,
  type SweepFrame
} from '../../shared/sweep'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

class SweepService {
  private generator = new SweepGenerator(defaultSweepConfig())
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 500)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setConfig(patch: Partial<SweepConfig>): void {
    this.generator.setConfig(patch)
  }

  getConfig(): SweepConfig {
    return this.generator.getConfig()
  }

  getStatus(): { running: boolean; config: SweepConfig } {
    return { running: !!this.timer, config: this.generator.getConfig() }
  }

  trigger(): void {
    this.tick()
  }

  private tick(): void {
    try {
      const frame = this.generator.next()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('sweep:frame', frame)
      }
    } catch (e) {
      console.error('[sweep] tick failed', e)
    }
  }

  dispose(): void {
    this.stop()
  }
}

let sweepServiceInstance: SweepService | null = null

export function getSweepService(): SweepService {
  if (!sweepServiceInstance) sweepServiceInstance = new SweepService()
  return sweepServiceInstance
}

export function registerSweepService(): () => void {
  const service = getSweepService()

  ipcMain.handle('sweep:start', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.start()
    return { ok: true, status: service.getStatus() }
  })
  ipcMain.handle('sweep:stop', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stop()
    return { ok: true, status: service.getStatus() }
  })
  ipcMain.handle('sweep:getStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.getStatus()
  })
  ipcMain.handle('sweep:setConfig', (e, patch: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = sanitizeSweepConfig(patch)
    if (!r.ok) return { ok: false, error: r.error }
    service.setConfig(r.value ?? {})
    return { ok: true, config: service.getConfig() }
  })
  ipcMain.handle('sweep:trigger', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.trigger()
    return { ok: true }
  })

  return () => {
    service.dispose()
    sweepServiceInstance = null
    ipcMain.removeHandler('sweep:start')
    ipcMain.removeHandler('sweep:stop')
    ipcMain.removeHandler('sweep:getStatus')
    ipcMain.removeHandler('sweep:setConfig')
    ipcMain.removeHandler('sweep:trigger')
  }
}

export type { SweepFrame }
