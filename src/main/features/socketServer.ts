/**
 * 【特性】WebSocket 服务器（socket.io —— 主进程即服务端，自闭环教学演示）
 * 【API】socket.io（node:http + socket.io）
 * 【复制】1. 安装依赖：npm i socket.io（客户端 socket.io-client 在渲染进程使用）
 *         2. 复制本文件到新工程 src/main/features/socketServer.ts
 *         3. 在 index.ts 中调用 registerSocketServer()
 *         4. 渲染进程调用 window.api.socketServer.* 配合 io() 连接
 * 【说明】与 httpServer.ts（HTTP 请求-响应）互补，演示 WebSocket 两大核心价值：
 *         - 双向实时：客户端发 message → 服务端 echo 回显（对比 HTTP 每次都要新请求）
 *         - 服务端推送：服务端每秒 tick 推送（HTTP 无法由服务器主动发起）
 *         自闭环设计：主进程起服务（127.0.0.1 回环）→ 渲染进程 socket.io-client
 *         连接 → 双向消息 + tick 推送，无外网依赖即可完整验证。
 *         注意命名：与 socket.ts（TCP/UDP 原生通信）区分，本模块是应用层 WebSocket。
 */

import { ipcMain } from 'electron'
import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'

let server: http.Server | null = null
let io: SocketIOServer | null = null
let port = 0

export function registerSocketServer(): void {
  // ── 启动 socket.io 服务 ──
  ipcMain.handle('socketServer:start', (_e, targetPort = 8766) => {
    if (io) return { ok: false, error: `服务器已在运行（端口 ${port}）` }
    return new Promise<{ ok: boolean; port?: number; error?: string }>((resolve) => {
      // socket.io 需要挂在一个 HTTP 服务上（WebSocket 握手经 HTTP Upgrade）
      server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ message: 'socket.io 服务已运行，请用客户端连接', port }))
      })
      io = new SocketIOServer(server, {
        // 渲染进程与主进程是不同源（dev 为 localhost:5173），放开 CORS
        cors: { origin: '*' }
      })

      io.on('connection', (socket) => {
        // ① 连接即推送欢迎信息（服务端推送的第一次体验）
        socket.emit('welcome', {
          time: new Date().toLocaleTimeString(),
          message: `已连接主进程 socket.io 服务（客户端 id: ${socket.id.slice(0, 6)}）`
        })

        // ② 双向实时：收到客户端 message → echo 回显 + 时间戳
        socket.on('message', (data) => {
          socket.emit('echo', {
            received: data,
            time: new Date().toLocaleTimeString(),
            from: '主进程 socket.io 服务'
          })
        })

        // ③ 服务端推送：每秒推送服务器时间 + 在线客户端数（tick）
        const timer = setInterval(() => {
          socket.emit('tick', {
            time: new Date().toLocaleTimeString(),
            clients: io!.engine.clientsCount
          })
        }, 1000)
        socket.on('disconnect', () => clearInterval(timer))
      })

      server.on('error', (err) => {
        server = null
        io = null
        resolve({ ok: false, error: err.message })
      })
      server.listen(targetPort, '127.0.0.1', () => {
        port = targetPort
        resolve({ ok: true, port })
      })
    })
  })

  // ── 停止服务 ──
  ipcMain.handle('socketServer:stop', () => {
    if (io) {
      io.close() // 断开所有客户端连接
      io = null
    }
    if (server) {
      server.close()
      server = null
    }
    return { ok: true }
  })

  // ── 状态查询 ──
  ipcMain.handle('socketServer:getStatus', () => ({
    running: io !== null,
    port,
    clients: io?.engine.clientsCount ?? 0
  }))
}
