/**
 * 【特性】原生 TCP / UDP 网络通信（Node.js net / dgram 模块）
 * 【API】net.createServer / net.createConnection / dgram.createSocket
 * 【复制】1. 复制本文件到新工程 src/main/features/socket.ts
 *         2. 在 index.ts 中调用 registerSockets(getMainWindow)
 *         3. 渲染进程通过 window.api.socket.* 收发消息
 * 【说明】区别于 HTTP（请求-响应），TCP/UDP 是传输层协议：
 *         - TCP：面向连接、可靠、有序（文件传输、游戏、远程桌面）
 *         - UDP：无连接、不可靠、低延迟（音视频流、实时游戏、广播）
 *         演示采用"自连自"模式（本机起服务端 + 客户端互发），无需外部服务器。
 *         主进程收发消息 → IPC 推送日志 → 渲染进程展示，链路清晰。
 */

import { ipcMain } from 'electron'
import net from 'net'
import dgram from 'dgram'
import type { MainWindowGetter } from '../types'

/** 日志条目：{ port/type 标识, 内容 }，渲染进程按类型着色展示 */
interface SocketLog {
  tag: string
  msg: string
}

export function registerSockets(getMainWindow: MainWindowGetter): void {
  const push = (channel: 'socket:tcp-log' | 'socket:udp-log', log: SocketLog): void => {
    getMainWindow()?.webContents.send(channel, log)
  }

  // ═══════════════════════════════════════════
  // TCP：本地服务端 + 本地客户端（自连自）
  // ═══════════════════════════════════════════
  let tcpServer: net.Server | null = null
  let tcpClient: net.Socket | null = null

  ipcMain.handle('tcp:startServer', (_e, port: number) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      tcpServer = net.createServer((socket) => {
        // 新客户端连入：注册数据/断开事件
        push('socket:tcp-log', {
          tag: '服务端',
          msg: `客户端已连入 ${socket.remoteAddress}:${socket.remotePort}`
        })
        socket.on('data', (data) => {
          const text = data.toString()
          push('socket:tcp-log', { tag: '服务端', msg: `收到: ${text}` })
          socket.write(`服务端回显: ${text}`) // 回显，演示双向通信
        })
        socket.on('close', () => {
          push('socket:tcp-log', { tag: '服务端', msg: '客户端已断开' })
        })
      })
      tcpServer.on('error', (err) => {
        push('socket:tcp-log', { tag: '服务端', msg: `错误: ${err.message}` })
        resolve({ ok: false, error: err.message })
      })
      tcpServer.listen(port, '127.0.0.1', () => {
        push('socket:tcp-log', { tag: '服务端', msg: `已启动，监听 127.0.0.1:${port}` })
        resolve({ ok: true })
      })
    })
  })

  ipcMain.handle('tcp:stopServer', () => {
    if (tcpServer) {
      tcpServer.close()
      tcpServer = null
      push('socket:tcp-log', { tag: '服务端', msg: '服务端已停止' })
    }
    return { ok: true }
  })

  ipcMain.handle('tcp:connect', (_e, options: { host: string; port: number }) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      tcpClient = net.createConnection({ host: options.host, port: options.port })
      tcpClient.on('connect', () => {
        push('socket:tcp-log', {
          tag: '客户端',
          msg: `已连接 ${options.host}:${options.port}`
        })
        resolve({ ok: true })
      })
      tcpClient.on('data', (data) => {
        push('socket:tcp-log', { tag: '客户端', msg: `收到: ${data.toString()}` })
      })
      tcpClient.on('close', () => {
        push('socket:tcp-log', { tag: '客户端', msg: '连接已断开' })
        tcpClient = null
      })
      tcpClient.on('error', (err) => {
        push('socket:tcp-log', { tag: '客户端', msg: `错误: ${err.message}` })
        resolve({ ok: false, error: err.message })
      })
    })
  })

  ipcMain.handle('tcp:disconnect', () => {
    tcpClient?.destroy()
    return { ok: true }
  })

  ipcMain.handle('tcp:send', (_e, message: string) => {
    if (!tcpClient) return { ok: false, error: '尚未建立连接' }
    tcpClient.write(message)
    push('socket:tcp-log', { tag: '客户端', msg: `发送: ${message}` })
    return { ok: true }
  })

  // ═══════════════════════════════════════════
  // UDP：无连接，直接"绑定端口" + "向目标端口发送"
  // ═══════════════════════════════════════════
  const udpSockets = new Map<number, dgram.Socket>()

  ipcMain.handle('udp:bind', (_e, port: number) => {
    if (udpSockets.has(port)) return { ok: true, error: '端口已绑定' }
    const socket = dgram.createSocket('udp4')
    socket.on('message', (msg, rinfo) => {
      push('socket:udp-log', {
        tag: `:${port}`,
        msg: `收到来自 ${rinfo.address}:${rinfo.port}: ${msg.toString()}`
      })
    })
    socket.on('error', (err) => {
      push('socket:udp-log', { tag: `:${port}`, msg: `错误: ${err.message}` })
    })
    socket.bind(port, '127.0.0.1', () => {
      udpSockets.set(port, socket)
      push('socket:udp-log', { tag: `:${port}`, msg: '已绑定，等待消息...' })
    })
    return { ok: true }
  })

  // 解绑端口：释放占用，可重新绑定其他端口
  ipcMain.handle('udp:unbind', (_e, port: number) => {
    const socket = udpSockets.get(port)
    if (!socket) return { ok: false, error: `端口 ${port} 未绑定` }
    socket.close()
    udpSockets.delete(port)
    push('socket:udp-log', { tag: `:${port}`, msg: '已解绑' })
    return { ok: true }
  })

  ipcMain.handle(
    'udp:send',
    (_e, options: { fromPort: number; targetPort: number; message: string }) => {
      // 从已绑定的"源端口"向"目标端口"发送
      const socket = udpSockets.get(options.fromPort)
      if (!socket) return { ok: false, error: `端口 ${options.fromPort} 未绑定` }
      socket.send(options.message, options.targetPort, '127.0.0.1')
      push('socket:udp-log', {
        tag: `:${options.fromPort}`,
        msg: `发送到 :${options.targetPort}: ${options.message}`
      })
      return { ok: true }
    }
  )
}
