/**
 * 【特性】会话配置（代理 + User-Agent）
 * 【API】session.setProxy / session.setUserAgent
 * 【复制】1. 复制本文件到新工程 src/main/features/sessionConfig.ts
 *         2. 在 index.ts 中调用 registerSessionConfig()
 *         3. 渲染进程调用 window.api.sessionConfig.*
 * 【说明】两类会话级配置：
 *         - 代理：公司内网、抓包调试（fiddler/charles 默认 127.0.0.1:8888）
 *         - UA：模拟浏览器访问兼容性差的旧网站
 *         代理模式：direct（直连）/ fixed_servers（固定代理）/ system（系统代理）
 */

import { ipcMain, session } from 'electron'

export function registerSessionConfig(): void {
  // ── 代理设置 ──
  ipcMain.handle('sessionConfig:setProxy', async (_e, proxyRules: string) => {
    try {
      await session.defaultSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: proxyRules || undefined // 如 'http=127.0.0.1:8888;https=127.0.0.1:8888'
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 恢复系统代理 / 直连
  ipcMain.handle('sessionConfig:setProxyMode', async (_e, mode: 'direct' | 'system') => {
    await session.defaultSession.setProxy({ mode })
    return { ok: true }
  })

  // 查询某 URL 实际会走什么代理（代理调试利器）
  ipcMain.handle('sessionConfig:resolveProxy', async (_e, url: string) => {
    try {
      return { ok: true, proxy: await session.defaultSession.resolveProxy(url) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── User-Agent 设置 ──
  ipcMain.handle('sessionConfig:setUserAgent', (_e, ua: string) => {
    session.defaultSession.setUserAgent(ua)
    return session.defaultSession.getUserAgent()
  })

  ipcMain.handle('sessionConfig:getUserAgent', () => session.defaultSession.getUserAgent())
}
