import { describe, expect, it } from 'vitest'
import { createViewHistory } from './viewHistory'

describe('视图历史栈（撤销/重做）', () => {
  it('提交后可逐步撤销与重做', () => {
    const h = createViewHistory<number>(30)
    h.commit(1)
    h.commit(2)
    h.commit(3)
    expect(h.position()).toBe(2)
    expect(h.undo()).toBe(2)
    expect(h.undo()).toBe(1)
    expect(h.canUndo()).toBe(false)
    expect(h.undo()).toBeNull() // 已到最旧
    expect(h.redo()).toBe(2)
    expect(h.redo()).toBe(3)
    expect(h.redo()).toBeNull() // 已到最新
  })

  it('撤销到中间后再提交：丢弃未来分支', () => {
    const h = createViewHistory<string>(30)
    h.commit('a')
    h.commit('b')
    h.commit('c')
    h.undo() // 回到 b
    h.commit('d')
    expect(h.size()).toBe(3) // a, b, d
    expect(h.redo()).toBeNull() // c 已被丢弃
    expect(h.undo()).toBe('b')
    expect(h.undo()).toBe('a')
  })

  it('超过上限时挤掉最旧一条，位置对齐最新', () => {
    const h = createViewHistory<number>(3)
    for (let i = 1; i <= 5; i++) h.commit(i)
    expect(h.size()).toBe(3)
    expect(h.position()).toBe(2)
    expect(h.undo()).toBe(4)
    expect(h.undo()).toBe(3)
    expect(h.undo()).toBeNull() // 1、2 已被挤出
  })

  it('reset 用当前快照重建历史，撤销栈被清空', () => {
    const h = createViewHistory<number>(30)
    h.commit(1)
    h.commit(2)
    h.reset(9)
    expect(h.size()).toBe(1)
    expect(h.position()).toBe(0)
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    expect(h.undo()).toBeNull()
  })

  it('空栈的边界：撤销/重做都返回 null 且不抛错', () => {
    const h = createViewHistory<number>(30)
    expect(h.size()).toBe(0)
    expect(h.position()).toBe(-1)
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBeNull()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })

  it('容量至少为 1（传 0/负数不炸）', () => {
    const h = createViewHistory<number>(0)
    h.commit(1)
    h.commit(2)
    expect(h.size()).toBe(1)
    expect(h.undo()).toBeNull()
  })

  it('快照是引用传递（组件里存的是普通对象，不做深拷贝）', () => {
    const h = createViewHistory<{ x: number }>(30)
    const snap = { x: 5 }
    h.commit(snap)
    expect(h.undo()).toBeNull()
    h.commit({ x: 6 })
    expect(h.undo()).toBe(snap)
  })
})
