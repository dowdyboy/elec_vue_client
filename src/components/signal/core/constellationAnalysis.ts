/**
 * 星座分析仪核心（零依赖，可单测）
 *
 * 纯显示路径不调用本模块；调用方显式传 analysis 时才启用：
 * - 中心频率下变频 / 可选残余载波频偏估计
 * - 符号定时相位搜索（最小 EVM）/ 判决点抽取
 * - EVM/MER、幅度/相位误差、IQ 增益/相位不平衡
 *
 * 约束：这是“分析仪”层，不是源/采集层。输入仍是原始复数 IQ；
 * 不负责解调比特、信道解码、协议解析。
 */
import { derotateIQ } from './constellation'
import type {
  ConstellationAnalysisConfig,
  ConstellationAnalysisStats,
  ConstellationModulation
} from './types'

const TAU = Math.PI * 2
const MER_MAX_DB = 120

export interface ConstellationAnalyzerOptions {
  modulation: ConstellationModulation
  sampleRate: number
  centerFrequencyHz: number
  frequencyOffsetHz: number
  phaseOffsetDeg: number
  symbolRateHz: number
  samplesPerSymbol: number
  autoCarrier: boolean
  autoSymbolTiming: boolean
  estimatorSymbols: number
}

export interface ResolvedConstellationAnalysis {
  options: ConstellationAnalyzerOptions
  /** 输入配置缺少采样率/符号率时不可用 */
  valid: boolean
  error?: string
}

/** 把可选的 analysis 配置解析为分析仪参数；纯显示路径不应调用 */
export function resolveAnalysisConfig(
  cfg: ConstellationAnalysisConfig,
  fallback: { sampleRate?: number; carrierHz?: number; samplesPerSymbol?: number } = {}
): ResolvedConstellationAnalysis {
  const sampleRate = positive(cfg.sampleRate ?? fallback.sampleRate)
  const centerFrequencyHz = finite(cfg.centerFrequencyHz ?? fallback.carrierHz, 0)
  const providedSps = positive(cfg.samplesPerSymbol ?? fallback.samplesPerSymbol)
  const providedRate = positive(cfg.symbolRateHz)
  let samplesPerSymbol = providedSps
  let symbolRateHz = providedRate
  if (!symbolRateHz && samplesPerSymbol > 0 && sampleRate > 0)
    symbolRateHz = sampleRate / samplesPerSymbol
  if (!samplesPerSymbol && symbolRateHz > 0 && sampleRate > 0)
    samplesPerSymbol = sampleRate / symbolRateHz
  if (!(samplesPerSymbol > 0)) samplesPerSymbol = 1
  const options: ConstellationAnalyzerOptions = {
    modulation: cfg.modulation ?? 'QPSK',
    sampleRate,
    centerFrequencyHz,
    frequencyOffsetHz: finite(cfg.frequencyOffsetHz, 0),
    phaseOffsetDeg: finite(cfg.phaseOffsetDeg, 0),
    symbolRateHz: symbolRateHz || (sampleRate > 0 ? sampleRate / samplesPerSymbol : 0),
    samplesPerSymbol,
    autoCarrier: cfg.autoCarrier === true,
    autoSymbolTiming: cfg.autoSymbolTiming === true,
    estimatorSymbols: Math.max(16, Math.floor(cfg.estimatorSymbols ?? 4096))
  }
  if (!(sampleRate > 0)) return { options, valid: false, error: 'analysis.sampleRate 必须大于 0' }
  if (!(providedSps > 0) && !(providedRate > 0))
    return {
      options,
      valid: false,
      error: 'analysis.symbolRateHz 或 analysis.samplesPerSymbol 必须提供'
    }
  if (!(samplesPerSymbol > 0))
    return { options, valid: false, error: 'analysis.symbolRateHz/samplesPerSymbol 必须大于 0' }
  return { options, valid: true }
}

