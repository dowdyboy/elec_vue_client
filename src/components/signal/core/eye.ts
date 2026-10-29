/**
 * 眼图核心：
 * - EyeBuffer：固定数量眼图轨迹的环形缓冲
 * - computeEyeStats：从已切好的眼图轨迹估计眼高/眼宽/交叉抖动
 * 不做时钟恢复/均衡；这些属于调用方或后续分析模块。
 */

export interface EyeStats {
  measured: boolean
  traceCount: number
  samples: number
  min: number
  max: number
  /** 眼高：中心采样点 p5~p95 张开量 */
  height: number
  /** 归一化眼高（0~1，相对全幅度） */
  opening: number
  /** 眼宽：中心附近 p5~p95 张开超过阈值的最长连续区间（0~1） */
  width: number
  /** 交叉点抖动 RMS（0~1，按轨迹长度归一化） */
  jitter: number
  /** 交叉点抖动的 UI 值（按 2UI 眼图默认换算；组件可按 span 再换算） */
  jitterUi: number
}

export class EyeBuffer {
  traces: Float32Array[] = []
  private max: number

  constructor(maxTraces = 500) {
    this.max = Math.max(1, Math.floor(maxTraces))
  }

  setMaxTraces(n: number): void {
    const next = Math.max(1, Math.floor(n))
    this.max = next
    if (this.traces.length > next) this.traces.splice(0, this.traces.length - next)
  }

  append(trace: Float32Array): void {
    if (trace.length < 2) return
    this.traces.push(trace)
    if (this.traces.length > this.max) this.traces.splice(0, this.traces.length - this.max)
  }

  set(traces: Float32Array[]): void {
    this.traces = traces.filter((t) => t.length >= 2).slice(-this.max)
  }

  clear(): void {
    this.traces = []
  }

  get length(): number {
    return this.traces.length
  }
}

/** 清洗非有限值；保留 NaN 会破坏折线，统一置 0 */
export function cleanEyeTrace(src: ArrayLike<number>): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const v = Number(src[i])
    out[i] = Number.isFinite(v) ? v : 0
  }
  return out
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]!
}

/**
 * 眼高/眼宽/抖动估计：
 * - 眼高：张开最大的采样位置 p5~p95
 * - 眼宽：该位置附近 p5~p95 张开 >= 25% 眼高的连续区间
 * - 抖动：每条轨迹首次穿过中点的时间差 RMS
 */
export function computeEyeStats(traces: Float32Array[], spanSymbols = 2): EyeStats {
  const n = traces.length
  if (n === 0)
    return {
      measured: false,
      traceCount: 0,
      samples: 0,
      min: 0,
      max: 0,
      height: 0,
      opening: 0,
      width: 0,
      jitter: 0,
      jitterUi: 0
    }
  let maxLen = 0
  let min = Infinity
  let max = -Infinity
  for (const t of traces) {
    if (t.length > maxLen) maxLen = t.length
    for (let i = 0; i < t.length; i++) {
      const v = t[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!(maxLen > 1)) {
    return {
      measured: false,
      traceCount: n,
      samples: maxLen,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      height: 0,
      opening: 0,
      width: 0,
      jitter: 0,
      jitterUi: 0
    }
  }
  const amplitude = Math.max(1e-12, max - min)
  const mid = (min + max) / 2

  // 各采样位置的眼张开；取张开最大的位置作为眼图中心
  const sep = new Float32Array(maxLen)
  const midFrac = new Float32Array(maxLen)
  const band = Math.max(1e-12, amplitude * 0.15)
  const vals: number[] = []
  let bestIndex = 0
  for (let x = 0; x < maxLen; x++) {
    vals.length = 0
    for (const t of traces) {
      if (x < t.length) vals.push(t[x]!)
    }
    vals.sort((a, b) => a - b)
    sep[x] = percentile(vals, 0.95) - percentile(vals, 0.05)
    let midCount = 0
    for (const v of vals) if (Math.abs(v - mid) <= band) midCount++
    midFrac[x] = vals.length > 0 ? midCount / vals.length : 0
    if (sep[x]! > sep[bestIndex]!) bestIndex = x
  }
  const height = Math.max(0, sep[bestIndex]!)
  const opening = Math.min(1, height / amplitude)
  const threshold = Math.max(1e-12, height * 0.25)
  let left = bestIndex
  let right = bestIndex
  if (height > 0) {
    // 眼宽：围绕张开最大处，扩展“经过中点附近的轨迹比例 <= 20%”的连续区间
    while (left > 0 && sep[left - 1]! >= threshold && midFrac[left - 1]! <= 0.2) left--
    while (right < maxLen - 1 && sep[right + 1]! >= threshold && midFrac[right + 1]! <= 0.2) right++
  }
  const width = height > 0 ? (right - left + 1) / maxLen : 0

  // 首次过中点，计算抖动
  const crossings: number[] = []
  for (const t of traces) {
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1]!
      const b = t[i]!
      if ((a - mid) * (b - mid) <= 0 && a !== b) {
        const frac = Math.abs(mid - a) / Math.max(1e-12, Math.abs(b - a))
        crossings.push(i - 1 + frac)
        break
      }
    }
  }
  let jitter = 0
  if (crossings.length > 1) {
    const mean = crossings.reduce((s, v) => s + v, 0) / crossings.length
    const variance = crossings.reduce((s, v) => s + (v - mean) * (v - mean), 0) / crossings.length
    jitter = Math.sqrt(variance) / Math.max(1, maxLen - 1)
  }
  return {
    measured: true,
    traceCount: n,
    samples: maxLen,
    min,
    max,
    height,
    opening,
    width,
    jitter,
    jitterUi: jitter * Math.max(1, spanSymbols)
  }
}
