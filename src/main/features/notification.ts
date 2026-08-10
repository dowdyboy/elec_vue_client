/**
 * 【特性】系统通知（Notification）
 * 【API】Notification
 * 【复制】1. 复制本文件到新工程 src/main/features/notification.ts
 *         2. 在 index.ts 中调用 registerNotification(getMainWindow)
 *         3. 渲染进程调用 window.api.notification.show()
 * 【说明】Notification 必须在主进程创建（渲染进程的 web Notification
 *         在 Electron 中默认不可用）。支持标题/正文/图标/点击事件，
 *         以及动作按钮（actions：macOS 显示在通知右侧；Windows 需打包后
 *         使用 toast 通知才支持，开发模式可能不显示）。
 */

import { Notification, ipcMain } from 'electron'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

export interface NotificationOptions {
  title: string
  body: string
  /** 动作按钮文案列表（最多 2 个），对应点击事件返回下标 0/1 */
  actions?: string[]
}

export function registerNotification(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('notification:show', (_event, options: NotificationOptions) => {
    const notification = new Notification({
      title: options.title || '系统通知',
      body: options.body || '',
      icon: join(__dirname, '../../resources/icon.png'),
      // 动作按钮（Electron 类型：{ type: 'button', text }）
      actions: options.actions?.map((text) => ({ type: 'button' as const, text }))
    })

    // 点击通知：聚焦主窗口（用户点击通知通常期望打开应用）
    notification.on('click', () => {
      const win = getMainWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      // 同时把"点击事件"回传给渲染进程，页面可据此做业务处理
      win.webContents.send('notification:clicked', options)
    })

    // 动作按钮被点击：回传按钮下标（0, 1, ...）
    notification.on('action', (_event, index) => {
      getMainWindow()?.webContents.send('notification:action', { options, index })
    })

    notification.show()
    return { shown: true }
  })
}
