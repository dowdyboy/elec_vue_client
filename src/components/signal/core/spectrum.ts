/**
 * 频谱迹线累计与峰值搜索（零依赖，可拷贝）
 *
 * SpectrumTraceBuffer：按迹线模式合并逐帧频谱
 * - clear：直通最新帧（内部 copy，调用方可复用输入缓冲）
 * - average：最近 N 帧滑动平均（Float64 求和降低精度损失；环形覆盖时先减旧值）
 * - maxHold / minHold：逐 bin 最大/最小保持
 * 帧长变化（fftSize 配置变更）时自动重置；模式/平均帧数切换以最新帧为种子重建，显示连续
 *
 * 峰值搜索（数据单位 dB/线性通用）：
 * - findPeak：区间最大点
 * - findPeaks：局部极大峰按幅度降序，支持绝对门限 threshold 与回落门限 excursion
 * - nextPeak：取低于当前峰 excursion 以上中的最高峰（"下一峰"）
 */

import type { SpectrumDetector, SpectrumTraceMode, SpectrumUnit } from './types'
import { snapRangeNice } from './axis'

export interface Peak {
  /** bin 索引 */
  bin: number
  /** 幅度（dB 或线性，随数据单位） */
  value: number
}

export interface FindPeaksOptions {
  /** 绝对门限：低于该值的峰忽略（缺省无门限） */
  threshold?: number
  /** 回落门限：峰值与已选更高峰之间最低谷的落差须达到该值，防肩峰/噪点（缺省 0） */
  excursion?: number
  /**
   * 参与回落门限筛选的候选峰上限（按幅度降序截断，缺省 128）。
   * 噪声谱的局部极大可达 bin 数的 1/3，全量做 O(k²·区间) 二次筛选会拖垮大 FFT 的每帧重绘；
   * 峰值表只需要最强的若干峰，截断后结果等价性对显示无影响。
   */
  maxCandidates?: number
}

export class SpectrumTraceBuffer {
  private mode: SpectrumTraceMode = 'clear'
  private frames = 16
  private len = 0
  private latest: Float32Array | null = null
  private maxH: Float32Array | null = null
  private minH: Float32Array | null = null
  private ring: Array<Float32Array | undefined> = []
  private ringPos = 0
  private ringFilled = 0
  private sum: Float64Array | null = null
  /** 平均语义：power=功率(RMS)平均（默认，真机口径）/ log=对数平均 */
  private avgMode: 'power' | 'log' = 'power'
  /** 数据域：true=dB（默认）/ false=线性幅度（power 平均在平方域/线性功率域进行） */
  private dbScale = true

  getMode(): SpectrumTraceMode {
    return this.mode
  }
  getAverageCount(): number {
    return this.frames
  }
  getLength(): number {
    return this.len
  }

  setMode(mode: SpectrumTraceMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.reseed()
  }

  setAverageCount(n: number): void {
    const c = Math.max(1, Math.min(1024, Math.round(n)))
    if (c === this.frames) return
    this.frames = c
    // 平均帧数只影响 average 模式；不要因为宿主调整参数把 maxHold/minHold 历史清掉
    if (this.mode === 'average') this.reseed()
  }

  /** 平均语义：power=功率(RMS)平均（默认）/ log=对数平均（切换以最新帧为种子） */
  setAverageMode(mode: 'power' | 'log'): void {
    if (mode === this.avgMode) return
    this.avgMode = mode
    if (this.mode === 'average') this.reseed()
  }

  /** 数据域（dB/线性）：power 平均需按域换算（切换以最新帧为种子） */
  setDbScale(db: boolean): void {
    if (db === this.dbScale) return
    this.dbScale = db
    this.reseed()
  }

  /** 样本 → 平均累加域（power: dB→线性功率 / 线性→平方；log: 原值） */
  private toAccum(v: number): number {
    if (this.avgMode === 'log') return v
    return this.dbScale ? Math.pow(10, v / 10) : v * v
  }

  /** 平均累加域 → 显示值 */
  private fromAccum(a: number): number {
    if (this.avgMode === 'log') return a
    return this.dbScale ? 10 * Math.log10(Math.max(a, 1e-30)) : Math.sqrt(Math.max(a, 0))
  }

