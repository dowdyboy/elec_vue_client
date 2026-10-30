import { describe, it, expect } from 'vitest'
// 独立脚本是纯 JS（供终端直接运行），这里直接 import 其纯函数做一致性校验。
// 被 import 时脚本不会启动服务（见 scripts/remote-signal-mock.mjs 的 isMain 守卫）。
import {
  computeRow as scriptComputeRow,
  createGenerator as scriptCreateGenerator,
  defaultCfg as scriptDefaultCfg
} from '../../scripts/remote-signal-mock.mjs'
import { defaultAnalysisConfig, type SignalAnalysisConfig } from './signal'
import { createSignalGenerator } from './signalDsp'
import { computeSpectrumRow } from './signalFrames'

/** 确定性伪随机（与 signalDsp.test.ts 相同），保证两套实现消耗同样的随机序列 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

function complexTone(n: number, bin: number, nFft: number): Float32Array {
  const out = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * bin * k) / nFft
    out[2 * k] = Math.cos(ph)
    out[2 * k + 1] = Math.sin(ph)
  }
  return out
}

describe('独立脚本 Mock 与共享实现保持一致', () => {
  it('defaultCfg 与 defaultAnalysisConfig 一致', () => {
    expect(scriptDefaultCfg()).toEqual(defaultAnalysisConfig())
  })

  it('computeRow 在 dB/线性、rect/hann、real/complex 下逐 bin 一致', () => {
    const base: SignalAnalysisConfig = { ...defaultAnalysisConfig(), fftSize: 256 }
    const tone = complexTone(256, 32, 256)
    for (const window of ['rect', 'hann'] as const) {
      for (const dbScale of [true, false]) {
        for (const spectrumMode of ['real', 'complex'] as const) {
          const cfg = { ...base, window, dbScale, spectrumMode }
          const a = computeSpectrumRow(tone, cfg)
          const b = scriptComputeRow(tone, cfg)
          expect(b.length).toBe(a.length)
          for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 4)
        }
      }
    }
  })

  it('生成器逐样本一致（含成型、符号集归一化与噪声口径）', () => {
    for (const modType of ['sine', 'BPSK', 'QPSK', '16QAM'] as const) {
      const cfg: SignalAnalysisConfig = {
        ...defaultAnalysisConfig(),
        modType,
        snr: 20,
        imageDb: -20,
        pointsPerFrame: 512
      }
      const shared = createSignalGenerator(cfg, { rng: lcg(7) })
      const script = scriptCreateGenerator(cfg, { rng: lcg(7) })
      const a = shared.next(512)
      const b = script.next(512)
      expect(b.length).toBe(a.length)
      for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 6)
    }
  })

  it('专业源波形与输出模式逐样本一致', () => {
    for (const outputMode of ['real', 'complex'] as const) {
      for (const waveform of [
        'cw',
        'am',
        'fm',
        'pulse',
        'twoTone',
        'noise',
        'digital',
        'ofdm'
      ] as const) {
        const cfg: SignalAnalysisConfig = {
          ...defaultAnalysisConfig(),
          outputMode,
          waveform,
          modType: waveform === 'digital' ? 'QPSK' : 'sine',
          imageDb: -20,
          snr: 30,
          pointsPerFrame: 512
        }
        const a = createSignalGenerator(cfg, { rng: lcg(7) }).next(512)
        const b = scriptCreateGenerator(cfg, { rng: lcg(7) }).next(512)
        expect(b.length).toBe(a.length)
        for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 6)
      }
    }
  })
})
