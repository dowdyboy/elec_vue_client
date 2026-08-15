/**
 * 【特性】页面加载状态监控（did-finish-load / did-fail-load / loading）
 * 【API】webContents 事件
 * 【复制】1. 复制本文件到新工程 src/main/features/loadState.ts
 *         2. 在 index.ts 中调用 registerLoadState(getMainWindow)
 *         3. 渲染进程监听 window.api.web.onLoadState()
 * 【说明】监控页面加载过程（主窗口 / 内嵌 WebContentsView 都适用）：
 *         - loading 开始 → did-finish-load 完成 → did-fail-load 失败（错误码）
 *         典型用途：加载指示器、失败错误页（网络异常时提示重试）。
 */

import { app, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerLoadState(getMainWindow: MainWindowGetter): void {
  // 查询当前页面加载状态
  ipcMain.handle('web:getLoadState', () => {
    const wc = getMainWindow()?.webContents
    return {
      loading: wc?.isLoading() ?? false,
      url: wc?.getURL() ?? ''
    }
  })

  // 每个 webContents（含内嵌 view）创建时挂载事件
  app.on('web-contents-created', (_event, contents) => {
    const push = (state: string, extra?: Record<string, unknown>): void => {
      getMainWindow()?.webContents.send('web:load-state', {
        state,
        url: contents.getURL(),
        time: new Date().toLocaleTimeString(),
        ...extra
      })
    }
    contents.on('did-start-loading', () => push('loading'))
    contents.on('did-finish-load', () => push('loaded'))
    contents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      // -3 是"页面被中止"（如刷新），不视为错误
      if (errorCode !== -3) {
        push('failed', { errorCode, errorDescription, validatedURL })
      }
    })
  })
}
