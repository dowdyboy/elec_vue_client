/**
 * 【特性】屏幕信息（多显示器 / 分辨率 / 光标位置）
 * 【API】screen
 * 【复制】1. 复制本文件到新工程 src/main/features/screenInfo.ts
 *         2. 在 index.ts 中调用 registerScreenInfo(getMainWindow)
 *         3. 渲染进程调用 window.api.screen.*
 * 【说明】screen 只能在主进程使用：
 *         - 获取所有显示器信息（位置、分辨率、缩放比、是否主屏）
 *         - 监听显示器"插入/拔出/分辨率变化"，实时推送渲染进程
 *         实际用途：多屏应用把窗口移到指定显示器、适配高分屏缩放等
 */

import { ipcMain, screen } from 'electron'
import type { MainWindowGetter } from '../types'

/** 汇总所有显示器信息 + 光标坐标 */
function getScreenInfo(): {
  primary: { width: number; height: number }
  displays: {
    id: number
    bounds: Electron.Rectangle
    scaleFactor: number
    primary: boolean
  }[]
  cursor: Electron.Point
} {
  return {
    // 主显示器的尺寸（实际业务常用）
    primary: screen.getPrimaryDisplay().size,
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds, // 显示器在虚拟桌面中的位置和尺寸
      scaleFactor: d.scaleFactor, // 缩放比（1 / 1.25 / 1.5 / 2 等）
      primary: d.id === screen.getPrimaryDisplay().id
    })),
    cursor: screen.getCursorScreenPoint() // 当前鼠标位置（虚拟桌面坐标）
  }
}

export function registerScreenInfo(getMainWindow: MainWindowGetter): void {
  // 渲染进程主动查询
  ipcMain.handle('screen:getInfo', () => getScreenInfo())

  // 显示器变化事件：向主窗口推送最新信息（实时刷新页面）
  const push = (): void =>
    getMainWindow()?.webContents.send('screen:displays-changed', getScreenInfo())
  screen.on('display-added', push)
  screen.on('display-removed', push)
  screen.on('display-metrics-changed', push)
}
