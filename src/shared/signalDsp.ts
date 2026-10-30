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
export interface MagnitudeSpectrumOptions {
  /** true=返回完整 N bin 复谱（complex）；false/缺省=单边 N/2 bin（real） */
  full?: boolean
  /** full 模式下是否把 0 Hz 移到中间（-Fs/2~+Fs/2）；默认 false */
  fftShift?: boolean
}

export function magnitudeSpectrum(
  input: Float32Array,
  imIn?: Float32Array,
  opts: MagnitudeSpectrumOptions = {}
): Float32Array {
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
  if (opts.full) {
    const out = new Float32Array(n)
    const shift = opts.fftShift ? n / 2 : 0
    for (let i = 0; i < n; i++) {
      const k = (i + shift) % n
      out[i] = Math.hypot(re[k]!, imm[k]!) / n
    }
    return out
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
 * 有状态信号源（相位/符号时钟/成型滤波历史跨帧连续）：
 * - outputMode=real：单路实数输出，IQ 表示为 I=x、Q=0（真实信号源/DAC）
 * - outputMode=complex：复数 IQ 输出（矢量源/仿真），可叠加共轭镜像
 * - waveform：cw / am / fm / pulse / twoTone / noise / digital / ofdm
 * - digital：BPSK/QPSK/16QAM 随机符号 → 升余弦成型 → 上变频
 * - ofdm：64 点 IFFT、QPSK 子载波、循环前缀（file 由回放后端提供，不在此生成）
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
  const Fs = cfg.sampleRate > 0 ? cfg.sampleRate : 4096
  const amp = cfg.amplitude || 1
  const outputMode = cfg.outputMode ?? 'real'
  const complexOut = outputMode === 'complex'
  // 兼容旧配置：modType 非 sine 且未显式指定波形时按数字调制处理
  const rawWaveform = cfg.waveform ?? (cfg.modType !== 'sine' ? 'digital' : 'cw')
  const waveform = rawWaveform === 'cw' && cfg.modType !== 'sine' ? 'digital' : rawWaveform
  const isDigital = waveform === 'digital'
  const isNoise = waveform === 'noise'
  const isOfdm = waveform === 'ofdm'
  const ofdmN = 64
  const ofdmActive = Math.min(52, Math.max(2, Math.floor((cfg.ofdmSubcarriers ?? 32) / 2) * 2))
  const ofdmCp = Math.min(ofdmN / 2, Math.max(0, Math.floor(ofdmN * (cfg.ofdmCpRatio ?? 0.25))))
  const ofdmQueueI: number[] = []
  const ofdmQueueQ: number[] = []
  let ofdmRead = 0
  const imageDb = cfg.imageDb ?? -120
  // 镜像只对复数输出有意义；实信号输出本身已含正负共轭
  const imageGain = complexOut && !isNoise && imageDb > -119.9 ? Math.pow(10, imageDb / 20) : 0
  const modFreq = cfg.modFreq ?? 50
  const modStep = (2 * Math.PI * modFreq) / Fs
  const amDepth = Math.min(1, Math.max(0, cfg.amDepth ?? 0.5))
  const fmDev = Math.max(0, cfg.fmDeviation ?? 200)
  const pulsePeriod = Math.max(1e-6, cfg.pulsePeriod ?? 0.01)
  const pulseDuty = Math.min(1, Math.max(0, cfg.pulseDuty ?? 0.5))
  const toneSpacing = Math.max(0, cfg.toneSpacing ?? 100)
  const carrierStep = (2 * Math.PI * cfg.freq) / Fs
  const tone1Step = (2 * Math.PI * (cfg.freq - toneSpacing / 2)) / Fs
  const tone2Step = (2 * Math.PI * (cfg.freq + toneSpacing / 2)) / Fs
  const S = Math.max(1, cfg.samplesPerSymbol | 0)
  const taps = isDigital ? rcTaps(S, 0.35, 6) : null
  const half = taps ? (taps.length - 1) / 2 : 0
  // 成型脉冲的平均功率（归一化前）：Σh²/S
  let pulsePower = 1
  if (taps) {
    let energy = 0
    for (let i = 0; i < taps.length; i++) energy += taps[i]! * taps[i]!
    pulsePower = energy / S
  }
  // 各波形相对载波功率的系数（用于保持 SNR 口径）
  let powerFactor = 1
  if (waveform === 'am') powerFactor = 1 + (amDepth * amDepth) / 2
  else if (waveform === 'pulse') powerFactor = pulseDuty
  else if (waveform === 'twoTone') powerFactor = 0.5
  else if (isDigital) powerFactor = pulsePower
  // 复噪声每路方差 σ² = 复信号功率 / (2·SNR)，实输出只加 I 路同 σ；
  // 两种输出的 SNR 口径一致。镜像信号计入总功率。
  const noiseSigma = Math.sqrt(
    (amp * amp * powerFactor * (1 + imageGain * imageGain)) / (2 * Math.pow(10, cfg.snr / 10))
  )
  const SQRT1_2 = Math.SQRT1_2
  const digitalModType = cfg.modType === 'sine' ? 'BPSK' : cfg.modType

  let phase = 0
  let phase2 = 0
  let modPhase = 0
  let sampleIndex = 0
  let baseM = 0
  const symI: number[] = []
  const symQ: number[] = []

  function wrapPhase(p: number): number {
    const twoPi = Math.PI * 2
    let v = p % twoPi
    if (v < 0) v += twoPi
    return v
  }

  function newSymbol(): [number, number] {
    if (digitalModType === 'BPSK') return rng() > 0.5 ? [1, 0] : [-1, 0]
    if (digitalModType === 'QPSK') {
      const map: Array<[number, number]> = [
        [SQRT1_2, SQRT1_2],
        [-SQRT1_2, SQRT1_2],
        [-SQRT1_2, -SQRT1_2],
        [SQRT1_2, -SQRT1_2]
      ]
      return map[Math.floor(rng() * 4)]!
    }
    if (digitalModType === '16QAM') {
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

  function appendOfdmSymbol(): void {
    const half = Math.floor(ofdmActive / 2)
    const idx: number[] = []
    const br: number[] = []
    const bi: number[] = []
    for (let j = 1; j <= half; j++) {
      const re = rng() > 0.5 ? SQRT1_2 : -SQRT1_2
      const im = rng() > 0.5 ? SQRT1_2 : -SQRT1_2
      idx.push(j, ofdmN - j)
      br.push(re, re)
      bi.push(im, -im)
    }
    const scale = 1 / Math.sqrt(ofdmActive)
    const symI = new Float64Array(ofdmN)
    const symQ = new Float64Array(ofdmN)
    for (let n = 0; n < ofdmN; n++) {
      let sr = 0
      let si = 0
      for (let b = 0; b < idx.length; b++) {
        const th = (2 * Math.PI * idx[b]! * n) / ofdmN
        const c = Math.cos(th)
        const s = Math.sin(th)
        sr += br[b]! * c - bi[b]! * s
        si += br[b]! * s + bi[b]! * c
      }
      symI[n] = sr * scale
      symQ[n] = si * scale
    }
    // cyclic prefix
    for (let k = ofdmN - ofdmCp; k < ofdmN; k++) {
      ofdmQueueI.push(symI[k]!)
      ofdmQueueQ.push(symQ[k]!)
    }
    for (let k = 0; k < ofdmN; k++) {
      ofdmQueueI.push(symI[k]!)
      ofdmQueueQ.push(symQ[k]!)
    }
  }

  function ensureOfdm(count: number): void {
    while (ofdmQueueI.length - ofdmRead < count) appendOfdmSymbol()
    if (ofdmRead > 8192) {
      ofdmQueueI.splice(0, ofdmRead)
      ofdmQueueQ.splice(0, ofdmRead)
      ofdmRead = 0
    }
  }

  return {
    next(n: number): Float32Array {
      const out = new Float32Array(n * 2)
      if (isNoise) {
        if (complexOut) {
          for (let k = 0; k < n; k++) {
            out[2 * k] = amp * SQRT1_2 * gauss()
            out[2 * k + 1] = amp * SQRT1_2 * gauss()
          }
        } else {
          for (let k = 0; k < n; k++) {
            out[2 * k] = amp * gauss()
            out[2 * k + 1] = 0
          }
        }
        sampleIndex += n
        return out
      }

      if (isOfdm) ensureOfdm(n)

      for (let k = 0; k < n; k++) {
        const t = sampleIndex + k
        let zr = 0
        let zi = 0
        if (isOfdm) {
          zr = ofdmQueueI[ofdmRead] ?? 0
          zi = ofdmQueueQ[ofdmRead] ?? 0
          ofdmRead++
          const c = Math.cos(phase)
          const s = Math.sin(phase)
          const br = zr
          const bq = zi
          zr = br * c - bq * s
          zi = br * s + bq * c
        } else if (isDigital) {
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
          const c = Math.cos(phase)
          const s = Math.sin(phase)
          zr = bi * c - bq * s
          zi = bi * s + bq * c
        } else if (waveform === 'twoTone') {
          zr = 0.5 * (Math.cos(phase) + Math.cos(phase2))
          zi = 0.5 * (Math.sin(phase) + Math.sin(phase2))
        } else {
          let env = 1
          if (waveform === 'am') env = 1 + amDepth * Math.cos(modPhase)
          else if (waveform === 'pulse') {
            const phaseInPeriod = (t / Fs) % pulsePeriod
            env = phaseInPeriod < pulsePeriod * pulseDuty ? 1 : 0
          }
          zr = env * Math.cos(phase)
          zi = env * Math.sin(phase)
        }

        if (complexOut) {
          // 共轭镜像：I 同相相加、Q 反相；imageGain=1 时 Q 抵消（实基带）
          if (imageGain > 0) {
            zr *= 1 + imageGain
            zi *= 1 - imageGain
          }
          out[2 * k] = amp * zr + gauss() * noiseSigma
          out[2 * k + 1] = amp * zi + gauss() * noiseSigma
        } else {
          // 实数输出：Q 严格为 0（没有第二路 ADC）
          out[2 * k] = amp * zr + gauss() * noiseSigma
          out[2 * k + 1] = 0
        }

        // 相位推进：FM 用瞬时频率，其余固定载波；双音两路独立
        if (waveform === 'fm') {
          phase = wrapPhase(phase + carrierStep + ((2 * Math.PI * fmDev) / Fs) * Math.cos(modPhase))
        } else if (waveform === 'twoTone') {
          phase = wrapPhase(phase + tone1Step)
          phase2 = wrapPhase(phase2 + tone2Step)
        } else {
          phase = wrapPhase(phase + carrierStep)
        }
        if (waveform === 'am' || waveform === 'fm') {
          modPhase = wrapPhase(modPhase + modStep)
        }
        if (isDigital && k % 256 === 0) trimSymbols(Math.ceil((t - half) / S))
      }
      sampleIndex += n
      return out
    },
    reset(): void {
      phase = 0
      phase2 = 0
      modPhase = 0
      sampleIndex = 0
      baseM = 0
      symI.length = 0
      symQ.length = 0
      ofdmQueueI.length = 0
      ofdmQueueQ.length = 0
      ofdmRead = 0
    }
  }
}
