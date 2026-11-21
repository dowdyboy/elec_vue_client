/**
 * 【特性】自定义协议 + 深链接（Deep Link）+ 内嵌网页（WebContentsView）
 * 【API】app.setAsDefaultProtocolClient / app.on('open-url') / WebContentsView
 * 【复制】1. 复制本文件到新工程 src/main/features/protocol.ts
 *         2. 在 index.ts 中调用 registerProtocol(getMainWindow)
 *         3. 打包后协议自动注册；dev 模式注册到 electron 可执行文件
 * 【依赖】复制时需一并带上：src/main/types.ts（MainWindowGetter 类型）、src/main/utils/validateSender.ts（敏感通道发送方校验）、security.ts（权限白名单 / 内嵌网页会话）
 * 【说明】深链接：注册自定义协议（如 elec-demo://）后，系统里点击
 *         该协议的链接会唤起应用（类似 weixin://、magnet://）。
 *         典型场景：网页/邮件里"打开应用"按钮、浏览器唤起应用传参。
 *         WebContentsView 是在窗口内嵌第三方网页的标准组件（替代已废弃的 BrowserView）。
 * 【安全】内嵌的是**不受信任的第三方页面**，因此它跑在独立内存分区 `untrusted-embed` 上
 *         （与 defaultSession 隔离 + 全拒权限 + sandbox + 无 preload），
 *         且 window.open 一律转交系统浏览器。详见 security.ts 与 docs/12。
 */

import { app, ipcMain, session, shell, WebContentsView } from 'electron'
import { isAbsolute, join } from 'path'
import { existsSync } from 'fs'
import type { MainWindowGetter } from '../types'
import { FORBIDDEN, isTrustedSender } from '../utils/validateSender'
import { registerDenyAllForSession } from './security'

/** 自定义协议名（注册为系统默认处理程序） */
const PROTOCOL = 'elec-demo'

/**
 * 内嵌第三方网页使用的独立会话分区。
 * 不用 persist: 前缀 = 内存会话，关窗即销毁，页面数据（Cookie/存储）不落盘；
 * 关键是它与 defaultSession 隔离，因此主会话里的权限白名单不会波及到第三方页面。
 */
const EMBED_PARTITION = 'untrusted-embed'

export function registerProtocol(getMainWindow: MainWindowGetter): void {
  // 内嵌网页会话：全拒权限（摄像头/麦克风/录屏/串口/剪贴板）与显示捕获，
  // 第三方页面即使与本应用同源域名也拿不到任何硬件能力（见 security.ts）。
  registerDenyAllForSession(session.fromPartition(EMBED_PARTITION))

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

  // Windows/Linux：通过 second-instance 的 argv 携带链接（合并处理：深链接 + 文件关联）
  // 注意：appLifecycle.ts 也有一个 second-instance 聚焦监听，此处额外处理协议/文件分发，两者共存
  const handleSecondInstance = (_event: Electron.Event, argv: string[]): void => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
      return
    }
    if (process.defaultApp) return // 开发模式参数混杂，不识别文件
    const fileArg = argv.find((arg) => {
      if (arg.startsWith('-') || arg.startsWith(PROTOCOL)) return false
      const normalized = arg.replace(/\\/g, '/')
      if (!isAbsolute(normalized)) return false
      try {
        return existsSync(arg)
      } catch {
        return false
      }
    })
    if (fileArg) handleFileOpen(fileArg)
  }
  app.on('second-instance', handleSecondInstance)

  // macOS：通过 open-url 事件携带链接
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  // ── ③ 系统打开协议链接（演示用：渲染进程触发）──
  ipcMain.handle('protocol:openUrl', (e, url: string) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    // 只允许 http/https 与项目自己的 elec-demo 深链接，避免 openExternal 执行任意协议
    try {
      const protocol = new URL(url).protocol
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== `${PROTOCOL}:`) return false
    } catch {
      return false
    }
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

  // 演示按钮：模拟"收到一个文件打开请求"
  ipcMain.handle('protocol:simulateOpenFile', (_e, filePath: string) => {
    handleFileOpen(filePath)
    return true
  })

  // ── ④ WebContentsView：窗口内嵌第三方网页 ──
  let embeddedView: WebContentsView | null = null
  /** 顶部预留高度（px）：页面需在视图上方显示固定控件（如 PDF 返回条）时传入 */
  let viewTopInset = 0
  /** 主页面 ESC 兜底是否已挂载（只挂一次） */
  let mainEscFallbackAttached = false

  const resizeEmbedded = (): void => {
    const win = getMainWindow()
    if (!win || !embeddedView) return
    // 铺满窗口内容区；topInset > 0 时预留顶部条（WebContentsView 是原生叠加层，
    // CSS z-index 盖不住它，可见 UI 只能放在视图边界之外）
    const { width, height } = win.getContentBounds()
    embeddedView.setBounds({ x: 0, y: viewTopInset, width, height: height - viewTopInset })
  }

  ipcMain.handle('view:open', (e, url: string, options?: { topInset?: number }) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    try {
      const protocol = new URL(url).protocol
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:')
        return { ok: false, error: '仅支持 http/https/file URL' }
    } catch {
      return { ok: false, error: 'URL 非法' }
    }
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    viewTopInset = options?.topInset ?? 0
    // 关闭旧的内嵌视图（同时移除 resize 监听，避免监听器累积）
    if (embeddedView) {
      win.contentView.removeChildView(embeddedView)
      embeddedView.webContents.close()
      win.removeListener('resize', resizeEmbedded)
      embeddedView = null
    }
    embeddedView = new WebContentsView({
      webPreferences: {
        // 第三方网页的隔离基线：独立内存会话 + 沙箱 + 无 preload（拿不到 window.api）
        // 注意：WebContentsView 的导航是 loadURL（编程式），不会触发 will-navigate，
        //       所以不能指望 security.ts 的导航拦截兜住它——隔离必须做在会话与沙箱层。
        partition: EMBED_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    // 内嵌页面内的 window.open / target=_blank：不新开窗口，http(s) 交给系统浏览器
    embeddedView.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      try {
        const p = new URL(targetUrl).protocol
        if (p === 'http:' || p === 'https:') shell.openExternal(targetUrl)
      } catch {
        // 非法 URL：不打开
      }
      return { action: 'deny' }
    })
    // addChildView 添加到主窗口；新视图会覆盖主窗口内容
    win.contentView.addChildView(embeddedView)
    resizeEmbedded()
    win.on('resize', resizeEmbedded)

    // 兜底①：主页面 webContents 的 ESC 处理——无论焦点落在哪个 webContents 都能关
    // （addChildView 不转移焦点；新视图渲染进程未就绪时 focus() 是空操作，焦点可能仍
    // 在主页面上，因此主页面也要能响应 ESC）
    if (!mainEscFallbackAttached) {
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape') return
        if (!embeddedView) return
        event.preventDefault()
        ipcMain.emit('view:close-internal')
      })
      mainEscFallbackAttached = true
    }

    // 兜底②：渲染就绪后再移交键盘焦点给内嵌视图（Alt+←/→ 与内嵌页面按键才能生效）
    embeddedView.webContents.on('did-finish-load', () => {
      embeddedView?.webContents.focus()
    })

    // 内嵌视图覆盖窗口后，主页面按钮不可见 → 提供 ESC 关闭视图的退出途径
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
      // 把键盘焦点还给主页面（否则关闭后主页面无法输入）
      win.webContents.focus()
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