  /** 推入一帧原始谱（长度变化自动重置） */
  push(frame: Float32Array): void {
    const n = frame.length
    if (n === 0) return
    if (n !== this.len) this.resetFields(n)
    const cur = frame.slice()
    this.latest = cur
    const mode = this.mode
    if (mode === 'clear') return
    if (mode === 'maxHold') {
      if (!this.maxH) {
        this.maxH = cur.slice()
        return
      }
      const h = this.maxH
      for (let i = 0; i < n; i++) if (cur[i]! > h[i]!) h[i] = cur[i]!
      return
    }
    if (mode === 'minHold') {
      if (!this.minH) {
        this.minH = cur.slice()
        return
      }
      const h = this.minH
      for (let i = 0; i < n; i++) if (cur[i]! < h[i]!) h[i] = cur[i]!
      return
    }
    // average：环形滑动平均
    if (this.frames <= 1) {
      // 单帧平均 = 直通最新帧。必须丢弃旧 sum，否则 get() 会一直返回 reseed 时的种子帧
      this.sum = null
      this.ring = []
      this.ringPos = 0
      this.ringFilled = 0
      return
    }
    if (!this.sum) {
      this.sum = new Float64Array(n)
      this.ring = new Array<Float32Array | undefined>(this.frames)
      this.ringPos = 0
      this.ringFilled = 0
    }
    const old = this.ring[this.ringPos]
    if (old) {
      for (let i = 0; i < n; i++) this.sum[i] -= this.toAccum(old[i]!)
    } else {
      this.ringFilled++
    }
    this.ring[this.ringPos] = cur
    for (let i = 0; i < n; i++) this.sum[i] += this.toAccum(cur[i]!)
    this.ringPos = (this.ringPos + 1) % this.frames
  }

  /** 当前显示迹线（按模式合并后；无数据返回 null） */
  get(): Float32Array | null {
    if (this.mode === 'clear' || !this.latest) return this.latest
    if (this.mode === 'maxHold') return this.maxH
    if (this.mode === 'minHold') return this.minH
    // average
    if (!this.sum || this.ringFilled <= 0) return this.latest
    const out = new Float32Array(this.len)
    const inv = 1 / this.ringFilled
    for (let i = 0; i < this.len; i++) out[i] = this.fromAccum(this.sum[i]! * inv)
    return out
  }

  /** 清空累计（保留当前帧长配置） */
  clear(): void {
    this.resetFields(this.len)
  }

  private resetFields(len: number): void {
    this.len = len
    this.latest = null
    this.maxH = null
    this.minH = null
    this.ring = []
    this.ringPos = 0
    this.ringFilled = 0
    this.sum = null
  }

  /** 模式/帧数切换：以最新帧为种子重建，避免切换瞬间黑屏 */
  private reseed(): void {
    this.maxH = null
    this.minH = null
    this.ring = []
    this.ringPos = 0
    this.ringFilled = 0
    this.sum = null
    const latest = this.latest
    if (!latest) return
    const n = latest.length
    if (this.mode === 'maxHold') this.maxH = latest.slice()
    else if (this.mode === 'minHold') this.minH = latest.slice()
    else if (this.mode === 'average') {
      this.ring = new Array<Float32Array | undefined>(Math.max(1, this.frames))
      this.ring[0] = latest.slice()
      this.ringPos = 1 % Math.max(1, this.frames)
      this.ringFilled = 1
      this.sum = new Float64Array(n)
      for (let i = 0; i < n; i++) this.sum[i] = this.toAccum(latest[i]!)
    }
  }
}

/** 区间内最大点；区间无效返回 null */
export function findPeak(data: Float32Array, s: number, e: number): Peak | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b <= a) return null
  let mi = a
  let mv = data[a]!
  for (let i = a + 1; i < b; i++) {
    const v = data[i]!
    if (v > mv) {
      mv = v
      mi = i
    }
  }
  return { bin: mi, value: mv }
}

/** 局部极大峰列表（按幅度降序；支持绝对门限与回落门限） */
export function findPeaks(
  data: Float32Array,
  s: number,
  e: number,
  opts: FindPeaksOptions = {}
): Peak[] {
  const a = Math.max(1, Math.floor(s))
  const b = Math.min(data.length - 1, Math.ceil(e))
  const peaks: Peak[] = []
  for (let i = a; i < b; i++) {
    const v = data[i]!
    if (v >= data[i - 1]! && v >= data[i + 1]!) peaks.push({ bin: i, value: v })
  }
  peaks.sort((x, y) => y.value - x.value)
  const threshold = opts.threshold ?? -Infinity
  const excursion = Math.max(0, opts.excursion ?? 0)
  // 只对最强的 maxCandidates 个候选做二次筛选，避免噪声谱 O(k²) 区间扫描
  const maxCandidates = Math.max(1, Math.floor(opts.maxCandidates ?? 128))
  if (peaks.length > maxCandidates) peaks.length = maxCandidates
  const selected: Peak[] = []
  for (const p of peaks) {
    if (p.value < threshold) continue
    let ok = true
    for (const q of selected) {
      const lo = Math.min(p.bin, q.bin)
      const hi = Math.max(p.bin, q.bin)
      let valley = Infinity
      for (let i = lo; i <= hi; i++) if (data[i]! < valley) valley = data[i]!
      if (p.value - valley < excursion) {
        ok = false
        break
      }
    }
    if (ok) selected.push(p)
  }
  return selected
}

