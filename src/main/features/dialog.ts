/**
 * 【特性】文件对话框（dialog：打开 / 保存 / 消息框）
 * 【API】dialog
 * 【复制】1. 复制本文件到新工程 src/main/features/dialog.ts
 *         2. 在 index.ts 中调用 registerDialog()
 *         3. 渲染进程调用 window.api.dialog.*
 * 【说明】打开/保存文件对话框**必须由主进程弹出**：
 *         - 对话框是系统原生窗口，需要挂在某个窗口上（parent）
 *         - 渲染进程无法直接调用（安全限制）
 *         注意：返回的路径仅作展示，真正读写文件用 fileSystem.ts
 */

import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerDialog(getMainWindow: MainWindowGetter): void {
  // ── 打开文件选择框 ──
  ipcMain.handle(
    'dialog:openFile',
    async (_event, filters?: { name: string; extensions: string[] }[]) => {
      const win = getMainWindow() as BrowserWindow | undefined
      const result = await dialog.showOpenDialog(win!, {
        title: '选择一个文件',
        // filters 控制可选文件类型：如 [{ name: '文本', extensions: ['txt', 'md'] }]
        filters: filters ?? [],
        properties: ['openFile'] // openDirectory 可改为选择文件夹
      })
      // canceled 表示用户点了取消
      return result.canceled ? null : result.filePaths[0]
    }
  )

  // ── 打开目录选择框（目录监听/导出目录等场景）──
  ipcMain.handle('dialog:openDirectory', async (_event, title?: string) => {
    const win = getMainWindow() as BrowserWindow | undefined
    const result = await dialog.showOpenDialog(win!, {
      title: title ?? '选择一个目录',
      // properties 决定对话框形态：
      //   'openDirectory'    → 只能选目录（Windows 下文件项置灰）
      //   'multiSelections'  → 多选（可同时用于 openFile/openDirectory）
      //   'createDirectory'  → macOS 提供"新建文件夹"按钮
      //   'promptToCreate'   → Windows 显示"新建文件夹"输入框
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── 保存文件对话框 ──
  ipcMain.handle(
    'dialog:saveFile',
    async (_event, options?: { defaultName?: string; content?: string }) => {
      const win = getMainWindow() as BrowserWindow | undefined
      const result = await dialog.showSaveDialog(win!, {
        title: '保存文件',
        defaultPath: options?.defaultName ?? 'untitled.txt'
      })
      return result.canceled ? null : result.filePath
    }
  )

  // ── 消息对话框（询问/提示，可自定义按钮）──
  ipcMain.handle(
    'dialog:showMessage',
    async (_event, options?: { title?: string; message?: string; buttons?: string[] }) => {
      const win = getMainWindow() as BrowserWindow | undefined
      const result = await dialog.showMessageBox(win!, {
        type: 'question', // info / warning / error / question
        title: options?.title ?? '消息',
        message: options?.message ?? '',
        buttons: options?.buttons ?? ['确定'],
        // 默认按钮与取消按钮的下标（从 buttons 中选）
        defaultId: 0,
        cancelId: 1
      })
      // response 是用户点击的按钮下标
      return { response: result.response, checkboxChecked: result.checkboxChecked }
    }
  )
}
