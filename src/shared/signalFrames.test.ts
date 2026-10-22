import { describe, it, expect } from 'vitest'
import { defaultAnalysisConfig, type SignalAnalysisConfig } from './signal'
import {
  getWindowInfo,
  computeSpectrumRow,
  SpectrumAnalyzer,
  SpectrogramAccumulator
} from './signalFrames'

/** 生成整数 bin 的复单音（可用于验证窗增益补偿后的绝对电平） */
function complexTone(n: number, bin: number, nFft: number, amp = 1): Float32Array {
  const out = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * bin * k) / nFft
    out[2 * k] = amp * Math.cos(ph)
    out[2 * k + 1] = amp * Math.sin(ph)
  }
  return out
}

function peak(row: Float32Array): number {
  let m = -Infinity
  for (let i = 0; i < row.length; i++) if (row[i]! > m) m = row[i]!
  return m
}

function cfg(over: Partial<SignalAnalysisConfig> = {}): SignalAnalysisConfig {
  return { ...defaultAnalysisConfig(), fftSize: 1024, sampleRate: 4096, ...over }
}

describe('窗相干增益补偿', () => {
  it('rect/hann/hamming/blackman 的相干增益符合理论值', () => {
    expect(getWindowInfo('rect', 1024).gain).toBeCloseTo(1, 6)
    expect(getWindowInfo('hann', 1024).gain).toBeCloseTo(0.5, 3)
    expect(getWindowInfo('hamming', 1024).gain).toBeCloseTo(0.54, 3)
    expect(getWindowInfo('blackman', 1024).gain).toBeCloseTo(0.42, 3)
  })

  it('同一 0 dBFS 复单音：切窗后峰值仍为 0 dB（旧实现 hann 会低 6 dB）', () => {
    const tone = complexTone(1024, 64, 1024)
    for (const window of ['rect', 'hann', 'hamming', 'blackman'] as const) {
      const db = computeSpectrumRow(tone, cfg({ window, dbScale: true }))
      expect(peak(db)).toBeCloseTo(0, 1)
      const lin = computeSpectrumRow(tone, cfg({ window, dbScale: false }))
      expect(peak(lin)).toBeCloseTo(1, 2)
    }
  })

  it('非同相 bin 的峰值落在 0 dB 附近（扇贝损失有限）', () => {
    const tone = complexTone(1024, 64.5, 1024)
    const db = computeSpectrumRow(tone, cfg({ window: 'hann', dbScale: true }))
    expect(peak(db)).toBeGreaterThan(-2)
    expect(peak(db)).toBeLessThan(0.2)
  })
})

describe('SpectrumAnalyzer（跨帧凑满 fftSize）', () => {
  it('pointsPerFrame < fftSize 时跨帧累积，峰值不再因零填充而暴跌', () => {
    const c = cfg({ fftSize: 1024, window: 'hann', dbScale: true })
    const tone = complexTone(1024, 64, 1024)
    const full = computeSpectrumRow(tone, c)
    const analyzer = new SpectrumAnalyzer()
    let row: Float32Array | null = null
    for (let i = 0; i < 4; i++) {
      const part = tone.subarray(i * 512, (i + 1) * 512)
      const r = analyzer.push(part, c)
      if (i < 3) expect(r).toBeNull()
      else row = r
    }
    expect(row).not.toBeNull()
    expect(peak(row!)).toBeCloseTo(peak(full), 3)
    for (let i = 0; i < full.length; i++) expect(row![i]).toBeCloseTo(full[i]!, 3)
  })

  it('帧长 ≥ fftSize 时取当前帧最后 fftSize 个复数样本', () => {
    const c = cfg({ fftSize: 256, window: 'rect', dbScale: true })
    const tone = complexTone(1024, 32, 256)
    const analyzer = new SpectrumAnalyzer()
    const row = analyzer.push(tone, c)!
    const ref = computeSpectrumRow(tone.subarray(tone.length - 512), c)
    expect(peak(row)).toBeCloseTo(peak(ref), 5)
  })

  it('fftSize 变化自动重置', () => {
    const analyzer = new SpectrumAnalyzer()
    expect(analyzer.push(complexTone(128, 8, 128), cfg({ fftSize: 128 }))).not.toBeNull()
    expect(analyzer.push(complexTone(128, 8, 128), cfg({ fftSize: 256 }))).toBeNull()
  })
})

describe('SpectrogramAccumulator（固定 dB 行）', () => {
  it('dbScale=false 时仍输出 dB 行（时频图着色口径固定 -120~0 dB）', () => {
    const c = cfg({ fftSize: 256, window: 'hann', dbScale: false, overlap: 0.5 })
    const tone = complexTone(512, 32, 256)
    const acc = new SpectrogramAccumulator()
    const rows = acc.push(tone, c)
    expect(rows.length).toBe(3)
    const ref = computeSpectrumRow(tone.subarray(0, 512), c, { forceDb: true })
    expect(peak(rows[0]!)).toBeLessThan(1)
    for (let i = 0; i < ref.length; i++) expect(rows[0]![i]).toBeCloseTo(ref[i]!, 3)
  })
})
