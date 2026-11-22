/**
 * 渲染层全局错误兜底
 *
 * 为什么需要它：主进程有 `uncaughtException` / `unhandledRejection`（见 errorHandler.ts），
 * 但渲染层此前一片空白。页面里大量 `await window.api.xxx()` 一旦 reject
 * （handler 抛错、发送方校验 FORBIDDEN、通道不存在…），只会变成
 * "未处理的 Promise 拒绝"，在 release 版里连 DevTools 都没有——用户只看到按钮没反应。
 *
 * 这里做两件事：
 *   1. 监听 `unhandledrejection` 与 `error`，统一 console.error（开发期可见）
 *   2. 通过 `window.api.error.report()` 上报主进程，进同一份错误日志
 *      → 「生命周期」页的错误面板即可看到渲染层错误（与主进程错误同一个列表）
 *
 * 防自激：上报走 `ipcRenderer.send`（无 Promise），且本模块自身任何异常都被吞掉；
 *         另外限流（每分钟最多 N 条），避免错误风暴把主进程日志刷满。
 */

/** 每分钟最多上报条数（超出只 console.error，不打扰主进程） */
const MAX_REPORTS_PER_MINUTE = 30
/** 单条消息截断长度（主进程侧还会再截一次） */
const MAX_MESSAGE_LEN = 1000

interface ReportPayload {
  message: string
  stack?: string
  kind: string
}

let windowStart = 0
let windowCount = 0

/** 限流：简单固定窗口，够用且不会引入定时器 */
function takeQuota(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now
    windowCount = 0
  }
  if (windowCount >= MAX_REPORTS_PER_MINUTE) return false
  windowCount += 1
  return true
}

function toMessage(value: unknown): string {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const anyValue = value as { message?: unknown }
    if (typeof anyValue.message === 'string') return anyValue.message
    try {
      return JSON.stringify(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  return String(value)
}

function toStack(value: unknown): string | undefined {
  if (value instanceof Error && value.stack) return value.stack
  if (value && typeof value === 'object') {
    const stack = (value as { stack?: unknown }).stack
    if (typeof stack === 'string') return stack
  }
  return undefined
}

/** 上报一条错误（内部使用；对外只暴露 installGlobalErrorHandlers） */
function report(kind: string, value: unknown): void {
  const message = toMessage(value).slice(0, MAX_MESSAGE_LEN)
  // 开发期仍然打全量堆栈，方便定位
  console.error(`[renderer:${kind}]`, value)
  if (!message) return
  if (!takeQuota(Date.now())) return
  // window.api 可能不存在（preload 加载失败/单测环境），此时只保留 console 输出
  const api = typeof window !== 'undefined' ? window.api : undefined
  const reporter = api?.error?.report
  if (typeof reporter !== 'function') return
  const payload: ReportPayload = { message, kind }
  const stack = toStack(value)
  if (stack) payload.stack = stack
  try {
    reporter(payload)
  } catch {
    // 上报失败就算了：绝不能让它再抛出去（否则又变成一次 unhandledrejection）
  }
}

/** 幂等安装：重复调用只生效一次 */
let installed = false

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  // Promise 拒绝（async 里 throw、await 了 reject 的 IPC、忘记 catch…）
  window.addEventListener('unhandledrejection', (event) => {
    report('unhandledrejection', event.reason)
  })

  // 同步异常（事件处理器里 throw、脚本求值错误…）
  // 注意：资源加载失败（如 <img>）也会触发 error 但 error 属性为 null，这类不报
  window.addEventListener('error', (event) => {
    const err = event.error
    if (!err && !event.message) return
    report('error', err ?? event.message)
  })
}
