/**
 * 【特性】串口通信（Web Serial —— 渲染进程通过 navigator.serial 访问硬件串口）
 * 【API】session.setDevicePermissionHandler / session.on('select-serial-port')
 * 【复制】1. 复制本文件到新工程 src/main/features/serialPort.ts
 *         2. 在 index.ts 中调用 registerSerialPort()
 *         3. 渲染进程调用 window.api.serial.* 配合 navigator.serial 使用
 * 【说明】硬件工具 / IoT / 固件烧录类应用的标配能力：
 *         - 渲染进程无法直接枚举/打开串口（浏览器安全模型），必须由主进程放行
 *         - 两道关卡：① devicePermissionHandler 决定"这个页面能否申请设备权限"
 *                     ② select-serial-port 事件决定"用户选了哪个端口"（弹窗选择）
 *         - 本演示实现经典交互：主进程收到端口列表 → 推给渲染层弹窗 → 用户选择 →
 *           回传 portId → callback 完成授权，渲染进程即可 open/read/write
 *         - 无真实串口设备时，页面走"无设备"分支，链路教学不受影响
 *         （WebUSB/WebHID 同理，见 docs/30 扩展说明）
 * 【健壮性】每次选择请求生成唯一 token（Map<token, callback>），避免多窗口/并发请求
 *           串扰；30 秒超时 + 窗口销毁兜底，保证 callback 恰好调用一次
 *           （否则 requestPort 的 Promise 会永久挂起）。
 */

import { ipcMain, session } from 'electron'

/** 端口选择请求表：token → 完成回调（callback 必须恰好调用一次） */
const pendingSelects = new Map<string, (portId: string) => void>()

/** 超时兜底：页面迟迟不回传选择（用户挂起弹窗）时自动取消，防止 Promise 永久挂起 */
const SELECT_TIMEOUT_MS = 30_000

export function registerSerialPort(): void {
  // ── ① 设备权限处理器：只放行串口，且仅限本应用页面（防第三方页面窥探设备）──
  // 说明：必须在页面发起设备请求前设置（本工程特性注册先于 createWindow ✓）
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'serial') return false
    const origin = details.origin
    const isInternal =
      origin.startsWith('file://') || origin.includes('localhost') || origin.includes('127.0.0.1')
    return isInternal
  })

  // ── ② 端口选择事件：navigator.serial.requestPort() 触发 ──
  // 默认行为是 Chromium 自带的设备选择器；preventDefault 后接管为"应用内弹窗"
  session.defaultSession.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()

    if (portList.length === 0) {
      callback('') // 无可用端口：取消请求
      return
    }

    // 每次请求一个唯一 token：渲染层回传时按 token 找到对应 callback
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timer = setTimeout(() => finish(''), SELECT_TIMEOUT_MS)

    // callback 必须恰好调用一次；finish 保证幂等（超时/销毁/选择三路竞争）
    const finish = (portId: string): void => {
      clearTimeout(timer)
      pendingSelects.delete(token)
      callback(portId)
    }
    pendingSelects.set(token, finish)

    // 兜底：发起请求的窗口销毁（关闭/刷新）时自动取消，防止监听残留
    webContents.once('destroyed', () => {
      if (pendingSelects.has(token)) finish('')
    })

    // 把端口清单 + token 推给发起请求的页面（弹窗展示，见 SerialPage.vue）
    webContents.send('serial:ports', {
      token,
      ports: portList.map((port) => ({
        portId: port.portId,
        portName: port.portName,
        displayName: port.displayName,
        vendorId: port.vendorId,
        productId: port.productId
      }))
    })
  })

  // ── ③ 渲染层回传：按 token 分发，完成对应请求 ──
  ipcMain.on('serial:select', (_e, token: string, portId: string) => {
    const finish = pendingSelects.get(token)
    if (finish) finish(portId)
  })

  ipcMain.on('serial:cancel', (_e, token: string) => {
    const finish = pendingSelects.get(token)
    if (finish) finish('')
  })
}
