/**
 * Raw IQ 回放：读取网络源 raw 录制（ci16/cf32/ci8 + sidecar JSON），
 * 按显示采样率抽取后产出 SourceFrame；文件按帧读取，不整体载入内存。
 */
import fs from 'node:fs'
import type { SourceFrame } from '../../../shared/sourceEngine'
import type { PlaybackSource, SourcePlaybackStatus } from '../../../shared/sourcePlayback'
import { networkBytesPerSample, type NetworkFormat } from '../../../shared/sourceNetwork'

export interface RawPlaybackConfig {
  path: string
  format: NetworkFormat
  /** 线上原始采样率 */
  sampleRate: number
  centerHz: number
  /** 原始文件里的复数样本总数 */
  totalSamples: number
  /** 显示/分析采样率（≤ sampleRate） */
  displaySampleRate: number
  pointsPerFrame: number
  /** raw 文件通道数（1/2）；默认 1 */
  channels?: number
  /** 回放哪个通道（0/1）；默认 0 */
  channel?: number
  /** 跨段回放时给时间戳加偏移（ms） */
  timeOffsetMs?: number
  loop?: boolean
}

export class RawIqPlayback implements PlaybackSource {
  private fd = -1
  private readonly path: string
  private readonly format: NetworkFormat
  private readonly bps: number
  private readonly channels: number
  private readonly channel: number
  private readonly timeOffsetMs: number
  private readonly sampleRate: number
  private readonly centerHz: number
  private readonly totalSamples: number
  private readonly stride: number
  private readonly displayRate: number
  private readonly points: number
  private readonly wirePerFrame: number
  private readonly frameBytes: number
  private readonly totalFrames: number
  private buffer: Buffer
  private frameIndex = 0
  private playing = false
  private paused = false
  private loop: boolean
  private cache: SourceFrame | null = null
  private closed = false

  constructor(cfg: RawPlaybackConfig) {
    this.path = cfg.path
    this.format = cfg.format
    this.bps = networkBytesPerSample(cfg.format)
    this.channels = cfg.channels === 2 ? 2 : 1
    this.channel = Math.max(0, Math.min(this.channels - 1, Math.floor(cfg.channel ?? 0)))
    this.timeOffsetMs = Math.max(0, Number(cfg.timeOffsetMs) || 0)
    this.sampleRate = Math.max(1, cfg.sampleRate)
    this.centerHz = cfg.centerHz
    this.points = Math.max(1, Math.min(65_536, Math.floor(cfg.pointsPerFrame)))
    this.stride = Math.max(1, Math.round(this.sampleRate / Math.max(1, cfg.displaySampleRate)))
    this.displayRate = this.sampleRate / this.stride
    this.wirePerFrame = this.points * this.stride
    this.frameBytes = this.wirePerFrame * this.bps * this.channels
    this.totalSamples = Math.max(0, Math.floor(cfg.totalSamples))
    this.totalFrames = Math.max(1, Math.ceil(this.totalSamples / Math.max(1, this.wirePerFrame)))
    this.loop = cfg.loop !== false
    this.buffer = Buffer.allocUnsafe(this.frameBytes)
    this.fd = fs.openSync(this.path, 'r')
  }

  start(): void {
    this.frameIndex = 0
    this.playing = true
    this.paused = false
    this.cache = null
  }

  stop(): void {
    this.playing = false
    this.paused = false
    this.cache = null
  }

  pause(): void {
    if (this.playing) this.paused = true
  }

  resume(): void {
    if (this.playing) this.paused = false
  }

  next(): SourceFrame | null {
    if (!this.playing || this.paused) return null
    return this.advance()
  }

  step(): SourceFrame | null {
    if (!this.playing) return null
    return this.advance()
  }

  peek(): SourceFrame | null {
    if (!this.playing) return null
    if (this.frameIndex >= this.totalFrames && !this.loop) return null
    const index = this.frameIndex >= this.totalFrames ? 0 : this.frameIndex
    if (!this.cache) this.cache = this.readFrameAt(index)
    return this.cache
  }

  seek(index: number): boolean {
    if (!Number.isFinite(index)) return false
    this.frameIndex = Math.max(0, Math.min(this.totalFrames - 1, Math.floor(index)))
    this.cache = null
    return true
  }

  setLoop(loop: boolean): void {
    this.loop = loop
  }

  getStatus(): SourcePlaybackStatus {
    const index = Math.min(this.frameIndex, Math.max(0, this.totalFrames - 1))
    const durationMs = (this.totalSamples / this.sampleRate) * 1000
    const positionMs = Math.min(durationMs, (index * this.wirePerFrame * 1000) / this.sampleRate)
    return {
      playing: this.playing,
      paused: this.paused,
      index,
      total: this.totalFrames,
      loop: this.loop,
      durationMs,
      positionMs,
      channel: this.channel,
      displaySampleRate: this.displayRate
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    try {
      fs.closeSync(this.fd)
    } catch {
      // ignore
    }
  }

  private advance(): SourceFrame | null {
    if (this.frameIndex >= this.totalFrames) {
      if (!this.loop) {
        this.playing = false
        return null
      }
      this.frameIndex = 0
      this.cache = null
    }
    const frame = this.cache ?? this.readFrameAt(this.frameIndex)
    this.cache = null
    if (!frame) {
      this.playing = false
      return null
    }
    this.frameIndex++
    return frame
  }

  private readFrameAt(index: number): SourceFrame | null {
    const wireStart = index * this.wirePerFrame
    if (wireStart >= this.totalSamples) return null
    const wireCount = Math.min(this.wirePerFrame, this.totalSamples - wireStart)
    const bytes = wireCount * this.bps * this.channels
    let bytesRead = 0
    try {
      bytesRead = fs.readSync(this.fd, this.buffer, 0, bytes, wireStart * this.bps * this.channels)
    } catch {
      return null
    }
    if (bytesRead < this.bps) return null
    const stepBytes = this.stride * this.bps * this.channels
    let count = 0
    while (count * stepBytes + this.channel * this.bps + this.bps <= bytesRead) count++
    if (count === 0) return null
    const data = new Float32Array(count * 2)
    for (let k = 0; k < count; k++) {
      const off = k * stepBytes + this.channel * this.bps
      this.readSample(off, data, k * 2)
    }
    return {
      seq: index + 1,
      timestamp: this.timeOffsetMs + (wireStart / this.sampleRate) * 1000,
      wallTimestamp: Date.now(),
      sampleRate: this.displayRate,
      centerFrequencyHz: this.centerHz,
      outputMode: 'complex',
      waveform: 'file',
      modType: 'sine',
      samplesPerSymbol: 1,
      amplitude: 1,
      data,
      channel: this.channel
    }
  }

  private readSample(off: number, out: Float32Array, outIndex: number): void {
    if (this.format === 'ci16') {
      out[outIndex] = this.buffer.readInt16LE(off) / 32768
      out[outIndex + 1] = this.buffer.readInt16LE(off + 2) / 32768
      return
    }
    if (this.format === 'cf32') {
      out[outIndex] = this.buffer.readFloatLE(off)
      out[outIndex + 1] = this.buffer.readFloatLE(off + 4)
      return
    }
    out[outIndex] = this.buffer.readInt8(off) / 128
    out[outIndex + 1] = this.buffer.readInt8(off + 1) / 128
  }
}
