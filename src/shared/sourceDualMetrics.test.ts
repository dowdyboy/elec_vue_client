import { describe, expect, it } from 'vitest'
import { computeDualChannelMetrics } from './sourceDualMetrics'

function tone(amp: number, phaseDeg: number, n = 512): Float32Array {
  const out = new Float32Array(n * 2)
  const ph = (phaseDeg * Math.PI) / 180
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * 7 * k) / n
    out[k * 2] = amp * Math.cos(a + ph)
    out[k * 2 + 1] = amp * Math.sin(a + ph)
  }
  return out
}

describe('computeDualChannelMetrics', () => {
  it('幅度比/相位差/相关系数', () => {
    const a = tone(0.5, 0)
    const b = tone(0.25, 30)
    const m = computeDualChannelMetrics(a, b)
    expect(m).not.toBeNull()
    expect(m!.ampRatio).toBeCloseTo(0.5, 3)
    expect(m!.phaseDeg).toBeCloseTo(30, 1)
    expect(m!.corr).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 3)
  })

  it('空/零数据返回 null', () => {
    expect(computeDualChannelMetrics(new Float32Array(0), new Float32Array(0))).toBeNull()
    expect(computeDualChannelMetrics(new Float32Array(4), new Float32Array(4))).toBeNull()
  })
})
