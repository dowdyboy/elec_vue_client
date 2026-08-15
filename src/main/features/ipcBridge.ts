/**
 * 【特性】IPC 通信（主进程 ↔ 渲染进程）
 * 【API】ipcMain / ipcRenderer / MessageChannelMain
 * 【复制】1. 复制本文件到新工程 src/main/features/ipcBridge.ts
 *         2. 在 index.ts 中调用 registerIpcBridge(getMainWindow)
 *         3. 渲染进程配合 preload 中 ipc 分组使用
 * 【说明】本模块演示 4 种主流 IPC 模式：
 *         ① invoke/handle  —— 请求-响应（最常用，有返回值）
 *         ② send/on        —— 单向消息（发完即走 / 事件通知）
 *         ③ 广播            —— 主进程向所有窗口转发（多窗口通信）
 *         ④ MessageChannel —— 双向管道（高频数据流）
 */

import { BrowserWindow, ipcMain, MessageChannelMain } from 'electron'

export function registerIpcBridge(): void {
  // ── ① 请求-响应模式 ───────────────────────────────
  // 渲染进程: const result = await window.api.ipc.ping('hello')
  // 适合"需要返回结果"的调用，如读取配置、查询数据库
  ipcMain.handle('ipc:ping', (_event, payload: string) => {
    return {
      echo: payload,
      time: new Date().toLocaleTimeString() // 主进程时间戳，证明确实到了主进程
    }
  })

  // ── ② 单向消息模式 ───────────────────────────────
  // 渲染进程: window.api.ipc.sendEvent('hi')  （不 await）
  // event.sender 是发送方的 webContents，可精确回复给发送方
  ipcMain.on('ipc:event', (event, payload: string) => {
    event.sender.send('ipc:event-reply', `主进程收到: ${payload}`)
  })

  // ── ③ 广播模式（多窗口通信）──────────────────────
  // 渲染进程: window.api.ipc.broadcast('hello everyone')
  // 主进程遍历所有窗口逐个转发，实现"一对多"通知
  ipcMain.on('ipc:broadcast', (_event, payload: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('ipc:broadcast-received', payload)
    }
  })

  // ── ④ MessageChannelMain 双向管道 ────────────────
  // 渲染进程: window.api.ipc.createChannel()
  //          （端口经 preload 用 window.postMessage 转移到页面，见 preload/index.ts）
  // 建立后两端可通过 port.postMessage 双向收发，适合高频数据流
  // ⚠️ contextIsolation 坑：MessagePort 不能经 contextBridge 参数传递（会被克隆断开），
  //    必须用 postMessage 的 transfer 机制转移（详见 docs/02 第四节）
  ipcMain.on('ipc:create-channel', (event) => {
    const { port1, port2 } = new MessageChannelMain()
    // 主进程持有 port1：收到消息后原样回传（回显演示）
    port1.on('message', (e) => {
      port1.postMessage(`主进程管道回显: ${e.data}`)
    })
    port1.start()
    // 通过 event.senderFrame 把 port2 转交给发起请求的渲染进程
    event.senderFrame?.postMessage('ipc:channel-port', null, [port2])
  })
}
