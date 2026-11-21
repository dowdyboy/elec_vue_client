/**
 * 【特性】安全实践（权限校验 / 导航拦截 / webview 禁用）
 * 【API】session.setPermissionRequestHandler / setPermissionCheckHandler / webContents 事件
 * 【复制】1. 复制本文件到新工程 src/main/features/security.ts（同时复制 utils/validateSender.ts）
 *         2. 在 index.ts 中调用 registerSecurity()
 *         3. 无需渲染进程配合（可观察"被拒绝的权限请求"日志）
 * 【说明】Electron 应用安全三件套：
 *         - 权限白名单：只有明确授权的浏览器权限才放行
 *         - 导航拦截：禁止页面被引导到外部网站（防钓鱼/防跳转）
 *         - 禁用 webview 标签：webview 是已知的高风险攻击面
 *         配合 webPreferences 的 contextIsolation: true 与 sandbox 一起使用
 * 【重要】权限处理器是"按 session"生效的，不是按页面生效。仅放行白名单里的权限名还不够：
 *         同一个 session 里如果存在第三方页面（本工程的"内嵌网页"演示就是），
 *         它同样会命中这个处理器。所以必须再叠加"来源是否本应用页面"的判断，
 *         否则任意网页都能申请摄像头/麦克风/录屏/串口。
 */

import { app, ipcMain, session, shell } from 'electron'
import { isTrustedPageUrl } from '../utils/validateSender'

/** 允许申请的权限白名单（仅对"本应用自己的页面"生效） */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'media', 'display-capture', 'serial'])

/** 从请求 details 中取发起页面 URL（缺省回退到 webContents 当前 URL） */
function requestUrl(webContents: Electron.WebContents | null, details: unknown): string {
  const d = details as { requestingUrl?: string } | undefined
  if (typeof d?.requestingUrl === 'string' && d.requestingUrl) return d.requestingUrl
  try {
    return webContents?.getURL() ?? ''
  } catch {
    return ''
  }
}

/** 静默检查开关（演示页可切换；模块级：所有受保护 session 共用同一策略） */
let silentCheck = false

/**
 * 为指定 session 应用完整的权限策略：请求处理器 + 静默检查处理器，均含"来源可信"校验。
 * 权限处理器是按 session 生效的，所以每个独立会话都要单独调用：
 *   - defaultSession（主窗口）→ registerSecurity() 内部调用
 *   - 分区窗口（partition.ts）→ 创建窗口前调用
 * 不调用就会退回 Electron 默认行为（默认放行），等于绕过本策略。
 */
export function registerSecurityForSession(targetSession: Electron.Session): void {
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = isTrustedPageUrl(requestUrl(webContents, details))
    if (!trusted || !ALLOWED_PERMISSIONS.has(permission)) {
      callback(false)
      // 只对自家页面回推"被拒绝"提示；第三方页面没有这个通道，也无需通知
      if (trusted && webContents && !webContents.isDestroyed()) {
        webContents.send('security:permission-denied', permission)
      }
      return
    }
    callback(true)
  })

  // 静默检查：permissions.query 这类无 UI 查询走这里，不弹窗也不通知
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    // 第三方页面（如内嵌网页）：静默拒绝，连查询都拿不到授权态
    const url = webContents && !webContents.isDestroyed() ? webContents.getURL() : requestingOrigin
    if (!isTrustedPageUrl(url)) return false
    // 开关关闭（未启用静默检查层）：放行查询，权限最终由上面的 request handler 裁决
    // 开关开启：白名单内权限放行，其余静默拒绝（不产生任何提示）
    return !silentCheck || ALLOWED_PERMISSIONS.has(permission)
  })
}

/**
 * 为"不受信任的会话"设置全拒策略：用于承载第三方网页的 WebContentsView。
 * 该 session 里任何权限请求（摄像头/麦克风/录屏/串口/剪贴板）与显示捕获一律拒绝，
 * 即使页面 origin 与业务页面同名也无例外。
 */
export function registerDenyAllForSession(targetSession: Electron.Session): void {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  targetSession.setPermissionCheckHandler(() => false)
  targetSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  })
}

export function registerSecurity(): void {
  // ── ① 权限请求白名单 + 来源校验 ───────────────────────
  // 页面请求任何浏览器权限（摄像头/麦克风/剪贴板/通知等）都会走到这里。
  // 教学演示：放行剪贴板读取、媒体访问（摄像头/麦克风，见 docs/29）、
  // 录屏（display-capture，getDisplayMedia 走此权限）；其余一律拒绝并记录。
  // 'serial' 供"静默检查处理器"使用（见下方 ①.5，串口走 devicePermissionHandler + 检查处理器）
  // 注意：'media' 放行后，macOS 还需通过 systemPreferences.askForMediaAccess
  // 获得系统级授权（见 systemAccess.ts 与 docs/29 的"双重权限"说明）
  registerSecurityForSession(session.defaultSession)

  // ── ①.5 静默检查开关（演示页切换 request / check 两种裁决层的差异）──
  ipcMain.handle('security:setSilentCheck', (_e, enabled: boolean) => {
    silentCheck = enabled
    return silentCheck
  })

  // ── ② 每个 webContents 创建时挂拦截器 ───────────────
  app.on('web-contents-created', (_event, contents) => {
    // 阻止页面内导航到其他网站（防钓鱼跳转）
    // 教学说明：页面点击 <a href> 或 window.location 跳转都会触发
    contents.on('will-navigate', (event, url) => {
      const devServerUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
      // 生产环境 devServerUrl 为空：不能直接用 startsWith('')（恒真，会完全绕过拦截）
      const isInternal =
        (devServerUrl !== '' && url.startsWith(devServerUrl)) || url.startsWith('file://')
      if (!isInternal) {
        event.preventDefault()
        // 只把 http/https 交给系统浏览器，避免 file://、smb:// 等协议被外部程序执行
        try {
          const protocol = new URL(url).protocol
          if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url)
        } catch {
          // 非法 URL：不打开
        }
      }
    })

    // 禁止内嵌 webview 标签（高风险攻击面，默认应禁用）
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
