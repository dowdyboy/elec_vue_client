/**
 * 信号质量指标评估：
 * - 只做阈值/方向判断，不计算 EVM/MER 等物理量
 * - 调用方/分析仪给指标，面板与生产测试复用同一套判定
 */
import type { SignalQualityMetrics, SignalQualityState, SignalQualityThresholds } from './types'

export type QualityMetricKey = keyof SignalQualityMetrics

export interface QualityItem {
  key: QualityMetricKey
  value: number
  state: SignalQualityState
  /** 阈值文本/说明，供面板展示 */
  threshold?: string
}

const LIMITS: Array<{
  key: QualityMetricKey
  kind: 'max' | 'min' | 'absMax' | 'range'
  threshold: keyof SignalQualityThresholds
  label: string
}> = [
  { key: 'evmPercent', kind: 'max', threshold: 'evmPercentMax', label: 'EVM' },
  { key: 'merDb', kind: 'min', threshold: 'merDbMin', label: 'MER' },
  { key: 'snrDb', kind: 'min', threshold: 'snrDbMin', label: 'SNR' },
  { key: 'carrierOffsetHz', kind: 'absMax', threshold: 'carrierOffsetHzMax', label: 'CFO' },
  {
    key: 'symbolRateErrorPpm',
    kind: 'absMax',
    threshold: 'symbolRateErrorPpmMax',
    label: 'Symbol rate'
  },
  { key: 'paprDb', kind: 'max', threshold: 'paprDbMax', label: 'PAPR' },
  {
    key: 'iqGainImbalanceDb',
    kind: 'absMax',
    threshold: 'iqGainImbalanceDbMax',
    label: 'IQ gain'
  },
  {
    key: 'iqPhaseImbalanceDeg',
    kind: 'absMax',
    threshold: 'iqPhaseImbalanceDegMax',
    label: 'IQ phase'
  },
  { key: 'powerDbm', kind: 'range', threshold: 'powerDbmMin', label: 'Power' }
]

function stateFor(
  value: number,
  kind: 'max' | 'min' | 'absMax' | 'range',
  thresholds: SignalQualityThresholds,
  key: QualityMetricKey
): { state: SignalQualityState; text?: string } {
  if (kind === 'max') {
    const max =
      thresholds[
        (key === 'evmPercent' ? 'evmPercentMax' : 'paprDbMax') as keyof SignalQualityThresholds
      ]
    if (!Number.isFinite(max)) return { state: 'unknown' }
    return { state: value <= (max as number) ? 'pass' : 'fail', text: `≤ ${max}` }
  }
  if (kind === 'min') {
    const map = {
      merDb: thresholds.merDbMin,
      snrDb: thresholds.snrDbMin
    } as const
    const min = map[key as 'merDb' | 'snrDb']
    if (!Number.isFinite(min)) return { state: 'unknown' }
    return { state: value >= (min as number) ? 'pass' : 'fail', text: `≥ ${min}` }
  }
  if (kind === 'absMax') {
    const map = {
      carrierOffsetHz: thresholds.carrierOffsetHzMax,
      symbolRateErrorPpm: thresholds.symbolRateErrorPpmMax,
      iqGainImbalanceDb: thresholds.iqGainImbalanceDbMax,
      iqPhaseImbalanceDeg: thresholds.iqPhaseImbalanceDegMax
    } as const
    const max = map[key as keyof typeof map]
    if (!Number.isFinite(max)) return { state: 'unknown' }
    return { state: Math.abs(value) <= (max as number) ? 'pass' : 'fail', text: `|x| ≤ ${max}` }
  }
  const min = thresholds.powerDbmMin
  const max = thresholds.powerDbmMax
  if (!Number.isFinite(min) && !Number.isFinite(max)) return { state: 'unknown' }
  const ok =
    (!Number.isFinite(min) || value >= (min as number)) &&
    (!Number.isFinite(max) || value <= (max as number))
  return { state: ok ? 'pass' : 'fail', text: `${min ?? '-∞'} ~ ${max ?? '+∞'}` }
}

export function evaluateSignalQuality(
  metrics: SignalQualityMetrics,
  thresholds: SignalQualityThresholds = {}
): { state: SignalQualityState; items: QualityItem[] } {
  const items: QualityItem[] = []
  for (const def of LIMITS) {
    const value = metrics[def.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const r = stateFor(value, def.kind, thresholds, def.key)
    items.push({ key: def.key, value, state: r.state, threshold: r.text })
  }
  const fails = items.some((i) => i.state === 'fail')
  return {
    state: fails ? 'fail' : items.some((i) => i.state === 'pass') ? 'pass' : 'unknown',
    items
  }
}
