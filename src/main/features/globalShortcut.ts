/**
 * 【特性】全局快捷键（globalShortcut）
 * 【API】globalShortcut
 * 【复制】1. 复制本文件到新工程 src/main/features/globalShortcut.ts
 *         2. 在 index.ts 中调用 registerGlobalShortcut(getMainWindow)
 *         3. 渲染进程调用 window.api.shortcut.setEnabled() 动态开关
 * 【说明】globalShortcut 注册的是"操作系统级"快捷键：
 *         - 应用失去焦点、甚至最小化到后台时依然生效
 *         - 必须在 app.whenReady 之后才能注册
 *         - 快捷键冲突时 register 返回 false（已被其他应用占用）
 *         建议：注册前用 isRegistered 检查，避免静默失败
 */

import { app, globalShortcut, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

/** 演示用快捷键清单 */
const SHORTCUTS = [
  { accelerator: 'CommandOrControl+Shift+1', label: '触发演示事件' },
  { accelerator: 'CommandOrControl+Shift+2', label: '显示/隐藏主窗口' }
]

/** 注册所有快捷键；返回是否全部注册成功 */
function registerAll(getMainWindow: MainWindowGetter): boolean {
  const results = SHORTCUTS.map(({ accelerator }) =>
    globalShortcut.register(accelerator, () => {
      // 快捷键触发 → 向主窗口发送事件（渲染进程监听展示）
      const win = getMainWindow()
      if (!win) return
      win.webContents.send('shortcut:triggered', { accelerator })

      // 第二个快捷键附加"切换窗口显示"行为（教学演示额外动作）
      if (accelerator === 'CommandOrControl+Shift+2') {
        if (win.isVisible()) win.hide()
        else {
          win.show()
          win.focus()
        }
      }
    })
  )
  return results.every(Boolean)
}

export function registerGlobalShortcut(getMainWindow: MainWindowGetter): void {
  // app.whenReady 之后注册（本函数在 whenReady 回调内被调用）
  registerAll(getMainWindow)

  // 动态开关：页面按钮切换全部快捷键的注册/注销状态
  ipcMain.handle('shortcut:setEnabled', (_event, enabled: boolean) => {
    if (enabled) return registerAll(getMainWindow)
    globalShortcut.unregisterAll()
    return false
  })

  // 应用退出时务必注销，否则快捷键在应用退出后仍可能被占用
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
