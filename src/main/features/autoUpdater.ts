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
 *         ⚠️ 注意：electron-updater 在**未打包（dev）环境默认直接跳过检查**
 *         （日志打印 "Skip checkForUpdates because application is not packed and
 *         dev update config is not forced"，且不触发任何事件 → 页面点了没反应）。
 *         必须设置 autoUpdater.forceDevUpdateConfig = true 才会读 dev-app-update.yml
 *         真实走一遍检查流程。
 *         教学演示 dev-app-update.yml 指向 example.com（必然失败），
 *         页面会完整展示"检查失败"的错误链路 —— 这是真实场景的必经之路。
 */

import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { MainWindowGetter } from '../types'

export function registerAutoUpdater(getMainWindow: MainWindowGetter): void {
  // 下载策略：不自动下载，由用户确认后再下载（教学演示更可控）
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // ⚠️ dev 模式强制走 dev-app-update.yml：不设此项时 electron-updater 在未打包环境
  // 直接跳过检查（仅打印日志、无任何事件，页面点击无反应）。打包后此项不影响
  // （该守卫只在 isPackaged === false 时生效，生产仍读构建生成的 app-update.yml）。
  autoUpdater.forceDevUpdateConfig = true

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
