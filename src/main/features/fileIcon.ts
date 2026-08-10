/**
 * 【特性】系统文件图标（app.getFileIcon）
 * 【API】app.getFileIcon
 * 【复制】1. 复制本文件到新工程 src/main/features/fileIcon.ts
 *         2. 在 index.ts 中调用 registerFileIcon()
 *         3. 渲染进程调用 window.api.fileIcon.get(path)
 * 【说明】获取文件在操作系统中的类型图标（如 Word 文档、图片、可执行文件），
 *         常配合文件列表/资源管理器类应用使用。
 *         size 可选 'small' | 'normal' | 'large'（越大越清晰）。
 */

import { app, ipcMain } from 'electron'

export function registerFileIcon(): void {
  ipcMain.handle('fileIcon:get', async (_e, filePath: string) => {
    if (!filePath) return { ok: false, error: '路径不能为空' }
    try {
      const icon = await app.getFileIcon(filePath, { size: 'large' })
      return { ok: true, dataUrl: icon.toDataURL() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
