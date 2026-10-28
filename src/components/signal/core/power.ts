/**
 * 功率-时间（Zero Span / 脉冲功率）核心：
 * - PowerBuffer：定长环形缓冲，保留绝对样本序号
 * - analyzePowerPulses：门限 + 滞回 + 最小脉宽，输出脉宽/周期/占空比/峰值
 * - computePowerStats：峰值/均值/RMS/PAPR
 * 纯显示路径不应依赖这里的脉冲分析。
 */

export interface PowerPulse {
  startIndex: number
  endIndex: number
  widthSamples: number
  widthSec: number
  startTimeSec: number
  endTimeSec: number
  peakDb: number
  meanDb: number
}

export interface PulseAnalysis {
  measured: boolean
  thresholdDb: number
  hysteresisDb: number
  pulses: PowerPulse[]
  count: number
  widthMeanSec: number
  periodMeanSec: number
  dutyCycle: number
  pulseRateHz: number
  peakDb: number
  meanDb: number
  paprDb: number
}

export interface PowerStats {
  count: number
  min: number
  max: number
  mean: number
  rms: number
  peak: number
  peakToPeak: number
  /** dB 功率的峰值-均值；线性功率请由调用方自行换算 */
  paprDb: number
}

export class PowerBuffer {
  values: Float32Array
  length = 0
  /** 已被环形淘汰的样本数；绝对横坐标 = offset + localIndex */
  offset = 0
  private max: number

  constructor(maxPoints = 500_000) {
    this.max = Math.max(2, Math.floor(maxPoints))
    this.values = new Float32Array(this.max)
  }

  setMaxPoints(maxPoints: number): void {
    const next = Math.max(2, Math.floor(maxPoints))
    if (next === this.max) return
    const keep = Math.min(this.length, next)
    const dropped = this.length - keep
    const out = new Float32Array(next)
    if (keep > 0) out.set(this.values.subarray(this.length - keep, this.length))
    this.values = out
    this.length = keep
    this.offset += dropped
    this.max = next
  }

  append(src: Float32Array): void {
    const n = src.length
    if (n <= 0) return
    if (n >= this.max) {
      this.values.set(src.subarray(n - this.max))
      this.offset += this.length + n - this.max
      this.length = this.max
      return
    }
    const overflow = Math.max(0, this.length + n - this.max)
    if (overflow > 0) {
      this.values.copyWithin(0, overflow, this.length)
      this.offset += overflow
      this.length -= overflow
    }
    this.values.set(src, this.length)
    this.length += n
  }

  set(src: Float32Array): void {
    this.offset = 0
    this.length = 0
    this.append(src)
  }

  clear(): void {
    this.offset = 0
    this.length = 0
  }

  get xStart(): number {
    return this.offset
  }

  get xEnd(): number {
    return this.offset + Math.max(0, this.length - 1)
  }
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) ? v : 0
}

export function cleanPowerValues(src: ArrayLike<number>): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = finiteOrZero(Number(src[i]))
  return out
}

/** 峰值/均值/RMS/PAPR；按 dB 功率理解时 PAPR=max-mean */
export function computePowerStats(values: Float32Array, count = values.length): PowerStats {
  const n = Math.min(count, values.length)
  if (n <= 0)
    return { count: 0, min: 0, max: 0, mean: 0, rms: 0, peak: 0, peakToPeak: 0, paprDb: 0 }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sum2 = 0
  for (let i = 0; i < n; i++) {
    const v = finiteOrZero(values[i]!)
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sum2 += v * v
  }
  const mean = sum / n
  const rms = Math.sqrt(sum2 / n)
  return {
    count: n,
    min,
    max,
    mean,
    rms,
    peak: max,
    peakToPeak: max - min,
    paprDb: max - mean
  }
}

/** 门限+滞回检测脉冲；threshold/hysteresis 单位与输入一致（通常 dB） */
export function analyzePowerPulses(
  values: Float32Array,
  thresholdDb: number,
  hysteresisDb = 3,
  timeStepSec = 1,
  minWidthSec = 0,
  maxPulses = 512
): PulseAnalysis {
  const n = values.length
  const high = thresholdDb + Math.abs(hysteresisDb) / 2
  const low = thresholdDb - Math.abs(hysteresisDb) / 2
  const dt = timeStepSec > 0 ? timeStepSec : 1
  const pulses: PowerPulse[] = []
  let above = false
  let start = 0
  let peak = -Infinity
  let sum = 0
  let count = 0
  const close = (end: number): void => {
    if (!above || end < start) return
    const widthSamples = end - start + 1
    const widthSec = widthSamples * dt
    if (widthSec + 1e-18 >= minWidthSec)
      pulses.push({
        startIndex: start,
        endIndex: end,
        widthSamples,
        widthSec,
        startTimeSec: start * dt,
        endTimeSec: (end + 1) * dt,
        peakDb: count > 0 ? peak : thresholdDb,
        meanDb: count > 0 ? sum / count : thresholdDb
      })
  }
  for (let i = 0; i < n; i++) {
    const v = finiteOrZero(values[i]!)
    if (!above && v >= high) {
      above = true
      start = i
      peak = v
      sum = v
      count = 1
    } else if (above) {
      if (v <= low) {
        close(i - 1)
        above = false
        continue
      }
      if (v > peak) peak = v
      sum += v
      count++
    }
  }
  if (above) close(n - 1)
  const kept = pulses.length > maxPulses ? pulses.slice(pulses.length - maxPulses) : pulses
  const k = kept.length
  let widthSum = 0
  let periodSum = 0
  let dutySum = 0
  let peakAll = -Infinity
  let meanAll = 0
  for (let i = 0; i < k; i++) {
    const p = kept[i]!
    widthSum += p.widthSec
    dutySum += p.widthSec
    if (i > 0) periodSum += p.startTimeSec - kept[i - 1]!.startTimeSec
    peakAll = Math.max(peakAll, p.peakDb)
    meanAll += p.meanDb
  }
  const first = kept[0]
  const last = kept[k - 1]
  const span = first && last ? Math.max(1e-18, last.endTimeSec - first.startTimeSec) : 0
  const meanPulse = k > 0 ? meanAll / k : 0
  return {
    measured: k > 0,
    thresholdDb,
    hysteresisDb,
    pulses: kept,
    count: k,
    widthMeanSec: k > 0 ? widthSum / k : 0,
    periodMeanSec: k > 1 ? periodSum / (k - 1) : 0,
    dutyCycle: span > 0 ? dutySum / span : 0,
    pulseRateHz: periodSum > 0 ? (k - 1) / periodSum : 0,
    peakDb: k > 0 ? peakAll : 0,
    meanDb: meanPulse,
    paprDb: k > 0 ? peakAll - meanPulse : 0
  }
}
