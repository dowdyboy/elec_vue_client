/**
 * 信号源领域模型（跨页面/后续 main 生成器共用）
 *
 * 当前阶段先把“源类型/能力/配置映射”从分析 UI 页抽出来；
 * 真正的 SourceEngine/OutputBackend 仍在主进程 signal/analysisServer 内，
 * 后续迁移时保持这里的 SourceKind/参数契约不变。
 */
import type { ModType, SignalAnalysisConfig, SourceWaveform } from './signal'

export type SourceKind =
  'cw' | 'am' | 'fm' | 'pulse' | 'twoTone' | 'noise' | 'BPSK' | 'QPSK' | '16QAM' | 'ofdm'

export interface SourceCapabilities {
  outputModes: Array<'real' | 'complex'>
  /** 是否支持复用同一套调制参数 */
  supportsDigital: boolean
  /** 是否需要每符号采样数 */
  usesSamplesPerSymbol: boolean
}

export interface SourceKindMeta {
  id: SourceKind
  label: string
  description: string
  waveform: SourceWaveform
  modType?: ModType
  capabilities: SourceCapabilities
  /** 推荐分析页面（一键跳转） */
  analysis: Array<{ label: string; path: string }>
}

const ANALOG: SourceCapabilities = {
  outputModes: ['real', 'complex'],
  supportsDigital: false,
  usesSamplesPerSymbol: false
}
const DIGITAL: SourceCapabilities = {
  outputModes: ['real', 'complex'],
  supportsDigital: true,
  usesSamplesPerSymbol: true
}

export const SOURCE_CATALOG: SourceKindMeta[] = [
  {
    id: 'cw',
    label: 'CW 单音',
    description: '单载波/单音，最适合频率与幅度校准',
    waveform: 'cw',
    capabilities: ANALOG,
    analysis: [
      { label: '频谱', path: '/signal/spectrum' },
      { label: 'IQ', path: '/signal/iq' }
    ]
  },
  {
    id: 'am',
    label: 'AM 调幅',
    description: '幅度调制，可调调制频率与调制度',
    waveform: 'am',
    capabilities: ANALOG,
    analysis: [
      { label: '频谱', path: '/signal/spectrum' },
      { label: '时频', path: '/signal/spectrogram' }
    ]
  },
  {
    id: 'fm',
    label: 'FM 调频',
    description: '频率调制，可调调制频率与峰值频偏',
    waveform: 'fm',
    capabilities: ANALOG,
    analysis: [
      { label: '频谱', path: '/signal/spectrum' },
      { label: '时频', path: '/signal/spectrogram' }
    ]
  },
  {
    id: 'pulse',
    label: 'Pulse 脉冲',
    description: '脉冲调制，可调周期/占空比，适合功率-时间与雷达场景',
    waveform: 'pulse',
    capabilities: ANALOG,
    analysis: [
      { label: '功率-时间', path: '/signal/power-time' },
      { label: '持续谱', path: '/signal/persistence' }
    ]
  },
  {
    id: 'twoTone',
    label: '双音',
    description: '双音测试，适合互调/失真观察',
    waveform: 'twoTone',
    capabilities: ANALOG,
    analysis: [{ label: '频谱', path: '/signal/spectrum' }]
  },
  {
    id: 'noise',
    label: 'Noise 噪声',
    description: '带限/白噪声源，适合底噪与统计场景',
    waveform: 'noise',
    capabilities: ANALOG,
    analysis: [
      { label: '持续谱', path: '/signal/persistence' },
      { label: 'APD/CCDF', path: '/signal/apd' }
    ]
  },
  {
    id: 'BPSK',
    label: 'BPSK',
    description: '数字调制，适合星座/眼图/信号质量',
    waveform: 'digital',
    modType: 'BPSK',
    capabilities: DIGITAL,
    analysis: [
      { label: '星座', path: '/signal/constellation' },
      { label: '眼图', path: '/signal/eye' }
    ]
  },
  {
    id: 'QPSK',
    label: 'QPSK',
    description: '数字调制，适合星座/眼图/EVM',
    waveform: 'digital',
    modType: 'QPSK',
    capabilities: DIGITAL,
    analysis: [
      { label: '星座', path: '/signal/constellation' },
      { label: '眼图', path: '/signal/eye' }
    ]
  },
  {
    id: '16QAM',
    label: '16QAM',
    description: '数字调制，适合高阶 QAM 星座/质量分析',
    waveform: 'digital',
    modType: '16QAM',
    capabilities: DIGITAL,
    analysis: [
      { label: '星座', path: '/signal/constellation' },
      { label: '眼图', path: '/signal/eye' }
    ]
  },
  {
    id: 'ofdm',
    label: 'OFDM',
    description: '多载波 OFDM，适合频谱/持续谱/APD 与峰均比观察',
    waveform: 'ofdm',
    capabilities: ANALOG,
    analysis: [
      { label: '频谱', path: '/signal/spectrum' },
      { label: '持续谱', path: '/signal/persistence' },
      { label: 'APD/CCDF', path: '/signal/apd' }
    ]
  }
]

export function sourceKindMeta(kind: SourceKind): SourceKindMeta {
  return SOURCE_CATALOG.find((s) => s.id === kind) ?? SOURCE_CATALOG[0]!
}

/** 当前分析配置 → 源类型（用于回填工作台） */
export function sourceKindOf(
  config: Pick<SignalAnalysisConfig, 'waveform' | 'modType'>
): SourceKind {
  if (config.waveform === 'digital') {
    if (config.modType === 'BPSK' || config.modType === 'QPSK' || config.modType === '16QAM')
      return config.modType
  }
  if (
    config.waveform === 'cw' ||
    config.waveform === 'am' ||
    config.waveform === 'fm' ||
    config.waveform === 'pulse' ||
    config.waveform === 'twoTone' ||
    config.waveform === 'noise' ||
    config.waveform === 'ofdm'
  )
    return config.waveform
  return 'cw'
}

/** 源类型 → 分析配置补丁（保留当前采样率/帧长等运行参数） */
export function sourceKindPatch(
  kind: SourceKind
): Pick<SignalAnalysisConfig, 'waveform' | 'modType'> {
  const m = sourceKindMeta(kind)
  return {
    waveform: m.waveform,
    modType: m.waveform === 'digital' ? (m.modType ?? 'QPSK') : 'sine'
  }
}

export interface SourceSummary {
  kind: SourceKind
  label: string
  outputMode: 'real' | 'complex'
  carrierHz: number
  sampleRate: number
  pointsPerFrame: number
  amplitude: number
  snrDb: number
}

export function sourceSummary(config: SignalAnalysisConfig): SourceSummary {
  const kind = sourceKindOf(config)
  return {
    kind,
    label: sourceKindMeta(kind).label,
    outputMode: config.outputMode,
    carrierHz: config.freq,
    sampleRate: config.sampleRate,
    pointsPerFrame: config.pointsPerFrame,
    amplitude: config.amplitude,
    snrDb: config.snr
  }
}