/** 下一峰：幅度低于当前峰 excursion 以上中的最高峰；无则 null */
export function nextPeak(peaks: Peak[], from: Peak, excursion = 0): Peak | null {
  let best: Peak | null = null
  for (const p of peaks) {
    if (p.bin === from.bin) continue
    if (p.value > from.value - excursion) continue
    if (!best || p.value > best.value) best = p
  }
  return best
}

// ── 频率轴缩放窗口（真实 bin 域） ──

export interface ZoomWindow {
  min: number
  max: number
  /** 宽度达到全带宽：调用方应吸附全带宽并锁定平移 */
  full: boolean
}

/**
 * X 轴（频率/bin）缩放窗口：以**真实窗口**计算（不含显示留白，避免 unpad 造成的窗宽缩水）。
 * - 锚点保持在屏上同一相对位置
 * - 宽度钳制 [minSpan, total]；达到全带宽返回 full=true
 * @param factor >1 缩小（展宽）/ <1 放大
 * @param total 全带宽最大 bin（bufferLen - 1）
 */
export function zoomXWindow(
  realMin: number,
  realMax: number,
  anchor: number,
  factor: number,
  total: number,
  minSpan: number
): ZoomWindow {
  const width = Math.max(minSpan, realMax - realMin)
  const w = Math.min(Math.max(width * factor, minSpan), total)
  if (w >= total - 1e-9) return { min: 0, max: total, full: true }
  const ratio = Math.min(1, Math.max(0, (anchor - realMin) / width))
  const min = Math.min(Math.max(anchor - ratio * w, 0), total - w)
  return { min, max: min + w, full: false }
}

/**
 * Y 轴（幅度）光标锚定缩放：锚点在屏上的相对位置保持不变，跨度钳制 [minSpan, maxSpan]。
 * @param factor >1 缩小（展宽）/ <1 放大
 */
export function zoomYWindow(
  yMin: number,
  yMax: number,
  anchor: number,
  factor: number,
  minSpan: number,
  maxSpan: number
): { min: number; max: number } {
  const width = Math.max(minSpan, yMax - yMin)
  const w = Math.min(Math.max(width * factor, minSpan), Math.max(minSpan, maxSpan))
  const k = w / width
  return { min: anchor + (yMin - anchor) * k, max: anchor + (yMax - anchor) * k }
}

/** 区间稳健极值：峰值取真实最大（载波）；底部取 floorPct 分位，忽略单 bin 深谷噪声 */
export function robustMinMax(
  data: Float32Array,
  s: number,
  e: number,
  floorPct = 0.03
): { min: number; max: number } | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b <= a) return null
  const n = b - a
  const pct = Math.min(0.5, Math.max(0, floorPct))
  const k = Math.min(n - 1, Math.max(0, Math.floor(n * pct)))
  // 小样本/精确分位：直接排序（保持原有单测语义）
  if (n <= 4096 || pct === 0) {
    const copy = data.subarray(a, b).slice()
    copy.sort()
    return { min: copy[k]!, max: copy[n - 1]! }
  }
  // 大样本：单遍扫描求极值 + 256 桶直方图近似 floorPct，避免每帧 copy+sort 的 O(n log n) 分配
  let mn = Infinity
  let mx = -Infinity
  for (let i = a; i < b; i++) {
    const v = data[i]!
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const span = mx - mn
  if (!(span > 0)) return { min: mn, max: mx }
  const bins = 256
  const hist = new Int32Array(bins)
  const scale = bins / span
  for (let i = a; i < b; i++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((data[i]! - mn) * scale)))
    hist[idx]!++
  }
  let acc = 0
  for (let i = 0; i < bins; i++) {
    acc += hist[i]!
    if (acc > k) return { min: mn + (i * span) / bins, max: mx }
  }
  return { min: mn, max: mx }
}

// ── 频谱专用自动量程（稳定不抖；与 IqChart 的 YAutoScaler 独立） ──

