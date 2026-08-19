/**
 * 【特性】HTTP 请求拦截（session.webRequest）
 * 【API】session.defaultSession.webRequest
 * 【复制】1. 复制本文件到新工程 src/main/features/webRequest.ts
 *         2. 在 index.ts 中调用 registerWebRequest(getMainWindow)
 *         3. 渲染进程监听 window.api.session.onRequestLog() 查看拦截记录
 * 【说明】webRequest 拦截 Chromium 网络栈的所有请求（渲染进程 fetch、
 *         下载、页面资源），典型用途：
 *         - 注入请求头（token、UA）与修改响应
 *         - 广告拦截（onBeforeRequest 返回 cancel）
 *         - 抓包调试（记录请求日志）
 *         ⚠️ 教学重点：onBeforeSendHeaders 的回调必须调用 callback()，
 *            否则请求会永久挂起！（忘记调用是经典 bug）
 */

import { session } from 'electron'
import type { MainWindowGetter } from '../types'

/** 演示用注入头：显示"拦截修改请求"的实际效果 */
const INJECTED_HEADER = 'X-Demo-Header'
const INJECTED_VALUE = 'injected-by-webRequest'

export function registerWebRequest(getMainWindow: MainWindowGetter): void {
  // 只记录 http(s) 请求，并过滤应用自身资源（避免 dev server 页面/热更请求刷屏）。
  // 注意：不能按 localhost/127.0.0.1 一刀切过滤——会话管理页用本地自闭环
  // 下载源 http://127.0.0.1:8765 触发请求，需保留拦截记录。
  const isTrackable = (url: string): boolean => {
    if (!(url.startsWith('http://') || url.startsWith('https://'))) return false
    const devOrigin = process.env['ELECTRON_RENDERER_URL'] // 开发模式渲染层来源，如 http://localhost:5173
    if (devOrigin && url.startsWith(devOrigin)) return false
    return true
  }

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (isTrackable(details.url)) {
      // 注入自定义请求头（教学演示：真实修改请求）
      details.requestHeaders[INJECTED_HEADER] = INJECTED_VALUE

      // 推送给渲染进程展示（含注入标记）
      getMainWindow()?.webContents.send('webRequest:log', {
        time: new Date().toLocaleTimeString(),
        method: details.method,
        url: details.url,
        injected: true
      })
    }
    // ⚠️ 必须调用 callback，否则请求挂起
    callback({ requestHeaders: details.requestHeaders })
  })
}
