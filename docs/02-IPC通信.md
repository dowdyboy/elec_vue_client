# 02 - IPC 通信

> 对应源码：`src/main/features/ipcBridge.ts` + `src/preload/index.ts` | 演示页：IPC 通信

## 一、原理

渲染进程没有 Node.js 能力（安全隔离），所有系统级操作必须通过 **IPC**（进程间通信）交给主进程。IPC 是 Electron 开发的**必修课**。

四种模式，按需选择：

| 模式 | 方向 | 适用场景 |
|------|------|---------|
| `invoke` / `handle` | 双向（有返回值） | 读配置、查询数据 —— **最常用** |
| `send` / `on` | 单向 + 事件 | 发通知、事件广播 |
| 广播（主进程转发） | 一对多 | 多窗口同步状态 |
| `MessageChannelMain` | 双向管道 | 高频数据流（聊天、日志） |

## 二、关键代码

```ts
// ── 主进程 ──
ipcMain.handle('ipc:ping', (_e, payload: string) => {
  return { echo: payload, time: new Date().toLocaleTimeString() }
})

// ── 渲染进程（经 preload 暴露）──
const result = await window.api.ipc.ping('hello')
// result = { echo: 'hello', time: '14:30:22' }
```

MessageChannel 管道：

```ts
// 主进程
ipcMain.on('ipc:create-channel', (event) => {
  const { port1, port2 } = new MessageChannelMain()
  port1.on('message', (e) => port1.postMessage(`回显: ${e.data}`))
  port1.start()
  event.senderFrame?.postMessage('ipc:channel-port', null, [port2])
})
```

## 三、复制到新工程的步骤

1. 复制 `src/main/features/ipcBridge.ts`，在 `index.ts` 调用 `registerIpcBridge()`
2. 复制 `src/preload/index.ts` 中 `ipc` 分组（定义了 `window.api.ipc.*`）
3. 渲染进程使用：

```ts
// 请求-响应
const res = await window.api.ipc.ping('hello')
// 单向 + 事件回复
window.api.ipc.sendEvent('hi')
window.api.ipc.onEventReply((data) => console.log(data))
// 管道
window.api.ipc.createChannel()
window.api.ipc.onChannelPort((port) => port.postMessage('hi'))
```

## 四、最佳实践

- **通道命名**：用 `模块:动作` 格式（如 `fs:readFile`），避免冲突
- **参数校验**：主进程对渲染进程传参必须校验（渲染进程可能被攻破）
- **错误处理**：`invoke` 返回 Promise，主进程 `handle` 中抛错会被渲染进程 catch
- **事件泄漏**：渲染进程 `on` 监听完要 `removeListener`（本工程 preload 的 `on()` 返回取消函数）

## 五、扩展：BroadcastChannel 多窗口直连（不经主进程）

对于"窗口间广播通知"这类简单场景，浏览器原生 `BroadcastChannel` 更轻量：
同一 origin 的所有窗口（含子窗口）共享频道，**无需主进程中转**：

```ts
// 任意窗口
const channel = new BroadcastChannel('demo-channel')
channel.onmessage = (event) => console.log('收到:', event.data)
channel.postMessage('hello everyone')
```

与"主进程广播"（方案③）的取舍：
| 方案 | 链路 | 适用 |
|------|------|------|
| 主进程广播 | 渲染 → 主进程 → 所有窗口 | 需要主进程参与业务（如鉴权、计数） |
| BroadcastChannel | 窗口直连 | 纯通知、无业务逻辑 |
