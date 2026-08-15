/**
 * 【特性】按键拦截（webContents before-input-event）+ dev 模式 F12 DevTools 开关
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
 * 【重要】dev 的 F12"开关 DevTools"行为由本模块统一接管（见下方 ①）：
 *         官方模板常用 @electron-toolkit/utils 的 optimizer.watchWindowShortcuts
 *         处理 F12，但它不检查 event.defaultPrevented，会无条件 openDevTools——
 *         即使本模块先 preventDefault 也拦不住（before-input-event 所有监听器
 *         都会执行）。因此使用本模块时，dev 下不要再对同一窗口调用
 *         optimizer.watchWindowShortcuts（本工程 index.ts 已改为仅生产启用），
 *         否则"吞掉 F12"会失效（F12 仍会打开 DevTools）。
 */

import { app, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerInputHook(getMainWindow: MainWindowGetter): void {
  // 吞掉 F12（演示"吞键"；dev 模式 F12 原本用于打开 DevTools，见下方 ①）
  let blockF12 = false

  // 按键日志：限流推送（按键频率高，合并为每 300ms 一条）
  let lastPush = 0
  let pendingKey = ''

  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      // ── ① F12 统一处理（吞键开关 + dev 的 DevTools 开关，二者互斥不冲突）──
      if (input.key === 'F12') {
        // 吞键开启：F12 彻底失效（包括 DevTools）
        if (blockF12) {
          event.preventDefault()
          return
        }
        // 吞键关闭且为开发模式：维持 dev 惯例——F12 开关 DevTools
        // （接管 optimizer.watchWindowShortcuts 的原行为，见文件头【重要】说明）
        if (!app.isPackaged) {
          event.preventDefault()
          if (contents.isDevToolsOpened()) {
            contents.closeDevTools()
          } else {
            contents.openDevTools({ mode: 'undocked' })
          }
        }
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
