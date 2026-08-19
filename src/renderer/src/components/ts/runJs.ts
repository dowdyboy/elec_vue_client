/**
 * TS 课程页"运行示例"工具
 * 说明：渲染进程 CSP 为 script-src 'self'（不允许 unsafe-eval），因此不能用
 * new Function / eval 做字符串求值。示例改为在课程页 <script setup> 里定义
 * 真实函数，这里只负责把函数返回值格式化为可展示文本。
 * TS 的类型在编译期检查，运行时只有 JS——"运行示例"观察的是等价 JS 行为。
 */

export interface RunResult {
  ok: boolean
  output: string
}

/** 把运行函数的返回值格式化为可展示的字符串（含错误捕获） */
export function formatValue(fn: () => unknown): RunResult {
  try {
    const value = fn()
    const output =
      typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
    return { ok: true, output }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}
