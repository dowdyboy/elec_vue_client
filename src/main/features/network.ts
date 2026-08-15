/**
 * 【特性】网络通信（主进程 HTTP 请求封装）
 * 【API】axios（主进程内使用）+ WebSocket（渲染进程直接使用 socket.io-client）
 * 【复制】1. 复制本文件到新工程 src/main/features/network.ts
 *         2. 在 index.ts 中调用 registerNetwork()
 *         3. 渲染进程调用 window.api.network.httpGet()
 * 【说明】两种网络方案的适用场景：
 *         - HTTP：axios 在主进程发起请求，可绕过浏览器 CORS 限制，
 *                 也方便统一加鉴权 header / 错误处理（生产工程常用）
 *         - WebSocket：socket.io-client 在渲染进程直连即可
 *                  （浏览器原生能力，无需主进程中转）
 */

import axios from 'axios'
import { ipcMain, net } from 'electron'

export function registerNetwork(): void {
  ipcMain.handle('network:httpGet', async (_event, url: string) => {
    if (!url) return { ok: false, error: 'URL 不能为空' }
    try {
      // timeout 防止教学演示时长时间挂起；validateStatus 让 4xx/5xx 也返回数据
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: () => true
      })
      return {
        ok: true,
        status: response.status,
        headers: Object.fromEntries(Object.entries(response.headers).slice(0, 5)),
        // 只返回前 2000 字符，避免演示时刷屏
        data:
          typeof response.data === 'string'
            ? response.data.slice(0, 2000)
            : JSON.stringify(response.data).slice(0, 2000)
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── DNS 解析（域名 → IP 地址列表）──
  ipcMain.handle('network:resolveDns', async (_event, hostname: string) => {
    if (!hostname) return { ok: false, error: '域名不能为空' }
    try {
      // ⚠️ Electron 30+ breaking change：net.resolveHost 返回结构从旧版
      // { addresses: [{ address, family: number }] } 改为
      // { endpoints: [{ address: string; family: 'ipv4' | 'ipv6' | 'unspec' }] }
      // （本工程曾按旧结构转型，导致 result.addresses 为 undefined，
      // 报 "Cannot read properties of undefined (reading 'map')"，见 docs/14）
      const result = await net.resolveHost(hostname)
      const list = result.endpoints.map((e) => `${e.address}（${e.family}）`)
      return {
        ok: true,
        addresses: list.length > 0 ? list : ['（无解析结果，检查域名是否有效）']
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