export interface AutoRangeOptions {
  /** 最小量程（dB；默认 30，防止纯噪声下过度收紧） */
  minSpan?: number
  /** 顶部余量比例（默认 0.06，clamp 2~10 dB） */
  headroomRatio?: number
  /** 底部余量比例（默认 0.03，clamp 1~5 dB） */
  padRatio?: number
  /** 收窄所需连续稳定帧数（默认 180 ≈ 3s；越大越「粘」定） */
  shrinkDwell?: number
  /** 收窄比例：数据跨度 ≤ 档位跨度 × 该值才累计驻留（默认 0.55） */
  shrinkRatio?: number
  /** 收缩方向缓动比例（每帧向档位靠拢；默认 0.05，约 1.5~2s 平滑滑入；扩张瞬时） */
  shrinkRelease?: number
  /** 包络衰减比例（每帧，按包络跨度；默认 0.003） */
  envelopeDecay?: number
  /**
   * true=档位变化直接吸附，避免逐帧缓动造成 Y 轴刻度/网格连续漂移。
   * 默认 false 保留平滑语义；实时频谱建议开启。
   */
  snap?: boolean
}

/**
 * 频谱 Y 轴自动量程：
 * - 快攻慢释包络（max 立即升/缓降，min 立即降/缓升）抑制逐帧噪声抖动
 * - 量程「顶部锚定贴合」：top = 峰值 + 余量 上取整、bottom = 底沿 − 余量 下取整，
 *   档距取 1/2/5×10^k（≤15% 浪费），使底噪靠近底部、峰值靠近顶部（频谱仪观感）
 * - 档位量化 + 滞回 + 收窄驻留 + 保守收窄比例，杜绝边界翻转与伸缩对
 * - 缓动按数据帧在 update() 内推进（与绘制次数无关）：扩张瞬时（不裁切），收缩缓慢平滑
 */
export class SpectrumAutoRange {
  private readonly minSpan: number
  private readonly headroomRatio: number
  private readonly padRatio: number
  private readonly shrinkDwell: number
  private readonly shrinkRatio: number
  private readonly shrinkRelease: number
  private readonly decayRatio: number
  private readonly snapTier: boolean

  private db = true
  private envMin: number | null = null
  private envMax: number | null = null
  private tierRange: { min: number; max: number } | null = null
  private shownRange: { min: number; max: number } | null = null
  private streak = 0

  constructor(opts: AutoRangeOptions = {}) {
    this.minSpan = Math.max(1, opts.minSpan ?? 30)
    this.headroomRatio = Math.max(0, opts.headroomRatio ?? 0.06)
    this.padRatio = Math.max(0, opts.padRatio ?? 0.03)
    this.shrinkDwell = Math.max(1, Math.round(opts.shrinkDwell ?? 180))
    this.shrinkRatio = Math.min(0.95, Math.max(0.1, opts.shrinkRatio ?? 0.55))
    this.shrinkRelease = Math.min(0.9, Math.max(0.01, opts.shrinkRelease ?? 0.05))
    this.decayRatio = Math.max(0, opts.envelopeDecay ?? 0.003)
    this.snapTier = opts.snap === true
  }

  reset(): void {
    this.envMin = null
    this.envMax = null
    this.tierRange = null
    this.shownRange = null
    this.streak = 0
  }

  /**
   * 帧长/配置变化：清包络/档位/驻留但保留当前显示范围——
   * 下一帧以新数据重建档位，显示范围平滑衔接（不闪默认量程）
   */
  resetTier(): void {
    this.envMin = null
    this.envMax = null
    this.tierRange = null
    this.streak = 0
  }

  /** 仅重置收窄驻留（缩放/平移后调用，避免误收档） */
  resetShrink(): void {
    this.streak = 0
  }

  /** 每帧数据更新（可见区稳健极值）；db=false 为线性幅度模式 */
  update(min: number, max: number, db = true): void {
    if (!isFinite(min) || !isFinite(max) || max < min) return
    this.db = db
    if (this.envMin === null || this.envMax === null) {
      this.envMin = min
      this.envMax = max
      this.tierRange = this.snap(min, max)
      if (!this.shownRange) this.shownRange = { ...this.tierRange }
      this.easeToTier()
      this.streak = 0
      return
    }
    const span = Math.max(this.envMax - this.envMin, 1e-9)
    const decay = Math.max(span * this.decayRatio, 1e-9)
    this.envMax = Math.max(max, this.envMax - decay)
    this.envMin = Math.min(min, this.envMin + decay)
    const cand = this.snap(this.envMin, this.envMax)
    const tier = this.tierRange!
    const widen = cand.min < tier.min || cand.max > tier.max
    const candSpan = cand.max - cand.min
    const tierSpan = tier.max - tier.min
    if (widen) {
      this.tierRange = cand
      this.streak = 0
    } else if (candSpan <= tierSpan * this.shrinkRatio) {
      this.streak++
      if (this.streak >= this.shrinkDwell) {
        this.tierRange = cand
        this.streak = 0
      }
    } else {
      this.streak = 0
    }
    this.easeToTier()
  }

