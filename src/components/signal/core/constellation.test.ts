import { describe, it, expect } from 'vitest'
import {
  ConstellationAutoRange,
  ConstellationBuffer,
  autoConstellationRange,
  computeConstellationStats,
  equalizeRange,
  formatConstellationTick,
  sampleConstellation
} from './constellation'

describe('ConstellationBuffer（实时点缓冲）', () => {
  it('追加/保留最新点/超限淘汰/清空', () => {
    const b = new ConstellationBuffer(4)
    b.append(new Float32Array([1, 2]), new Float32Array([10, 20]))
    expect(b.length).toBe(2)
    b.append(new Float32Array([3, 4, 5]), new Float32Array([30, 40, 50]))
    expect(Array.from(b.i)).toEqual([2, 3, 4, 5])
    expect(Array.from(b.q)).toEqual([20, 30, 40, 50])
    b.append(new Float32Array([9, 8, 7]), new Float32Array([90, 80, 70]))
    expect(Array.from(b.i)).toEqual([5, 9, 8, 7]) // 保留最新 max 个点
    expect(Array.from(b.q)).toEqual([50, 90, 80, 70])
    b.clear()
    expect(b.length).toBe(0)
  })

  it('setMaxPoints 保留最新数据', () => {
    const b = new ConstellationBuffer(8)
    b.append(new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8]))
    b.setMaxPoints(2)
    expect(Array.from(b.i)).toEqual([3, 4])
    expect(Array.from(b.q)).toEqual([7, 8])
  })
})

describe('autoConstellationRange / equalizeRange', () => {
  it('自动量程以 0 为中心且覆盖极值；全零回退 [-1,1]', () => {
    const i = new Float32Array([-1.2, 0.8, 0.2])
    const q = new Float32Array([0.1, 1.1, -0.9])
    const r = autoConstellationRange(i, q)
    expect(r.min).toBeLessThanOrEqual(-1.2)
    expect(r.max).toBeGreaterThanOrEqual(1.2)
    expect(r.min).toBeCloseTo(-r.max, 9)
    const z = autoConstellationRange(new Float32Array(3), new Float32Array(3))
    expect(z).toEqual({ min: -1, max: 1 })
  })

  it('等比扩展：宽画布扩 x，高画布扩 y，中心不变', () => {
    const r = equalizeRange({ min: -1, max: 1 }, { min: -2, max: 2 }, 2)
    expect(r.x.max - r.x.min).toBeCloseTo(8)
    expect(r.y.max - r.y.min).toBeCloseTo(4)
    const r2 = equalizeRange({ min: -2, max: 2 }, { min: -1, max: 1 }, 0.5)
    expect(r2.x.max - r2.x.min).toBeCloseTo(4)
    expect(r2.y.max - r2.y.min).toBeCloseTo(8)
  })
})

describe('ConstellationAutoRange（自动量程稳定性）', () => {
  it('扩张即时，收窄需滞回+驻留，边界附近不逐帧翻转', () => {
    const ar = new ConstellationAutoRange({ hysteresis: 0.2, holdFrames: 3 })
    const a = ar.resolve({ min: -1, max: 1 })
    expect(a).toEqual({ min: -1, max: 1 })
    const b = ar.resolve({ min: -3, max: 3 })
    expect(b).toEqual({ min: -3, max: 3 })
    let changes = 0
    let prev = b
    for (let i = 0; i < 30; i++) {
      const r = ar.resolve({ min: -2.9, max: 2.9 })
      if (r.min !== prev.min || r.max !== prev.max) changes++
      prev = r
    }
    expect(changes).toBe(0)
  })

  it('持续变小超过驻留后收窄；reset 后重新吸附', () => {
    const ar = new ConstellationAutoRange({ hysteresis: 0.2, holdFrames: 3 })
    ar.resolve({ min: -3, max: 3 })
    let r = ar.resolve({ min: -1, max: 1 })
    expect(r.max).toBe(3) // 第一帧仍驻留
    r = ar.resolve({ min: -1, max: 1 })
    expect(r.max).toBe(3)
    r = ar.resolve({ min: -1, max: 1 })
    expect(r.max).toBe(1)
    ar.reset()
    expect(ar.resolve({ min: -0.5, max: 0.5 })).toEqual({ min: -0.5, max: 0.5 })
  })
})

describe('sampleConstellation / stats / tick', () => {
  it('抽点数量受上限约束且不修改原缓冲', () => {
    const i = new Float32Array(1000)
    const q = new Float32Array(1000)
    for (let k = 0; k < 1000; k++) i[k] = k
    const s = sampleConstellation(i, q, 1000, 100)
    expect(s.count).toBe(100)
    expect(s.i.length).toBe(100)
    expect(s.i[0]).toBe(0)
    expect(s.i[99]).toBe(990)
    expect(i[999]).toBe(999)
  })

  it('统计 I/Q 极值、RMS、功率、峰值', () => {
    const i = new Float32Array([1, -1, 0])
    const q = new Float32Array([0, 0, 2])
    const s = computeConstellationStats(i, q)
    expect(s.points).toBe(3)
    expect(s.iMin).toBe(-1)
    expect(s.iMax).toBe(1)
    expect(s.qMin).toBe(0)
    expect(s.qMax).toBe(2)
    expect(s.iRms).toBeCloseTo(Math.sqrt(2 / 3), 9)
    expect(s.qRms).toBeCloseTo(Math.sqrt(4 / 3), 9)
    expect(s.peak).toBe(2)
    expect(s.powerDbfs).toBeCloseTo(10 * Math.log10(6 / 3), 9)
  })

  it('刻度格式在 1/2/5 步进下无浮点尾数', () => {
    expect(formatConstellationTick(0, { min: -1, max: 1 })).toBe('0')
    expect(formatConstellationTick(0.5, { min: -1, max: 1 })).not.toContain('e')
    expect(formatConstellationTick(-2, { min: -3, max: 3 })).toBe('-2')
  })
})
