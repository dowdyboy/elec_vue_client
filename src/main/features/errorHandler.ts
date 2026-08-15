/**
 * 【特性】全局错误处理（进程崩溃与未捕获异常）
 * 【API】process.on('uncaughtException') / app.on('render-process-gone')
 * 【复制】1. 复制本文件到新工程 src/main/features/errorHandler.ts
 *         2. 在 index.ts 中调用 registerErrorHandler(getMainWindow)
 *         3. 渲染进程调用 window.api.error.* 查看错误日志
 * 【说明】生产应用的兜底保障：
 *         - uncaughtException：主进程未捕获异常（防止直接崩溃退出）
 *         - unhandledRejection：未处理的 Promise 拒绝
 *         - render-process-gone：渲染进程崩溃/被杀（可提示"页面崩溃，点击恢复"）
 *         - child-process-gone：GPU/网络等子进程异常
 *         完整方案还应接入崩溃上报服务（如 sentry），本模块演示捕获链路。
 */

import { app, crashReporter, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

interface ErrorRecord {
  time: string
  type: string
  message: string
}

/** 错误日志环形缓冲（最多保留 50 条） */
const logs: ErrorRecord[] = []

export function registerErrorHandler(getMainWindow: MainWindowGetter): void {
  const log = (type: string, message: string): void => {
    const record: ErrorRecord = {
      time: new Date().toLocaleTimeString(),
      type,
      message: message.slice(0, 500) // 截断超长错误信息
    }
    logs.unshift(record)
    if (logs.length > 50) logs.pop()
    // 同步打印到主进程终端，方便开发排查
    console.error(`[${type}]`, message)
    // 推送给渲染进程（页面实时展示）
    getMainWindow()?.webContents.send('error:new', record)
  }

  // 主进程未捕获异常：记录但不直接退出（生产可在此做上报/恢复）
  process.on('uncaughtException', (error) => {
    log('uncaughtException', error.stack ?? error.message)
  })

  // 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason) => {
    log('unhandledRejection', String(reason))
  })

  // ── 崩溃自动恢复：渲染进程崩溃后自动 reload（可开关）──
  let autoRecovery = false
  ipcMain.handle('error:setAutoRecovery', (_e, enabled: boolean) => {
    autoRecovery = enabled
    return autoRecovery
  })

  // 渲染进程崩溃/被系统终止
  app.on('render-process-gone', (_event, webContents, details) => {
    log('render-process-gone', `原因: ${details.reason}（exitCode=${details.exitCode}）`)
    // 自动恢复：等 1 秒后重新加载页面（clean-exit 是正常退出，无需恢复）
    if (autoRecovery && details.reason !== 'clean-exit' && !webContents.isDestroyed()) {
      setTimeout(() => {
        if (!webContents.isDestroyed()) webContents.reload()
      }, 1000)
    }
  })

  // GPU / 网络等子进程异常
  app.on('child-process-gone', (_event, details) => {
    log('child-process-gone', `${details.type}: ${details.reason}（exitCode=${details.exitCode}）`)
  })

  // ── 崩溃转储（crashReporter）：进程崩溃时生成 .dmp 文件 ──
  // 生产环境通常配合 uploadToServer 上报到崩溃收集服务；本工程演示本地转储
  crashReporter.start({
    productName: 'elec_vue_client',
    companyName: 'Electron 教学项目',
    uploadToServer: false, // 不上报，仅本地生成 dump
    submitURL: '' // uploadToServer=false 时无需真实地址
  })

  ipcMain.handle('error:getCrashInfo', () => ({
    started: crashReporter.getLastCrashReport() !== null || true, // start 后即生效
    dumpDir: app.getPath('crashDumps'),
    // 已有崩溃转储文件列表（可能为空）
    reports: crashReporter.getUploadedReports?.() ?? []
  }))

  // 查询历史日志（页面初始化时加载）
  ipcMain.handle('error:getLogs', () => logs)
}
