import { describe, it, expect } from 'vitest'
import {
  constellationDisplayOnly,
  eyeDisplayOnly,
  iqDisplayOnly,
  powerTimeDisplayOnly,
  spectrogramDisplayOnly,
  spectrumDisplayOnly
} from './presets'

describe('最小显示预设', () => {
  it('所有预设都关闭高级/分析功能，但保留轴/网格', () => {
    expect(iqDisplayOnly.trigger?.enabled).toBe(false)
    expect(iqDisplayOnly.envelope).toBe(false)
    expect(iqDisplayOnly.contextMenu).toBe(false)
    expect(iqDisplayOnly.axis).toBe(true)
    expect(iqDisplayOnly.grid).toBe(true)

    expect(spectrumDisplayOnly.autoScale).toBe(false)
    expect(spectrumDisplayOnly.showInfo).toBe(false)
    expect(spectrumDisplayOnly.contextMenu).toBe(false)
    expect(spectrumDisplayOnly.peakTable).toBe(false)
    expect(spectrumDisplayOnly.markerTable).toBe(false)
    expect(spectrumDisplayOnly.vbw).toBe(0)
    expect(spectrumDisplayOnly.axis).toBe(true)
    expect(spectrumDisplayOnly.grid).toBe(true)

    expect(spectrogramDisplayOnly.autoLevel).toBe(false)
    expect(spectrogramDisplayOnly.showInfo).toBe(false)
    expect(spectrogramDisplayOnly.contextMenu).toBe(false)
    expect(spectrogramDisplayOnly.axis).toBe(true)
    expect(spectrogramDisplayOnly.grid).toBe(true)

    expect(constellationDisplayOnly.showInfo).toBe(false)
    expect(constellationDisplayOnly.axis).toBe(true)
    expect(constellationDisplayOnly.grid).toBe(true)
    expect('analysis' in constellationDisplayOnly).toBe(false)

    expect(powerTimeDisplayOnly.showInfo).toBe(false)
    expect(powerTimeDisplayOnly.axis).toBe(true)
    expect(powerTimeDisplayOnly.grid).toBe(true)
    expect('analysis' in powerTimeDisplayOnly).toBe(false)

    expect(eyeDisplayOnly.showInfo).toBe(false)
    expect(eyeDisplayOnly.axis).toBe(true)
    expect(eyeDisplayOnly.grid).toBe(true)
  })
})
