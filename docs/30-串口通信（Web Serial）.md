# 30 - 串口通信（Web Serial）

> 对应源码：`src/main/features/serialPort.ts` | 演示页：串口通信

## 一、为什么需要主进程配合

渲染进程不能直接枚举/打开串口（浏览器安全模型）。Electron 提供两道关卡：

| 关卡 | API | 作用 |
|------|-----|------|
| 设备权限 | `session.setDevicePermissionHandler` | 这个页面**能否申请**设备访问（按 origin + 设备类型裁决） |
| 端口选择 | `session.on('select-serial-port')` | 用户**选了哪个**端口（默认是 Chromium 自带选择器） |

## 二、最小实现（主进程）

```ts
// ① 权限：只允许本应用页面访问串口
session.defaultSession.setDevicePermissionHandler((details) => {
  if (details.deviceType !== 'serial') return false
  return details.origin.startsWith('file://') || details.origin.includes('localhost')
})

// ② 选择：接管 Chromium 默认选择器，改为"应用内弹窗"
const pendingSelects = new Map<string, (portId: string) => void>()
session.defaultSession.on('select-serial-port', (event, portList, webContents, callback) => {
  event.preventDefault()
  if (portList.length === 0) return callback('')
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const timer = setTimeout(() => finish(''), 30_000) // 超时兜底
  const finish = (portId: string): void => {
    clearTimeout(timer)
    pendingSelects.delete(token)
    callback(portId)
  }
  pendingSelects.set(token, finish)
  webContents.once('destroyed', () => pendingSelects.has(token) && finish('')) // 窗口销毁兜底
  webContents.send('serial:ports', { token, ports: portList.map((p) => ({ portId: p.portId, ... })) })
})
ipcMain.on('serial:select', (_e, token, portId) => pendingSelects.get(token)?.(portId))
ipcMain.on('serial:cancel', (_e, token) => pendingSelects.get(token)?.(''))
```

**两个经典 bug**：

1. `callback` 忘记调用 → requestPort 的 Promise 永不 settle。所以用 `finish` 统一收敛
   （选择/取消/超时/窗口销毁四路竞争，保证恰好调用一次）。
2. 全局 `ipcMain.once` 不按请求作用域 → 多窗口/并发 requestPort 时回调串扰。
   本实现用 **token 关联每次请求**（`Map<token, callback>`），渲染层回传时带上 token。

## 三、渲染进程读写

```ts
// 申请端口 → 触发 select-serial-port → 应用内弹窗 → 回传 portId → Promise resolve
const port = await navigator.serial.requestPort()
await port.open({ baudRate: 115200 })

// 读：readable 是流，循环 read()
const reader = port.readable.getReader()
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  console.log(new TextDecoder().decode(value))
}

// 写：writable 也是流
const writer = port.writable.getWriter()
await writer.write(new TextEncoder().encode('AT\r\n'))
writer.releaseLock()

// 复用：已授权的端口无需再次弹窗
const granted = await navigator.serial.getPorts()

// 关闭
await reader.cancel()
await port.close()
```

## 四、复制到新工程的步骤

1. 复制 `src/main/features/serialPort.ts`，`index.ts` 中调用 `registerSerialPort()`
2. 复制 preload 的 `serial` 分组（onPorts / selectPort / cancel）
3. 渲染进程：复制演示页的弹窗 + 读写代码
4. 页面 HTML 无需特殊标签；协议细节（波特率/数据位/校验）在 `port.open()` 参数中

## 五、扩展：WebUSB / WebHID / Web Bluetooth

同一条链路，只改两个位置：

| 设备类型 | deviceType 值 | 事件 | 渲染进程 API |
|----------|--------------|------|-------------|
| 串口 | `'serial'` | `select-serial-port` | `navigator.serial` |
| USB | `'usb'` | `select-usb-device` | `navigator.usb` |
| HID | `'hid'` | `select-hid-device` | `navigator.hid` |
| 蓝牙 | `'bluetooth'` | `select-bluetooth-device` | `navigator.bluetooth` |

