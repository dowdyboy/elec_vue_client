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
  app.on('before-quit', () => broadcast('before-quit')) // 用户选择退出时最先触发
  app.on('will-quit', () => broadcast('will-quit')) // 所有窗口关闭后触发
  app.on('window-all-closed', () => broadcast('window-all-closed')) // 所有窗口被关闭时触发
  app.on('activate', () => broadcast('activate')) // macOS 点击 Dock 图标时触发

  return true // 单实例锁获取成功，可继续初始化
}
