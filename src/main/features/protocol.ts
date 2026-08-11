/**
 * 【特性】自定义协议 + 深链接（Deep Link）+ 内嵌网页（WebContentsView）
 * 【API】app.setAsDefaultProtocolClient / app.on('open-url') / WebContentsView
 * 【复制】1. 复制本文件到新工程 src/main/features/protocol.ts
 *         2. 在 index.ts 中调用 registerProtocol(getMainWindow)
 *         3. 打包后协议自动注册；dev 模式注册到 electron 可执行文件
 * 【说明】深链接：注册自定义协议（如 elec-demo://）后，系统里点击
 *         该协议的链接会唤起应用（类似 weixin://、magnet://）。
 *         典型场景：网页/邮件里"打开应用"按钮、浏览器唤起应用传参。
 *         WebContentsView 是在窗口内嵌第三方网页的标准组件（替代已废弃的 BrowserView）。
 */

import { app, ipcMain, shell, WebContentsView } from 'electron'
import { isAbsolute, join } from 'path'
import { existsSync } from 'fs'
import type { MainWindowGetter } from '../types'

/** 自定义协议名（注册为系统默认处理程序） */
const PROTOCOL = 'elec-demo'

export function registerProtocol(getMainWindow: MainWindowGetter): void {
  // ── ① 注册为系统默认协议处理程序 ──
  // dev 模式：协议指向 electron.exe + 入口脚本
  // 生产模式：协议指向打包后的 exe（安装时自动注册）
  if (process.defaultApp) {
    // 开发模式下需要额外参数：electron.exe + 项目入口
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      join(process.cwd(), 'out/main/index.js')
    ])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  // ── ② 深链接处理 ──
  // 收到协议链接时：聚焦主窗口 + 把链接内容发给渲染进程
  const handleDeepLink = (url: string): void => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    getMainWindow()?.webContents.send('protocol:deep-link', url)
  }

  // Windows/Linux：通过 second-instance 的 argv 携带链接
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) handleDeepLink(url)
  })

  // macOS：通过 open-url 事件携带链接
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  // ── ③ 系统打开协议链接（演示用：渲染进程触发）──
  ipcMain.handle('protocol:openUrl', (_e, url: string) => {
    // 用系统默认程序打开该链接 → 唤起应用自身（触发深链接流程）
    shell.openExternal(url)
    return true
  })

  // ── ③.5 文件关联（open-file）：双击文件用应用打开 ──
  // 打包时声明文件关联（electron-builder fileAssociations），
  // 用户双击 .md/.txt 等文件时：macOS 触发 open-file 事件；
  // Windows/Linux 通过启动参数 argv 携带文件路径（second-instance 时处理）。
  const handleFileOpen = (filePath: string): void => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    getMainWindow()?.webContents.send('protocol:file-open', filePath)
  }

  // macOS：双击关联文件时触发
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    handleFileOpen(filePath)
  })

  // Windows/Linux：从 second-instance 参数中识别文件路径
  // 严格校验：绝对路径 + 文件真实存在（避免把 electron 自身参数误判为文件）
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
      return
    }
    // 开发模式参数混杂（electron.exe / 入口脚本等），不在此识别文件
    if (process.defaultApp) return
    const fileArg = argv.find((arg) => {
      if (arg.startsWith('-') || arg.startsWith(PROTOCOL)) return false
      // 需为绝对路径且文件真实存在（Windows 路径 / Unix 路径）
      const normalized = arg.replace(/\\/g, '/')
      if (!isAbsolute(normalized)) return false
      try {
        return existsSync(arg)
      } catch {
        return false
      }
    })
    if (fileArg) handleFileOpen(fileArg)
  })

  // 演示按钮：模拟"收到一个文件打开请求"
  ipcMain.handle('protocol:simulateOpenFile', (_e, filePath: string) => {
    handleFileOpen(filePath)
    return true
  })

  // ── ④ WebContentsView：窗口内嵌第三方网页 ──
  let embeddedView: WebContentsView | null = null
  const resizeEmbedded = (): void => {
    const win = getMainWindow()
    if (!win || !embeddedView) return
    // 让内嵌视图铺满整个窗口内容区
    const { width, height } = win.getContentBounds()
    embeddedView.setBounds({ x: 0, y: 0, width, height })
  }

  ipcMain.handle('view:open', (_e, url: string) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    // 关闭旧的内嵌视图（同时移除 resize 监听，避免监听器累积）
    if (embeddedView) {
      win.contentView.removeChildView(embeddedView)
      embeddedView.webContents.close()
      win.removeListener('resize', resizeEmbedded)
      embeddedView = null
    }
    embeddedView = new WebContentsView({
      webPreferences: { sandbox: false }
    })
    // addChildView 添加到主窗口；新视图会覆盖主窗口内容
    win.contentView.addChildView(embeddedView)
    resizeEmbedded()
    win.on('resize', resizeEmbedded)

    // 内嵌视图铺满窗口后，主页面按钮不可见 → 提供 ESC 关闭视图的退出途径
    embeddedView.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'Escape') {
        event.preventDefault()
        ipcMain.emit('view:close-internal')
      }
      // 导航历史：Alt+← 返回 / Alt+→ 前进（浏览器标准快捷键）
      if (input.key === 'ArrowLeft' && input.alt) {
        event.preventDefault()
        embeddedView?.webContents.goBack()
      }
      if (input.key === 'ArrowRight' && input.alt) {
        event.preventDefault()
        embeddedView?.webContents.goForward()
      }
    })

    // 导航状态推送（did-navigate：页面跳转后更新 返回/前进 可用状态）
    embeddedView.webContents.on('did-navigate', () => {
      win.webContents.send('view:navigation', {
        url: embeddedView?.webContents.getURL() ?? '',
        canGoBack: embeddedView?.webContents.canGoBack() ?? false,
        canGoForward: embeddedView?.webContents.canGoForward() ?? false
      })
    })

    embeddedView.webContents.loadURL(url)
    return { ok: true }
  })

  // ESC 关闭（与 view:close 相同的清理逻辑）
  const closeEmbedded = (): void => {
    const win = getMainWindow()
    if (embeddedView && win) {
      win.contentView.removeChildView(embeddedView)
      embeddedView.webContents.close()
      embeddedView = null
      win.removeListener('resize', resizeEmbedded)
      // 通知主页面同步按钮状态（view:close 的返回也能达成，但 ESC 场景需要推送）
      win.webContents.send('view:closed-by-esc')
    }
  }
  ipcMain.on('view:close-internal', closeEmbedded)

  ipcMain.handle('view:close', () => {
    closeEmbedded()
    return { ok: true }
  })

  // ── 导航历史控制（教学完整：页面按钮调用；内嵌时主页面被覆盖，用 Alt+←/→ 操作）──
  ipcMain.handle('view:goBack', () => {
    embeddedView?.webContents.goBack()
    return true
  })
  ipcMain.handle('view:goForward', () => {
    embeddedView?.webContents.goForward()
    return true
  })
}
