import { describe, it, expect } from 'vitest'
import { defaultAnalysisConfig, sanitizeConfigPatch } from './signal'

describe('信号配置：频谱模式', () => {
  it('默认 real，兼容旧配置（缺省即单边实信号）', () => {
    expect(defaultAnalysisConfig().spectrumMode).toBe('real')
    expect(sanitizeConfigPatch({}).value).toEqual({})
  })

  it('接受 real/complex，拒绝非法值', () => {
    expect(sanitizeConfigPatch({ spectrumMode: 'complex' }).value).toEqual({
      spectrumMode: 'complex'
    })
    expect(sanitizeConfigPatch({ spectrumMode: 'real' }).value).toEqual({ spectrumMode: 'real' })
    const bad = sanitizeConfigPatch({ spectrumMode: 'signed' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('spectrumMode')
  })

  it('imageDb 默认 -120（关闭），只接受 -120~0', () => {
    expect(defaultAnalysisConfig().imageDb).toBe(-120)
    expect(sanitizeConfigPatch({ imageDb: -20 }).value).toEqual({ imageDb: -20 })
    expect(sanitizeConfigPatch({ imageDb: 0 }).value).toEqual({ imageDb: 0 })
    expect(sanitizeConfigPatch({ imageDb: -121 }).ok).toBe(false)
  })

  it('专业源默认实数输出，outputMode/waveform/调制参数校验', () => {
    const d = defaultAnalysisConfig()
    expect(d.outputMode).toBe('real')
    expect(d.waveform).toBe('cw')
    expect(sanitizeConfigPatch({ outputMode: 'complex' }).value).toEqual({
      outputMode: 'complex'
    })
    expect(sanitizeConfigPatch({ waveform: 'pulse' }).value).toEqual({ waveform: 'pulse' })
    expect(sanitizeConfigPatch({ waveform: 'sawtooth' }).ok).toBe(false)
    expect(sanitizeConfigPatch({ amDepth: 0.5, fmDeviation: 100 }).value).toEqual({
      amDepth: 0.5,
      fmDeviation: 100
    })
    expect(sanitizeConfigPatch({ pulseDuty: 1.2 }).ok).toBe(false)
  })
})