  /** 显示范围向档位靠拢：扩张瞬时（防裁切），收缩按 shrinkRelease 缓动（每帧一次） */
  private easeToTier(): void {
    const tier = this.tierRange
    const shown = this.shownRange
    if (!tier || !shown) return
    if (this.snapTier) {
      shown.min = tier.min
      shown.max = tier.max
      return
    }
    if (shown.min > tier.min) shown.min = tier.min
    else shown.min += (tier.min - shown.min) * this.shrinkRelease
    if (shown.max < tier.max) shown.max = tier.max
    else shown.max += (tier.max - shown.max) * this.shrinkRelease
  }

  /** 绘制用显示范围（纯读取，不在绘制侧推进状态）；未初始化返回 null */
  display(): { min: number; max: number } | null {
    if (!this.shownRange) return null
    return { min: this.shownRange.min, max: this.shownRange.max }
  }

  /** 当前档位（测试/诊断） */
  tier(): { min: number; max: number } | null {
    return this.tierRange ? { ...this.tierRange } : null
  }

  /**
   * 顶部锚定贴合量化：峰值 + headroom 上取、底沿 − pad 下取；
   * 档距从 {50,20,10,5,2,1} 取「不超过 15% 浪费的最大档」；
   * 最小量程 minSpan 兜底（从底部向下扩展，保持顶部锚定）
   */
  private snap(min: number, max: number): { min: number; max: number } {
    if (!this.db) {
      // 线性幅度：底部钉 0，顶部按 1/2/5 档上取
      const raw = Math.max(max, 1e-9) * 1.05
      const snapped = snapRangeNice(0, raw, 4)
      return { min: 0, max: Math.max(snapped.max, raw) }
    }
    const span = Math.max(0, max - min)
    const head = Math.min(10, Math.max(2, span * this.headroomRatio))
    const pad = Math.min(5, Math.max(1, span * this.padRatio))
    const rawTop = max + head
    const rawBottom = min - pad
    const rawSpan = Math.max(this.minSpan, rawTop - rawBottom)
    for (const s of [50, 20, 10, 5, 2, 1]) {
      const top = Math.ceil(rawTop / s) * s + 0 // +0 归一化 -0
      let bottom = Math.floor(rawBottom / s) * s + 0
      if (top - bottom < this.minSpan) bottom = top - Math.ceil(this.minSpan / s) * s
      if (top - bottom <= rawSpan * 1.15) return { min: bottom, max: top }
    }
    const top = Math.ceil(rawTop) + 0
    return { min: Math.min(Math.floor(rawBottom) + 0, top - this.minSpan), max: top }
  }
}

// ── 幅度显示单位换算（仅显示层；内部域为归一化 dBFS）──

/**
 * dBFS → 目标单位。
 * - dBFS：直通（0 dB = 满量程复单音，Mock 的默认口径）
 * - dBm：直通（0 dBFS 视作 0 dBm，需宿主用 ampOffsetDb 做绝对校准）
 * - 50Ω：dBmV=+46.99 / dBµV=+106.99；75Ω：+48.75 / +108.75；dBW=−30
 */
export function dbToUnit(v: number, unit: SpectrumUnit, impedance: 50 | 75 = 50): number {
  switch (unit) {
    case 'dBW':
      return v - 30
    case 'dBmV':
      return v + (impedance === 75 ? 48.75 : 46.99)
    case 'dBuV':
      return v + (impedance === 75 ? 108.75 : 106.99)
    default:
      return v
  }
}

/** 单位显示名（dBµV 用 µ 符号） */
export function unitLabel(unit: SpectrumUnit): string {
  return unit === 'dBuV' ? 'dBµV' : unit
}

// ── 视频带宽（VBW）滤波 ──

/**
 * 视频带宽滤波器：逐 bin 一阶 IIR 低通（帧间平滑），强度按 **VBW/RBW 比例**建模——
 * 真机的视频滤波效果取决于 VBW/RBW 比例（扫频过程平滑），与帧率无关；
 * 本工程每帧一条完整谱，用比例模型可复现同样的「旋钮手感」：
 * α = clamp(1 − VBW/RBW, 0, 0.95)，y = α·prev + (1−α)·x。
 * VBW≥RBW 直通（真机上此时滤波效果可忽略）；语义对齐仪器：先视频滤波、再做平均/保持累计。
 * 帧长变化 / 显式 reset 后，以当帧为种子重建（显示不跳变）。
 */
export class VbwFilter {
  private prev: Float32Array | null = null

