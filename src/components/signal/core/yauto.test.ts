import { describe, it, expect } from 'vitest'
import { YAutoScaler } from './yauto'

describe('YAutoScaler', () => {
  it('首帧直接吸附目标（含 25% 余量 + 档位量化）', () => {
    const s = new YAutoScaler()
    const r = s.resolve(-0.8, 0.8) // 目标 ±1.0 → 档位吸附 [-1, 1]
    expect(r.min).toBeLessThanOrEqual(-1)
    expect(r.max).toBeGreaterThanOrEqual(1)
  })

  it('突增新极值即时扩入（永不裁剪）', () => {
    const s = new YAutoScaler()
    s.resolve(-0.8, 0.8)
    const r = s.resolve(-1.6, 1.6)
    // 目标 ±2.0，应首帧即覆盖数据极值
    expect(r.min).toBeLessThanOrEqual(-1.6)
    expect(r.max).toBeGreaterThanOrEqual(1.6)
  })

  it('回落慢速收敛（约半秒九成）', () => {
    const s = new YAutoScaler()
    s.resolve(-1.6, 1.6)
    const startMax = s.resolve(-1.6, 1.6).max
    // 实际吸附目标（档位量化会把 ±0.625 向外吸附）
    const targetMax = new YAutoScaler().resolve(-0.5, 0.5).max
    let frames = 0
    let reached90 = false
    let cur = { min: 0, max: 0 }
    for (let i = 1; i <= 120 && !reached90; i++) {
      cur = s.resolve(-0.5, 0.5)
      frames = i
      const progress = (startMax - cur.max) / (startMax - targetMax)
      if (progress >= 0.9) reached90 = true
    }
    expect(reached90).toBe(true)
    // 九成收敛应在 60fps 下 1 秒内（~60 帧）
    expect(frames).toBeLessThanOrEqual(60)
  })

  it('稳态收敛后逐帧完全静止（零爬行）', () => {
    const s = new YAutoScaler()
    for (let i = 0; i < 120; i++) s.resolve(-0.5, 0.5) // 收敛
    const a = s.resolve(-0.5, 0.5)
    const b = s.resolve(-0.5, 0.5)
    expect(a.min).toBe(b.min)
    expect(a.max).toBe(b.max)
  })

  it('档位量化：小幅极值波动被吸收，目标稳定', () => {
    const s = new YAutoScaler()
    const a = s.resolve(-0.7, 0.68)
    const b = s.resolve(-0.66, 0.72) // 微小扰动
    expect(a.min).toBe(b.min)
    expect(a.max).toBe(b.max)
  })

  it('reset 后重新吸附新目标，不从旧范围滑入', () => {
    const s = new YAutoScaler()
    s.resolve(-2, 2) // 大范围
    s.reset()
    const r = s.resolve(-0.5, 0.5)
    // reset 后首帧直接吸附小目标
    expect(r.max).toBeLessThan(1.1)
  })

  it('极小信号（含零跨度）不产生 NaN', () => {
    const s = new YAutoScaler()
    const r = s.resolve(0.3, 0.3)
    expect(Number.isFinite(r.min)).toBe(true)
    expect(Number.isFinite(r.max)).toBe(true)
    expect(r.max).toBeGreaterThan(r.min)
  })
})

describe('YAutoScaler 稳定性参数（换档滞回 + 收窄驻留）', () => {
  const OPT = { hysteresis: 0.25, holdFrames: 60, shrinkRelease: 0.05 }

  it('档位边界噪声：目标档位不逐帧翻转（修复 QAM 抖动）', () => {
    const s = new YAutoScaler(OPT)
    let prev: { min: number; max: number } | null = null
    let changes = 0
    for (let i = 0; i < 300; i++) {
      // 交替在 [-1,1] 与 [-1.5,1.5] 两个档位边界附近（旧实现会持续翻转）
      const r = i % 2 === 0 ? s.resolve(-0.8, 0.8) : s.resolve(-1.0, 1.0)
      if (prev && (Math.abs(r.min - prev.min) > 1e-9 || Math.abs(r.max - prev.max) > 1e-9))
        changes++
      prev = r
    }
    expect(changes).toBeLessThanOrEqual(1) // 仅允许首次扩张一次
  })

  it('幅度阶跃：当帧立即扩张（不裁切）', () => {
    const s = new YAutoScaler(OPT)
    s.resolve(-0.5, 0.5)
    const r = s.resolve(-3, 3)
    expect(r.min).toBeLessThanOrEqual(-3)
    expect(r.max).toBeGreaterThanOrEqual(3)
  })

  it('持续变小：先驻留保持，超过 holdFrames 后平滑收窄', () => {
    const s = new YAutoScaler(OPT)
    s.resolve(-3, 3) // 目标 [-4,4]
    for (let i = 0; i < 30; i++) s.resolve(-0.5, 0.5)
    expect(s.resolve(-0.5, 0.5).max).toBeGreaterThan(3.9) // 驻留期不收缩
    let r = { min: 0, max: 0 }
    for (let i = 0; i < 200; i++) r = s.resolve(-0.5, 0.5)
    expect(r.max).toBeLessThan(2.5) // 驻留后平滑收窄
  })

  it('默认参数保持原语义：每次调用均跟随候选目标', () => {
    const s = new YAutoScaler()
    const a = s.resolve(-1.0, 1.0) // [-1.5,1.5]
    expect(a.max).toBeGreaterThanOrEqual(1.5)
    const b = s.resolve(-0.8, 0.8) // [-1,1]：默认无驻留，立即收窄目标
    expect(b.max).toBeLessThan(a.max)
  })

  it('reset 清空目标与驻留计数', () => {
    const s = new YAutoScaler(OPT)
    s.resolve(-3, 3)
    for (let i = 0; i < 30; i++) s.resolve(-0.5, 0.5) // 累计驻留
    s.reset()
    const r = s.resolve(-0.5, 0.5)
    expect(r.max).toBeLessThan(1.1) // 重置后直接吸附小目标
  })

  it('snap：档位变化直接吸附，不逐帧缓动（刻度不爬行）', () => {
    const s = new YAutoScaler({ snap: true })
    const wide = s.resolve(-3, 3)
    const narrow = s.resolve(-0.5, 0.5)
    expect(narrow.max).toBeLessThan(wide.max)
    const again = s.resolve(-0.5, 0.5)
    expect(again).toEqual(narrow)
  })
})
