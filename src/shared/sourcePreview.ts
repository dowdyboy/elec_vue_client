/**
 * 源工作台频谱预览：直接由 SourceFrame 计算，使用固定窗/固定 FFT，
 * 不读取分析配置，确保「分析配置」不会反向影响「信号源」预览。
 */
import type { SourceFrame } from './sourceEngine'
import { applyWindow, getWindow, magnitudeSpectrum, toDB } from './signalDsp'

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
  const win = getWindow('hann', fftSize)
  applyWindow(re, win)
  applyWindow(im, win)
  const complex = frame.outputMode === 'complex'
  const mag = magnitudeSpectrum(re, im, complex ? { full: true, fftShift: true } : {})
  const db = opts.db !== false
  return {
    data: db ? toDB(mag) : mag,
    fftSize,
    sampleRate: frame.sampleRate,
    spectrumMode: complex ? 'complex' : 'real',
    freqStartHz: complex ? -frame.sampleRate / 2 : 0,
    binHz: frame.sampleRate / fftSize,
    fftShift: complex,
    dbScale: db
  }
}
