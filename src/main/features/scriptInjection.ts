/**
 * 【特性】脚本注入（webContents.executeJavaScript）
 * 【API】webContents.executeJavaScript
 * 【复制】1. 复制本文件到新工程 src/main/features/scriptInjection.ts
 *         2. 在 index.ts 中调用 registerScriptInjection(getMainWindow)
 *         3. 渲染进程调用 window.api.inject.execute(code)
 * 【说明】向页面注入脚本/读取页面数据（调试、自动化、埋点）：
 *         - 主进程可在任意时刻执行 JS（页面自身无法做到的"外部操控"）
 *         - 返回值会被序列化回主进程
 *         - 对内嵌 WebContentsView 页面同样适用（用对应 view 的 webContents）
 *         ⚠️ 注意：executeJavaScript 能力很强，仅限可信场景使用
 */

import { ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerScriptInjection(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('inject:execute', async (_e, code: string) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    try {
      // 在主窗口页面上下文中执行脚本，返回结果
      const result = await win.webContents.executeJavaScript(code)
      return { ok: true, result: String(result) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
