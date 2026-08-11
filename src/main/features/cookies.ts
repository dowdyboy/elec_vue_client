/**
 * 【特性】Cookie 管理（session.cookies）
 * 【API】session.defaultSession.cookies
 * 【复制】1. 复制本文件到新工程 src/main/features/cookies.ts
 *         2. 在 index.ts 中调用 registerCookies()
 *         3. 渲染进程调用 window.api.session.*
 * 【说明】Cookie 是 Web 登录态的载体，桌面应用常需要：
 *         - 读取：排查登录态、导出给其他客户端
 *         - 写入：免登录（把网页端 Cookie 同步给桌面端）
 *         - 删除：退出登录时清理
 *         cookies.set 需要完整的 url（含协议），name/value 必填。
 */

import { ipcMain, session } from 'electron'

export function registerCookies(): void {
  // ── 读取全部 Cookie ──
  ipcMain.handle('cookies:getAll', async () => {
    const cookies = await session.defaultSession.cookies.get({})
    return cookies.map((c) => ({
      name: c.name,
      value: c.value.slice(0, 40), // 截断展示，避免刷屏
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate ?? null // null = 会话级（关窗即失效）
    }))
  })

  // ── 写入 Cookie（url 需含协议，如 https://example.com）──
  ipcMain.handle(
    'cookies:set',
    async (_e, options: { url: string; name: string; value: string }) => {
      try {
        await session.defaultSession.cookies.set({
          url: options.url,
          name: options.name,
          value: options.value
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // ── 删除 Cookie ──
  ipcMain.handle('cookies:remove', async (_e, options: { url: string; name: string }) => {
    await session.defaultSession.cookies.remove(options.url, options.name)
    return { ok: true }
  })
}
