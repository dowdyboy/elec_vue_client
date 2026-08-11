/**
 * 【特性】自定义协议内容（protocol.handle）
 * 【API】protocol.registerSchemesAsPrivileged / protocol.handle
 * 【复制】1. 复制本文件到新工程 src/main/features/protocolContent.ts
 *         2. 在 index.ts 的【app ready 之前】调用 registerProtocolSchemes()
 *         3. 在 index.ts 的 whenReady 内调用 registerProtocolContent()
 *         4. 渲染进程可直接 fetch('elec-fs://demo/hello.txt') 读取
 * 【说明】与 docs/16 的"深链接"是两回事：
 *         - 深链接（setAsDefaultProtocolClient）：系统里点击链接唤起应用
 *         - 本模块（protocol.handle）：应用内部拦截 URL 并返回自定义内容
 *         典型用途：虚拟文件系统、离线资源包、流式数据接口。
 *         注意：registerSchemesAsPrivileged 必须在 app ready 前调用，
 *         且 CSP 需要放行 connect-src（见 index.html）。
 */

import { protocol } from 'electron'

/** 自定义协议名 */
const SCHEME = 'elec-fs'

/**
 * ① 声明协议特权（必须在 app ready 之前调用）：
 * standard + secure → 按 https 语义解析 URL（host/pathname 可用）
 * supportFetchAPI → 渲染进程可用 fetch() 请求该协议
 */
export function registerProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/** 虚拟文件内容（教学演示） */
const virtualFiles: Record<string, { type: string; body: string }> = {
  '/demo/hello.txt': {
    type: 'text/plain; charset=utf-8',
    body: '这是来自主进程 protocol.handle 的虚拟文件内容！\n应用内部拦截 elec-fs:// 协议并返回自定义数据。'
  },
  '/demo/version.json': {
    type: 'application/json',
    body: JSON.stringify({ app: 'Electron 教学项目', version: '1.0.0', protocol: SCHEME }, null, 2)
  }
}

/**
 * ② 注册协议处理器（app ready 之后调用）：
 * 每个 elec-fs:// 请求都会进入此回调，返回 Response 对象
 */
export function registerProtocolContent(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const file = virtualFiles[url.pathname]
    if (!file) {
      // 不存在的路径返回 404
      return new Response('404 Not Found', { status: 404 })
    }
    return new Response(file.body, { headers: { 'content-type': file.type } })
  })
}
