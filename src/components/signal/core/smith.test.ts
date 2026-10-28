import { describe, expect, it } from 'vitest'
import { computeSmithStats, gammaToImpedance, gammaToReturnLossDb, gammaToVswr } from './smith'

describe('Smith 圆图核心', () => {
  it('Γ=0 → Z0、VSWR=1、回波损耗无穷', () => {
    expect(gammaToImpedance(0, 0).r).toBeCloseTo(50, 6)
    expect(gammaToImpedance(0, 0).x).toBeCloseTo(0, 6)
    expect(gammaToVswr(0, 0)).toBeCloseTo(1, 6)
    expect(gammaToReturnLossDb(0, 0)).toBe(Infinity)
  })

  it('实/复反射系数换算', () => {
    const zr = gammaToImpedance(0.5, 0)
    expect(zr.r).toBeCloseTo(150, 6)
    expect(zr.x).toBeCloseTo(0, 6)
    expect(gammaToVswr(0.5, 0)).toBeCloseTo(3, 6)
    expect(gammaToReturnLossDb(0.5, 0)).toBeCloseTo(6.0206, 3)

    const zc = gammaToImpedance(0, 0.5)
    expect(zc.r).toBeCloseTo(30, 6)
    expect(zc.x).toBeCloseTo(40, 6)
  })

  it('轨迹统计', () => {
    const s = computeSmithStats([{ i: new Float32Array([0, 0.5]), q: new Float32Array([0, 0]) }])
    expect(s.points).toBe(2)
    expect(s.maxGamma).toBeCloseTo(0.5, 6)
    expect(s.maxVswr).toBeCloseTo(3, 6)
    expect(s.minReturnLossDb).toBeCloseTo(6.0206, 3)
  })
})
