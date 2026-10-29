import { describe, expect, it } from 'vitest'
import {
  SOURCE_CATALOG,
  sourceKindMeta,
  sourceKindOf,
  sourceKindPatch,
  sourceSummary
} from './source'
import { defaultAnalysisConfig } from './signal'

describe('信号源领域模型', () => {
  it('目录覆盖模拟与数字源', () => {
    expect(SOURCE_CATALOG.length).toBeGreaterThanOrEqual(9)
    expect(sourceKindMeta('pulse').waveform).toBe('pulse')
    expect(sourceKindMeta('16QAM').waveform).toBe('digital')
    expect(sourceKindMeta('16QAM').modType).toBe('16QAM')
    expect(sourceKindMeta('16QAM').capabilities.usesSamplesPerSymbol).toBe(true)
  })

  it('源类型与分析配置映射', () => {
    expect(sourceKindOf({ waveform: 'cw', modType: 'sine' })).toBe('cw')
    expect(sourceKindOf({ waveform: 'digital', modType: 'QPSK' })).toBe('QPSK')
    expect(sourceKindPatch('BPSK')).toEqual({ waveform: 'digital', modType: 'BPSK' })
    expect(sourceKindPatch('pulse')).toEqual({ waveform: 'pulse', modType: 'sine' })
  })

  it('摘要保留运行参数', () => {
    const cfg = defaultAnalysisConfig()
    cfg.waveform = 'digital'
    cfg.modType = 'QPSK'
    cfg.outputMode = 'complex'
    cfg.freq = 1200
    const s = sourceSummary(cfg)
    expect(s.kind).toBe('QPSK')
    expect(s.outputMode).toBe('complex')
    expect(s.carrierHz).toBe(1200)
  })
})
