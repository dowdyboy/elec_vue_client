/**
 * 时频（瀑布）纯核心：色阶 LUT、dB→强度映射、行环形缓冲。
 * 零 DOM / 零 Vue，可单测、可拷入 Worker。
 *
 * 数据契约：每行是服务端算好的 dB 值 Float32Array（长度 = fftSize/2，固定 -120~0 dBFS 口径）。
 * 色阶映射统一归一化到 [0,1]，由 gamma 与 level range 控制；LUT 输出 RGBA。
 */
import type { ColorMap } from './types'

export interface ColorStop {
  t: number
  r: number
  g: number
  b: number
}

/** 生产级色阶控制点（线性插值；t ∈ [0,1]） */
const STOPS: Record<ColorMap, ColorStop[]> = {
  viridis: [
    { t: 0, r: 68, g: 1, b: 84 },
    { t: 0.13, r: 71, g: 44, b: 122 },
    { t: 0.25, r: 59, g: 82, b: 139 },
    { t: 0.38, r: 44, g: 113, b: 142 },
    { t: 0.5, r: 33, g: 145, b: 140 },
    { t: 0.63, r: 39, g: 173, b: 129 },
    { t: 0.75, r: 94, g: 201, b: 98 },
    { t: 0.88, r: 173, g: 220, b: 48 },
    { t: 1, r: 253, g: 231, b: 37 }
  ],
  turbo: [
    { t: 0, r: 48, g: 18, b: 59 },
    { t: 0.13, r: 70, g: 134, b: 251 },
    { t: 0.25, r: 27, g: 229, b: 181 },
    { t: 0.38, r: 94, g: 255, b: 88 },
    { t: 0.5, r: 175, g: 240, b: 35 },
    { t: 0.63, r: 236, g: 177, b: 35 },
    { t: 0.75, r: 251, g: 106, b: 19 },
    { t: 0.88, r: 210, g: 39, b: 10 },
    { t: 1, r: 122, g: 4, b: 3 }
  ],
  jet: [
    { t: 0, r: 0, g: 0, b: 131 },
    { t: 0.125, r: 0, g: 0, b: 255 },
    { t: 0.375, r: 0, g: 255, b: 255 },
    { t: 0.625, r: 255, g: 255, b: 0 },
    { t: 0.875, r: 255, g: 0, b: 0 },
    { t: 1, r: 128, g: 0, b: 0 }
  ],
  grayscale: [
    { t: 0, r: 0, g: 0, b: 0 },
    { t: 1, r: 255, g: 255, b: 255 }
  ],
  hot: [
    { t: 0, r: 0, g: 0, b: 0 },
    { t: 0.33, r: 255, g: 0, b: 0 },
    { t: 0.66, r: 255, g: 255, b: 0 },
    { t: 1, r: 255, g: 255, b: 255 }
  ]
}

export const COLOR_MAPS: ColorMap[] = ['viridis', 'turbo', 'jet', 'grayscale', 'hot']

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 取色（0..1），返回 0..255；非法 t 按边界裁剪 */
export function colorAt(t: number, map: ColorMap): [number, number, number] {
  const stops = STOPS[map] ?? STOPS.viridis
  const x = clamp01(Number.isFinite(t) ? t : 0)
  let i = 0
  while (i < stops.length - 1 && x > stops[i + 1]!.t) i++
  const a = stops[i]!
  const b = stops[Math.min(stops.length - 1, i + 1)]!
  const span = b.t - a.t
  const f = span > 1e-9 ? (x - a.t) / span : 0
  return [
    Math.round(a.r + (b.r - a.r) * f),
    Math.round(a.g + (b.g - a.g) * f),
    Math.round(a.b + (b.b - a.b) * f)
  ]
}

