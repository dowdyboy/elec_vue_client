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
})
