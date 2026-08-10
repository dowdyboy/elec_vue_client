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
import { join } from 'path'
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
    // 关闭旧的内嵌视图
    if (embeddedView) {
      win.contentView.removeChildView(embeddedView)
      embeddedView.webContents.close()
      embeddedView = null
    }
    embeddedView = new WebContentsView({
      webPreferences: { sandbox: false }
    })
    // addChildView 添加到主窗口；新视图会覆盖主窗口内容
    win.contentView.addChildView(embeddedView)
    resizeEmbedded()
    win.on('resize', resizeEmbedded)
    embeddedView.webContents.loadURL(url)
    return { ok: true }
  })

  ipcMain.handle('view:close', () => {
    const win = getMainWindow()
    if (embeddedView && win) {
      win.contentView.removeChildView(embeddedView)
      embeddedView.webContents.close()
      embeddedView = null
      win.removeListener('resize', resizeEmbedded)
    }
    return { ok: true }
  })
}
