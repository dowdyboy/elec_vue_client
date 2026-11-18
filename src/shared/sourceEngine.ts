/**
 * SourceEngine：源输出域的有状态生成器（无 Electron / 无 FFT）
 *
 * 与 LocalAnalysisSource 解耦：
 *   SourceEngine -> SourceFrame（IQ + 时基/频点/输出域）
 *   AnalysisSource -> 对 SourceFrame 做 FFT/时频/分析帧
 *
 * 当前 createSignalGenerator 仍是实际波形实现；后续可替换为
 * 任意 IQ/OFDM/硬件后端，而 SourceFrame 契约保持不变。
 */
import {
  defaultAnalysisConfig,
  type OutputMode,
  type SignalAnalysisConfig,
  type ModType,
  type SourceWaveform
} from './signal'
import { createSignalGenerator, type SignalGenerator } from './signalDsp'

export interface SourceFrame {
  seq: number
  /** 生成时刻（Unix ms） */
  timestamp: number
  sampleRate: number
  centerFrequencyHz: number
  outputMode: OutputMode
  waveform: SourceWaveform
  modType: ModType
  samplesPerSymbol: number
  amplitude: number
  /**
   * 交织原始 IQ：[I0,Q0,I1,Q1...]
   * real 输出时 Q=0，仍保持交织以复用同一传输/显示契约。
   */
  data: Float32Array
}

export interface SourceEngineOptions {
  rng?: () => number
  now?: () => number
}

/**
 * 影响波形生成器的配置字段：只有这些变化才需要重建生成器。
 * fftSize/window/overlap/spectrumMode/enabled 等属于分析或服务控制参数，变更不应重置相位/符号历史。
 */
const GENERATOR_KEYS = [
  'freq',
  'snr',
  'amplitude',
  'modType',
  'outputMode',
  'waveform',
  'modFreq',
  'amDepth',
  'fmDeviation',
  'pulsePeriod',
  'pulseDuty',
  'toneSpacing',
  'sampleRate',
  'samplesPerSymbol',
  'ofdmSubcarriers',
  'ofdmCpRatio',
  'imageDb'
] as const satisfies ReadonlyArray<keyof SignalAnalysisConfig>

export class SourceEngine {
  private config: SignalAnalysisConfig
  private gen: SignalGenerator
  private seq = 0
  private readonly rng?: () => number
  private readonly now: () => number

  constructor(config?: Partial<SignalAnalysisConfig>, opts: SourceEngineOptions = {}) {
    this.config = { ...defaultAnalysisConfig(), ...config }
    this.rng = opts.rng
    this.now = opts.now ?? (() => Date.now())
    this.gen = createSignalGenerator(this.config, { rng: this.rng })
  }

  getConfig(): SignalAnalysisConfig {
    return { ...this.config }
  }

  /** 更新源配置；只有波形参数变化才重建生成器（分析参数变更不再重置相位/符号历史） */
  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    const prev = this.config
    this.config = { ...this.config, ...patch }
    const rebuild = GENERATOR_KEYS.some((key) => this.config[key] !== prev[key])
    if (rebuild) this.gen = createSignalGenerator(this.config, { rng: this.rng })
  }

  reset(): void {
    this.gen = createSignalGenerator(this.config, { rng: this.rng })
    this.seq = 0
  }

  next(n: number): SourceFrame {
    const count = Math.max(1, Math.floor(n))
    const data = this.gen.next(count)
    this.seq++
    return {
      seq: this.seq,
      timestamp: this.now(),
      sampleRate: this.config.sampleRate,
      centerFrequencyHz: this.config.freq,
      outputMode: this.config.outputMode,
      waveform: this.config.waveform,
      modType: this.config.modType,
      samplesPerSymbol: this.config.samplesPerSymbol,
      amplitude: this.config.amplitude,
      data
    }
  }
}