function finite(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function positive(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

interface RefPoint {
  i: number
  q: number
  mag: number
}

/** 理想参考点（归一化到平均功率 1；16QAM 与 Mock 生成器一致 ±1/±3 / √10） */
export function referencePoints(mod: ConstellationModulation): RefPoint[] {
  if (mod === 'BPSK') {
    const pts = [
      { i: 1, q: 0 },
      { i: -1, q: 0 }
    ]
    return pts.map((p) => ({ ...p, mag: 1 }))
  }
  if (mod === '16QAM') {
    const lv = [-3, -1, 1, 3]
    const inv = 1 / Math.sqrt(10)
    const out: RefPoint[] = []
    for (const i of lv)
      for (const q of lv) out.push({ i: i * inv, q: q * inv, mag: Math.hypot(i, q) * inv })
    return out
  }
  const s = Math.SQRT1_2
  return [
    { i: s, q: s, mag: 1 },
    { i: -s, q: s, mag: 1 },
    { i: -s, q: -s, mag: 1 },
    { i: s, q: -s, mag: 1 }
  ]
}

/** 由 z^M 相邻自相关估计载波/残余频偏（仅作粗估计；分析仪内部改用判决点相位斜率） */
export function estimateCarrierOffset(
  i: Float32Array,
  q: Float32Array,
  mod: ConstellationModulation,
  sampleRate: number
): number {
  const n = Math.min(i.length, q.length)
  if (!(sampleRate > 0) || n < 4) return 0
  const m = mod === 'BPSK' ? 2 : 4
  let pr = 0
  let pi = 0
  let accR = 0
  let accI = 0
  let has = false
  for (let k = 0; k < n; k++) {
    const iv = i[k]!
    const qv = q[k]!
    if (!Number.isFinite(iv) || !Number.isFinite(qv)) continue
    const a2 = iv * iv + qv * qv
    if (a2 < 1e-12) continue
    const ph = m * Math.atan2(qv, iv)
    // 幅度加权：RRC 过渡点幅度低，减少其对载波估计的牵引
    const amp = Math.pow(a2, m / 2)
    const zr = amp * Math.cos(ph)
    const zi = amp * Math.sin(ph)
    if (has) {
      // z * conj(prev)
      accR += zr * pr + zi * pi
      accI += zi * pr - zr * pi
    }
    pr = zr
    pi = zi
    has = true
  }
  if (!has || (Math.abs(accR) < 1e-12 && Math.abs(accI) < 1e-12)) return 0
  const off = (Math.atan2(accI, accR) / (TAU * m)) * sampleRate
  const limit = sampleRate / (2 * m)
  return Math.max(-limit, Math.min(limit, off))
}

/**
 * 在候选残余频偏上做 EVM 搜索（BPSK/QPSK/16QAM 通用）。
 * 用于分析仪首帧：中心频率已大致对准时，残余频偏一般在 ±symbolRate/4 内。
 */
export function estimateCarrierOffsetByEvm(
  i: Float32Array,
  q: Float32Array,
  mod: ConstellationModulation,
  symbolRateHz: number
): number {
  const n = Math.min(i.length, q.length)
  if (!(symbolRateHz > 0) || n < 16) return 0
  const max = symbolRateHz / 8
  const step = Math.max(0.25, symbolRateHz / 1024)
  let best = 0
  let bestEvm = Infinity
  const ri = new Float32Array(n)
  const rq = new Float32Array(n)
  for (let f = -max; f <= max; f += step) {
    const wStep = (TAU * f) / symbolRateHz
    let w = 0
    for (let k = 0; k < n; k++) {
      const c = Math.cos(w)
      const s = Math.sin(w)
      const iv = i[k]!
      const qv = q[k]!
      ri[k] = iv * c + qv * s
      rq[k] = qv * c - iv * s
      w += wStep
    }
    const m = computeEvm(ri, rq, mod, n)
    if (m.evmRms < bestEvm) {
      bestEvm = m.evmRms
      best = f
    }
  }
  return best
}

/** 按符号周期抽取判决点；sps 可为小数，phase 为下一帧起点（0..sps） */
export function extractSymbolsAt(
  i: Float32Array,
  q: Float32Array,
  samplesPerSymbol: number,
  phase = 0
): { i: Float32Array; q: Float32Array; count: number; nextPhase: number } {
  const n = Math.min(i.length, q.length)
  const sps = Math.max(1e-6, samplesPerSymbol)
  if (n === 0) return { i: i.subarray(0, 0), q: q.subarray(0, 0), count: 0, nextPhase: phase }
  let p = Math.max(0, phase)
  const idx: number[] = []
  while (p < n) {
    const k = Math.min(n - 1, Math.round(p))
    if (!idx.length || idx[idx.length - 1] !== k) idx.push(k)
    p += sps
  }
  const oi = new Float32Array(idx.length)
  const oq = new Float32Array(idx.length)
  for (let j = 0; j < idx.length; j++) {
    oi[j] = i[idx[j]!]!
    oq[j] = q[idx[j]!]!
  }
  let next = p - n
  if (next < 0) next = 0
  if (next >= sps) next %= sps
  return { i: oi, q: oq, count: idx.length, nextPhase: next }
}

interface EvmResult {
  evmRms: number
  magnitudeErrorRms: number
  phaseErrorRmsDeg: number
  iqGainImbalanceDb: number
  iqPhaseImbalanceDeg: number
  count: number
}

/** 用最近理想点计算 EVM/幅度/相位误差/IQ 不平衡（自动尝试星座相位旋转） */
export function computeEvm(
  i: Float32Array,
  q: Float32Array,
  mod: ConstellationModulation,
  count = Math.min(i.length, q.length)
): EvmResult {
  const n = Math.max(0, Math.min(count, i.length, q.length))
  if (n === 0)
    return {
      evmRms: 0,
      magnitudeErrorRms: 0,
      phaseErrorRmsDeg: 0,
      iqGainImbalanceDb: 0,
      iqPhaseImbalanceDeg: 0,
      count: 0
    }
  let energy = 0
  for (let k = 0; k < n; k++) {
    const iv = i[k]!
    const qv = q[k]!
    energy += iv * iv + qv * qv
  }
  const rms = Math.sqrt(Math.max(1e-18, energy / n))
  const refs = referencePoints(mod)
  const rotations = mod === 'BPSK' ? 2 : 4
  let best: EvmResult | null = null
  for (let rot = 0; rot < rotations; rot++) {
    const ang = (rot * Math.PI) / 2
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    let err2 = 0
    let mag2 = 0
    let phase2 = 0
    let rpi = 0
    let rpq = 0
    let rcross = 0
    for (let k = 0; k < n; k++) {
      // 把测量点旋转到参考坐标系
      const iv = i[k]!
      const qv = q[k]!
      const ri = iv * c + qv * s
      const rq = -iv * s + qv * c
      rpi += ri * ri
      rpq += rq * rq
      rcross += ri * rq
      let bestRef = refs[0]!
      let bestD = Infinity
      for (const r of refs) {
        const d = (ri - r.i) ** 2 + (rq - r.q) ** 2
        if (d < bestD) {
          bestD = d
          bestRef = r
        }
      }
      const ei = ri - bestRef.i
      const eq = rq - bestRef.q
      err2 += ei * ei + eq * eq
      const magDiff = Math.hypot(ri, rq) - bestRef.mag
      mag2 += magDiff * magDiff
      const crossPhase = rq * bestRef.i - ri * bestRef.q
      const dotPhase = ri * bestRef.i + rq * bestRef.q
      const ph = Math.atan2(crossPhase, Math.max(1e-18, dotPhase))
      phase2 += ph * ph
    }
    rpi /= n
    rpq /= n
    rcross /= n
    const evm = Math.sqrt(err2 / n) / rms
    const cand: EvmResult = {
      evmRms: evm,
      magnitudeErrorRms: Math.sqrt(mag2 / n) / rms,
      phaseErrorRmsDeg: (Math.sqrt(phase2 / n) * 180) / Math.PI,
      iqGainImbalanceDb: rpq > 0 ? 10 * Math.log10(Math.max(1e-18, rpi) / rpq) : 0,
      iqPhaseImbalanceDeg:
        (Math.asin(Math.max(-1, Math.min(1, (2 * rcross) / Math.max(1e-18, rpi + rpq)))) * 180) /
        Math.PI,
      count: n
    }
    if (!best || cand.evmRms < best.evmRms) best = cand
  }
  return best!
}

/** 搜索符号定时相位：取 EVM 最小的整数采样偏移 */
export function estimateTimingOffset(
  i: Float32Array,
  q: Float32Array,
  samplesPerSymbol: number,
  mod: ConstellationModulation
): number {
  const sps = Math.max(1, samplesPerSymbol)
  if (sps <= 1) return 0
  let best = 0
  let bestEvm = Infinity
  const span = Math.max(1, Math.ceil(sps))
  for (let off = 0; off < span; off++) {
    const sy = extractSymbolsAt(i, q, sps, off)
    if (sy.count < 4) continue
    const m = computeEvm(sy.i, sy.q, mod, sy.count)
    if (m.evmRms < bestEvm) {
      bestEvm = m.evmRms
      best = off
    }
  }
  return best
}

function rotateIQ(
  i: Float32Array,
  q: Float32Array,
  angleRad: number
): { i: Float32Array; q: Float32Array } {
  if (!Number.isFinite(angleRad) || Math.abs(angleRad) < 1e-15) return { i, q }
  const c = Math.cos(-angleRad)
  const s = Math.sin(-angleRad)
  const oi = new Float32Array(i.length)
  const oq = new Float32Array(q.length)
  for (let k = 0; k < i.length; k++) {
    const iv = i[k]!
    const qv = q[k]!
    oi[k] = iv * c + qv * s
    oq[k] = -iv * s + qv * c
  }
  return { i: oi, q: oq }
}

/**
 * 有状态星座分析仪：
 * - center/frequencyOffset 通过 NCO 连续下变频
 * - autoCarrier 在首帧用 z^M 自相关估计残余频偏
 * - autoSymbolTiming 首帧搜索最小 EVM 定时相位
 * - 指标在最近 estimatorSymbols 个判决点上计算
 */
export class ConstellationAnalyzer {
  readonly options: ConstellationAnalyzerOptions
  private ncoPhase = 0
  private carrierOffsetHz = 0
  private carrierEstimated = false
  private timingPhase = 0
  private timingEstimated = false
  private symI = new Float32Array(0)
  private symQ = new Float32Array(0)
  private symLen = 0
  private stat: ConstellationAnalysisStats

  constructor(options: ConstellationAnalyzerOptions) {
    this.options = options
    this.symI = new Float32Array(options.estimatorSymbols)
    this.symQ = new Float32Array(options.estimatorSymbols)
    this.carrierOffsetHz = options.frequencyOffsetHz
    this.stat = this.emptyStats()
  }

  reset(): void {
    this.ncoPhase = 0
    this.carrierOffsetHz = this.options.frequencyOffsetHz
    this.carrierEstimated = false
    this.timingPhase = 0
    this.timingEstimated = false
    this.symLen = 0
    this.stat = this.emptyStats()
  }

  private emptyStats(): ConstellationAnalysisStats {
    return {
      measured: false,
      modulation: this.options.modulation,
      symbolRateHz: this.options.symbolRateHz,
      samplesPerSymbol: this.options.samplesPerSymbol,
      carrierOffsetHz: 0,
      symbolTimingOffset: 0,
      symbolCount: 0,
      evmRms: 0,
      evmPercent: 0,
      merDb: MER_MAX_DB,
      magnitudeErrorRms: 0,
      phaseErrorRmsDeg: 0,
      iqGainImbalanceDb: 0,
      iqPhaseImbalanceDeg: 0
    }
  }

  /** 处理一帧原始 IQ（可带载波），返回判决点与当前分析指标 */
  process(
    i: Float32Array,
    q: Float32Array
  ): { symbols: { i: Float32Array; q: Float32Array }; stats: ConstellationAnalysisStats } {
    const opt = this.options
    const n = Math.min(i.length, q.length)
    if (n === 0)
      return { symbols: { i: i.subarray(0, 0), q: q.subarray(0, 0) }, stats: { ...this.stat } }
    const center = opt.centerFrequencyHz
    if (opt.autoCarrier && !this.carrierEstimated) {
      // 第一遍：用标称中心频率 + 手动频偏粗抽判决点，再用判决点估计残余频偏。
      // RRC 过渡点的相位不是理想 QPSK，直接用全采样 z^M 估计会被拉偏。
      const probe = derotateIQ(i, q, center + opt.frequencyOffsetHz, opt.sampleRate, 0)
      const probePhased = rotateIQ(probe.i, probe.q, (opt.phaseOffsetDeg * Math.PI) / 180)
      const probeTiming = opt.autoSymbolTiming
        ? estimateTimingOffset(probePhased.i, probePhased.q, opt.samplesPerSymbol, opt.modulation)
        : 0
      const probeSymbols = extractSymbolsAt(
        probePhased.i,
        probePhased.q,
        opt.samplesPerSymbol,
        probeTiming
      )
      const residual =
        probeSymbols.count >= 16
          ? estimateCarrierOffsetByEvm(
              probeSymbols.i,
              probeSymbols.q,
              opt.modulation,
              opt.symbolRateHz
            )
          : 0
      this.carrierOffsetHz = opt.frequencyOffsetHz + residual
      this.carrierEstimated = true
      this.ncoPhase = 0
      this.timingPhase = 0
      this.timingEstimated = false
    } else if (!opt.autoCarrier) {
      this.carrierOffsetHz = opt.frequencyOffsetHz
    }
    const totalCarrier = center + this.carrierOffsetHz
    const base = derotateIQ(i, q, totalCarrier, opt.sampleRate, this.ncoPhase)
    this.ncoPhase = base.phase
    const phased = rotateIQ(base.i, base.q, (opt.phaseOffsetDeg * Math.PI) / 180)

    if (opt.autoSymbolTiming && !this.timingEstimated) {
      this.timingPhase = estimateTimingOffset(
        phased.i,
        phased.q,
        opt.samplesPerSymbol,
        opt.modulation
      )
      this.timingEstimated = true
    }
    const usedTiming = this.timingPhase
    const sy = extractSymbolsAt(phased.i, phased.q, opt.samplesPerSymbol, this.timingPhase)
    this.timingPhase = sy.nextPhase
    if (sy.count > 0) {
      for (let k = 0; k < sy.count; k++) {
        if (this.symLen >= this.symI.length) {
          this.symI.copyWithin(0, 1)
          this.symQ.copyWithin(0, 1)
          this.symLen--
        }
        this.symI[this.symLen] = sy.i[k]!
        this.symQ[this.symLen] = sy.q[k]!
        this.symLen++
      }
    }
    const evm = computeEvm(this.symI, this.symQ, opt.modulation, this.symLen)
    const measured = evm.count > 0
    this.stat = {
      measured,
      modulation: opt.modulation,
      symbolRateHz: opt.symbolRateHz,
      samplesPerSymbol: opt.samplesPerSymbol,
      carrierOffsetHz: this.carrierOffsetHz,
      symbolTimingOffset: usedTiming,
      symbolCount: evm.count,
      evmRms: evm.evmRms,
      evmPercent: evm.evmRms * 100,
      merDb:
        measured && evm.evmRms > 0
          ? Math.min(MER_MAX_DB, -20 * Math.log10(evm.evmRms))
          : MER_MAX_DB,
      magnitudeErrorRms: evm.magnitudeErrorRms,
      phaseErrorRmsDeg: evm.phaseErrorRmsDeg,
      iqGainImbalanceDb: evm.iqGainImbalanceDb,
      iqPhaseImbalanceDeg: evm.iqPhaseImbalanceDeg
    }
    return { symbols: { i: sy.i, q: sy.q }, stats: { ...this.stat } }
  }

  getStats(): ConstellationAnalysisStats {
    return { ...this.stat }
  }
}
