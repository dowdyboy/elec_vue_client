/**
 * 信号处理纯函数（无 DOM / Vue 依赖，可在主进程、Worker、远程后端复用）
 * 由服务端调用以生成「显示就绪」帧（幅度谱 / dB / 抽稀）。
 * 另含演示信号源：rcTaps（升余弦成型，β=0.35）与 createSignalGenerator（有状态：相位/符号时钟/成型历史跨帧连续）。
 */

import type { SignalAnalysisConfig, WindowType } from './signal'

// ── 窗函数 ──
export function getWindow(type: WindowType, n: number): Float32Array {
  const w = new Float32Array(n)
  if (type === 'rect') {
    w.fill(1)
    return w
  }
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / (n - 1)
    if (type === 'hann') w[i] = 0.5 * (1 - Math.cos(a))
    else if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(a)
    else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
  }
  return w
}

export function applyWindow(data: Float32Array, win: Float32Array): void {
  const n = Math.min(data.length, win.length)
  for (let i = 0; i < n; i++) data[i] *= win[i]
}

// ── 简易 FFT（复数输入 → 正频率幅度谱）──
// 返回线性幅度（已除以 n），长度 n/2
export function magnitudeSpectrum(input: Float32Array, imIn?: Float32Array): Float32Array {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two')
  const re = new Float32Array(n)
  const imm = new Float32Array(n)
  re.set(input)
  if (imIn && imIn.length === n) imm.set(imIn)
  // bit reversal
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tmpR = re[i]
      re[i] = re[j]
      re[j] = tmpR
      const tmpI = imm[i]
      imm[i] = imm[j]
      imm[j] = tmpI
    }
  }
  // Cooley-Tukey
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len
    const wlenR = Math.cos(ang)
    const wlenI = -Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1
      let wi = 0
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k]
        const uI = imm[i + k]
        const vR = re[i + k + len / 2] * wr - imm[i + k + len / 2] * wi
        const vI = re[i + k + len / 2] * wi + imm[i + k + len / 2] * wr
        re[i + k] = uR + vR
        imm[i + k] = uI + vI
        re[i + k + len / 2] = uR - vR
        imm[i + k + len / 2] = uI - vI
        const nxtR = wr * wlenR - wi * wlenI
        const nxtI = wr * wlenI + wi * wlenR
        wr = nxtR
        wi = nxtI
      }
    }
  }
  const out = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], imm[i]) / n
  return out
}

export function toDB(mag: Float32Array, floor = -120): Float32Array {
  const out = new Float32Array(mag.length)
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i] <= 1e-12 ? floor : 20 * Math.log10(mag[i])
    out[i] = Math.max(floor, v)
  }
  return out
}

// ── 成型脉冲（升余弦）与信号生成器 ──
// 说明：这里使用「收发两端合并的升余弦（RC，RRC⊗RRC）」脉冲——符号点无 ISI（星座点干净），
// 频谱为经典升余弦：|f| ≤ (1-β)/2·Rs 平坦、(1±β)/2·Rs 余弦滚降、外侧为零。

/**
 * 升余弦脉冲（T 归一化为 1）：h(t)=sinc(t)·cos(πβt)/(1-(2βt)²)
 * @param sps 每符号采样数
 * @param beta 滚降系数（0~1，默认 0.35）
 * @param spanSymbols 总跨度（符号数，默认 6）
 */
export function rcTaps(sps: number, beta = 0.35, spanSymbols = 6): Float32Array {
  const S = Math.max(1, Math.round(sps))
  const half = Math.max(1, Math.round(spanSymbols / 2))
  const n = half * S * 2 + 1
  const taps = new Float32Array(n)
  const b = Math.min(1, Math.max(0, beta))
  const sinc = (x: number): number =>
    Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
  for (let i = 0; i < n; i++) {
    const t = (i - half * S) / S
    let v: number
    if (Math.abs(t) < 1e-9) v = 1
    else if (b > 1e-9 && Math.abs(Math.abs(2 * b * t) - 1) < 1e-6) {
      // 奇异点 t = ±1/(2β)：极限值 (π/4)·sinc(1/(2β))
      v = (Math.PI / 4) * sinc(1 / (2 * b))
    } else {
      v = (sinc(t) * Math.cos(Math.PI * b * t)) / (1 - (2 * b * t) ** 2)
    }
    taps[i] = v
  }
  // 归一化：峰值（中心抽头）为 1，保证符号点幅度与符号值一致
  const c = taps[half * S] || 1
  for (let i = 0; i < n; i++) taps[i] /= c
  return taps
}

export interface SignalGenerator {
  /** 生成下一段交织 IQ [I0,Q0,I1,Q1...]（长度 n*2），状态跨帧连续 */
  next(n: number): Float32Array
  reset(): void
}