  /**
   * @param frame 当前帧
   * @param vbwHz 视频带宽（0/undefined=关闭；≥rbwHz 视为关闭）
   * @param rbwHz 分辨带宽（bin 宽；未知时无法计算比例，视为关闭）
   */
  apply(frame: Float32Array, vbwHz: number | undefined, rbwHz: number | undefined): Float32Array {
    if (!vbwHz || vbwHz <= 0 || !rbwHz || rbwHz <= 0 || vbwHz >= rbwHz) {
      this.prev = null
      return frame
    }
    let prev = this.prev
    if (!prev || prev.length !== frame.length) {
      prev = frame.slice()
      this.prev = prev
      return frame
    }
    const alpha = Math.min(0.95, Math.max(0, 1 - vbwHz / rbwHz))
    const out = new Float32Array(frame.length)
    for (let i = 0; i < frame.length; i++) out[i] = prev[i]! * alpha + frame[i]! * (1 - alpha)
    this.prev = out
    return out
  }

  reset(): void {
    this.prev = null
  }
}

// ── 频谱测量（OBW / 信道功率 / N dB 带宽）──

/** 信道功率：区间内 dB bin 的线性功率和再转 dB（bin 视作等功率密度样本的简化口径） */
export function channelPowerDb(data: Float32Array, s: number, e: number): number | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b <= a) return null
  let sum = 0
  for (let i = a; i < b; i++) sum += Math.pow(10, data[i]! / 10)
  return 10 * Math.log10(Math.max(sum, 1e-30))
}

export interface ObwResult {
  /** 下/上边界（bin 索引域） */
  loBin: number
  hiBin: number
  /** 区间总功率 dB */
  totalDb: number
}

/** 占用带宽：区间总功率的 pct（默认 0.99）所在边界（两端各裁 (1-pct)/2 功率） */
export function occupiedBandwidth(
  data: Float32Array,
  s: number,
  e: number,
  pct = 0.99
): ObwResult | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b - a < 2) return null
  const n = b - a
  const p = new Float64Array(n)
  let total = 0
  for (let i = 0; i < n; i++) {
    p[i] = Math.pow(10, data[a + i]! / 10)
    total += p[i]!
  }
  if (!(total > 0)) return null
  const tail = (total * (1 - pct)) / 2
  let acc = 0
  let lo = a
  for (let i = 0; i < n; i++) {
    if (acc + p[i]! >= tail) {
      lo = a + i
      break
    }
    acc += p[i]!
    lo = a + i
  }
  acc = 0
  let hi = b - 1
  for (let i = n - 1; i >= 0; i--) {
    if (acc + p[i]! >= tail) {
      hi = a + i
      break
    }
    acc += p[i]!
    hi = a + i
  }
  if (hi < lo) return null
  return { loBin: lo, hiBin: hi, totalDb: 10 * Math.log10(total) }
}

export interface NdbResult {
  /** 左右穿越点（bin 索引域，线性插值） */
  loBin: number
  hiBin: number
  peakBin: number
  peakValue: number
}

export interface NdbOptions {
  /** 穿越判定前的轻度滑动平均窗（奇数；<3/缺省=不平滑。仅测量用，不改显示迹线） */
  smooth?: number
  /** 连续低于门限的点数才算穿越（缺省 1；用于忽略单 bin 噪谷） */
  hold?: number
}

/**
 * N dB 带宽：区间峰值左右 (peak - nDb) 的穿越点（默认 3 dB；线性插值亚 bin 精度）。
 * 抗噪增强（可选）：smooth 轻度平滑 + hold 连续低于门限确认——穿越检测在（平滑后的）包络上进行，
 * 避免噪声迹线上单 bin 噪谷导致的虚假窄带宽；返回 peakBin/peakValue 仍为**原始峰值**（与显示一致）。
 */
