import { describe, expect, it } from 'vitest'
import { PowerBuffer, analyzePowerPulses, computePowerStats, cleanPowerValues } from './power'

describe('功率-时间核心', () => {
  it('环形缓冲保留绝对序号并淘汰旧点', () => {
    const b = new PowerBuffer(8)
    b.append(new Float32Array([1, 2, 3, 4]))
    b.append(new Float32Array([5, 6, 7, 8, 9, 10]))
    expect(b.length).toBe(8)
    expect(b.offset).toBe(2)
    expect(Array.from(b.values)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(b.xStart).toBe(2)
    expect(b.xEnd).toBe(9)
  })

  it('门限/滞回检测脉冲并计算宽度/周期/占空比', () => {
    const v = new Float32Array(100).fill(-80)
    for (const start of [10, 40, 70]) {
      for (let i = 0; i < 10; i++) v[start + i] = -10
    }
    const r = analyzePowerPulses(v, -40, 4, 0.001, 0.001)
    expect(r.measured).toBe(true)
    expect(r.count).toBe(3)
    expect(r.widthMeanSec).toBeCloseTo(0.01, 6)
    expect(r.periodMeanSec).toBeCloseTo(0.03, 6)
    expect(r.dutyCycle).toBeCloseTo(30 / 70, 3)
    expect(r.peakDb).toBe(-10)
  })

  it('最小脉宽过滤与统计', () => {
    const v = new Float32Array([-80, -10, -10, -80, -10, -80])
    const r = analyzePowerPulses(v, -40, 2, 1, 2)
    expect(r.count).toBe(1)
    const s = computePowerStats(v)
    expect(s.min).toBe(-80)
    expect(s.max).toBe(-10)
    expect(s.paprDb).toBeCloseTo(-10 - (-80 + -10 - 10 - 80 - 10 - 80) / 6, 6)
  })

  it('非有限值清洗为 0', () => {
    expect(Array.from(cleanPowerValues([1, NaN, Infinity, -Infinity]))).toEqual([1, 0, 0, 0])
  })
})
