import { describe, expect, it } from 'vitest'
import { PersistenceBuffer } from './persistence'

describe('持续谱核心', () => {
  it('按 bin/level 累加频谱计数', () => {
    const p = new PersistenceBuffer({ width: 4, height: 4, minDb: -100, maxDb: 0 })
    p.addSpectrum([-100, -75, -50, -25])
    expect(p.frames).toBe(1)
    expect(p.density[0 * 4 + 0]).toBe(1) // -100 -> level 0
    expect(p.density[1 * 4 + 1]).toBe(1) // -75 -> level 1
    expect(p.density[2 * 4 + 2]).toBe(1) // -50 -> level 2
    expect(p.density[2 * 4 + 3]).toBe(1) // -25 -> level 2
    expect(p.getStats().max).toBe(1)
    expect(p.getStats().occupied).toBe(4)
  })

  it('逐帧衰减再累加', () => {
    const p = new PersistenceBuffer({ width: 2, height: 2, minDb: 0, maxDb: 2 })
    p.addSpectrum([0, 2])
    p.configure({ decay: 0.5 })
    p.addSpectrum([2, 0])
    expect(p.density[0 * 2 + 0]).toBeCloseTo(0.5, 6)
    expect(p.density[1 * 2 + 0]).toBeCloseTo(1, 6)
    expect(p.density[0 * 2 + 1]).toBeCloseTo(1, 6)
    expect(p.density[1 * 2 + 1]).toBeCloseTo(0.5, 6)
  })

  it('纯显示矩阵、归一化与清空', () => {
    const p = new PersistenceBuffer({ width: 2, height: 2 })
    p.setMatrix({ width: 2, height: 2, minDb: -10, maxDb: 0, density: [0, 1, 2, 4] })
    expect(p.getStats().max).toBe(4)
    const n = p.normalize(1)
    expect(n[0]).toBe(0)
    expect(n[3]).toBeCloseTo(1, 6)
    expect(n[2]).toBeGreaterThan(0)
    p.clear()
    expect(p.getStats().max).toBe(0)
  })
})