export function ndbBandwidth(
  data: Float32Array,
  s: number,
  e: number,
  nDb = 3,
  opts: NdbOptions = {}
): NdbResult | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b - a < 2) return null
  const rawPk = findPeak(data, a, b)
  if (!rawPk) return null
  const n = b - a
  // 工作副本（可选轻度平滑；前缀和实现，边缘窗收缩）
  let work: Float32Array
  const smooth = Math.floor(opts.smooth ?? 0)
  if (smooth >= 3) {
    const w = smooth % 2 === 0 ? smooth + 1 : smooth
    const half = (w - 1) >> 1
    const pre = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + data[a + i]!
    work = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half)
      const hi = Math.min(n, i + half + 1)
      work[i] = (pre[hi]! - pre[lo]!) / (hi - lo)
    }
  } else {
    work = data.subarray(a, b)
  }
  // 包络峰值（平滑时以包络为口径）
  let pkIdx = 0
  let pkVal = work[0]!
  for (let i = 1; i < n; i++) {
    if (work[i]! > pkVal) {
      pkVal = work[i]!
      pkIdx = i
    }
  }
  const lvl = pkVal - nDb
  const hold = Math.max(1, Math.floor(opts.hold ?? 1))
  const belowRun = (k: number, dir: -1 | 1): boolean => {
    for (let j = 0; j < hold; j++) {
      const idx = k + dir * j
      if (idx < 0 || idx >= n) return true // 触边界视为确认
      if (work[idx]! > lvl) return false
    }
    return true
  }
  let lo = a
  for (let k = pkIdx - 1; k >= 0; k--) {
    if (work[k]! <= lvl && belowRun(k, -1)) {
      const d = work[k + 1]! - work[k]!
      lo = a + k + (d !== 0 ? (lvl - work[k]!) / d : 0)
      break
    }
    lo = a + k
  }
  let hi = b - 1
  for (let k = pkIdx + 1; k < n; k++) {
    if (work[k]! <= lvl && belowRun(k, 1)) {
      const d = work[k]! - work[k - 1]!
      hi = a + k - (d !== 0 ? (work[k]! - lvl) / d : 0)
      break
    }
    hi = a + k
  }
  if (hi <= lo) return null
  return { loBin: lo, hiBin: hi, peakBin: rawPk.bin, peakValue: rawPk.value }
}

// ── 检波器（抽稀时每像素桶取值方式）──

/**
 * 检波感知抽稀：窗口内 bin 数超过目标像素数时按检波器逐桶取值。
 * - minmax：每桶输出 min/max 两点（保持原索引顺序；默认，与旧版行为一致）
 * - posPeak / negPeak：桶内最大/最小（正峰/负峰检波）
 * - sample：桶首样本（采样检波）
 * - rms：功率(RMS)平均——dB 域按 10^(v/10) 线性功率平均，线性域按平方平均开方
 * - average：桶内算术平均（dB 域对数平均）
 * 桶数不足（len ≤ target）时直接返回原切片（全分辨率）。
 */
export function decimateTrace(
  data: Float32Array,
  s: number,
  e: number,
  target: number,
  mode: SpectrumDetector = 'minmax',
  dbScale = true
): Float32Array {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  const len = b - a
  if (len <= 0) return data.subarray(0, 0) as Float32Array
  if (len <= target || mode === 'minmax') {
    if (mode === 'minmax') {
      if (len <= target) return data.subarray(a, b)
      const n = Math.max(1, Math.min(target, len))
      const out = new Float32Array(n * 2)
      let oi = 0
      const bucket = len / n
      for (let k = 0; k < n; k++) {
        const bs = a + Math.floor(k * bucket)
        const be = Math.min(b, a + Math.max(bs - a + 1, Math.floor((k + 1) * bucket)))
        let mn = Infinity
        let mx = -Infinity
        let mnIdx = bs
        let mxIdx = bs
        for (let j = bs; j < be; j++) {
          const v = data[j]!
          if (v < mn) {
            mn = v
            mnIdx = j
          }
          if (v > mx) {
            mx = v
            mxIdx = j
          }
        }
        if (!isFinite(mn)) continue
        if (mnIdx <= mxIdx) {
          out[oi++] = mn
          out[oi++] = mx
        } else {
          out[oi++] = mx
          out[oi++] = mn
        }
      }
      return out.subarray(0, oi)
    }
    return data.subarray(a, b)
  }
  const n = Math.max(1, Math.min(target, len))
  const out = new Float32Array(n)
  const bucket = len / n
  for (let k = 0; k < n; k++) {
    const bs = a + Math.floor(k * bucket)
    const be = Math.min(b, a + Math.max(bs - a + 1, Math.floor((k + 1) * bucket)))
    const cnt = be - bs
    let v = data[bs]!
    if (mode === 'posPeak') {
      let mx = -Infinity
      for (let j = bs; j < be; j++) if (data[j]! > mx) mx = data[j]!
      v = mx
    } else if (mode === 'negPeak') {
      let mn = Infinity
      for (let j = bs; j < be; j++) if (data[j]! < mn) mn = data[j]!
      v = mn
    } else if (mode === 'sample') {
      v = data[bs]!
    } else if (mode === 'rms') {
      let acc = 0
      if (dbScale) {
        for (let j = bs; j < be; j++) acc += Math.pow(10, data[j]! / 10)
        v = 10 * Math.log10(Math.max(acc / cnt, 1e-30))
      } else {
        for (let j = bs; j < be; j++) {
          const x = data[j]!
          acc += x * x
        }
        v = Math.sqrt(Math.max(acc / cnt, 0))
      }
    } else {
      // average：对数平均
      let acc = 0
      for (let j = bs; j < be; j++) acc += data[j]!
      v = acc / cnt
    }
    out[k] = v
  }
  return out
}

