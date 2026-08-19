/**
 * 【特性】应用生命周期（单实例锁 / 开机自启 / 信息查询 / 事件广播）
 * 【API】app
 * 【复制】1. 复制本文件到新工程 src/main/features/appLifecycle.ts
 *         2. 在 index.ts 中调用 registerAppLifecycle(getMainWindow)，
 *            返回 false 时表示已有实例在运行，入口应立即 return 不再初始化
 *         3. 渲染进程调用 window.api.app.*
 * 【说明】单实例锁：防止用户重复打开应用（如双击两次 exe），
 *         第二次启动会触发 first 实例的 'second-instance' 事件，
 *         典型做法是聚焦已有窗口并提示用户。
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import type { MainWindowGetter } from '../types'

/**
 * 注册生命周期相关能力
 * @returns false 表示已有实例在运行（调用方应立即退出初始化流程）
 */
export function registerAppLifecycle(getMainWindow: MainWindowGetter): boolean {
  // ── ① 单实例锁 ───────────────────────────────────
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    // 已有实例在运行，本实例直接退出
    app.quit()
    return false // 通知调用方：不要再创建窗口/注册其余模块
  }
  app.on('second-instance', () => {
    // 用户再次启动 → 聚焦已有窗口
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    // 通知渲染进程：页面可弹出"检测到重复启动"的提示
    getMainWindow()?.webContents.send('app:second-instance')
  })

  // ── ② 应用信息查询 ───────────────────────────────
  ipcMain.handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    // 常用路径（写配置文件、日志、缓存时都用 userData 目录）
    userData: app.getPath('userData'),
    cwd: process.cwd()
  }))

  // ── ③ 开机自启 ───────────────────────────────────
  // 注意：macOS 上通过登录项实现，Windows 通过注册表实现
  ipcMain.handle('app:getLoginItem', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:setLoginItem', (_e, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin })
    return app.getLoginItemSettings().openAtLogin
  })

  // ── ④ 生命周期事件广播（教学演示：观察事件触发顺序）──
  // 页面通过 window.api.app.onLifecycle() 实时显示事件日志
  const broadcast = (event: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('app:lifecycle', { event })
    }
  }

  // ── 合并降噪通道（app:lifecycle-merged）──
  // 一个用户操作往往联动触发多个窗口事件（如还原 → restore+show+focus），
  // 未合并通道会各推一条导致刷屏。这里在 300ms 窗口内把同一批事件去重合并为一条
  // （window.api.app.onLifecycleMerged() 订阅），未合并通道保留供对照。
  const MERGE_WINDOW_MS = 300
  const mergedBuffer: string[] = []
  let mergedTimer: NodeJS.Timeout | null = null
  const pushMerged = (event: string): void => {
    if (!mergedBuffer.includes(event)) mergedBuffer.push(event)
    if (mergedTimer) return
    mergedTimer = setTimeout(() => {
      mergedTimer = null
      const events = mergedBuffer.splice(0)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('app:lifecycle-merged', { events })
      }
    }, MERGE_WINDOW_MS)
  }
  // 同一事件同时喂给"未合并"与"合并"两个通道
  const pushBoth = (event: string): void => {
    broadcast(event)
    pushMerged(event)
  }

  // 退出类事件（页面在事件前后销毁，页内通常观察不到，保留用于概念完整）：
  app.on('before-quit', () => pushBoth('before-quit')) // 用户选择退出时最先触发
  app.on('will-quit', () => pushBoth('will-quit')) // 所有窗口关闭后触发
  app.on('window-all-closed', () => pushBoth('window-all-closed')) // 所有窗口被关闭时触发
  app.on('activate', () => pushBoth('activate')) // macOS 点击 Dock 图标时触发

  // 窗口级生命周期事件：正常使用即可观察（最小化/还原/最大化/全屏/聚焦/失焦/隐藏到托盘）
  // ⚠️ 教学要点：只广播退出类事件，页面上日志会"永远为空"——那些事件发生时页面已被销毁
  // （或仅 macOS 触发）。必须补充窗口级事件才能实时演示。
  app.on('browser-window-created', (_event, win) => {
    win.on('show', () => pushBoth('window-show'))
    win.on('hide', () => pushBoth('window-hide')) // 关窗=隐藏到托盘（见 index.ts）
    win.on('minimize', () => pushBoth('window-minimize'))
    win.on('restore', () => pushBoth('window-restore'))
    win.on('maximize', () => pushBoth('window-maximize'))
    win.on('unmaximize', () => pushBoth('window-unmaximize'))
    win.on('focus', () => pushBoth('window-focus'))
    win.on('blur', () => pushBoth('window-blur'))
    win.on('enter-full-screen', () => pushBoth('window-fullscreen'))
    win.on('leave-full-screen', () => pushBoth('window-leave-fullscreen'))
  })

  return true // 单实例锁获取成功，可继续初始化
}