/**
 * 有状态信号生成器（相位/符号时钟/成型滤波历史跨帧连续）：
 * - sine：复载波 cos/sin + 高斯噪声
 * - BPSK/QPSK/16QAM：随机符号 → 升余弦成型基带 → 上变频到 freq；amplitude 作用于基带
 * @param opts.rng 可注入确定性随机（默认 Math.random，便于单测）
 */
export function createSignalGenerator(
  cfg: SignalAnalysisConfig,
  opts: { rng?: () => number } = {}
): SignalGenerator {
  const rng = opts.rng ?? Math.random
  const gauss = (): number => {
    const u = rng() || 1e-12
    const v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const S = Math.max(1, cfg.samplesPerSymbol | 0)
  const step = (2 * Math.PI * cfg.freq) / cfg.sampleRate
  const amp = cfg.amplitude || 1
  const isSine = cfg.modType === 'sine'
  const taps = isSine ? null : rcTaps(S, 0.35, 6)
  const half = taps ? (taps.length - 1) / 2 : 0
  // 成型脉冲的平均功率（归一化前）：Σh²/S。符号集已归一化到 E|a|²=1，
  // 因此上变频后信号平均功率 = amp²·pulsePower。
  let pulsePower = 1
  if (taps) {
    let energy = 0
    for (let i = 0; i < taps.length; i++) energy += taps[i]! * taps[i]!
    pulsePower = energy / S
  }
  // 噪声口径统一：每路噪声方差 σ² = 信号平均功率 / (2·10^(snr/10))，
  // 使 E|n|²=2σ² 与信号功率之比恰好为 snr（不再按调制方式乘 0.3 之类的魔法数）。
  const noiseSigma = Math.sqrt((amp * amp * pulsePower) / (2 * Math.pow(10, cfg.snr / 10)))
  const SQRT1_2 = Math.SQRT1_2

  let phase = 0
  let sampleIndex = 0
  let baseM = 0
  const symI: number[] = []
  const symQ: number[] = []

  function newSymbol(): [number, number] {
    // 符号集统一归一化到 E|a|²=1：BPSK ±1、QPSK (±1±j)/√2、16QAM (±1,±3)/√10，
    // 这样 amplitude 与 snr 在所有调制方式下含义一致（峰值/星座幅度允许不同）。
    if (cfg.modType === 'BPSK') return rng() > 0.5 ? [1, 0] : [-1, 0]
    if (cfg.modType === 'QPSK') {
      const map: Array<[number, number]> = [
        [SQRT1_2, SQRT1_2],
        [-SQRT1_2, SQRT1_2],
        [-SQRT1_2, -SQRT1_2],
        [SQRT1_2, -SQRT1_2]
      ]
      return map[Math.floor(rng() * 4)]!
    }
    if (cfg.modType === '16QAM') {
      const inv = 1 / Math.sqrt(10)
      const lv = [-3, -1, 1, 3]
      return [lv[Math.floor(rng() * 4)]! * inv, lv[Math.floor(rng() * 4)]! * inv]
    }
    return [0, 0]
  }
  function ensureSymbol(m: number): void {
    while (baseM + symI.length <= m) {
      const [i, q] = newSymbol()
      symI.push(i)
      symQ.push(q)
    }
  }
  function trimSymbols(minM: number): void {
    const drop = minM - 8 - baseM
    if (drop > 64) {
      symI.splice(0, drop)
      symQ.splice(0, drop)
      baseM += drop
    }
  }

  return {
    next(n: number): Float32Array {
      const out = new Float32Array(n * 2)
      if (isSine) {
        for (let k = 0; k < n; k++) {
          out[2 * k] = amp * Math.cos(phase) + gauss() * noiseSigma
          out[2 * k + 1] = amp * Math.sin(phase) + gauss() * noiseSigma
          phase += step
          if (phase > Math.PI * 2) phase -= Math.PI * 2
        }
        return out
      }
      for (let k = 0; k < n; k++) {
        const t = sampleIndex + k
        const mMin = Math.ceil((t - half) / S)
        const mMax = Math.floor((t + half) / S)
        ensureSymbol(mMax)
        let bi = 0
        let bq = 0
        for (let m = mMin; m <= mMax; m++) {
          const j = m - baseM
          if (j < 0) continue
          const h = taps![t - m * S + half]
          if (!h) continue
          bi += symI[j]! * h
          bq += symQ[j]! * h
        }
        const ci = Math.cos(phase)
        const si = Math.sin(phase)
        out[2 * k] = amp * (bi * ci - bq * si) + gauss() * noiseSigma
        out[2 * k + 1] = amp * (bi * si + bq * ci) + gauss() * noiseSigma
        phase += step
        if (phase > Math.PI * 2) phase -= Math.PI * 2
        if (k % 256 === 0) trimSymbols(mMin)
      }
      sampleIndex += n
      return out
    },
    reset(): void {
      phase = 0
      sampleIndex = 0
      baseM = 0
      symI.length = 0
      symQ.length = 0
    }
  }
}
