import { describe, it, expect } from 'vitest'
import {
  applyWindow,
  createSignalGenerator,
  getWindow,
  magnitudeSpectrum,
  rcTaps
} from './signalDsp'
import { defaultAnalysisConfig, type SignalAnalysisConfig } from './signal'

/** 确定性伪随机（LCG），保证用例可复现 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

/** 多帧平均功率谱（dB），用于验证成型后的谱形 */
function averagedSpectrum(cfg: SignalAnalysisConfig, frames: number): Float32Array {
  const gen = createSignalGenerator(cfg, { rng: lcg(12345) })
  const n = cfg.fftSize
  const acc = new Float64Array(n / 2)
  for (let f = 0; f < frames; f++) {
    const iq = gen.next(cfg.pointsPerFrame)
    const slice = iq.subarray(iq.length - n * 2)
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      re[k] = slice[2 * k]!
      im[k] = slice[2 * k + 1]!
    }
    const win = getWindow(cfg.window, n)
    applyWindow(re, win)
    applyWindow(im, win)
    const mag = magnitudeSpectrum(re, im)
    for (let k = 0; k < n / 2; k++) acc[k] += mag[k]! * mag[k]!
  }
  const out = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k++) out[k] = 10 * Math.log10(acc[k]! / frames + 1e-20)
  return out
}

describe('rcTaps（升余弦成型脉冲）', () => {
  it('长度奇数、中心抽头为 1、左右对称', () => {
    const taps = rcTaps(16, 0.35, 6)
    expect(taps.length).toBe(6 * 16 + 1)
    const c = (taps.length - 1) / 2
    expect(taps[c]).toBeCloseTo(1, 6)
    for (let i = 0; i < c; i++) expect(taps[c - i]).toBeCloseTo(taps[c + i]!, 6)
  })

  it('sps=1 等极端参数不产生 NaN', () => {
    const taps = rcTaps(1, 0.35, 6)
    expect(taps.every((v) => isFinite(v))).toBe(true)
    expect(taps[(taps.length - 1) / 2]).toBeCloseTo(1, 6)
  })
})

describe('magnitudeSpectrum（实/复谱）', () => {
  function tone(n: number, bin: number): { re: Float32Array; im: Float32Array } {
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const ph = (2 * Math.PI * bin * k) / n
      re[k] = Math.cos(ph)
      im[k] = Math.sin(ph)
    }
    return { re, im }
  }
  function peakBin(row: Float32Array): number {
    let idx = 0
    for (let i = 1; i < row.length; i++) if (row[i]! > row[idx]!) idx = i
    return idx
  }

  it('fftShift 后正/负频率落在正确半区', () => {
    const n = 64
    const pos = tone(n, 7)
    const neg = tone(n, -7)
    const fullPos = magnitudeSpectrum(pos.re, pos.im, { full: true, fftShift: true })
    const fullNeg = magnitudeSpectrum(neg.re, neg.im, { full: true, fftShift: true })
    expect(fullPos.length).toBe(n)
    expect(peakBin(fullPos)).toBe(n / 2 + 7)
    expect(peakBin(fullNeg)).toBe(n / 2 - 7)
  })

  it('默认仍返回 N/2 单边谱（向后兼容）', () => {
    const n = 64
    const tone7 = tone(n, 7)
    const half = magnitudeSpectrum(tone7.re, tone7.im)
    expect(half.length).toBe(n / 2)
    expect(peakBin(half)).toBe(7)
  })
})

describe('createSignalGenerator（有状态、跨帧连续）', () => {
  it('分两次 next(1024) 与一次 next(2048) 逐值一致（相位/符号/成型状态连续）', () => {
    const cfg: SignalAnalysisConfig = { ...defaultAnalysisConfig(), modType: 'BPSK', freq: 512 }
    const genA = createSignalGenerator(cfg, { rng: lcg(7) })
    const a1 = genA.next(1024)
    const a2 = genA.next(1024)
    const joined = new Float32Array(4096)
    joined.set(a1)
    joined.set(a2, 2048)
    const genB = createSignalGenerator(cfg, { rng: lcg(7) })
    const b = genB.next(2048)
    expect(joined).toEqual(b)
  })

  it('BPSK 成型谱：峰值位于载波、带外快速衰减（升余弦特征）', () => {
    const cfg: SignalAnalysisConfig = {
      ...defaultAnalysisConfig(),
      modType: 'BPSK',
      freq: 512,
      snr: 100, // 近无噪
      fftSize: 2048,
      pointsPerFrame: 2048,
      window: 'hann'
    }
    const spec = averagedSpectrum(cfg, 64)
    const binHz = cfg.sampleRate / cfg.fftSize // 2 Hz/bin
    const carrierBin = Math.round(cfg.freq / binHz) // 256
    // 升余弦带内为平顶（±(1-β)/2·Rs ≈ ±41 bin），峰值应落在平顶区域内
    let peak = 0
    for (let k = 1; k < spec.length; k++) if (spec[k]! > spec[peak]!) peak = k
    expect(Math.abs(peak - carrierBin)).toBeLessThanOrEqual(45)
    // 带内（载波 +20Hz） vs 带外（载波 +250Hz，超出 Rs(1+β)/2≈173Hz）：应显著衰减
    const inBand = spec[carrierBin + Math.round(20 / binHz)]!
    const outBand = spec[carrierBin + Math.round(250 / binHz)]!
    expect(inBand - outBand).toBeGreaterThan(25)
  })

  it('sine 模式：峰值位于载波频率', () => {
    const cfg: SignalAnalysisConfig = {
      ...defaultAnalysisConfig(),
      modType: 'sine',
      freq: 512,
      snr: 100,
      fftSize: 2048,
      pointsPerFrame: 2048,
      window: 'hann'
    }
    const spec = averagedSpectrum(cfg, 8)
    const binHz = cfg.sampleRate / cfg.fftSize
    let peak = 0
    for (let k = 1; k < spec.length; k++) if (spec[k]! > spec[peak]!) peak = k
    expect(Math.abs(peak - Math.round(cfg.freq / binHz))).toBeLessThanOrEqual(2)
  })

  it('SNR 口径跨调制一致：标称 20 dB 时实测均为 20±1 dB', () => {
    // 同一 seed 下改变 snr 不改变随机数消耗序列 → (noisy - clean) 即纯噪声，
    // clean 的信号功率即真实信号功率。旧实现调制信号噪声乘 0.3，BPSK 实测会比 sine 高约 10 dB。
    for (const modType of ['sine', 'BPSK', 'QPSK', '16QAM'] as const) {
      const base: SignalAnalysisConfig = {
        ...defaultAnalysisConfig(),
        modType,
        snr: 20,
        pointsPerFrame: 4096
      }
      const noisy = createSignalGenerator(base, { rng: lcg(7) })
      const clean = createSignalGenerator({ ...base, snr: 200 }, { rng: lcg(7) })
      let ps = 0
      let pn = 0
      for (let f = 0; f < 8; f++) {
        const a = noisy.next(base.pointsPerFrame)
        const b = clean.next(base.pointsPerFrame)
        for (let k = 0; k < a.length; k++) {
          ps += b[k]! * b[k]!
          const d = a[k]! - b[k]!
          pn += d * d
        }
      }
      const measured = 10 * Math.log10(ps / Math.max(pn, 1e-30))
      expect(Math.abs(measured - 20)).toBeLessThan(1)
    }
  })
})
