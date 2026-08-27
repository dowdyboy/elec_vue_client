import { describe, it, expect } from 'vitest'
import { TriggerEngine, findEdge, triggerWindow } from './trigger'

describe('findEdge', () => {
  const a = new Float32Array([-1, -0.5, 0, 0.5, 1, 0.8, 0.2, -0.2])
  it('上升沿：跨过电平 0 的第一个索引', () => {
    // -0.5(1) → 0(2) 不是严格 >；0.5(3) 跨过 → 命中 3
    expect(findEdge(a, 0, a.length, 0, 'rising', 0)).toBe(3)
  })
  it('下降沿：跨过电平 0', () => {
    expect(findEdge(a, 0, a.length, 0, 'falling', 0)).toBe(7) // 0.2→-0.2
  })
  it('电平不同', () => {
    expect(findEdge(a, 0, a.length, 0.9, 'rising', 0)).toBe(4) // 0.8→1
    // 电平恰等于样本值不触发（严格 >）；0.5→1 跨 0.5 → 索引 4
    expect(findEdge(a, 0, a.length, 0.5, 'rising', 0)).toBe(4)
  })
  it('无触发返回 -1', () => {
    expect(findEdge(a, 0, a.length, 5, 'rising', 0)).toBe(-1)
    expect(findEdge(a, 0, a.length, 0, 'rising', 0)).toBe(3) // sanity
  })
  it('dropped 偏移：绝对索引 = 本地 + dropped', () => {
    expect(findEdge(a, 0, a.length, 0, 'rising', 1000)).toBe(1003)
  })
  it('段长 < 2 返回 -1', () => {
    expect(findEdge(a, 3, 3, 0, 'rising', 0)).toBe(-1)
  })
})

describe('triggerWindow', () => {
  it('preTrigger=0.25：触发点在窗口 1/4 处', () => {
    const w = triggerWindow(1000, 400, 0.25, 0, 2000)
    expect(w.min).toBe(1000 - Math.floor(100)) // 900
    expect(w.max - w.min).toBe(400)
  })
  it('钳制到 dropped 与 total', () => {
    const w = triggerWindow(50, 400, 0.25, 0, 100)
    expect(w.min).toBeGreaterThanOrEqual(0)
    expect(w.max).toBeLessThanOrEqual(100)
  })
})

describe('TriggerEngine', () => {
  it('auto：检测并记录触发点', () => {
    const e = new TriggerEngine()
    const arr = new Float32Array([-1, 1, -1, 1, -1])
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 0,
      mode: 'auto' as const,
      preTrigger: 0.25
    }
    e.feed(cfg, arr, 0, 2, 0)
    expect(e.state.lastTriggerAbs).toBe(1) // -1→1
    expect(e.state.armed).toBe(true)
  })
  it('auto：无触发保持 -1', () => {
    const e = new TriggerEngine()
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 5,
      mode: 'auto' as const,
      preTrigger: 0.25
    }
    e.feed(cfg, new Float32Array([0, 1, 2]), 0, 3, 0)
    expect(e.state.lastTriggerAbs).toBe(-1)
  })
  it('single：触发一次后 fired（armed=false），再喂无新触发', () => {
    const e = new TriggerEngine()
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 0,
      mode: 'single' as const,
      preTrigger: 0.25
    }
    const buf = new Float32Array([-1, 1, -1, 1, -1, 1, -1, 1])
    e.feed(cfg, buf, 0, 6, 0) // 新段 [0,6)：-1→1 触发于 1
    expect(e.state.lastTriggerAbs).toBe(1)
    expect(e.state.armed).toBe(false)
    // 继续喂数据（含新边沿 [6,8) -1→1）也不更新
    e.feed(cfg, buf, 6, 8, 0)
    expect(e.state.lastTriggerAbs).toBe(1)
    // arm 后重新捕获
    e.arm()
    expect(e.state.armed).toBe(true)
    expect(e.state.lastTriggerAbs).toBe(-1) // arm 清空上次触发点，避免残留旧捕获锚定显示窗
    e.feed(cfg, buf, 6, 8, 0)
    expect(e.state.lastTriggerAbs).toBe(7)
  })
  it('normal：每次检测都更新（未触发则保持上次）', () => {
    const e = new TriggerEngine()
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 0,
      mode: 'normal' as const,
      preTrigger: 0.25
    }
    const buf = new Float32Array([-1, 1, 0, 0, 0])
    e.feed(cfg, buf, 0, 2, 0) // 触发于 1
    expect(e.state.lastTriggerAbs).toBe(1)
    e.feed(cfg, buf, 2, 5, 0) // [2,5) 无触发
    expect(e.state.lastTriggerAbs).toBe(1)
  })
  it('reset 清空状态', () => {
    const e = new TriggerEngine()
    e.state.lastTriggerAbs = 5
    e.state.armed = false
    e.reset()
    expect(e.state.lastTriggerAbs).toBe(-1)
    expect(e.state.armed).toBe(true)
  })
})