选择器事件的回调参数结构不同（如 USB 是 `Device` 列表），但"权限裁决 + 选择器接管"模式完全一致。

> 注意一：串口的权限裁决其实经过 **两层**——`setPermissionCheckHandler`（静默检查，
> 本工程 security.ts 的白名单已包含 `serial`，否则开启"静默检查模式"后串口会被静默拒绝）
> 与 `setDevicePermissionHandler`（设备级裁决），缺一不可。
>
> 注意二：HID 设备权限事件在部分平台有 `allowedDevices` 例外清单（会话级持久授权）；
> 蓝牙还涉及 `bluetooth-pairing-request` 配对事件。硬件调试建议装
> [Serial Port Monitor](https://www.serial-port-monitor.org/)（Windows）观察真实数据流。

## 六、无硬件如何验证功能（三档递进）

| 链路环节 | 无硬件 | 虚拟串口对 | 硬件回环 |
|---|---|---|---|
| navigator.serial 可用性 / getPorts | ✅ | ✅ | ✅ |
| 主进程 devicePermissionHandler 放行 + select-serial-port 拦截 + token 回传 | ✅（取消路径） | ✅ | ✅ |
| 应用内弹窗（端口选择） | ❌ | ✅ | ✅ |
| port.open / write / read / close | ❌ | ✅ | ✅ |

### 第一档：纯软件自检（无需任何硬件）

演示页「无设备自检」卡片一键执行（自动运行，无需手动操作）：

1. **API 可用性**：`'serial' in navigator`
2. **getPorts 授权状态**：首次应为 0 个
3. **请求→取消链路**：`requestPort()` 后 1.5s 自动取消——无设备时主进程直接
   `callback('')`，Promise 以 **NotFoundError** 拒绝。**这个"预期拒绝"就是
   handler 链路贯通的证据**（若挂起超时 = callback 未调用；若报其他异常 = 链路断点）

手工验证等价操作：点「选择串口」→ 提示"未选择端口（已取消）"即取消链路正常。

### 第二档：虚拟串口对（推荐，最接近真实场景）

用 [com0com](https://sourceforge.net/projects/com0com/)（开源 null-modem 模拟器，
需管理员安装签名驱动）创建虚拟串口对 COM3 ↔ COM4：写入 COM3 的数据从 COM4 读出，反之亦然。

> ⚠️ 本应用有单实例锁，**无法开两个应用实例互测**——对端用外部终端（PowerShell 脚本即可）。

**步骤**：
1. 安装 com0com → 配置一对虚拟端口（如 CNCA0/CNCB0，重命名为 COM3/COM4）
2. 应用内点「选择串口」→ 弹窗应出现 COM3/COM4 → 选 COM3 连接
3. 对端运行 PowerShell 脚本（开 COM4，读 5 秒后回写一行）：

```powershell
$port = New-Object System.IO.Ports.SerialPort COM4,115200,None,8,one
$port.Open()
$end = (Get-Date).AddSeconds(5)
while ((Get-Date) -lt $end) {
  if ($port.BytesToRead -gt 0) { Write-Output "收到: $($port.ReadExisting())" }
  Start-Sleep -Milliseconds 200
}
$port.WriteLine('来自 PowerShell 的回复')   # 应用接收区应显示这一行
$port.Close()
```

4. 应用内「发送一行」→ PowerShell 窗口应打印 `收到: <内容>`
5. 双向都通 → 权限放行、端口选择、open/read/write/close 全链路验证完成

### 第三档：硬件回环（有 USB 转串口模块时）

CH340 / CP2102 等 USB 转串口模块：把 **TX 与 RX 引脚短接**（自回环）→ 应用选该端口
连接 → 「发送一行」→ 接收区应原样显示所发内容（数据经 TX→RX 环回）。

**期望结果表**：

| 观察点 | 正常表现 |
|---|---|
| 自检第 3 项 | ✅ NotFoundError 预期拒绝 |
| 虚拟对连接后发送 | 对端收到原文（含换行） |
| 对端回写 | 应用接收区显示"来自 PowerShell 的回复" |
| 断开后重连 | 弹窗再次出现（端口重新选择） |