// ── 区间统计 / ACPR / 限制线 ──

export interface BandStats {
  /** 区间总功率 dB */
  powerDb: number
  /** 功率谱密度 dB/Hz（按 RBW=binHz 简化，未做 ENBW 归一） */
  densityDbPerHz: number
}

/** 区间统计：总功率 + 功率谱密度（dBm/Hz 口径，调用方按显示单位自行换算） */
export function bandStats(
  data: Float32Array,
  s: number,
  e: number,
  binHz: number
): BandStats | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e))
  if (b <= a || !(binHz > 0)) return null
  let sum = 0
  for (let i = a; i < b; i++) sum += Math.pow(10, data[i]! / 10)
  const powerDb = 10 * Math.log10(Math.max(sum, 1e-30))
  const bw = (b - a) * binHz
  return { powerDb, densityDbPerHz: powerDb - 10 * Math.log10(Math.max(bw, 1e-9)) }
}

export interface AcprBands {
  mainDb: number
  lowerDb: number
  upperDb: number
}

/**
 * ACPR 三信道功率（bin 域）。
 * - 主信道：`[c−mh, c+mh]`（2·mh+1 bin）
 * - 邻信道：`[c−mh−2·ah, c−mh−1]` / `[c+mh+1, c+mh+2·ah]`（各 2·ah bin）
 *
 * `adjHalfBins` 是**半带宽**（与 `mainHalfBins` 同口径）；邻道必须取 2·ah 个 bin，
 * 否则同带宽设置下邻道只积分一半，ACPR 会系统性偏好约 3 dB（旧实现的问题）。
 */
export function acprBands(
  data: Float32Array,
  s: number,
  e: number,
  centerBin: number,
  mainHalfBins: number,
  adjHalfBins = mainHalfBins
): AcprBands | null {
  if (!(mainHalfBins >= 1) || !(adjHalfBins >= 1)) return null
  const c = Math.round(centerBin)
  const seg = (lo: number, hi: number): number | null =>
    channelPowerDb(data, Math.max(s, lo), Math.min(e, hi + 1))
  const m = seg(c - mainHalfBins, c + mainHalfBins)
  const lo = seg(c - mainHalfBins - 2 * adjHalfBins, c - mainHalfBins - 1)
  const up = seg(c + mainHalfBins + 1, c + mainHalfBins + 2 * adjHalfBins)
  if (m === null || lo === null || up === null) return null
  return { mainDb: m, lowerDb: lo, upperDb: up }
}

/** 限制线顶点（bin 升序）线性插值到全 bin；两端水平延伸。无有效顶点返回 null */
export function buildLimitArray(
  points: Array<{ bin: number; level: number }>,
  n: number
): Float32Array | null {
  if (!points.length || n <= 0) return null
  const pts = points.slice().sort((p, q) => p.bin - q.bin)
  const out = new Float32Array(n)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  let pi = 0
  for (let i = 0; i < n; i++) {
    if (i <= first.bin) {
      out[i] = first.level
      continue
    }
    if (i >= last.bin) {
      out[i] = last.level
      continue
    }
    while (pi < pts.length - 1 && pts[pi + 1]!.bin < i) pi++
    const p0 = pts[pi]!
    const p1 = pts[pi + 1]!
    const t = (i - p0.bin) / Math.max(1e-9, p1.bin - p0.bin)
    out[i] = p0.level + (p1.level - p0.level) * t
  }
  return out
}

export interface LimitResult {
  pass: boolean
  /** 违例点数 */
  violations: number
  /** 最差余量 dB（正=有裕量；负=超限幅度） */
  worstMarginDb: number
}

/** 限制线判定：upper → data>limit 违例（余量=limit−data）；lower → data<limit 违例（余量=data−limit） */
export function evaluateLimit(
  data: Float32Array,
  s: number,
  e: number,
  limit: Float32Array,
  type: 'upper' | 'lower' = 'upper'
): LimitResult | null {
  const a = Math.max(0, Math.floor(s))
  const b = Math.min(data.length, Math.ceil(e), limit.length)
  if (b <= a) return null
  let violations = 0
  let worst = Infinity
  for (let i = a; i < b; i++) {
    const margin = type === 'upper' ? limit[i]! - data[i]! : data[i]! - limit[i]!
    if (margin < 0) violations++
    if (margin < worst) worst = margin
  }
  return { pass: violations === 0, violations, worstMarginDb: worst === Infinity ? 0 : worst }
}
