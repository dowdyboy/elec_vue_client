/**
 * 【工具】轻量"来源可信度"校验（防 XSS / 内嵌网页滥用敏感通道）
 * 【说明】两条链路共用同一个判断：
 *         ① IPC 发送方校验：ipcMain.handle 回调首参可拿到 event.senderFrame.url
 *         ② 特权能力放行：权限请求（摄像头/麦克风/录屏/串口）、设备授权等只有
 *            "本应用自己的页面"才有资格申请（否则内嵌的第三方网页也能拿到硬件权限）
 *         判定口径：打包态只认 file://；开发态只认 dev server 同 origin 或回环地址。
 *         之所以单独抽出来，是因为"页面 URL 是否可信"在 3 处以上出现，
 *         任何一处写成 startsWith/includes 都会留下相似域名绕过（如 localhost.evil.com）。
 */

import type { IpcMainInvokeEvent } from 'electron'

/**
 * 回环主机名精确匹配（不做子串匹配）。
 * 反例：`origin.includes('localhost')` 会被 `https://localhost.evil.com` 绕过。
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

/**
 * 该 URL 是否属于"本应用自己的页面"。
 * - 打包态：`file://`（应用自身页面）
 * - 开发态：与 ELECTRON_RENDERER_URL 同 origin，或任意回环地址（electron-vite 起在随机端口）
 * - 其余一律不可信（含内嵌的 http/https 第三方页面）
 */
export function isTrustedPageUrl(rawUrl: string | null | undefined): boolean {
  const url = (rawUrl ?? '').trim()
  if (!url) return false
  // Electron 在部分回调里只给出 scheme 形式（如 details.origin === 'file://'）
  if (url === 'file:' || url === 'file://' || url.startsWith('file://')) return true

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
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
  return isLoopbackHost(parsed.hostname)
}

/** 是否为可信的本应用 IPC 发送方（file:// 打包态 或 devServer 开发态） */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedPageUrl(event.senderFrame?.url)
}

/** 校验失败时的统一返回（便于 handle 中直接 return） */
export const FORBIDDEN = { ok: false, error: 'forbidden: untrusted sender' } as const
