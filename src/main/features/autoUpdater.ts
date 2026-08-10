/**
 * 【特性】自动更新（electron-updater）
 * 【API】electron-updater / autoUpdater
 * 【复制】1. 复制本文件到新工程 src/main/features/autoUpdater.ts
 *         2. 在 index.ts 中调用 registerAutoUpdater(getMainWindow)
 *         3. 打包配置：electron-builder.yml 中配置 publish（见 docs/15-自动更新.md）
 *         4. 需要依赖：electron-updater（本工程已安装）
 * 【说明】自动更新是生产应用的标配能力：
 *         - 开发模式读取 dev-app-update.yml（指向本地/测试更新服务器）
 *         - 生产模式读取打包时生成的 app-update.yml
 *         教学演示默认 dev-app-update.yml 指向 example.com（必然失败），
 *         页面会完整展示"检查失败"的错误链路 —— 这是真实场景的必经之路。
 */

import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { MainWindowGetter } from '../types'

export function registerAutoUpdater(getMainWindow: MainWindowGetter): void {
  // 下载策略：不自动下载，由用户确认后再下载（教学演示更可控）
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const push = (data: unknown): void => {
    getMainWindow()?.webContents.send('update:status', data)
  }

  // ── 状态事件：全部推送到渲染进程（页面实时展示）──
  autoUpdater.on('checking-for-update', () => {
    push({ type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    push({ type: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    push({ type: 'not-available', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    push({ type: 'progress', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    push({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    push({ type: 'error', message: error.message })
  })

  // ── IPC 控制接口 ──
  ipcMain.handle('update:check', () => {
    autoUpdater.checkForUpdates()
    return true
  })
  ipcMain.handle('update:download', () => {
    autoUpdater.downloadUpdate()
    return true
  })
  ipcMain.handle('update:install', () => {
    // 下载完成后调用：退出并安装，然后自动重启
    autoUpdater.quitAndInstall()
    return true
  })
  ipcMain.handle('update:getVersion', () => ({
    name: app.getName(),
    version: app.getVersion()
  }))
}
