import { describe, expect, it } from 'vitest'
import { evaluateSignalQuality } from './quality'

describe('信号质量阈值判定', () => {
  it('全部通过', () => {
    const r = evaluateSignalQuality(
      { evmPercent: 3, merDb: 30, snrDb: 25, carrierOffsetHz: -12, paprDb: 8 },
      {
        evmPercentMax: 5,
        merDbMin: 25,
        snrDbMin: 20,
        carrierOffsetHzMax: 50,
        paprDbMax: 10
      }
    )
    expect(r.items).toHaveLength(5)
    expect(r.items.every((i) => i.state === 'pass')).toBe(true)
    expect(r.state).toBe('pass')
  })

  it('单项失败则总体失败，绝对值阈值生效', () => {
    const r = evaluateSignalQuality(
      { evmPercent: 8, merDb: 30, iqPhaseImbalanceDeg: -7 },
      { evmPercentMax: 5, merDbMin: 25, iqPhaseImbalanceDegMax: 5 }
    )
    expect(r.state).toBe('fail')
    expect(r.items.find((i) => i.key === 'evmPercent')?.state).toBe('fail')
    expect(r.items.find((i) => i.key === 'iqPhaseImbalanceDeg')?.state).toBe('fail')
  })

  it('没有阈值时未判定，不伪造 pass', () => {
    const r = evaluateSignalQuality({ evmPercent: 3, snrDb: 20 })
    expect(r.state).toBe('unknown')
    expect(r.items.every((i) => i.state === 'unknown')).toBe(true)
  })

  it('功率区间与缺失指标', () => {
    const r = evaluateSignalQuality({ powerDbm: 3 }, { powerDbmMin: 0, powerDbmMax: 5 })
    expect(r.state).toBe('pass')
    expect(r.items).toHaveLength(1)
  })
})
