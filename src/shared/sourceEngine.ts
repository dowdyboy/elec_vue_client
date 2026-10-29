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

  /** 更新源配置；波形参数变更时重建生成器，保持相位/符号历史重置的既有语义 */
  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.gen = createSignalGenerator(this.config, { rng: this.rng })
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
