/**
 * 星座图核心（零依赖，可单测）：
 * - ConstellationBuffer：定长环形缓冲（按点淘汰，供实时 IQ 流）
 * - autoConstellationRange：以 0 为中心的对称自动量程（1/2/5 档位）
 * - equalizeRange：按绘图区宽高比扩展范围，保证 I/Q 单位长度一致（不被拉成椭圆）
 * - sampleConstellation：绘制抽点，缓冲不丢点
 * - computeConstellationStats：I/Q 极值、RMS、功率、峰值
 */
import { niceStep, snapRangeNice } from './axis'

export interface ConstellationRange {
  min: number
  max: number
}

/** 实时星座点缓冲：超过上限后丢弃最老的点 */
export class ConstellationBuffer {
  private iData: Float32Array
  private qData: Float32Array
  private count = 0
  private max: number
  /** 数据版本：抽点缓存/重绘判断 */
  version = 0

  constructor(maxPoints = 500_000) {
    this.max = clampMax(maxPoints)
    this.iData = new Float32Array(this.max)
    this.qData = new Float32Array(this.max)
  }

  get length(): number {
    return this.count
  }
  get maxPoints(): number {
    return this.max
  }
  get i(): Float32Array {
    return this.iData.subarray(0, this.count)
  }
  get q(): Float32Array {
    return this.qData.subarray(0, this.count)
  }

  clear(): void {
    this.count = 0
    this.version++
  }

  /** 调整上限（保留最新数据） */
  setMaxPoints(maxPoints: number): void {
    const next = clampMax(maxPoints)
    if (next === this.max) return
    const keep = Math.min(this.count, next)
    const ni = new Float32Array(next)
    const nq = new Float32Array(next)
    ni.set(this.iData.subarray(this.count - keep, this.count))
    nq.set(this.qData.subarray(this.count - keep, this.count))
    this.iData = ni
    this.qData = nq
    this.max = next
    this.count = keep
    this.version++
  }

  append(i: Float32Array, q: Float32Array): number {
    const n = Math.min(i.length, q.length)
    if (n <= 0) return 0
    const take = Math.min(n, this.max)
    // 只保留本次输入的最后 max 个点（极端大帧）
    const srcOff = n - take
    const overflow = Math.max(0, this.count + take - this.max)
    if (overflow > 0) {
      this.iData.copyWithin(0, overflow, this.count)
      this.qData.copyWithin(0, overflow, this.count)
      this.count -= overflow
    }
    this.iData.set(i.subarray(srcOff, srcOff + take), this.count)
    this.qData.set(q.subarray(srcOff, srcOff + take), this.count)
    this.count += take
    this.version++
    return take
  }
}

function clampMax(v: number): number {
  const n = Math.floor(Number.isFinite(v) ? v : 500_000)
  return Math.max(1, Math.min(4_000_000, n))
}

/** 以 0 为中心、带余量的对称自动量程；全零输入回退 [-1,1] */
export function autoConstellationRange(
  i: Float32Array,
  q: Float32Array,
  len = Math.min(i.length, q.length),
  pad = 0.12,
  targetTicks = 6
): ConstellationRange {
  const n = Math.max(0, Math.min(len, i.length, q.length))
  let maxAbs = 0
  for (let k = 0; k < n; k++) {
    const a = Math.abs(i[k]!)
    const b = Math.abs(q[k]!)
    if (a > maxAbs) maxAbs = a
    if (b > maxAbs) maxAbs = b
  }
  if (!isFinite(maxAbs)) maxAbs = 0
  if (maxAbs < 1e-12) return { min: -1, max: 1 }
  const half = Math.max(1e-9, maxAbs * (1 + Math.max(0, pad)))
  const snapped = snapRangeNice(-half, half, Math.max(2, targetTicks))
  // 保持视觉中心严格在 (0,0)
  const m = Math.max(Math.abs(snapped.min), Math.abs(snapped.max))
  return { min: -m, max: m }
}

export interface ConstellationAutoRangeOptions {
  /** 收窄滞回比例（默认 0.2；候选跨度小于当前跨度 80% 才考虑收窄） */
  hysteresis?: number
  /** 收窄驻留帧数（默认 180；随机调制峰值边界不来回切档） */
  holdFrames?: number
}

/**
 * 星座自动量程稳定器：
 * - 扩张即时（不裁切）
 * - 收窄必须连续满足滞回 + 驻留；随机 QAM/QPSK 极值在档位边界附近不会逐帧翻转
 * - 自身不做逐帧缓动，显示范围只在换档时离散变化
 */
export class ConstellationAutoRange {
  private cur: ConstellationRange | null = null
  private streak = 0
  private readonly hysteresis: number
  private readonly holdFrames: number

