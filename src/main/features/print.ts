/**
 * 【特性】打印（printToPDF 生成 PDF）
 * 【API】webContents.printToPDF / dialog
 * 【复制】1. 复制本文件到新工程 src/main/features/print.ts
 *         2. 在 index.ts 中调用 registerPrint(getMainWindow)
 *         3. 渲染进程调用 window.api.print.toPdf()
 * 【说明】把当前窗口内容导出为 PDF：webContents.printToPDF 返回 Buffer，
 *         配合保存对话框落盘。实际打印（走系统打印机）用 webContents.print()，
 *         参数类似（silent、printBackground 等），此处演示 PDF 导出更直观。
 */

import { dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { MainWindowGetter } from '../types'

export function registerPrint(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('print:toPdf', async (_e, options?: { defaultName?: string }) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }

    // 生成 PDF（A4，包含背景色）
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })

    // 弹出保存对话框
    const result = await dialog.showSaveDialog(win, {
      title: '保存 PDF',
      defaultPath: options?.defaultName ?? '页面.pdf',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '用户取消' }

    await fs.writeFile(result.filePath, pdfBuffer)
    return { ok: true, path: result.filePath, size: pdfBuffer.length }
  })
}
