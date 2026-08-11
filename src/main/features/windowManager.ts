/**
 * 【特性】窗口管理（多窗口、窗口控制、置顶、全屏、透明无边框窗口）
 * 【API】BrowserWindow
 * 【复制】1. 复制本文件到新工程 src/main/features/windowManager.ts
 *         2. 复制 src/main/types.ts（MainWindowGetter 类型）
 *         3. 在 index.ts 中调用 registerWindowManager(getMainWindow)
 *         4. 渲染进程调用 window.api.window.*（对应 preload 中 window 分组）
 * 【说明】本模块只依赖 Electron 内置 API，不含任何 UI 组件依赖
 */

import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

/** 演示子窗口类型：normal=普通子窗口，transparent=无边框透明窗口 */
export type ChildWindowMode = 'normal' | 'transparent'

/**
 * 通用加载函数：开发环境加载 dev server URL，生产环境加载打包后的 HTML
 * @param win  目标窗口
 * @param hash 要跳转的 SPA 路由 hash（如 'window-demo'），为空则加载首页
 */
export function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

/** 创建演示子窗口：演示"一个应用多个窗口"与透明/无边框窗口特性 */
function createChildWindow(mode: ChildWindowMode = 'normal'): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 420,
    show: false,
    title: mode === 'transparent' ? '透明演示窗口' : '子窗口演示',
    // frame: false + transparent: true 即可实现"无边框透明窗口"
    // （透明窗口必须配合 frame: false，且 Windows 下需设置 backgroundColor 透明）
    frame: mode !== 'transparent',
    transparent: mode === 'transparent',
    alwaysOnTop: mode === 'transparent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  // 子窗口加载 SPA 的 #window-demo 路由（对应 WindowDemoPage.vue）
  // 透明窗口额外带 query 参数，页面据此显示提示
  loadRenderer(win, mode === 'transparent' ? 'window-demo?transparent=1' : 'window-demo')
  return win
}

/**
 * 注册所有"窗口管理"相关的 IPC 通道
 * 调用时机：app.whenReady 之后
 */
export function registerWindowManager(getMainWindow: MainWindowGetter): void {
  // ── 创建子窗口（invoke/handle：需要返回结果）──
  ipcMain.handle('window:create', (_event, mode: ChildWindowMode) => {
    const win = createChildWindow(mode)
    return { created: true, id: win.id }
  })

  // ── 最小化（send/on：单向通知，无需结果）──
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize())

  // ── 最大化 / 还原 切换 ──
  ipcMain.handle('window:toggleMaximize', () => {
    const win = getMainWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  // ── 全屏切换 ──
  ipcMain.handle('window:toggleFullscreen', () => {
    const win = getMainWindow()
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })

  // ── 窗口置顶切换 ──
  ipcMain.handle('window:toggleAlwaysOnTop', () => {
    const win = getMainWindow()
    if (!win) return false
    win.setAlwaysOnTop(!win.isAlwaysOnTop())
    return win.isAlwaysOnTop()
  })

  // ── 关闭窗口 ──
  ipcMain.on('window:close', () => getMainWindow()?.close())

  // ── 通用窗口控制（无边框窗口自定义标题栏用）──
  // 与上面不同：作用于"发起请求的窗口"（主窗口/子窗口通用）
  // 渲染进程: window.api.window.control('minimize' | 'maximize' | 'close')
  ipcMain.on('window:control', (event, channel: 'minimize' | 'maximize' | 'close') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (channel === 'minimize') win.minimize()
    else if (channel === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (channel === 'close') win.close()
  })

  // ── 拖拽文件出窗口（webContents.startDrag）──
  // 把应用内的文件"拖到桌面/资源管理器"：必须在渲染进程的拖拽事件中调用
  ipcMain.on('drag:start', (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !filePath) return
    win.webContents.startDrag({
      file: filePath,
      // 拖动时显示的图标（可选：可改为文件自身的缩略图）
      icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    })
  })

  // ── kiosk 模式（自助终端/大屏应用：锁定全屏，Esc 无法退出）──
  ipcMain.handle('window:setKiosk', (_e, enabled: boolean) => {
    const win = getMainWindow()
    if (!win) return false
    win.setKiosk(enabled)
    return win.isKiosk()
  })

  // ── 窗口尺寸限制（最小/最大）──
  ipcMain.handle('window:setMinSize', (_e, width: number, height: number) => {
    const win = getMainWindow()
    if (!win) return false
    win.setMinimumSize(Math.max(0, width), Math.max(0, height))
    return true
  })

  ipcMain.handle('window:setMaxSize', (_e, width: number, height: number) => {
    const win = getMainWindow()
    if (!win) return false
    win.setMaximumSize(Math.max(0, width), Math.max(0, height))
    return true
  })

  // ── 窗口透明度（0 完全透明 ~ 1 不透明）──
  ipcMain.handle('window:setOpacity', (_e, opacity: number) => {
    const win = getMainWindow()
    if (!win) return null
    const clamped = Math.min(1, Math.max(0, opacity))
    win.setOpacity(clamped)
    return win.getOpacity()
  })
}

/**
 * 窗口移动/缩放事件监听（附加到窗口实例，由 index.ts 在创建后调用）
 * 演示：拖动窗口/调整大小时实时推送给页面（'window:event' 通道）
 */
export function attachWindowEvents(win: BrowserWindow): void {
  const push = (event: string): void => {
    const bounds = win.getBounds()
    win.webContents.send('window:event', {
      event,
      time: new Date().toLocaleTimeString(),
      bounds: `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`
    })
  }
  win.on('will-move', () => push('will-move')) // 窗口即将移动
  win.on('will-resize', () => push('will-resize')) // 窗口即将调整大小
}
