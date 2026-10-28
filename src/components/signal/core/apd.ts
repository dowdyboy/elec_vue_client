/**
 * APD / CCDF 核心：
 * - 输入功率样本（dB 或线性），输出幅度概率分布与互补累积分布
 * - 不做 FFT/解调；样本由调用方给出
 */
import type { ApdCcdfData, ApdCurve } from './types'

export interface ApdOptions {
  bins?: number
  minDb?: number
  maxDb?: number
  linear?: boolean
}

function emptyData(): ApdCcdfData {
  const empty: ApdCurve = { x: new Float32Array(0), y: new Float32Array(0) }
  return {
    apd: empty,
    ccdf: empty,
    meanDb: 0,
    peakDb: 0,
    paprDb: 0,
    p01Db: 0,
    p1Db: 0,
    sampleCount: 0
  }
}

function ccdfLevel(x: Float32Array, y: Float32Array, pct: number): number {
  if (x.length === 0) return 0
  // x 升序、CCDF 递减；从高功率端向下找第一个“超限概率 >= pct”的电平
  for (let i = x.length - 1; i >= 0; i--) {
    if (y[i]! >= pct) return x[i]!
  }
  return x[0]!
}

export function computeApdCcdf(samples: ArrayLike<number>, opts: ApdOptions = {}): ApdCcdfData {
  const vals: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const v = Number(samples[i])
    if (!Number.isFinite(v)) continue
    if (opts.linear) {
      if (v <= 0) continue
      vals.push(10 * Math.log10(v))
    } else {
      vals.push(v)
    }
  }
  const n = vals.length
  if (n === 0) return emptyData()
  let min = Number.isFinite(opts.minDb) ? (opts.minDb as number) : Infinity
  let max = Number.isFinite(opts.maxDb) ? (opts.maxDb as number) : -Infinity
  if (!Number.isFinite(opts.minDb) || !Number.isFinite(opts.maxDb)) {
    let a = Infinity
    let b = -Infinity
    for (const v of vals) {
      if (v < a) a = v
      if (v > b) b = v
    }
    if (!Number.isFinite(opts.minDb)) min = a
    if (!Number.isFinite(opts.maxDb)) max = b
    if (!(max > min)) {
      min -= 0.5
      max += 0.5
    }
  }
  if (!(max > min)) {
    min -= 0.5
    max += 0.5
  }
  const bins = Math.max(4, Math.min(2048, Math.floor(opts.bins ?? 100)))
  const step = (max - min) / bins
  const counts = new Uint32Array(bins)
  let sumDb = 0
  let peak = -Infinity
  for (const v of vals) {
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((v - min) / step)))
    counts[idx]!++
    sumDb += v
    if (v > peak) peak = v
  }
  const x = new Float32Array(bins)
  const apdY = new Float32Array(bins)
  const ccdfY = new Float32Array(bins)
  let suffix = 0
  for (let i = bins - 1; i >= 0; i--) {
    suffix += counts[i]!
    ccdfY[i] = (suffix / n) * 100
  }
  for (let i = 0; i < bins; i++) {
    x[i] = min + (i + 0.5) * step
    apdY[i] = (counts[i]! / n) * 100
  }
  const meanDb = sumDb / n
  return {
    apd: { x, y: apdY },
    ccdf: { x, y: ccdfY },
    meanDb,
    peakDb: peak,
    paprDb: peak - meanDb,
    p01Db: ccdfLevel(x, ccdfY, 0.1),
    p1Db: ccdfLevel(x, ccdfY, 1),
    sampleCount: n
  }
}
