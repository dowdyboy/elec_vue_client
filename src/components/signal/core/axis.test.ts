import { describe, it, expect } from 'vitest'
import { niceTicks, snapRangeNice, niceStep } from './axis'

describe('niceStep', () => {
  it('返回 1/2/5×10^k 家族步进', () => {
    expect(niceStep(1, 5)).toBe(0.2)
    expect(niceStep(10, 5)).toBe(2)
    expect(niceStep(100, 5)).toBe(20)
    expect(niceStep(2, 5)).toBe(0.5)
    expect(niceStep(0.5, 5)).toBe(0.1)
  })
  it('非法输入返回 1', () => {
    expect(niceStep(0, 5)).toBe(1)
    expect(niceStep(Number.NaN, 5)).toBe(1)
    expect(niceStep(Infinity, 5)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('覆盖 [min,max] 且含两端近似', () => {
    const ticks = niceTicks(-1, 1, 5)
    expect(ticks[0]).toBeCloseTo(-1, 9)
    expect(ticks[ticks.length - 1]).toBeCloseTo(1, 9)
    expect(ticks).toContain(0)
  })
  it('等距步进', () => {
    const ticks = niceTicks(0, 10, 5)
    expect(ticks.length).toBeGreaterThan(1)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(ticks[1]! - ticks[0]!, 9)
    }
  })
  it('非法输入返回空数组', () => {
    expect(niceTicks(5, 1, 5)).toEqual([])
    expect(niceTicks(Number.NaN, 1, 5)).toEqual([])
  })
})

describe('snapRangeNice', () => {
  it('向外吸附到步进倍数，覆盖原始范围', () => {
    const { min, max } = snapRangeNice(-0.72, 0.71)
    expect(min).toBeLessThanOrEqual(-0.72)
    expect(max).toBeGreaterThanOrEqual(0.71)
    // 边界应为步进倍数（吸附结果跨度对应 niceTicks 整倍数域）
    expect(min % 0.5).toBeCloseTo(0, 6)
    expect(max % 0.5).toBeCloseTo(0, 6)
  })
  it('小幅波动吸附结果稳定（档位量化）', () => {
    const a = snapRangeNice(-0.72, 0.71)
    const b = snapRangeNice(-0.68, 0.69)
    expect(a.min).toBe(b.min)
    expect(a.max).toBe(b.max)
  })
  it('同一边界不收缩已覆盖范围', () => {
    const { min, max } = snapRangeNice(-1, 1)
    expect(min).toBeLessThanOrEqual(-1)
    expect(max).toBeGreaterThanOrEqual(1)
  })
  it('非法输入原样返回', () => {
    expect(snapRangeNice(1, 1)).toEqual({ min: 1, max: 1 })
    expect(snapRangeNice(Number.NaN, 5)).toEqual({ min: Number.NaN, max: 5 })
  })
})
