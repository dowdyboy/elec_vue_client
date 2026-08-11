/**
 * 【特性】任务栏与平台特性（Windows 任务栏 / macOS Dock）
 * 【API】BrowserWindow.setProgressBar / app.setBadgeCount / app.setJumpList /
 *        win.setOverlayIcon / app.dock.setMenu / app.addRecentDocument
 * 【复制】1. 复制本文件到新工程 src/main/features/taskbar.ts
 *         2. 在 index.ts 中调用 registerTaskbar(getMainWindow)
 *         3. 渲染进程调用 window.api.taskbar.*
 * 【说明】桌面应用的"存在感"细节（按平台区分）：
 *         Windows：进度条、跳转列表（JumpList 最近文件）、图标叠加角标
 *         macOS：Dock 角标数字、Dock 右键菜单、最近文档、bounce 动画
 */

import { app, ipcMain, Menu, nativeImage } from 'electron'
import { join } from 'path'
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

  // ── Windows 跳转列表（JumpList：右键任务栏图标的最近文件/任务）──
  ipcMain.handle('taskbar:setJumpList', (_e, files: string[]) => {
    if (process.platform !== 'win32') return { ok: false, error: '仅 Windows 支持' }
    app.setJumpList([
      {
        type: 'recent',
        items: files.map((file) => ({ type: 'file', path: file }))
      }
    ])
    return { ok: true }
  })

  // ── Windows 任务栏图标叠加角标（OverlayIcon）──
  ipcMain.handle('taskbar:setOverlay', (_e, enabled: boolean) => {
    const win = getMainWindow()
    if (!win) return false
    if (enabled) {
      const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
      win.setOverlayIcon(icon, '演示叠加图标')
    } else {
      win.setOverlayIcon(null, '')
    }
    return true
  })

  // ── macOS Dock 右键菜单 ──
  ipcMain.handle('taskbar:setDockMenu', () => {
    if (process.platform !== 'darwin' || !app.dock) return { ok: false, error: '仅 macOS 支持' }
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => getMainWindow()?.show() },
        {
          label: '添加最近文档',
          click: () => app.addRecentDocument(join(app.getPath('documents'), '示例文档.txt'))
        }
      ])
    )
    return { ok: true }
  })

  // ── 最近文档 + Dock 弹跳动画（macOS）──
  ipcMain.handle('taskbar:addRecentDocument', () => {
    app.addRecentDocument(join(app.getPath('documents'), '最近文档示例.txt'))
    app.dock?.bounce('informational') // Dock 图标弹跳提示
    return true
  })
}
