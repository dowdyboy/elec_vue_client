/**
 * 【特性】任务栏进度 + 应用角标（Windows / macOS）
 * 【API】BrowserWindow.setProgressBar / app.setBadgeCount
 * 【复制】1. 复制本文件到新工程 src/main/features/taskbar.ts
 *         2. 在 index.ts 中调用 registerTaskbar(getMainWindow)
 *         3. 渲染进程调用 window.api.taskbar.*
 * 【说明】桌面应用的"存在感"细节：
 *         - setProgressBar：Windows 任务栏图标下方的进度条（0~1，-1 清除）
 *           典型场景：下载/导出/上传进度（本页按钮模拟）
 *         - setBadgeCount：macOS Dock 图标角标数字（Linux 部分环境支持）
 *           典型场景：未读消息数
 */

import { app, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerTaskbar(getMainWindow: MainWindowGetter): void {
  // ── 任务栏进度条 ──
  // value: 0 ~ 1 表示进度；null 清除进度条；'error'/'paused' 切换颜色模式
  ipcMain.handle(
    'taskbar:setProgress',
    (_e, value: number | null, mode?: 'normal' | 'error' | 'paused' | 'indeterminate') => {
      const win = getMainWindow()
      if (!win) return false
      if (value === null) {
        win.setProgressBar(-1) // -1 移除进度条
      } else {
        win.setProgressBar(value, { mode: mode ?? 'normal' })
      }
      return true
    }
  )

  // ── 应用角标（macOS Dock / Linux）──
  ipcMain.handle('taskbar:setBadge', (_e, count: number) => {
    app.setBadgeCount(Math.max(0, Math.floor(count)))
    return app.getBadgeCount()
  })
}
