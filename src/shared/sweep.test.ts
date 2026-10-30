import { describe, expect, it } from 'vitest'
import { defaultSweepConfig, makeSweepFrame, sanitizeSweepConfig, SweepGenerator } from './sweep'

describe('S11 扫频源', () => {
  it('生成等间隔频点与有界 Γ', () => {
    const f = makeSweepFrame(defaultSweepConfig(), 7, 123)
    expect(f.seq).toBe(7)
    expect(f.timestamp).toBe(123)
    expect(f.frequencies.length).toBe(401)
    expect(f.frequencies[0]).toBeCloseTo(1e6)
    expect(f.frequencies[400]).toBeCloseTo(500e6)
    for (let k = 0; k < f.frequencies.length; k++) {
      expect(Math.hypot(f.gammaI[k]!, f.gammaQ[k]!)).toBeLessThanOrEqual(1.0001)
    }
  })

  it('谐振点 Γ 近似实数且为负（25Ω < 50Ω）', () => {
    const l = 100e-9
    const c = 5e-12
    const f0 = 1 / (2 * Math.PI * Math.sqrt(l * c))
    const cfg = {
      ...defaultSweepConfig(),
      startHz: f0 * 0.999,
      stopHz: f0 * 1.001,
      points: 3,
      rOhm: 25,
      lHenry: l,
      cFarad: c
    }
    const f = makeSweepFrame(cfg, 1)
    const mid = 1
    expect(Math.abs(f.gammaQ[mid]!)).toBeLessThan(0.01)
    expect(f.gammaI[mid]!).toBeCloseTo((25 - 50) / (25 + 50), 2)
  })

  it('配置校验与生成器序号', () => {
    expect(sanitizeSweepConfig({ points: 10 }).ok).toBe(false)
    expect(sanitizeSweepConfig({ startHz: 100, stopHz: 1 }).ok).toBe(false)
    const g = new SweepGenerator({ points: 21 })
    expect(g.next(1).seq).toBe(1)
    expect(g.next(2).seq).toBe(2)
  })
})