  constructor(opts: ConstellationAutoRangeOptions = {}) {
    this.hysteresis = Math.min(0.8, Math.max(0, opts.hysteresis ?? 0.2))
    this.holdFrames = Math.max(1, Math.round(opts.holdFrames ?? 180))
  }

  reset(): void {
    this.cur = null
    this.streak = 0
  }

  resolve(target: ConstellationRange): ConstellationRange {
    if (!(target.max > target.min) || !isFinite(target.min) || !isFinite(target.max)) {
      return this.cur ? { ...this.cur } : { min: -1, max: 1 }
    }
    if (!this.cur) {
      this.cur = { ...target }
      this.streak = 0
      return { ...this.cur }
    }
    const curSpan = this.cur.max - this.cur.min
    const targetSpan = target.max - target.min
    if (targetSpan > curSpan) {
      this.cur = { ...target }
      this.streak = 0
    } else if (targetSpan <= curSpan * (1 - this.hysteresis)) {
      this.streak++
      if (this.streak >= this.holdFrames) {
        this.cur = { ...target }
        this.streak = 0
      }
    } else {
      this.streak = 0
    }
    return { ...this.cur }
  }
}

/**
 * 让 I/Q 的单位长度在屏幕上一致：
 * 绘图区越宽，x 范围同比放宽（或 y 范围放宽），避免星座被拉成椭圆。
 * 中心点保持不变。
 */
export function equalizeRange(
  x: ConstellationRange,
  y: ConstellationRange,
  aspect: number
): { x: ConstellationRange; y: ConstellationRange } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  let xs = x.max - x.min
  let ys = y.max - y.min
  if (!(xs > 0) || !(ys > 0)) return { x: { ...x }, y: { ...y } }
  const cx = (x.min + x.max) / 2
  const cy = (y.min + y.max) / 2
  if (xs / ys > a) ys = xs / a
  else xs = ys * a
  return {
    x: { min: cx - xs / 2, max: cx + xs / 2 },
    y: { min: cy - ys / 2, max: cy + ys / 2 }
  }
}

export interface SampledConstellation {
  i: Float32Array
  q: Float32Array
  count: number
}

/** 均匀抽点（只影响绘制，不修改缓冲）；len<=max 时返回原数组视图 */
export function sampleConstellation(
  i: Float32Array,
  q: Float32Array,
  len: number,
  max: number
): SampledConstellation {
  const n = Math.max(0, Math.min(len, i.length, q.length))
  const limit = Math.max(1, Math.floor(max))
  if (n <= limit) return { i: i.subarray(0, n), q: q.subarray(0, n), count: n }
  const si = new Float32Array(limit)
  const sq = new Float32Array(limit)
  const stride = n / limit
  for (let k = 0; k < limit; k++) {
    const idx = Math.min(n - 1, Math.floor(k * stride))
    si[k] = i[idx]!
    sq[k] = q[idx]!
  }
  return { i: si, q: sq, count: limit }
}

export interface ConstellationStatsData {
  points: number
  iMin: number
  iMax: number
  qMin: number
  qMax: number
  iRms: number
  qRms: number
  power: number
  powerDbfs: number
  peak: number
}

/** 全缓冲统计（调用方按需调用，不在每帧路径） */
export function computeConstellationStats(
  i: Float32Array,
  q: Float32Array,
  len = Math.min(i.length, q.length)
): ConstellationStatsData {
  const n = Math.max(0, Math.min(len, i.length, q.length))
  if (n === 0)
    return {
      points: 0,
      iMin: 0,
      iMax: 0,
      qMin: 0,
      qMax: 0,
      iRms: 0,
      qRms: 0,
      power: 0,
      powerDbfs: -120,
      peak: 0
    }
  let iMin = Infinity
  let iMax = -Infinity
  let qMin = Infinity
  let qMax = -Infinity
  let si = 0
  let sq = 0
  let peak = 0
  for (let k = 0; k < n; k++) {
    const a = i[k]!
    const b = q[k]!
    if (a < iMin) iMin = a
    if (a > iMax) iMax = a
    if (b < qMin) qMin = b
    if (b > qMax) qMax = b
    si += a * a
    sq += b * b
    const p = a * a + b * b
    if (p > peak) peak = p
  }
  const power = (si + sq) / n
  return {
    points: n,
    iMin,
    iMax,
    qMin,
    qMax,
    iRms: Math.sqrt(si / n),
    qRms: Math.sqrt(sq / n),
    power,
    powerDbfs: power > 0 ? 10 * Math.log10(power) : -120,
    peak: Math.sqrt(peak)
  }
}

/** 刻度步长格式（1/2/5×10^k，避免浮点尾数） */
export function formatConstellationTick(v: number, range: ConstellationRange): string {
  const step = niceStep(range.max - range.min, 5)
  if (Math.abs(v) < step * 1e-6) return '0'
  if (step >= 1) return v.toFixed(0)
  const dec = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
  return v.toFixed(dec)
}
