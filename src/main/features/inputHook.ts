/**
 * 【特性】按键拦截（webContents before-input-event）
 * 【API】webContents.on('before-input-event')
 * 【复制】1. 复制本文件到新工程 src/main/features/inputHook.ts
 *         2. 在 index.ts 中调用 registerInputHook(getMainWindow)
 *         3. 渲染进程调用 window.api.inputHook.*
 * 【说明】在按键到达页面之前拦截，两种典型用途：
 *         - 吞键：阻止某些快捷键生效（如禁 F12、禁 Ctrl+S）
 *         - 全局热键：应用内任意页面响应的自定义热键
 *         与 globalShortcut（docs/05）的区别：
 *         globalShortcut 是"系统级"（应用失焦也生效）；
 *         before-input-event 是"应用内"（仅窗口聚焦时）。
 */

import { app, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerInputHook(getMainWindow: MainWindowGetter): void {
  // 吞掉 F12（演示"吞键"；dev 模式 F12 原本用于打开 DevTools）
  let blockF12 = false

  // 按键日志：限流推送（按键频率高，合并为每 300ms 一条）
  let lastPush = 0
  let pendingKey = ''

  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      // 吞键：F12 不再触发任何行为（包括默认的 DevTools 快捷键）
      if (blockF12 && input.key === 'F12') {
        event.preventDefault()
        return
      }

      // 记录按键日志（教学展示；过滤修饰键单独按下）
      if (input.key.length === 1 || ['Enter', 'Escape', 'Space'].includes(input.key)) {
        const label = input.control ? 'Ctrl+' : input.alt ? 'Alt+' : input.shift ? 'Shift+' : ''
        pendingKey = label + input.key
        const now = Date.now()
        if (now - lastPush > 300) {
          lastPush = now
          getMainWindow()?.webContents.send('inputHook:key', { key: pendingKey })
        }
      }
    })
  })

  ipcMain.handle('inputHook:setBlockF12', (_e, enabled: boolean) => {
    blockF12 = enabled
    return blockF12
  })
}
