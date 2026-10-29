/**
 * SourceRecorder：录制 SourceFrame（原始 IQ + 源元数据），供导出为 .f32 + .json 索引。
 * 纯数据类，不依赖 Electron/fs，便于单测与后续独立服务复用。
 */
import type { SourceFrame } from './sourceEngine'

export interface RecordedFrameMeta {
  seq: number
  timestamp: number
  sampleRate: number
  centerFrequencyHz: number
  outputMode: 'real' | 'complex'
  waveform: string
  modType: string
  samplesPerSymbol: number
  amplitude: number
  sampleCount: number
}

export interface RecordedFrame extends RecordedFrameMeta {
  data: Float32Array
}

export interface SourceRecorderStatus {
  recording: boolean
  frames: number
  samples: number
  durationMs: number
  truncated: boolean
}

export interface SourceRecorderOptions {
  maxSamples?: number
}

export class SourceRecorder {
  private frames: RecordedFrame[] = []
  private active = false
  private truncated = false
  private sampleCount = 0
  private readonly maxSamples: number

  constructor(opts: SourceRecorderOptions = {}) {
    this.maxSamples = Math.max(1024, opts.maxSamples ?? 4_000_000)
  }

  start(): void {
    this.frames = []
    this.sampleCount = 0
    this.active = true
    this.truncated = false
  }

  stop(): void {
    this.active = false
  }

  reset(): void {
    this.frames = []
    this.sampleCount = 0
    this.active = false
    this.truncated = false
  }

  /** 返回 false 表示达到上限或未在录制 */
  push(frame: SourceFrame): boolean {
    if (!this.active) return false
    if (this.sampleCount + frame.data.length / 2 > this.maxSamples) {
      this.active = false
      this.truncated = true
      return false
    }
    this.frames.push({
      seq: frame.seq,
      timestamp: frame.timestamp,
      sampleRate: frame.sampleRate,
      centerFrequencyHz: frame.centerFrequencyHz,
      outputMode: frame.outputMode,
      waveform: frame.waveform,
      modType: frame.modType,
      samplesPerSymbol: frame.samplesPerSymbol,
      amplitude: frame.amplitude,
      sampleCount: frame.data.length / 2,
      data: frame.data
    })
    this.sampleCount += frame.data.length / 2
    return true
  }

  getStatus(): SourceRecorderStatus {
    const first = this.frames[0]
    const last = this.frames[this.frames.length - 1]
    return {
      recording: this.active,
      frames: this.frames.length,
      samples: this.sampleCount,
      durationMs: first && last ? Math.max(0, last.timestamp - first.timestamp) : 0,
      truncated: this.truncated
    }
  }

  getFrames(): RecordedFrame[] {
    return this.frames.slice()
  }
}
