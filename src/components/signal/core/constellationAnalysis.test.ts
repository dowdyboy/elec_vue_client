import { describe, it, expect } from 'vitest'
import {
  ConstellationAnalyzer,
  computeEvm,
  estimateCarrierOffset,
  estimateCarrierOffsetByEvm,
  estimateTimingOffset,
  extractSymbolsAt,
  resolveAnalysisConfig
} from './constellationAnalysis'
import type { ConstellationModulation } from './types'

function qpskSignal(
  opts: {
    symbols?: number
    sps?: number
    fs?: number
    fc?: number
    offset?: number
  } = {}
): { i: Float32Array; q: Float32Array; sps: number } {
  const nSym = opts.symbols ?? 256
  const sps = opts.sps ?? 16
  const fs = opts.fs ?? 8192
  const fc = opts.fc ?? 0
  const offset = opts.offset ?? 0
  const n = nSym * sps + offset
  const i = new Float32Array(n)
  const q = new Float32Array(n)
  const s = Math.SQRT1_2
  const syms = [
    [s, s],
    [-s, s],
    [-s, -s],
    [s, -s]
  ]
  for (let k = 0; k < nSym; k++) {
    const [bi, bq] = syms[k % 4]!
    for (let j = 0; j < sps; j++) {
      const idx = offset + k * sps + j
      if (idx >= n) break
      const ph = (2 * Math.PI * fc * idx) / fs
      i[idx] = bi * Math.cos(ph) - bq * Math.sin(ph)
      q[idx] = bi * Math.sin(ph) + bq * Math.cos(ph)
    }
  }
  return { i, q, sps }
}

describe('星座分析核心', () => {
  it('perfect QPSK 的 EVM 近似 0', () => {
    const s = Math.SQRT1_2
    const i = new Float32Array([s, -s, -s, s])
    const q = new Float32Array([s, s, -s, -s])
    const m = computeEvm(i, q, 'QPSK')
    expect(m.evmRms).toBeLessThan(1e-6)
  })

  it('BPSK/16QAM 的理想参考点 EVM 近似 0', () => {
    const b = computeEvm(new Float32Array([1, -1]), new Float32Array([0, 0]), 'BPSK')
    expect(b.evmRms).toBeLessThan(1e-6)
    const lv = [-3, -1, 1, 3]
    const inv = 1 / Math.sqrt(10)
    const i: number[] = []
    const q: number[] = []
    for (const a of lv)
      for (const bq of lv) {
        i.push(a * inv)
        q.push(bq * inv)
      }
    const m = computeEvm(new Float32Array(i), new Float32Array(q), '16QAM')
    expect(m.evmRms).toBeLessThan(1e-6)
  })

  it('由 z^4 自相关估计 QPSK 载波偏移', () => {
    const sig = qpskSignal({ fc: 512, symbols: 128 })
    const off = estimateCarrierOffset(sig.i, sig.q, 'QPSK', 8192)
    expect(off).toBeGreaterThan(505)
    expect(off).toBeLessThan(519)
  })

  it('EVM 搜索可估计 QPSK/16QAM 残余频偏', () => {
    for (const mod of ['QPSK', '16QAM'] as const) {
      const n = 256
      const i = new Float32Array(n)
      const q = new Float32Array(n)
      const symbolRate = 512
      const offset = 3.5
      const levels = mod === 'QPSK' ? [Math.SQRT1_2, -Math.SQRT1_2] : [-3, -1, 1, 3]
      const inv = mod === 'QPSK' ? 1 : 1 / Math.sqrt(10)
      let seed = 7
      const rnd = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0
        return seed / 4294967296
      }
      for (let k = 0; k < n; k++) {
        const si = levels[Math.floor(rnd() * levels.length)]! * inv
        const sq = levels[Math.floor(rnd() * levels.length)]! * inv
        const ph = (2 * Math.PI * offset * k) / symbolRate
        i[k] = si * Math.cos(ph) - sq * Math.sin(ph)
        q[k] = si * Math.sin(ph) + sq * Math.cos(ph)
      }
      const est = estimateCarrierOffsetByEvm(i, q, mod, symbolRate)
      expect(Math.abs(est - offset)).toBeLessThan(0.6)
    }
  })

  it('按符号周期抽点并跨帧返回相位', () => {
    const n = 40
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    for (let k = 0; k < n; k++) i[k] = k
    const a = extractSymbolsAt(i.subarray(0, 20), q.subarray(0, 20), 8, 0)
    const b = extractSymbolsAt(i.subarray(20), q.subarray(20), 8, a.nextPhase)
    expect(Array.from(a.i)).toEqual([0, 8, 16])
    expect(Array.from(b.i)).toEqual([24, 32])
  })

  it('定时搜索能找到符号中心附近的整数相位', () => {
    const sig = qpskSignal({ fc: 0, symbols: 64, sps: 16 })
    const best = estimateTimingOffset(sig.i, sig.q, 16, 'QPSK')
    expect(best).toBeGreaterThanOrEqual(0)
    expect(best).toBeLessThan(16)
  })

  it('分析仪自动载波/定时后 EVM 低，且纯配置校验有效', () => {
    const sig = qpskSignal({ fc: 512, symbols: 256, sps: 16, offset: 3 })
    const resolved = resolveAnalysisConfig(
      {
        modulation: 'QPSK',
        sampleRate: 8192,
        centerFrequencyHz: 0,
        samplesPerSymbol: 16,
        autoCarrier: true,
        autoSymbolTiming: true
      },
      {}
    )
    expect(resolved.valid).toBe(true)
    const an = new ConstellationAnalyzer(resolved.options)
    const out = an.process(sig.i, sig.q)
    expect(out.stats.measured).toBe(true)
    expect(out.stats.symbolCount).toBeGreaterThan(100)
    expect(out.stats.evmRms).toBeLessThan(0.05)
    expect(out.symbols.i.length).toBeGreaterThan(100)
  })

  it('缺少 sampleRate 时 analysis 配置无效', () => {
    const r = resolveAnalysisConfig({ modulation: 'QPSK', samplesPerSymbol: 16 }, {})
    expect(r.valid).toBe(false)
    expect(r.error).toContain('sampleRate')
  })
})

/** 类型导出检查（编译期；避免测试文件只依赖运行时） */
const _mods: ConstellationModulation[] = ['BPSK', 'QPSK', '16QAM']
void _mods