/** 生成 size×4 的 RGBA LUT（Canvas ImageData / WebGL 纹理共用） */
export function colorMapLut(map: ColorMap, size = 256): Uint8ClampedArray {
  const n = Math.max(2, Math.floor(size))
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colorAt(i / (n - 1), map)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

/** 把 RGBA LUT 转为 Uint32 视图（供 ImageData 快速写像素；按本机字节序自动正确） */
export function lutToUint32(lut: Uint8ClampedArray): Uint32Array {
  const n = Math.floor(lut.length / 4)
  const out = new Uint32Array(n)
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
  for (let i = 0; i < n; i++) {
    const r = lut[i * 4]!
    const g = lut[i * 4 + 1]!
    const b = lut[i * 4 + 2]!
    const a = lut[i * 4 + 3]!
    // ImageData 内存布局固定为 R,G,B,A；Uint32 视图按本机字节序解释
    out[i] = littleEndian
      ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
  }
  return out
}

/** dB → [0,255] 强度；NaN/Inf 视为下限（避免污染色阶） */
export function levelToByte(db: number, min: number, max: number, gamma = 1, levels = 256): number {
  const n = Math.max(2, Math.floor(levels)) - 1
  if (!Number.isFinite(db)) return 0
  const span = max - min
  if (!(span > 1e-12)) return 0
  let t = (db - min) / span
  t = clamp01(t)
  if (gamma > 0 && Math.abs(gamma - 1) > 1e-9) t = Math.pow(t, 1 / gamma)
  return Math.round(t * n)
}

/** 整行 dB → 强度字节（复用 out，避免每帧分配） */
export function mapRowToBytes(
  row: Float32Array,
  min: number,
  max: number,
  gamma: number,
  out: Uint8Array
): Uint8Array {
  const n = Math.min(row.length, out.length)
  for (let i = 0; i < n; i++) out[i] = levelToByte(row[i]!, min, max, gamma, 256)
  return out
}

/**
 * 时频行环形缓冲。
 * - `cols` 由首行决定；行长变化 → 自动重置（防止 fftSize 变更后混行）
 * - `capacity` 为最大保留行数；`seq` 为累计接收行数
 * - 最新行下标 = head-1；按 age（0=最新）读取
 */
export class SpectrogramBuffer {
  cols = 0
  capacity = 1
  count = 0
  seq = 0
  data: Float32Array
  private head = 0

  constructor(capacity = 256) {
    const c = Number.isFinite(capacity) ? Math.floor(capacity) : 256
    this.capacity = Math.max(1, c)
    this.data = new Float32Array(0)
  }

  /** 配置列数/容量；列数变化会清空，仅容量变化保留最新行 */
  configure(cols: number, capacity: number): boolean {
    const c = Math.max(1, Number.isFinite(capacity) ? Math.floor(capacity) : this.capacity)
    const colN = Number.isFinite(cols) ? Math.floor(cols) : 0
    if (colN > 0 && colN !== this.cols) {
      this.cols = colN
      this.capacity = c
      this.data = new Float32Array(this.cols * this.capacity)
      this.count = 0
      this.seq = 0
      this.head = 0
      return true
    }
    if (c !== this.capacity) {
      const keep = Math.min(this.count, c)
      const next = new Float32Array(this.cols * c)
      for (let age = keep - 1; age >= 0; age--) {
        // 按最老→最新写入新缓冲
        const row = this.rowAt(age)
        if (!row) continue
        const target = keep - 1 - age
        next.set(row, target * this.cols)
      }
      this.data = next
      this.capacity = c
      this.count = keep
      this.head = keep % c
      return false
    }
    return false
  }

  clear(): void {
    this.count = 0
    this.seq = 0
    this.head = 0
    this.data.fill(0)
  }

  /** 推入一行；返回 false 表示行长非法（被丢弃） */
  push(row: Float32Array): boolean {
    if (!row || row.length === 0) return false
    if (this.cols === 0) {
      this.cols = row.length
      this.data = new Float32Array(this.cols * this.capacity)
    }
    if (row.length !== this.cols) return false
    const off = this.head * this.cols
    this.data.set(row, off)
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
    this.seq++
    return true
  }

  /** age=0 最新；返回的 Float32Array 是内部视图，调用方不要修改 */
  rowAt(age: number): Float32Array | null {
    if (age < 0 || age >= this.count) return null
    const slot = (this.head - 1 - age + this.capacity * 2) % this.capacity
    return this.data.subarray(slot * this.cols, slot * this.cols + this.cols)
  }

  /** 最新行的槽位（供 WebGL 纹理上传） */
  newestSlot(): number {
    if (this.count === 0) return 0
    return (this.head - 1 + this.capacity) % this.capacity
  }

  slotForAge(age: number): number {
    return (this.newestSlot() - age + this.capacity * 2) % this.capacity
  }

  /** 可见行数（不超过 timeSpan） */
  displayCount(timeSpan: number): number {
    const ts = Number.isFinite(timeSpan) ? Math.floor(timeSpan) : this.count
    return Math.min(this.count, Math.max(1, ts))
  }

  /** 最新 count 行（newest→oldest）的拷贝，用于冻结/导出 */
  copyRows(count: number): Float32Array[] {
    const n = Math.min(this.count, Math.max(0, Math.floor(count)))
    const out: Float32Array[] = []
    for (let age = 0; age < n; age++) {
      const row = this.rowAt(age)
      if (row) out.push(row.slice())
    }
    return out
  }
}
