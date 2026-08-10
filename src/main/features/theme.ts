/**
 * 【特性】系统主题（nativeTheme：跟随系统明暗模式）
 * 【API】nativeTheme
 * 【复制】1. 复制本文件到新工程 src/main/features/theme.ts
 *         2. 在 index.ts 中调用 registerTheme(getMainWindow)
 *         3. 渲染进程配合 preload 的 theme 分组实现明暗主题联动
 * 【说明】nativeTheme 是"主进程判断系统主题"的权威来源：
 *         - themeSource: 'system' | 'light' | 'dark'（应用偏好）
 *         - shouldUseDarkColors: 当前实际是否暗色（由 source 与系统决定）
 *         - 'updated' 事件：系统主题变化 / source 变化时触发
 *         教学价值：实现"亮/暗/跟随系统"三档切换，且能感知 OS 级变化
 */

import { ipcMain, nativeTheme } from 'electron'
import type { MainWindowGetter } from '../types'

export type ThemeSource = 'system' | 'light' | 'dark'

export function registerTheme(getMainWindow: MainWindowGetter): void {
  // 渲染进程初始化时查询当前状态
  ipcMain.handle('theme:getState', () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource
  }))

  // 设置应用主题偏好（亮 / 暗 / 跟随系统）
  ipcMain.handle('theme:setSource', (_e, source: ThemeSource) => {
    nativeTheme.themeSource = source
    return nativeTheme.shouldUseDarkColors
  })

  // 系统主题变化（用户改 Windows/macOS 设置）→ 推送渲染进程
  nativeTheme.on('updated', () => {
    getMainWindow()?.webContents.send('theme:updated', {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    })
  })
}
