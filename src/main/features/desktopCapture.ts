/**
 * 【特性】桌面捕获（desktopCapturer）+ 窗口截图（capturePage）
 * 【API】desktopCapturer.getSources / webContents.capturePage
 * 【复制】1. 复制本文件到新工程 src/main/features/desktopCapture.ts
 *         2. 在 index.ts 中调用 registerDesktopCapture(getMainWindow)
 *         3. 渲染进程调用 window.api.capture.*
 * 【说明】desktopCapturer 枚举所有屏幕/窗口源（含缩略图），
 *         是"录屏、共享屏幕"类应用（如 OBS、视频会议）的基础。
 *         本演示只做静态截图：列出屏幕源缩略图 + 截取当前窗口保存 PNG。
 *         注意：desktopCapturer.getSources 在渲染进程也可调用，
 *         但为统一权限管理（安全页），这里经主进程调用。
 */

import { desktopCapturer, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { MainWindowGetter } from '../types'

export function registerDesktopCapture(getMainWindow: MainWindowGetter): void {
  // ── 枚举屏幕/窗口源（带缩略图）──
  ipcMain.handle('capture:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      // 缩略图尺寸（小图足够预览）
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      // 空缩略图（某些窗口最小化/权限原因）不返回 dataURL，页面据此跳过显示
      thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
      displayId: source.display_id
    }))
  })

  // ── 截取当前窗口（含页面内容）──
  ipcMain.handle('capture:capturePage', async () => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    const image = await win.webContents.capturePage()
    return { ok: true, dataUrl: image.toDataURL() }
  })

  // ── 保存截图为 PNG 文件 ──
  ipcMain.handle('capture:savePng', async (_e, dataUrl: string) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    const result = await dialog.showSaveDialog(win, {
      title: '保存截图',
      defaultPath: `截图-${Date.now()}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '用户取消' }
    // dataURL → Buffer → 写文件
    const base64 = dataUrl.split(',')[1] ?? ''
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: result.filePath }
  })
}
