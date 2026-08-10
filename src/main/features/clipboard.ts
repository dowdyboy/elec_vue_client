/**
 * 【特性】剪贴板（clipboard）
 * 【API】clipboard
 * 【复制】1. 复制本文件到新工程 src/main/features/clipboard.ts
 *         2. 在 index.ts 中调用 registerClipboard()
 *         3. 渲染进程调用 window.api.clipboard.*
 * 【说明】Electron 的 clipboard 在渲染进程也可直接用 navigator.clipboard，
 *         但通过 IPC 封装可以获得：读写 HTML 富文本、图片、额外格式，
 *         并统一权限管理（见 security.ts 的权限策略）。
 */

import { clipboard, ipcMain, nativeImage } from 'electron'

export function registerClipboard(): void {
  // ── 纯文本 ──
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(text ?? '')
    return true
  })

  // ── HTML 富文本（复制到 Word/WPS 等可保留格式）──
  ipcMain.handle('clipboard:readHtml', () => clipboard.readHTML())
  ipcMain.handle('clipboard:writeHtml', (_e, html: string) => {
    clipboard.writeHTML(html ?? '')
    return true
  })

  // ── 图片（渲染进程传 dataURL，主进程转 nativeImage 写入）──
  ipcMain.handle('clipboard:readImage', () => clipboard.readImage().toDataURL())
  ipcMain.handle('clipboard:writeImage', (_e, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    return true
  })

  // ── 清空 ──
  ipcMain.handle('clipboard:clear', () => {
    clipboard.clear()
    return true
  })
}
