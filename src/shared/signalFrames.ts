/**
 * 帧构造（跨 main / 内置远端 Mock / 独立脚本共用）
 *
 * 设计要点：
 * - 频谱行统一在这里计算：加窗 → FFT → 幅度 → **窗相干增益归一**（同一条 0 dBFS 复单音，
 *   切 rect/hann/hamming/blackman 峰值不再相差 6 dB）→ 线性或 dB。
 * - SpectrumAnalyzer 维护跨帧样本 FIFO：即使 pointsPerFrame < fftSize，也会等到凑满
 *   fftSize 个复数样本再算 FFT，不再对不足部分零填充（旧实现会让频谱低 20~75 dB）。
 * - SpectrogramAccumulator 只产 dB 行（时频图着色口径固定 -120~0 dB），
 *   与谱图的 dbScale 显示开关解耦。
 */

import type { SignalAnalysisConfig, WindowType } from './signal'
import { applyWindow, getWindow, magnitudeSpectrum, toDB } from './signalDsp'

/** 窗缓存（同一 fftSize/窗型在 60fps 下避免每行重算窗函数与和值） */
let winKey = ''
let winData: Float32Array = new Float32Array(0)
let winGain = 1

export interface WindowInfo {
  win: Float32Array
  /** 相干增益 Σw/N：用于把峰值校准到「满量程复单音 = 0 dB」 */
  gain: number
}

export function getWindowInfo(type: WindowType, n: number): WindowInfo {
  const key = `${type}:${n}`
  if (key !== winKey) {
    const win = getWindow(type, n)
    let sum = 0
    for (let i = 0; i < n; i++) sum += win[i] ?? 0
    winData = win
    winGain = n > 0 ? sum / n : 1
    winKey = key
  }
  return { win: winData, gain: winGain }
}

/**
 * 由交织复数切片计算一行幅度谱。
 * @param slice 交织 IQ（长度不足 fftSize*2 时按实际样本数加窗，调用方应保证已凑满）
 * @param cfg 处理配置
 * @param opts.forceDb 忽略 cfg.dbScale，强制输出 dB（时频图固定 dB 行）
 */
export function computeSpectrumRow(
  slice: Float32Array,
  cfg: SignalAnalysisConfig,
  opts: { forceDb?: boolean } = {}
): Float32Array {
  const n = cfg.fftSize
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  const count = Math.min(n, Math.floor(slice.length / 2))
  for (let k = 0; k < count; k++) {
    re[k] = slice[2 * k] ?? 0
    im[k] = slice[2 * k + 1] ?? 0
  }
  const { win, gain } = getWindowInfo(cfg.window, n)
  applyWindow(re, win)
  applyWindow(im, win)
  const mag = magnitudeSpectrum(re, im)
  // 相干增益补偿：rect=1，hann=0.5（补偿后峰值 +6 dB），保证窗型切换不改变电平读数
  const inv = gain > 1e-12 ? 1 / gain : 1
  for (let i = 0; i < mag.length; i++) mag[i] = (mag[i] ?? 0) * inv
  return opts.forceDb || cfg.dbScale ? toDB(mag) : mag
}

/**
 * 频谱跨帧分析器：保留最近 fftSize 个复数样本（交织 float 缓冲）。
 * - pointsPerFrame ≥ fftSize：与旧行为一致，取当前帧最后 fftSize 个复数样本；
 * - pointsPerFrame < fftSize：跨帧累积，凑满后再算，避免零填充导致的幅度/谱形错误。
 * - fftSize 变化时自动重置。
 */
export class SpectrumAnalyzer {
  private buf = new Float32Array(0)
  private len = 0
  private fftSize = 0

  push(iq: Float32Array, cfg: SignalAnalysisConfig): Float32Array | null {
    const need = cfg.fftSize * 2
    if (!(need > 0) || iq.length === 0) return null
    if (this.fftSize !== cfg.fftSize || this.buf.length !== need) {
      this.fftSize = cfg.fftSize
      this.buf = new Float32Array(need)
      this.len = 0
    }
    if (iq.length >= need) {
      this.buf.set(iq.subarray(iq.length - need))
      this.len = need
    } else {
      const keep = Math.min(this.len, need - iq.length)
      if (keep < this.len) this.buf.copyWithin(0, this.len - keep, this.len)
      this.len = keep
      this.buf.set(iq, this.len)
      this.len += iq.length
    }
    if (this.len < need) return null
    return computeSpectrumRow(this.buf.subarray(0, need), cfg)
  }

  reset(): void {
    this.len = 0
  }
}

/**
 * 时频图行累计器：按 overlap 在帧间滑动窗口，输出固定 dB 行。
 * （从 analysisServer 抽出，供本地源 / 内置远端 Mock 复用，避免两份实现漂移）
 */
export class SpectrogramAccumulator {
  private buf = new Float32Array(0)
  private len = 0
  private pos = 0

  push(iq: Float32Array, cfg: SignalAnalysisConfig): Float32Array[] {
    if (this.buf.length < this.len + iq.length) {
      const next = Math.max(this.len + iq.length, this.buf.length ? this.buf.length * 2 : 8192)
      const nb = new Float32Array(next)
      nb.set(this.buf.subarray(0, this.len))
      this.buf = nb
    }
    this.buf.set(iq, this.len)
    this.len += iq.length

    const need = cfg.fftSize * 2
    const step = Math.max(2, Math.floor(cfg.fftSize * (1 - cfg.overlap)) * 2)
    const rows: Float32Array[] = []
    while (this.pos + need <= this.len) {
      rows.push(
        computeSpectrumRow(this.buf.subarray(this.pos, this.pos + need), cfg, { forceDb: true })
      )
      this.pos += step
    }
    // 压缩已消费部分
    if (this.pos > cfg.fftSize * 4) {
      this.buf.copyWithin(0, this.pos, this.len)
      this.len -= this.pos
      this.pos = 0
    }
    return rows
  }

  reset(): void {
    this.len = 0
    this.pos = 0
  }
}
