/**
 * 【特性】会话分区（session.fromPartition：无痕模式 / 多账号隔离）
 * 【API】BrowserWindow webPreferences.partition / session.fromPartition
 * 【复制】1. 复制本文件到新工程 src/main/features/partition.ts
 *         2. 在 index.ts 中调用 registerPartition()
 *         3. 渲染进程调用 window.api.partition.*
 * 【说明】partition 让窗口使用独立的会话（Cookie/缓存/存储互不干扰）：
 *         - 'incognito-xxx'：内存会话，关窗即销毁（无痕浏览）
 *         - 'persist:work'：持久会话，数据落盘（多账号隔离，如工作/私人账号）
 *         典型场景：多账号同时登录、无痕浏览、应用内"访客模式"。
 */

import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { loadRenderer } from './windowManager'

export function registerPartition(): void {
  // 创建使用独立会话的窗口
  const createPartitionWindow = (partition: string): BrowserWindow => {
    const win = new BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      title: partition.startsWith('persist') ? '持久分区窗口' : '无痕窗口',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        partition // 关键：指定独立会话分区
      }
    })
    win.on('ready-to-show', () => win.show())
    // 与主窗口一致的安全基线：window.open 一律转交系统浏览器
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
    // 加载应用主页（无痕窗口中可验证 Cookie/存储与主会话隔离）
    loadRenderer(win)
    return win
  }

  // ── 无痕窗口：内存会话（关窗即销毁，不落盘）──
  ipcMain.handle('partition:openIncognito', () => {
    const win = createPartitionWindow(`incognito-${Date.now()}`)
    return { ok: true, id: win.id }
  })

  // ── 持久分区窗口：数据落盘（userData/Partitions/work）──
  ipcMain.handle('partition:openPersistent', () => {
    const win = createPartitionWindow('persist:work')
    return { ok: true, id: win.id }
  })
}
