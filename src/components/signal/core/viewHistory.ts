/**
 * 视图历史栈（撤销/重做）
 *
 * 图表交互的通用需求：缩放/平移/框选之后要能回溯。抽成无依赖的小状态机，
 * 好处是边界条件（栈满、撤销后再提交、撤销到最旧）能被单测钉住，
 * 而不是埋在 3000 行的组件里靠手点验证。
 *
 * 语义（与原组件内实现完全一致）：
 * - `commit(s)`：丢弃"撤销后的未来"，追加快照；超过上限则挤掉最旧一条
 * - `undo()` / `redo()`：返回要恢复的快照；无处可退返回 null
 * - `reset(s)`：清空历史并立刻提交当前快照（作为新的起点）
 */
export interface ViewHistory<T> {
  /** 提交一个快照（会截断撤销点之后的历史） */
  commit(snapshot: T): void
  /** 清空后以该快照为唯一历史 */
  reset(snapshot: T): void
  /** 回退一步，返回目标快照；已到最旧返回 null */
  undo(): T | null
  /** 前进一步，返回目标快照；已到最新返回 null */
  redo(): T | null
  canUndo(): boolean
  canRedo(): boolean
  /** 当前快照数 */
  size(): number
  /** 当前所在位置（-1 表示空） */
  position(): number
}

export function createViewHistory<T>(max = 30): ViewHistory<T> {
  const limit = Math.max(1, Math.floor(max))
  const stack: T[] = []
  let pos = -1

  return {
    commit(snapshot: T): void {
      // 撤销到中间位置后再提交：后面的分支作废
      stack.length = pos + 1
      stack.push(snapshot)
      if (stack.length > limit) stack.shift()
      pos = stack.length - 1
    },
    reset(snapshot: T): void {
      stack.length = 0
      pos = -1
      this.commit(snapshot)
    },
    undo(): T | null {
      if (pos <= 0) return null
      pos -= 1
      return stack[pos] ?? null
    },
    redo(): T | null {
      if (pos >= stack.length - 1) return null
      pos += 1
      return stack[pos] ?? null
    },
    canUndo: () => pos > 0,
    canRedo: () => pos < stack.length - 1,
    size: () => stack.length,
    position: () => pos
  }
}
