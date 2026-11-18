import { describe, expect, it } from 'vitest'
import { computeApdCcdf } from './apd'

describe('APD/CCDF 核心', () => {
  it('dB 样本的 APD/CCDF/PAPR', () => {
    const r = computeApdCcdf([-10, 0, 0, 10], { bins: 4, minDb: -10, maxDb: 10 })
    // 均值取功率域：10log10((0.1+1+1+10)/4)=10log10(3.025)，而非 dB 算术平均 0
    const meanDb = 10 * Math.log10(3.025)
    expect(r.sampleCount).toBe(4)
    expect(r.meanDb).toBeCloseTo(meanDb, 6)
    expect(r.peakDb).toBeCloseTo(10, 6)
    expect(r.paprDb).toBeCloseTo(10 - meanDb, 6)
    expect(Array.from(r.apd.y)).toEqual([25, 0, 50, 25])
    expect(Array.from(r.ccdf.y)).toEqual([100, 75, 75, 25])
    expect(r.p01Db).toBeGreaterThanOrEqual(r.p1Db)
  })

  it('线性功率输入自动转 dB', () => {
    const r = computeApdCcdf([1, 10, 100], { linear: true, bins: 8 })
    // dB 样本 [0, 10, 20] 的功率域均值 = 10log10((1+10+100)/3) = 10log10(37)
    const meanDb = 10 * Math.log10(37)
    expect(r.meanDb).toBeCloseTo(meanDb, 5)
    expect(r.peakDb).toBeCloseTo(20, 5)
    expect(r.paprDb).toBeCloseTo(20 - meanDb, 5)
  })

  it('空输入与非法值', () => {
    const r = computeApdCcdf([], { bins: 16 })
    expect(r.sampleCount).toBe(0)
    expect(r.apd.x.length).toBe(0)
    expect(r.ccdf.x.length).toBe(0)
  })
})
