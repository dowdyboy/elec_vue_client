/**
 * 【工具】轻量 IPC 发送方校验（防 XSS 滥用敏感通道）
 * 【说明】Electron 的 ipcMain.handle 回调首参为 IpcMainInvokeEvent，
 *         可通过 event.senderFrame?.url 判断调用来源是否为本应用页面。
 *         本函数为"轻量化"实现：仅校验是否为 file:// 或 devServer 域，
 *         失败时返回 { ok:false }，调用方可直接返回给渲染进程。
 *         非敏感通道无需校验，敏感通道（shell/db/inject/fs写/trash 等）建议校验。
 */

import type { IpcMainInvokeEvent } from 'electron'

/** 是否为可信的本应用页面（file:// 打包态 或 ELECTRON_RENDERER_URL 开发态） */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // 打包态：只接受 file://（应用自身页面）
  if (parsed.protocol === 'file:') return true
  // 开发态：必须与 dev server 同 origin（不能用字符串前缀，避免 userinfo/相似域名绕过）
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    try {
      if (parsed.origin === new URL(devUrl).origin) return true
    } catch {
      // devUrl 非法：继续走回环兜底
    }
  }
  // electron-vite dev 常见回环地址（任意端口）
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
}

/** 校验失败时的统一返回（便于 handle 中直接 return） */
export const FORBIDDEN = { ok: false, error: 'forbidden: untrusted sender' } as const

/** 辅助：在 handle 顶部调用 `if (!isTrustedSender(e)) return FORBIDDEN` */
export function assertTrustedSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedSender(event)
}
