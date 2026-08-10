/**
 * 【特性】系统托盘（Tray）
 * 【API】Tray / Menu / nativeImage
 * 【复制】1. 复制本文件到新工程 src/main/features/tray.ts
 *         2. 在 index.ts 中调用 registerTray(getMainWindow)
 *         3. 需要托盘图标资源（本工程使用 resources/icon.png，可替换）
 * 【说明】托盘是桌面应用"常驻系统"的关键特性：
 *         - 应用关闭窗口后进程仍存活（见 index.ts 的 window-all-closed 逻辑）
 *         - 通过托盘菜单可重新打开窗口、退出应用
 *         注意：Windows 托盘图标会自动缩放，无需手动 resize
 */

import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

export function registerTray(getMainWindow: MainWindowGetter): Tray | null {
  // ── 创建托盘图标 ──
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (icon.isEmpty()) return null // 图标文件缺失时安全退出
  const tray = new Tray(icon)

  // 鼠标悬停提示
  tray.setToolTip('Electron 教学与模板项目')

  // 左键单击：显示并聚焦主窗口（Windows 上单击默认无行为）
  tray.on('click', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 右键菜单：托盘最常用的交互方式
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => getMainWindow()?.show() },
      { label: '隐藏主窗口', click: () => getMainWindow()?.hide() },
      { type: 'separator' },
      {
        label: '退出应用',
        // 真正退出：app.quit() → index.ts 的 before-quit 置 isQuitting=true，
        // 此后窗口关闭不再被拦截（否则会被"隐藏到托盘"逻辑挡住）
        click: () => app.quit()
      }
    ])
  )

  return tray
}
