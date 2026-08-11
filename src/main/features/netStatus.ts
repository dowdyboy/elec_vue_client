/**
 * 【特性】网络在线状态（net.isOnline）
 * 【API】net.isOnline（主进程查询）+ 渲染进程 online/offline 事件
 * 【复制】1. 复制本文件到新工程 src/main/features/netStatus.ts
 *         2. 在 index.ts 中调用 registerNetStatus(getMainWindow)
 *         3. 渲染进程调用 window.api.net.*（onStatus 内部用浏览器事件）
 * 【说明】断网检测是桌面应用的常见需求：
 *         - 主进程：net.isOnline() 查询当前网络连通性
 *         - 事件推送：online/offline 是【渲染进程】的浏览器事件
 *           （Electron 的 net 模块只有 isOnline，无事件），
 *           本模块在 preload 中用 window 事件封装，页面 API 保持一致
 *         - 注意：isOnline() 只反映"系统网络连通性"，
 *           业务级探测（服务器可达）用 HTTP 请求（见 network.ts）
 */

import { ipcMain, net } from 'electron'

export function registerNetStatus(): void {
  // 当前状态查询（事件部分由 preload 的 window 事件封装处理）
  ipcMain.handle('net:getStatus', () => ({ online: net.isOnline() }))
}
