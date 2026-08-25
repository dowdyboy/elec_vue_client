/**
 * 【工具】资源释放辅助（轻量化）
 * 【说明】每个 features 模块的 registerX 可返回 Disposer，
 *         index.ts 统一在 before-quit 时调用，避免资源泄漏。
 *         不引入新依赖，仅类型与辅助函数。
 */

export type Disposer = () => void

/** 收集多个释放函数，返回一个合并释放函数 */
export function combineDisposers(disposers: Disposer[]): Disposer {
  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        // 忽略单个释放失败，保证其余资源仍被释放
      }
    }
  }
}

/** 安全调用：忽略异常（用于退出时的清理） */
export function safeDispose(fn: () => void): void {
  try {
    fn()
  } catch {
    // 退出清理阶段不抛异常
  }
}
