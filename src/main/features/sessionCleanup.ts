/**
 * 【特性】会话缓存清理（session.clearCache / clearStorageData）
 * 【API】session.defaultSession.clearCache / clearStorageData
 * 【复制】1. 复制本文件到新工程 src/main/features/sessionCleanup.ts
 *         2. 在 index.ts 中调用 registerSessionCleanup()
 *         3. 渲染进程调用 window.api.session.clear*
 * 【说明】清理浏览器会话数据的常见场景：
 *         - 退出登录：清 Cookie（配合 cookies.ts）
 *         - 隐私清理：清 localStorage / IndexedDB / 缓存
 *         - 排障：清缓存后重载（解决"页面异常"）
 *         ⚠️ 注意：clearStorageData 会清掉应用自身的 localStorage
 *            （含本教学页面的 UI 状态），属预期行为。
 */

import { ipcMain, session } from 'electron'

export function registerSessionCleanup(): void {
  // 清 HTTP 缓存（不影响登录态）
  ipcMain.handle('session:clearCache', async () => {
    await session.defaultSession.clearCache()
    return { ok: true }
  })

  // 清存储数据（可按类型指定：cookies / localstorage / indexdb / cachestorage ...）
  ipcMain.handle('session:clearStorage', async () => {
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage']
    })
    return { ok: true }
  })

  // 全部清空（等同"清除浏览数据"）
  ipcMain.handle('session:clearAll', async () => {
    await session.defaultSession.clearCache()
    await session.defaultSession.clearStorageData()
    return { ok: true }
  })
}
