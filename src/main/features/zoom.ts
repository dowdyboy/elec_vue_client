/**
 * 【特性】页面缩放控制（webContents.setZoomFactor）
 * 【API】webContents.setZoomFactor / getZoomFactor / zoom-changed 事件
 * 【复制】1. 复制本文件到新工程 src/main/features/zoom.ts
 *         2. 在 index.ts 中调用 registerZoom(getMainWindow)
 *         3. 渲染进程调用 window.api.zoom.*
 * 【说明】页面缩放（0.5 ~ 3.0 倍）：
 *         - 按钮/设置项控制：setZoomFactor
 *         - 用户 Ctrl+滚轮缩放：'zoom-changed' 事件（同步推送最新倍率）
 *         典型场景：阅读类应用的字体缩放设置、辅助功能。
 *         注意：zoom-changed 必须通过 web-contents-created 挂载
 *         （窗口创建时机晚于模块注册，直接拿窗口引用会失效）。
 */

import { app, ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerZoom(getMainWindow: MainWindowGetter): void {
  // 设置缩放倍率（0.5 ~ 3.0，1.0 = 100%）
  ipcMain.handle('zoom:set', (_e, factor: number) => {
    const win = getMainWindow()
    if (!win) return null
    const clamped = Math.min(3, Math.max(0.5, factor))
    win.webContents.setZoomFactor(clamped)
    return win.webContents.getZoomFactor()
  })

  // 重置为 100%
  ipcMain.handle('zoom:reset', () => {
    const win = getMainWindow()
    if (!win) return null
    win.webContents.setZoomFactor(1)
    return 1
  })

  // 查询当前倍率
  ipcMain.handle('zoom:get', () => getMainWindow()?.webContents.getZoomFactor() ?? null)

  // 用户 Ctrl+滚轮缩放（macOS 捏合手势）时触发：
  // ⚠️ Electron 中 zoom-changed 只是"请求缩放"的通知，默认不会自动缩放，
  //    必须在此根据 zoomDirection 调用 setZoomFactor 才真正生效。
  // 每个 webContents 创建时挂载（与 security.ts / inputHook.ts 同模式）
  app.on('web-contents-created', (_event, contents) => {
    contents.on('zoom-changed', (_e, zoomDirection) => {
      // ① 根据方向计算新倍率（步长 0.1，范围 0.5 ~ 3.0）
      const current = contents.getZoomFactor()
      const next = Math.min(3, Math.max(0.5, current + (zoomDirection === 'in' ? 0.1 : -0.1)))
      // ② 真正执行缩放
      contents.setZoomFactor(next)
      // ③ 推送最新倍率（页面标签实时同步）
      getMainWindow()?.webContents.send('zoom:changed', contents.getZoomFactor())
    })
  })
}
