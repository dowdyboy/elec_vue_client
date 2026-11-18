import { describe, expect, it } from 'vitest'
import { defaultAnalysisConfig, type SignalAnalysisConfig } from './signal'
import {
  ANALYSIS_PRESET_KEYS,
  SOURCE_PRESET_KEYS,
  SOURCE_PRESET_VERSION,
  buildSourcePreset,
  parsePresets,
  presetToConfig,
  serializePresets,
  validateSourcePreset
} from './sourcePresets'

function cfg(over: Partial<SignalAnalysisConfig> = {}): SignalAnalysisConfig {
  return { ...defaultAnalysisConfig(), waveform: 'pulse', modType: 'sine', ...over }
}

describe('场景预设', () => {
  it('构建 → 校验 → 回填配置（源 + 分析字段齐全）', () => {
    const preset = buildSourcePreset(
      'Pulse 场景',
      cfg({ freq: 300, pulseDuty: 0.3, fftSize: 2048, window: 'blackman' }),
      { previewSpectrum: 'complex' },
      '2026-11-18T00:00:00.000Z'
    )
    expect(preset.version).toBe(SOURCE_PRESET_VERSION)
    expect(preset.name).toBe('Pulse 场景')
    expect(preset.ui.previewSpectrum).toBe('complex')
    for (const key of SOURCE_PRESET_KEYS) expect(preset.source).toHaveProperty(key)
    for (const key of ANALYSIS_PRESET_KEYS) expect(preset.analysis).toHaveProperty(key)

    const r = validateSourcePreset(JSON.parse(JSON.stringify(preset)))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(presetToConfig(r.value)).toMatchObject({
        freq: 300,
        pulseDuty: 0.3,
        fftSize: 2048,
        window: 'blackman'
      })
    }
  })

  it('拒绝版本不符、字段缺失与非法值', () => {
    const preset = buildSourcePreset('ok', cfg())
    expect(validateSourcePreset({ ...preset, version: 99 }).ok).toBe(false)
    expect(validateSourcePreset({ ...preset, name: '  ' }).ok).toBe(false)
    const missing = JSON.parse(JSON.stringify(preset)) as Record<string, unknown>
    delete (missing.source as Record<string, unknown>).freq
    expect(validateSourcePreset(missing).ok).toBe(false)
    expect(
      validateSourcePreset({ ...preset, analysis: { ...preset.analysis, fftSize: 1000 } }).ok
    ).toBe(false)
    expect(
      validateSourcePreset({ ...preset, source: { ...preset.source, waveform: 'bad' } }).ok
    ).toBe(false)
  })

  it('序列化/解析预设集合与坏条目过滤', () => {
    const a = buildSourcePreset('a', cfg())
    const b = buildSourcePreset('b', cfg({ waveform: 'ofdm', modType: 'sine' }))
    const text = serializePresets({ a, b })
    const parsed = parsePresets(text)
    expect(parsed.ok).toBe(true)
    expect(Object.keys(parsed.presets ?? {}).sort()).toEqual(['a', 'b'])

    const bad = parsePresets('{"a":{"version":1,"name":"x"}}')
    expect(bad.ok).toBe(false)
    expect(parsePresets('not json').ok).toBe(false)

    const mixed = JSON.stringify({
      version: 1,
      presets: { a, broken: { version: 1, name: '', source: {}, analysis: {} } }
    })
    const m = parsePresets(mixed)
    expect(m.ok).toBe(true)
    expect(Object.keys(m.presets ?? {})).toEqual(['a'])
  })
})
