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
 *         保存路径默认系统下载目录 app.getPath('downloads')，
 *         可通过 appPaths.ts 的"数据目录"页运行期修改（setPath('downloads')）后立即生效；
 *         生产可用 setSaveDialogOptions 弹窗让用户选择。
 *         注意：每个下载生成唯一 id（同一 URL 可重复下载，互不干扰）。
 *         主进程缓存最近 50 条完成记录（download:list 回放）：下载事件是
 *         fire-and-forget 推送，页面未挂载时完成的事件会丢失（如媒体捕获页
 *         "保存录屏"后切到本页），需用缓存补回。
 */

import { app, ipcMain, session, type DownloadItem } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

/** 下载记录（活动表与历史缓存共用的结构化数据） */
interface DownloadRecord {
  id: string
  url: string
  filename: string
  state: string
  percent: number
  receivedBytes: number
  totalBytes: number
  savePath: string
  /** 完成时间戳；0 = 进行中 */
  finishedAt: number
}

/** 活动下载表：key = 下载唯一 id */
const activeDownloads = new Map<string, DownloadItem>()
/** 已完成/中断下载的历史缓存（供 download:list 回放：页面未挂载时完成的事件不会丢） */
const recentDownloads: DownloadRecord[] = []
const HISTORY_LIMIT = 50
let downloadSeq = 0

/** 从 DownloadItem 生成结构化记录（活动表与历史共用） */
function toRecord(id: string, item: DownloadItem, state: string, finishedAt = 0): DownloadRecord {
  const received = item.getReceivedBytes()
  const total = item.getTotalBytes()
  return {
    id,
    url: item.getURL(),
    filename: item.getFilename(),
    state,
    percent: state === 'completed' ? 100 : total > 0 ? Math.round((received / total) * 100) : 0,
    receivedBytes: received,
    totalBytes: total,
    savePath: item.getSavePath(),
    finishedAt
  }
}

export function registerDownload(getMainWindow: MainWindowGetter): void {
  const push = (channel: string, data: unknown): void => {
    getMainWindow()?.webContents.send(channel, data)
  }

  // ── 每次下载开始时触发 ──
  session.defaultSession.on('will-download', (_event, item) => {
    // 每个下载独立 id（同一 URL 重复下载不会互相覆盖）
    const id = `${Date.now()}-${++downloadSeq}`

    // 默认保存目录：系统下载目录（数据目录页 setPath('downloads') 可运行期修改）
    const dir = app.getPath('downloads')
    mkdirSync(dir, { recursive: true }) // 目录不存在时兜底创建
    // 兜底文件名：blob:// 等下载在某些平台 getFilename() 可能为空
    const filename = item.getFilename() || `download-${Date.now()}`
    item.setSavePath(join(dir, filename))

    activeDownloads.set(id, item)

    // 进度更新：percent / 字节数 / 状态（progressing | interrupted）
    item.on('updated', (_e, state) => {
      push('download:progress', toRecord(id, item, state))
    })

    // 下载结束：completed | cancelled | interrupted
    item.on('done', (_e, state) => {
      activeDownloads.delete(id)
      const record = toRecord(id, item, state, Date.now())
      // 写入历史缓存（供 download:list 回放，页面未挂载时推送的事件不会丢）
      recentDownloads.unshift(record)
      if (recentDownloads.length > HISTORY_LIMIT) recentDownloads.pop()
      push('download:done', record)
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

  // ── 回放下载列表（活动 + 历史缓存）──
  // 页面挂载时先拉一次：此前完成/进行中的下载（如媒体捕获页"保存录屏"）不会丢失
  ipcMain.handle('download:list', () => {
    const active: DownloadRecord[] = []
    activeDownloads.forEach((item, id) => {
      active.push(toRecord(id, item, item.isPaused() ? 'paused' : 'progressing'))
    })
    // 活动下载在前（进行中），历史缓存在后（最新在前）
    return [...active, ...recentDownloads]
  })

  // ── 暂停 / 恢复 / 取消（按下载 id）──
  // ⚠️ API 语义陷阱：canResume() 是"能否**恢复**"（仅 paused/interrupted 时返回 true），
  //   对**正在下载**（progressing）的项它返回 false——不能拿它当"能否暂停"的守卫
  //   （本工程曾因此把正常暂停挡掉，提示"没有可暂停的下载"）。
  //   正确用法：判断"能否暂停"看 isPaused()/state；判断"能否恢复"才用 canResume()。
  // ⚠️ 状态事件陷阱（Electron 39 源码级确认）：updated/done 事件的 state 转换器
  //   没有 PAUSED 分支（gin Converter 的 default 返回空串），暂停时页面只会收到
  //   state: ''——因此暂停/恢复状态必须由应用主动推送（download:state 通道），
  //   真实工程也常自行维护状态机。
  ipcMain.handle('download:pause', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item) return { ok: false, error: '没有进行中的下载' }
    if (item.isPaused()) return { ok: false, error: '下载已暂停' }
    item.pause()
    push('download:state', { id, state: 'paused' })
    return { ok: true }
  })

  ipcMain.handle('download:resume', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item) return { ok: false, error: '没有暂停中的下载' }
    // 这里才是 canResume 的正确场景：只有 paused/interrupted 且服务器支持 Range 才可恢复
    if (!item.canResume()) return { ok: false, error: '当前状态不可恢复（需服务器支持 Range）' }
    item.resume()
    push('download:state', { id, state: 'progressing' })
    return { ok: true }
  })

  ipcMain.handle('download:cancel', (_e, id: string) => {
    const item = activeDownloads.get(id)
    if (!item) return { ok: false, error: '没有进行中的下载' }
    item.cancel()
    return { ok: true }
  })
}
