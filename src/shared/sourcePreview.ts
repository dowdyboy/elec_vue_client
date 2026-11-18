/**
 * 源工作台频谱预览：直接由 SourceFrame 计算，使用固定窗/固定 FFT，
 * 不读取分析配置，确保「分析配置」不会反向影响「信号源」预览。
 */
import type { SourceFrame } from './sourceEngine'
import { applyWindow, magnitudeSpectrum, toDB } from './signalDsp'
import { getWindowInfo } from './signalFrames'

export interface SourcePreviewSpectrum {
  data: Float32Array
  fftSize: number
  sampleRate: number
  spectrumMode: 'real' | 'complex'
  freqStartHz: number
  binHz: number
  fftShift: boolean
  dbScale: boolean
}

/** 2 的幂，且不超过样本数；样本不足 64 返回 null */
export function pickPreviewFftSize(samples: number, preferred = 1024): number | null {
  let n = 64
  while (n * 2 <= Math.min(samples, preferred)) n *= 2
  return n <= samples ? n : null
}

export interface SourcePreviewOptions {
  fftSize?: number
  db?: boolean
  /** 显示域：缺省按 outputMode 自动；real=单边，complex=完整双边 */
  spectrumMode?: 'real' | 'complex'
}

export function buildSourcePreviewSpectrum(
  frame: SourceFrame,
  opts: SourcePreviewOptions = {}
): SourcePreviewSpectrum | null {
  const samples = Math.floor(frame.data.length / 2)
  const fftSize = pickPreviewFftSize(samples, opts.fftSize ?? 1024)
  if (!fftSize) return null
  const re = new Float32Array(fftSize)
  const im = new Float32Array(fftSize)
  for (let k = 0; k < fftSize; k++) {
    re[k] = frame.data[2 * k] ?? 0
    im[k] = frame.data[2 * k + 1] ?? 0
  }
  const { win, gain } = getWindowInfo('hann', fftSize)
  applyWindow(re, win)
  applyWindow(im, win)
  const spectrumMode = opts.spectrumMode ?? (frame.outputMode === 'complex' ? 'complex' : 'real')
  const complex = spectrumMode === 'complex'
  const mag = magnitudeSpectrum(re, im, complex ? { full: true, fftShift: true } : {})
  // 窗相干增益补偿（与 signalFrames.computeSpectrumRow 同口径）：
  // 满量程 CW 预览峰值 = 0 dB；real 单边谱除 DC 外 ×2
  const inv = gain > 1e-12 ? 1 / gain : 1
  if (complex) {
    for (let i = 0; i < mag.length; i++) mag[i] = (mag[i] ?? 0) * inv
  } else {
    for (let i = 0; i < mag.length; i++) mag[i] = (mag[i] ?? 0) * inv * (i === 0 ? 1 : 2)
  }
  const db = opts.db !== false
  return {
    data: db ? toDB(mag) : mag,
    fftSize,
    sampleRate: frame.sampleRate,
    spectrumMode,
    freqStartHz: complex ? -frame.sampleRate / 2 : 0,
    binHz: frame.sampleRate / fftSize,
    fftShift: complex,
    dbScale: db
  }
}
