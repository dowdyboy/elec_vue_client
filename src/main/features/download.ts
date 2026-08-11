/**
 * 【特性】下载管理（session + DownloadItem）
 * 【API】session.defaultSession.on('will-download') / DownloadItem / webContents.downloadURL
 * 【复制】1. 复制本文件到新工程 src/main/features/download.ts
 *         2. 在 index.ts 中调用 registerDownload(getMainWindow)
 *         3. 渲染进程调用 window.api.download.*
 * 【说明】下载管理是桌面应用的常用能力：
 *         - will-download 事件在每次下载开始时触发（可设置保存路径、拦截）
 *         - DownloadItem 提供进度/暂停/恢复/取消/状态查询
 *         - 下载走 Chromium 网络栈（与渲染进程请求同栈，可被 webRequest 拦截）
 *         保存路径默认 userData/downloads（教学演示顺滑）；生产可用 setSaveDialogOptions 弹窗。
 *         注意：每个下载生成唯一 id（同一 URL 可重复下载，互不干扰）。
 */

import { app, ipcMain, session, type DownloadItem } from 'electron'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

/** 活动下载表：key = 下载唯一 id */
const activeDownloads = new Map<string, DownloadItem>()
let downloadSeq = 0

export function registerDownload(getMainWindow: MainWindowGetter): void {
  const push = (channel: string, data: unknown): void => {
    getMainWindow()?.webContents.send(channel, data)
  }

  // ── 每次下载开始时触发 ──
  session.defaultSession.on('will-download', (_event, item) => {
    // 每个下载独立 id（同一 URL 重复下载不会互相覆盖）
    const id = `${Date.now()}-${++downloadSeq}`

    // 默认保存目录（确保存在）
    const dir = join(app.getPath('userData'), 'downloads')
    item.setSavePath(join(dir, item.getFilename()))

    activeDownloads.set(id, item)

    // 进度更新：percent / 字节数 / 状态（progressing | interrupted）
    item.on('updated', (_e, state) => {
      const received = item.getReceivedBytes()
      const total = item.getTotalBytes()
      push('download:progress', {
        id,
        url: item.getURL(),
        filename: item.getFilename(),
        state,
        percent: total > 0 ? Math.round((received / total) * 100) : 0,
        receivedBytes: received,
        totalBytes: total,
        savePath: item.getSavePath()
      })
    })

    // 下载结束：completed | cancelled | interrupted
    item.on('done', (_e, state) => {
      activeDownloads.delete(id)
      push('download:done', {
        id,
        url: item.getURL(),
        filename: item.getFilename(),
        state,
        savePath: item.getSavePath()
      })
    })
  })

  // ── 开始下载（走 Chromium 网络栈）──
  ipcMain.handle('download:start', (_e, url: string) => {
    if (!url) return { ok: false, error: 'URL 不能为空' }
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    win.webContents.downloadURL(url)
    return { ok: true }
  })

  // ── 暂停 / 恢复 / 取消（按下载 id）──
  ipcMain.handle('download:pause', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item || !item.canResume()) return { ok: false, error: '没有可暂停的下载' }
    item.pause()
    return { ok: true }
  })

  ipcMain.handle('download:resume', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item) return { ok: false, error: '没有暂停中的下载' }
    item.resume()
    return { ok: true }
  })

  ipcMain.handle('download:cancel', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item) return { ok: false, error: '没有进行中的下载' }
    item.cancel()
    return { ok: true }
  })
}
