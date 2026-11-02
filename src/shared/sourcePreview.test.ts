import { describe, expect, it } from 'vitest'
import { buildSourcePreviewSpectrum, pickPreviewFftSize } from './sourcePreview'
import type { SourceFrame } from './sourceEngine'

function frame(outputMode: 'real' | 'complex', n: number, bin: number, fftSize = n): SourceFrame {
  const data = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * bin * k) / fftSize
    data[2 * k] = Math.cos(th)
    data[2 * k + 1] = outputMode === 'complex' ? Math.sin(th) : 0
  }
  return {
    seq: 1,
    timestamp: 1,
    sampleRate: 4096,
    centerFrequencyHz: 512,
    outputMode,
    waveform: 'cw',
    modType: 'sine',
    samplesPerSymbol: 16,
    amplitude: 1,
    data
  }
}

describe('源工作台独立频谱预览', () => {
  it('complex 输出使用完整双边复谱', () => {
    const p = buildSourcePreviewSpectrum(frame('complex', 256, 32), {})
    expect(p).not.toBeNull()
    expect(p!.fftSize).toBe(256)
    expect(p!.spectrumMode).toBe('complex')
    expect(p!.data.length).toBe(256)
    expect(p!.freqStartHz).toBe(-2048)
    expect(p!.fftShift).toBe(true)
  })

  it('real 输出使用单边实谱', () => {
    const p = buildSourcePreviewSpectrum(frame('real', 256, 32), {})
    expect(p!.spectrumMode).toBe('real')
    expect(p!.data.length).toBe(128)
    expect(p!.freqStartHz).toBe(0)
    expect(p!.fftShift).toBe(false)
  })

  it('FFT 选择与分析配置无关，且样本不足返回 null', () => {
    expect(pickPreviewFftSize(100)).toBe(64)
    expect(pickPreviewFftSize(256)).toBe(256)
    expect(pickPreviewFftSize(32)).toBeNull()
    const p = buildSourcePreviewSpectrum(frame('complex', 128, 8), { fftSize: 64 })
    expect(p!.fftSize).toBe(64)
  })
})
