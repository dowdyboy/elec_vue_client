import { describe, it, expect } from 'vitest'
import { TriggerEngine, findEdge, triggerRightNeed, triggerWindow } from './trigger'

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

describe('triggerRightNeed', () => {
  it('默认演示参数（pre=0.25 / span=4096）右需 3072', () => {
    expect(triggerRightNeed(0.25, 4096)).toBe(3072)
  })
  it('边界：pre=1 右需 0；pre=0 右需整窗', () => {
    expect(triggerRightNeed(1, 512)).toBe(0)
    expect(triggerRightNeed(0, 512)).toBe(512)
  })
})

describe('触发 pending 提升门控（默认演示参数周期信号可锁定）', () => {
  it('首帧命中经右侧补齐后提升，不再永远自由滚动', () => {
    const pointsPerFrame = 2048
    const span = 4096
    const pre = 0.25
    const right = triggerRightNeed(pre, span)
    const engine = new TriggerEngine()
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 0,
      mode: 'auto' as const,
      preTrigger: pre
    }
    const buf = new Float32Array(pointsPerFrame * 4)
    let len = 0
    const promoted: number[] = []
    for (let f = 0; f < 4; f++) {
      const s = len
      for (let i = 0; i < pointsPerFrame; i++) buf[s + i] = (s + i) % 82 === 0 ? 1 : 0
      len += pointsPerFrame
      engine.feed(cfg, buf, s, len, 0)
      if (engine.state.pendingAbs >= 0 && engine.state.pendingAbs + right <= len) {
        engine.promote()
        promoted.push(engine.state.lastTriggerAbs)
      }
    }
    // 关键回归：默认参数下 auto/normal 必须能锁定（修复前 pending 恒被新边沿覆盖/门控永不满足）
    expect(promoted.length).toBeGreaterThan(0)
    expect(promoted[0]! + right).toBeLessThanOrEqual(len)
    expect(engine.state.lastTriggerAbs).toBeGreaterThanOrEqual(0)
  })
})

describe('TriggerEngine', () => {
  it('auto：检测进入 pendingAbs，promote 后才生效', () => {
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
    expect(e.state.pendingAbs).toBe(1) // -1→1，等待右侧数据
    expect(e.state.lastTriggerAbs).toBe(-1) // 未提升前不生效
    expect(e.promote()).toBe(true)
    expect(e.state.lastTriggerAbs).toBe(1)
    expect(e.state.pendingAbs).toBe(-1)
    expect(e.state.armed).toBe(true)
    expect(e.state.lastTriggerAt).toBeGreaterThan(0) // 记录触发时间（auto free-run 判断用）
  })
  it('auto：待渲染触发点不被后续新边沿覆盖（首个命中优先）', () => {
    const e = new TriggerEngine()
    const cfg = {
      enabled: true,
      source: 'i' as const,
      edge: 'rising' as const,
      level: 0,
      mode: 'auto' as const,
      preTrigger: 0.25
    }
    const buf = new Float32Array([-1, 1, -1, 1, -1, 1])
    e.feed(cfg, buf, 0, 2, 0) // 首次命中 1
    e.feed(cfg, buf, 2, 4, 0) // 新边沿 3 不覆盖
    expect(e.state.pendingAbs).toBe(1)
    e.promote()
    expect(e.state.lastTriggerAbs).toBe(1)
    e.feed(cfg, buf, 4, 6, 0) // 提升后再命中进入新 pending
    expect(e.state.pendingAbs).toBe(5)
  })
  it('promote 无待渲染触发返回 false', () => {
    const e = new TriggerEngine()
    expect(e.promote()).toBe(false)
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
    expect(e.state.pendingAbs).toBe(-1)
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
  it('normal：命中进入 pending，promote 生效；未触发保持上次', () => {
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
    e.feed(cfg, buf, 0, 2, 0) // 触发于 1 → pending
    expect(e.state.pendingAbs).toBe(1)
    e.promote()
    expect(e.state.lastTriggerAbs).toBe(1)
    e.feed(cfg, buf, 2, 5, 0) // [2,5) 无触发
    expect(e.state.lastTriggerAbs).toBe(1)
    expect(e.state.pendingAbs).toBe(-1)
  })
  it('reset 清空状态（含 pending）', () => {
    const e = new TriggerEngine()
    e.state.lastTriggerAbs = 5
    e.state.armed = false
    e.state.pendingAbs = 7
    e.reset()
    expect(e.state.lastTriggerAbs).toBe(-1)
    expect(e.state.armed).toBe(true)
    expect(e.state.pendingAbs).toBe(-1)
  })
})
