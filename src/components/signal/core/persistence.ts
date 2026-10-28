/**
 * 持续谱/密度谱核心：
 * - PersistenceBuffer：频率(bin) × 幅度(level) 的命中计数矩阵
 * - addSpectrum：把一帧 dB 谱累加到矩阵；可选逐帧衰减
 * - setMatrix：纯显示路径直接接收调用方算好的密度矩阵
 * - normalize：计数 → [0,1]（log1p + gamma），供色阶 LUT
 * 不做 FFT/检波；频谱帧由调用方给出。
 */

export interface PersistenceMatrixInput {
  density: ArrayLike<number>
  width: number
  height: number
  minDb?: number
  maxDb?: number
}

export interface PersistenceStats {
  width: number
  height: number
  frames: number
  max: number
  total: number
  occupied: number
}

export interface PersistenceBufferOptions {
  width?: number
  height?: number
  minDb?: number
  maxDb?: number
  /** 每帧先乘 (1-decay)；0=不衰减 */
  decay?: number
}

export class PersistenceBuffer {
  width: number
  height: number
  density: Float32Array
  frames = 0
  minDb: number
  maxDb: number
  decay: number

  constructor(opts: PersistenceBufferOptions = {}) {
    this.width = Math.max(2, Math.floor(opts.width ?? 512))
    this.height = Math.max(2, Math.floor(opts.height ?? 256))
    this.minDb = Number.isFinite(opts.minDb) ? (opts.minDb as number) : -120
    this.maxDb = Number.isFinite(opts.maxDb) ? (opts.maxDb as number) : 0
    this.decay = Math.min(0.99, Math.max(0, opts.decay ?? 0))
    this.density = new Float32Array(this.width * this.height)
  }

  configure(opts: PersistenceBufferOptions): void {
    const width = opts.width !== undefined ? Math.max(2, Math.floor(opts.width)) : this.width
    const height = opts.height !== undefined ? Math.max(2, Math.floor(opts.height)) : this.height
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.density = new Float32Array(width * height)
      this.frames = 0
    }
    if (Number.isFinite(opts.minDb)) this.minDb = opts.minDb as number
    if (Number.isFinite(opts.maxDb)) this.maxDb = opts.maxDb as number
    if (Number.isFinite(opts.decay)) this.decay = Math.min(0.99, Math.max(0, opts.decay as number))
  }

  addSpectrum(values: ArrayLike<number>, opts: { minDb?: number; maxDb?: number } = {}): void {
    const minDb = Number.isFinite(opts.minDb) ? (opts.minDb as number) : this.minDb
    const maxDb = Number.isFinite(opts.maxDb) ? (opts.maxDb as number) : this.maxDb
    const width = Math.min(this.width, values.length)
    if (width <= 0 || !(maxDb > minDb)) return
    if (this.decay > 0) {
      const f = 1 - this.decay
      const d = this.density
      for (let i = 0; i < d.length; i++) d[i] = d[i]! * f
    }
    const h = this.height
    const scale = (h - 1) / (maxDb - minDb)
    for (let i = 0; i < width; i++) {
      const v = Number(values[i])
      if (!Number.isFinite(v)) continue
      const clamped = v < minDb ? minDb : v > maxDb ? maxDb : v
      const level = Math.max(0, Math.min(h - 1, Math.round((clamped - minDb) * scale)))
      this.density[level * this.width + i] = this.density[level * this.width + i]! + 1
    }
    this.frames++
  }

  setMatrix(m: PersistenceMatrixInput): void {
    this.width = Math.max(2, Math.floor(m.width))
    this.height = Math.max(2, Math.floor(m.height))
    if (Number.isFinite(m.minDb)) this.minDb = m.minDb as number
    if (Number.isFinite(m.maxDb)) this.maxDb = m.maxDb as number
    const out = new Float32Array(this.width * this.height)
    const n = Math.min(out.length, m.density.length)
    for (let i = 0; i < n; i++) {
      const v = Number(m.density[i])
      out[i] = Number.isFinite(v) ? v : 0
    }
    this.density = out
    this.frames = 0
  }

  clear(): void {
    this.density.fill(0)
    this.frames = 0
  }

  getStats(): PersistenceStats {
    let max = 0
    let total = 0
    let occupied = 0
    for (let i = 0; i < this.density.length; i++) {
      const v = this.density[i]!
      if (v <= 0) continue
      occupied++
      total += v
      if (v > max) max = v
    }
    return { width: this.width, height: this.height, frames: this.frames, max, total, occupied }
  }

  /** 计数 → 0..1；log1p 保留低计数，gamma>1 压暗低密度 */
  normalize(gamma = 1): Float32Array {
    const out = new Float32Array(this.density.length)
    const max = this.getStats().max
    if (!(max > 0)) return out
    const denom = Math.log1p(max)
    const g = Math.max(0.2, Math.min(3, gamma))
    for (let i = 0; i < out.length; i++) {
      const v = this.density[i]!
      if (v <= 0) continue
      const t = Math.log1p(v) / denom
      out[i] = Math.pow(t, g)
    }
    return out
  }
}
