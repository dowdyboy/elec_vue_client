/**
 * 【特性】退出前未保存询问（before-quit 拦截 + 对话框）
 * 【API】app.on('before-quit') / dialog.showMessageBoxSync
 * 【复制】1. 复制本文件到新工程 src/main/features/quitGuard.ts
 *         2. 在 index.ts 中调用 registerQuitGuard(getMainWindow)
 *         3. 渲染进程调用 window.api.quitGuard.setDirty(true/false)
 * 【说明】生产必备模式：应用存在未保存修改时，退出前弹窗确认。
 *         实现要点：
 *         - 页面通过 quitGuard.setDirty() 标记"有未保存修改"
 *         - before-quit 拦截：有 dirty 且非强制退出 → preventDefault + 询问
 *         - 用户确认后置 forceQuit 再 quit（避免二次询问死循环）
 *         - quitState 与 index.ts 共享（退出流程取消时复位 isQuitting，
 *           否则"关闭=隐藏到托盘"的拦截会失效）
 */

import { app, dialog, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

/** 跨模块共享的退出状态（index.ts 的窗口 close 拦截也读它） */
export const quitState = {
  isQuitting: false
}

let hasUnsaved = false
let forceQuit = false

export function registerQuitGuard(getMainWindow: MainWindowGetter): void {
  // 页面标记"有未保存修改"
  ipcMain.handle('quitGuard:setDirty', (_e, dirty: boolean) => {
    hasUnsaved = dirty
    return hasUnsaved
  })

  ipcMain.handle('quitGuard:getDirty', () => hasUnsaved)

  // 退出拦截：有未保存修改时询问用户
  app.on('before-quit', (event) => {
    if (!hasUnsaved || forceQuit) return // 无修改 / 已确认退出 → 放行

    // 拦截本次退出
    event.preventDefault()

    const options: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      title: '未保存的修改',
      message: '存在未保存的修改，确定要退出吗？',
      buttons: ['直接退出', '取消'],
      defaultId: 0,
      cancelId: 1
    }
    // 对话框挂在主窗口上（无窗口时居中屏幕）
    const win = getMainWindow()
    const result = win
      ? dialog.showMessageBoxSync(win, options)
      : dialog.showMessageBoxSync(options)

    if (result === 0) {
      // 用户确认退出：清除 dirty + 置 forceQuit 后重新发起退出
      hasUnsaved = false
      forceQuit = true
      app.quit()
    } else {
      // 用户取消：复位退出状态（否则窗口 close 不再被"隐藏到托盘"拦截）
      quitState.isQuitting = false
    }
  })
}
