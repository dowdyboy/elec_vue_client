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

  it('Mock 镜像分量：负频峰约等于设定 imageDb', () => {
    const cfg: SignalAnalysisConfig = {
      ...defaultAnalysisConfig(),
      modType: 'sine',
      freq: 512,
      sampleRate: 4096,
      fftSize: 1024,
      snr: 100,
      outputMode: 'complex',
      imageDb: -20
    }
    const gen = createSignalGenerator(cfg, { rng: lcg(9) })
    const iq = gen.next(1024)
    const re = new Float32Array(1024)
    const im = new Float32Array(1024)
    for (let k = 0; k < 1024; k++) {
      re[k] = iq[2 * k]!
      im[k] = iq[2 * k + 1]!
    }
    const full = magnitudeSpectrum(re, im, { full: true, fftShift: true })
    const pos = full[512 + 128]!
    const neg = full[512 - 128]!
    expect(20 * Math.log10(pos / neg)).toBeCloseTo(20, 0)
  })
})

describe('专业源：实数/复数输出与波形', () => {
  const base: SignalAnalysisConfig = {
    ...defaultAnalysisConfig(),
    modType: 'sine',
    freq: 512,
    sampleRate: 4096,
    pointsPerFrame: 1024,
    fftSize: 1024,
    snr: 100
  }
  function gen(over: Partial<SignalAnalysisConfig>, n = 1024): Float32Array {
    return createSignalGenerator({ ...base, ...over }, { rng: lcg(21) }).next(n)
  }
  function fullSpectrum(iq: Float32Array): Float32Array {
    const n = iq.length / 2
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      re[k] = iq[2 * k]!
      im[k] = iq[2 * k + 1]!
    }
    return magnitudeSpectrum(re, im, { full: true, fftShift: true })
  }

  it('real 输出 Q=0；complex 输出保留 Q；real CW 复谱对称', () => {
    const real = gen({ outputMode: 'real', waveform: 'cw' })
    const complex = gen({ outputMode: 'complex', waveform: 'cw' })
    for (let k = 0; k < real.length / 2; k++) expect(real[2 * k + 1]).toBe(0)
    let qEnergy = 0
    for (let k = 0; k < complex.length / 2; k++) qEnergy += Math.abs(complex[2 * k + 1]!)
    expect(qEnergy).toBeGreaterThan(1)

    const realSpec = fullSpectrum(real)
    const cplxSpec = fullSpectrum(complex)
    const pos = realSpec[512 + 128]!
    const neg = realSpec[512 - 128]!
    expect(neg / pos).toBeGreaterThan(0.5)
    const cPos = cplxSpec[512 + 128]!
    const cNeg = cplxSpec[512 - 128]!
    expect(cNeg / cPos).toBeLessThan(0.01)
  })

  it('OFDM 生成复数基带并保持 real 输出 Q=0', () => {
    const c = gen({ waveform: 'ofdm', outputMode: 'complex', ofdmSubcarriers: 16 }, 2048)
    let energy = 0
    for (let k = 0; k < c.length; k++) energy += Math.abs(c[k]!)
    expect(energy).toBeGreaterThan(100)
    const r = gen({ waveform: 'ofdm', outputMode: 'real', ofdmSubcarriers: 16 }, 2048)
    for (let k = 0; k < r.length / 2; k++) expect(r[2 * k + 1]).toBe(0)
  })

  it('AM/FM/Pulse/TwoTone/Noise/Digital 均能生成，关键特征正确', () => {
    const am = gen({ outputMode: 'real', waveform: 'am', amDepth: 0.8, modFreq: 50 })
    let amMin = Infinity
    let amMax = -Infinity
    for (let k = 0; k < 1024; k++) {
      amMin = Math.min(amMin, am[2 * k]!)
      amMax = Math.max(amMax, am[2 * k]!)
    }
    expect(amMax - amMin).toBeGreaterThan(0.5)

    const fm = gen({ outputMode: 'real', waveform: 'fm', fmDeviation: 100, modFreq: 30 })
    for (let k = 0; k < fm.length; k++) expect(Number.isFinite(fm[k]!)).toBe(true)
    for (let k = 0; k < 1024; k++) expect(fm[2 * k + 1]).toBe(0)

    const pulse = gen({ outputMode: 'real', waveform: 'pulse', pulsePeriod: 0.01, pulseDuty: 0.25 })
    let zeros = 0
    let nonZeros = 0
    for (let k = 0; k < 1024; k++) Math.abs(pulse[2 * k]!) < 0.01 ? zeros++ : nonZeros++

    expect(zeros).toBeGreaterThan(0)
    expect(nonZeros).toBeGreaterThan(0)

    const two = gen({
      outputMode: 'complex',
      waveform: 'twoTone',
      toneSpacing: 256
    })
    const twoSpec = fullSpectrum(two)
    let p1 = 0
    let p2 = 0
    for (let i = 1; i < twoSpec.length; i++) {
      if (twoSpec[i]! > twoSpec[p1]!) p1 = i
    }
    for (let i = 1; i < twoSpec.length; i++) {
      if (i !== p1 && twoSpec[i]! > twoSpec[p2]!) p2 = i
    }
    const peaks = [p1, p2].sort((a, b) => a - b)
    expect(peaks[0]).toBe(512 + 96)
    expect(peaks[1]).toBe(512 + 160)

    const noise = gen({ outputMode: 'real', waveform: 'noise' })
    for (let k = 0; k < 1024; k++) expect(noise[2 * k + 1]).toBe(0)

    const digital = gen({ outputMode: 'complex', waveform: 'digital', modType: 'QPSK' })
    let dq = 0
    for (let k = 0; k < 1024; k++) dq += Math.abs(digital[2 * k + 1]!)
    expect(dq).toBeGreaterThan(1)
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
      window: 'hann',
      outputMode: 'complex'
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
