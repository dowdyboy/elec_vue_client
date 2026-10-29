import { describe, expect, it } from 'vitest'
import { SourceEngine } from './sourceEngine'
import { defaultAnalysisConfig } from './signal'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

describe('SourceEngine', () => {
  it('输出交织 IQ 与源元数据', () => {
    const cfg = { ...defaultAnalysisConfig(), outputMode: 'complex' as const, freq: 1000 }
    const e = new SourceEngine(cfg, { rng: lcg(1), now: () => 123 })
    const f = e.next(64)
    expect(f.seq).toBe(1)
    expect(f.timestamp).toBe(123)
    expect(f.sampleRate).toBe(cfg.sampleRate)
    expect(f.centerFrequencyHz).toBe(1000)
    expect(f.outputMode).toBe('complex')
    expect(f.data.length).toBe(128)
    expect(f.data.some((v) => v !== 0)).toBe(true)
  })

  it('real 输出 Q 为 0；setConfig 更新源参数', () => {
    const e = new SourceEngine(
      { ...defaultAnalysisConfig(), outputMode: 'real', waveform: 'cw' },
      { rng: lcg(2) }
    )
    const f = e.next(32)
    for (let k = 0; k < 32; k++) expect(f.data[2 * k + 1]).toBe(0)
    e.setConfig({ outputMode: 'complex', waveform: 'am' })
    const g = e.next(32)
    expect(g.outputMode).toBe('complex')
    expect(g.waveform).toBe('am')
    expect(g.seq).toBe(2)
    expect(g.data.some((v) => v !== 0)).toBe(true)
  })

  it('数字源与 reset 序号', () => {
    const e = new SourceEngine(
      { ...defaultAnalysisConfig(), waveform: 'digital', modType: 'QPSK', outputMode: 'complex' },
      { rng: lcg(3) }
    )
    expect(e.next(16).modType).toBe('QPSK')
    e.reset()
    expect(e.next(16).seq).toBe(1)
  })
})
