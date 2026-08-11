/**
 * 【特性】安全实践（权限校验 / 导航拦截 / webview 禁用）
 * 【API】session.setPermissionRequestHandler / webContents 事件
 * 【复制】1. 复制本文件到新工程 src/main/features/security.ts
 *         2. 在 index.ts 中调用 registerSecurity()
 *         3. 无需渲染进程配合（可观察"被拒绝的权限请求"日志）
 * 【说明】Electron 应用安全三件套：
 *         - 权限白名单：只有明确授权的浏览器权限才放行
 *         - 导航拦截：禁止页面被引导到外部网站（防钓鱼/防跳转）
 *         - 禁用 webview 标签：webview 是已知的高风险攻击面
 *         配合 webPreferences 的 contextIsolation: true 与 sandbox 一起使用
 */

import { app, ipcMain, session, shell } from 'electron'

export function registerSecurity(): void {
  // ── ① 权限请求白名单 ───────────────────────────────
  // 页面请求任何浏览器权限（摄像头/麦克风/剪贴板/通知等）都会走到这里
  // 教学演示：只放行剪贴板读取，其余一律拒绝并记录
  const allowedPermissions = new Set(['clipboard-read'])

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (allowedPermissions.has(permission)) {
      callback(true) // 允许
      return
    }
    callback(false) // 拒绝
    // 通知渲染进程：页面可展示"权限被拒绝"的提示
    webContents.send('security:permission-denied', permission)
  })

  // ── ①.5 静默权限检查（setPermissionCheckHandler）──
  // 与上面的"请求处理器"（有回调交互、可通知页面）不同：
  // 检查处理器是"无 UI 静默判断"（如 permissions.query API 的返回值），
  // 不弹窗、不通知，直接返回 boolean。开关演示两种模式的差异。
  let silentCheck = false
  ipcMain.handle('security:setSilentCheck', (_e, enabled: boolean) => {
    silentCheck = enabled
    return silentCheck
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    // 开关关闭（未启用静默检查层）：放行查询，权限最终由上面的 request handler 裁决
    // 开关开启：白名单内权限放行，其余静默拒绝（不产生任何提示）
    return !silentCheck || allowedPermissions.has(permission)
  })

  // ── ② 每个 webContents 创建时挂拦截器 ───────────────
  app.on('web-contents-created', (_event, contents) => {
    // 阻止页面内导航到其他网站（防钓鱼跳转）
    // 教学说明：页面点击 <a href> 或 window.location 跳转都会触发
    contents.on('will-navigate', (event, url) => {
      const devServerUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
      const isInternal = url.startsWith(devServerUrl) || url.startsWith('file://')
      if (!isInternal) {
        event.preventDefault()
        // 外部链接交给系统默认浏览器打开
        shell.openExternal(url)
      }
    })

    // 禁止内嵌 webview 标签（高风险攻击面，默认应禁用）
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
