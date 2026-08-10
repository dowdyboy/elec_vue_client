/**
 * 【文件】主进程入口
 * 【说明】本文件只做两件事：
 *         1. 创建主窗口
 *         2. 以"注册表"形式挂载各特性模块（每个特性一行，增删即注释）
 *         各特性模块位于 src/main/features/，可单独复制到其他工程。
 */

import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { MainWindowGetter } from './types'

// ── 特性模块（按需增删，每个 register 对应一个可复制的模块）──
import { registerWindowManager } from './features/windowManager'
import { registerIpcBridge } from './features/ipcBridge'
import { registerTray } from './features/tray'
import { registerNotification } from './features/notification'
import { registerGlobalShortcut } from './features/globalShortcut'
import { registerClipboard } from './features/clipboard'
import { registerDialog } from './features/dialog'
import { registerFileSystem } from './features/fileSystem'
import { registerMenu } from './features/menu'
import { registerScreenInfo } from './features/screenInfo'
import { registerTheme } from './features/theme'
import { registerSecurity } from './features/security'
import { registerAppLifecycle } from './features/appLifecycle'
import { registerNetwork } from './features/network'
import { registerSockets } from './features/socket'
import { registerAutoUpdater } from './features/autoUpdater'
import { registerProtocol } from './features/protocol'
import { registerWindowState, attachWindowState } from './features/windowState'
import { registerDesktopCapture } from './features/desktopCapture'
import { registerPowerMonitor } from './features/powerMonitor'
import { registerPrint } from './features/print'
import { registerTaskbar } from './features/taskbar'
import { registerErrorHandler } from './features/errorHandler'
import { registerUtilityProcess } from './features/utilityProcess'
import { registerGlassEffect } from './features/glassEffect'
import { registerPowerBlocker } from './features/powerBlocker'
import { registerFileIcon } from './features/fileIcon'
import { showSplash, closeSplash, registerSplashReplay } from './features/splash'

/** 主窗口引用（用 let 而非 const：窗口可能被销毁重建） */
let mainWindow: BrowserWindow | null = null

/** 退出标志：true 表示用户选择了真正退出（托盘菜单/系统退出），
 *  此时关闭窗口不再拦截；false 时关闭窗口 = 隐藏到托盘 */
let isQuitting = false

/** 提供给各特性模块的窗口获取函数 */
const getMainWindow: MainWindowGetter = () => mainWindow

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 教学说明：sandbox: false 是 electron-vite 模板默认值，
      // 实际生产建议 true（见 docs/12-安全实践.md）
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // 主窗口就绪 → 关闭闪屏页
    closeSplash()
    mainWindow?.show()
  })

  // 窗口内所有 target="_blank" / window.open 都会走这里：
  // 外部链接一律交给系统浏览器打开，应用内不新开窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 窗口关闭行为：默认"关闭 = 隐藏到托盘"（教学演示托盘常驻场景）
  // 真正退出走托盘菜单"退出应用"或系统退出（此时 isQuitting = true，不拦截）
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 窗口状态持久化：恢复上次位置/大小 + 自动保存
  attachWindowState(mainWindow)

  // 开发环境加载 dev server（支持 HMR），生产加载打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ──────────────────────────────────────────────────
// 应用就绪后：注册所有特性模块
// 教学要点：每行注释掉即可"停用"该特性，方便对照学习
// ──────────────────────────────────────────────────
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  // ── 单实例锁必须先注册：若已有实例在运行，直接退出不再初始化 ──
  if (!registerAppLifecycle(getMainWindow)) return

  // 开发环境 F12 开 DevTools / 生产屏蔽 Ctrl+R
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── 特性注册表 ──
  registerWindowManager(getMainWindow) // 窗口管理（含多窗口/置顶/透明）
  registerIpcBridge() // IPC 四种通信模式
  registerTray(getMainWindow) // 系统托盘
  registerNotification(getMainWindow) // 系统通知
  registerGlobalShortcut(getMainWindow) // 全局快捷键 Ctrl+Shift+1/2
  registerClipboard() // 剪贴板
  registerDialog(getMainWindow) // 文件对话框
  registerFileSystem() // 文件系统读写
  registerMenu(getMainWindow) // 应用菜单 + 右键菜单
  registerScreenInfo(getMainWindow) // 屏幕信息
  registerTheme(getMainWindow) // 系统主题联动
  registerSecurity() // 安全策略（权限/导航拦截）
  registerNetwork() // HTTP 请求封装
  registerSockets(getMainWindow) // TCP / UDP 原生通信
  registerAutoUpdater(getMainWindow) // 自动更新（electron-updater）
  registerProtocol(getMainWindow) // 自定义协议 + 深链接 + 内嵌网页
  registerWindowState() // 窗口状态持久化（attach 见 createWindow）
  registerDesktopCapture(getMainWindow) // 屏幕源枚举 + 窗口截图
  registerPowerMonitor(getMainWindow) // 电源/会话监控
  registerPrint(getMainWindow) // 打印 PDF
  registerTaskbar(getMainWindow) // 任务栏进度 + 角标
  registerErrorHandler(getMainWindow) // 全局错误捕获
  registerUtilityProcess(getMainWindow) // 计算密集任务（utilityProcess）
  registerGlassEffect(getMainWindow) // 毛玻璃/亚克力效果
  registerPowerBlocker() // 阻止系统睡眠
  registerFileIcon() // 系统文件图标
  registerSplashReplay() // 闪屏重放（演示页按钮）

  // 启动闪屏（教学演示默认开启；主窗口 ready 后自动关闭）
  showSplash()

  createWindow()

  // macOS 惯例：点击 Dock 图标且无窗口时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭即退出（macOS 除外：保留 Dock 常驻）
// 教学说明：正常关闭窗口已被拦截为"隐藏到托盘"（见 createWindow），
// 走到这里说明是退出流程（托盘"退出应用"触发 before-quit → isQuitting=true）
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
