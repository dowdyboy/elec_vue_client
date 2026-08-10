/**
 * 【特性】毛玻璃 / 亚克力效果（窗口背景材质）
 * 【API】BrowserWindow.setVibrancy（macOS）/ BrowserWindow.setBackgroundMaterial（Windows 11）
 * 【复制】1. 复制本文件到新工程 src/main/features/glassEffect.ts
 *         2. 在 index.ts 中调用 registerGlassEffect(getMainWindow)
 *         3. 渲染进程调用 window.api.glass.set(true/false)
 * 【说明】窗口半透明毛玻璃：macOS 的 vibrancy 特效、Windows 11 的
 *         mica / acrylic 材质。注意平台限制：
 *         - macOS：setVibrancy('under-window') 等
 *         - Windows 11：setBackgroundMaterial('acrylic')
 *         - Linux：不支持
 *         半透明窗口需要配合 transparent: true 或深色背景才有视觉效果。
 */

import { ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerGlassEffect(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('glass:set', (_e, enabled: boolean) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }

    if (process.platform === 'darwin') {
      // macOS 毛玻璃：'under-window' | 'fullscreen-ui' | 'titlebar' 等
      win.setVibrancy(enabled ? 'under-window' : null)
      return { ok: true, platform: 'macOS (vibrancy)' }
    }

    if (process.platform === 'win32') {
      try {
        // Windows 11：'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed'
        win.setBackgroundMaterial(enabled ? 'acrylic' : 'none')
        return { ok: true, platform: 'Windows 11 (acrylic)' }
      } catch {
        return { ok: false, error: '当前 Windows 版本不支持 setBackgroundMaterial（需 Win11）' }
      }
    }

    return { ok: false, error: `当前平台（${process.platform}）不支持毛玻璃效果` }
  })
}
