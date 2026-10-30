/**
 * 扫频 S11 源（网络分析演示）
 * 生成等间隔频点的复反射系数 Γ，供 Smith 圆图使用。
 * 与 IQ SourceFrame 属于不同测量域；不混入 source:frame。
 */

export interface SweepConfig {
  startHz: number
  stopHz: number
  points: number
  z0: number
  /** 串联 RLC 负载参数 */
  rOhm: number
  lHenry: number
  cFarad: number
}

export interface SweepFrame {
  seq: number
  timestamp: number
  frequencies: Float32Array
  gammaI: Float32Array
  gammaQ: Float32Array
  z0: number
  model: 'series-rlc'
}

export function defaultSweepConfig(): SweepConfig {
  return {
    startHz: 1e6,
    stopHz: 500e6,
    points: 401,
    z0: 50,
    rOhm: 25,
    lHenry: 100e-9,
    cFarad: 5e-12
  }
}

export function sanitizeSweepConfig(patch: unknown): {
  ok: boolean
  error?: string
  value?: Partial<SweepConfig>
} {
  if (!patch || typeof patch !== 'object') return { ok: false, error: '配置须为对象' }
  const src = patch as Record<string, unknown>
  const out: Partial<SweepConfig> = {}
  const num = (k: string): number | null => {
    const v = src[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  if ('startHz' in src) {
    const v = num('startHz')
    if (v === null || v < 1 || v > 1e12) return { ok: false, error: 'startHz 非法' }
    out.startHz = v
  }
  if ('stopHz' in src) {
    const v = num('stopHz')
    if (v === null || v < 1 || v > 1e12) return { ok: false, error: 'stopHz 非法' }
    out.stopHz = v
  }
  if ('points' in src) {
    const v = num('points')
    if (v === null || v < 11 || v > 20001) return { ok: false, error: 'points 须为 11~20001' }
    out.points = Math.floor(v)
  }
  if ('z0' in src) {
    const v = num('z0')
    if (v === null || v <= 0 || v > 10000) return { ok: false, error: 'z0 非法' }
    out.z0 = v
  }
  if ('rOhm' in src) {
    const v = num('rOhm')
    if (v === null || v < 0 || v > 1e6) return { ok: false, error: 'rOhm 非法' }
    out.rOhm = v
  }
  if ('lHenry' in src) {
    const v = num('lHenry')
    if (v === null || v < 0 || v > 1) return { ok: false, error: 'lHenry 非法' }
    out.lHenry = v
  }
  if ('cFarad' in src) {
    const v = num('cFarad')
    if (v === null || v < 0 || v > 1) return { ok: false, error: 'cFarad 非法' }
    out.cFarad = v
  }
  const merged = { ...defaultSweepConfig(), ...out }
  if (merged.stopHz <= merged.startHz) return { ok: false, error: 'stopHz 须大于 startHz' }
  return { ok: true, value: out }
}

/** 生成一帧串联 RLC 的 S11 扫频 */
export function makeSweepFrame(
  config: SweepConfig,
  seq: number,
  timestamp = Date.now()
): SweepFrame {
  const n = Math.max(2, Math.floor(config.points))
  const frequencies = new Float32Array(n)
  const gammaI = new Float32Array(n)
  const gammaQ = new Float32Array(n)
  const z0 = config.z0
  for (let k = 0; k < n; k++) {
    const f = config.startHz + ((config.stopHz - config.startHz) * k) / (n - 1)
    const w = 2 * Math.PI * f
    const x = w * config.lHenry - (config.cFarad > 0 ? 1 / (w * config.cFarad) : 0)
    const zr = config.rOhm
    const zx = x
    const dr = zr + z0
    const di = zx
    const den = dr * dr + di * di
    gammaI[k] = ((zr - z0) * dr + zx * di) / den
    gammaQ[k] = (zx * dr - (zr - z0) * di) / den
    frequencies[k] = f
  }
  return { seq, timestamp, frequencies, gammaI, gammaQ, z0, model: 'series-rlc' }
}

export class SweepGenerator {
  private seq = 0
  private config: SweepConfig

  constructor(config?: Partial<SweepConfig>) {
    this.config = { ...defaultSweepConfig(), ...config }
  }

  setConfig(patch: Partial<SweepConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  getConfig(): SweepConfig {
    return { ...this.config }
  }

  next(now = Date.now()): SweepFrame {
    return makeSweepFrame(this.config, ++this.seq, now)
  }
}
