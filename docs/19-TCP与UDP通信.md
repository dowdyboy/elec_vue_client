# 19 - TCP / UDP 通信

> 对应源码：`src/main/features/socket.ts` | 演示页：TCP/UDP 通信

## 一、原理

传输层原生通信（Node.js `net` / `dgram` 模块）：

| 协议 | 特性 | 场景 |
|------|------|------|
| **TCP** | 面向连接、可靠、有序 | 文件传输、远程桌面、数据库 |
| **UDP** | 无连接、不可靠、低延迟 | 音视频流、实时游戏、广播发现 |

为什么在主进程收发？渲染进程没有 Node.js 能力（安全隔离），所有 socket 操作经 IPC 走主进程。

**演示采用"自连自"**：本机启动服务端 + 客户端互发，无需外部服务器。

## 二、关键代码

```ts
import net from 'net'
import dgram from 'dgram'

// ── TCP 服务端 ──
const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    socket.write(`回显: ${data.toString()}`)
  })
  socket.on('close', () => { /* 客户端断开 */ })
})
server.listen(9999, '127.0.0.1')

// ── TCP 客户端 ──
const client = net.createConnection({ host: '127.0.0.1', port: 9999 })
client.on('connect', () => client.write('你好'))
client.on('data', (data) => console.log(data.toString()))

// ── UDP：绑定端口 + 发送 ──
const socket = dgram.createSocket('udp4')
socket.on('message', (msg, rinfo) => {
  console.log(`收到 ${rinfo.address}: ${msg.toString()}`)
})
socket.bind(5000, '127.0.0.1')
socket.send('你好', 5001, '127.0.0.1')
```

## 三、复制到新工程的步骤

1. 复制 `src/main/features/socket.ts`
2. `index.ts` 中调用 `registerSockets(getMainWindow)`
3. 渲染进程：

```ts
// TCP
await window.api.socket.tcp.startServer(9999)
await window.api.socket.tcp.connect({ host: '127.0.0.1', port: 9999 })
await window.api.socket.tcp.send('你好')
window.api.socket.onTcpLog((log) => console.log(log))

// UDP
await window.api.socket.udp.bind(5000)
await window.api.socket.udp.send({ fromPort: 5000, targetPort: 5001, message: '你好' })
window.api.socket.onUdpLog((log) => console.log(log))
```

## 四、常见问题

- **端口占用**：`EADDRINUSE` 错误，换端口或先停止旧服务
- **粘包/半包**：TCP 是字节流，应用层需要自定义协议边界（长度前缀/分隔符）
- **防火墙**：对外通信需在打包配置中声明网络权限（macOS 沙箱、Windows 防火墙）
- **生产场景**：协议私有化、心跳保活、断线重连是必修课
