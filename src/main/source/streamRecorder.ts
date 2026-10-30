/**
 * SourceStreamRecorder：把 SourceFrame 原始 IQ 顺序写入临时 .f32 分段文件，
 * 元数据保存在内存；用于长时间录制，避免主进程堆积全部样本。
 */
import { createWriteStream, type WriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SourceFrame } from '../../shared/sourceEngine'
import type { RecordedFrameMeta, SourceRecorderStatus } from '../../shared/sourceRecorder'

const DEFAULT_SEGMENT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_PENDING_BYTES = 64 * 1024 * 1024

export interface SourceStreamRecorderOptions {
  segmentBytes?: number
  maxPendingBytes?: number
}

export class SourceStreamRecorder {
  private ws: WriteStream | null = null
  private basePath = ''
  private segments: string[] = []
  private segmentIndex = 0
  private currentBytes = 0
  private frames: RecordedFrameMeta[] = []
  private samples = 0
  private startedAt = 0
  private active = false
  private truncated = false
  private pendingBytes = 0
  private closers: Promise<void>[] = []
  private readonly segmentBytes: number
  private readonly maxPendingBytes: number

  constructor(opts: SourceStreamRecorderOptions = {}) {
    this.segmentBytes = Math.max(32, opts.segmentBytes ?? DEFAULT_SEGMENT_BYTES)
    this.maxPendingBytes = Math.max(1, opts.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES)
  }

  start(): void {
    this.dispose()
    this.basePath = path.join(
      os.tmpdir(),
      `dsh-source-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    this.segments = []
    this.segmentIndex = 0
    this.frames = []
    this.samples = 0
    this.startedAt = Date.now()
    this.active = true
    this.truncated = false
    this.pendingBytes = 0
    this.closers = []
    this.openSegment()
  }

  private openSegment(): void {
    const p = `${this.basePath}-${this.segmentIndex++}.f32`
    const ws = createWriteStream(p)
    ws.on('error', (e) => {
      console.error('[source] stream error', e)
      this.truncated = true
      this.active = false
      if (this.ws === ws) this.ws = null
    })
    this.ws = ws
    this.segments.push(p)
    this.currentBytes = 0
  }

  push(frame: SourceFrame): void {
    if (!this.active || !this.ws) return
    try {
      const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
      if (this.pendingBytes + buf.length > this.maxPendingBytes) {
        this.truncated = true
        this.active = false
        const ws = this.ws
        this.ws = null
        if (ws) {
          this.closers.push(
            new Promise<void>((resolve) => {
              ws.once('close', () => resolve())
            })
          )
          ws.end()
        }
        return
      }
      if (this.currentBytes > 0 && this.currentBytes + buf.length > this.segmentBytes) {
        const previous = this.ws
        this.ws = null
        this.closers.push(
          new Promise<void>((resolve) => {
            previous.once('close', () => resolve())
          })
        )
        previous.end()
        this.openSegment()
      }
      const queued = this.ws!.write(buf)
      this.currentBytes += buf.length
      this.pendingBytes += buf.length
      if (!queued) {
        this.ws!.once('drain', () => {
          this.pendingBytes = 0
        })
      } else {
        this.pendingBytes = 0
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
        sampleCount: frame.data.length / 2
      })
      this.samples += frame.data.length / 2
    } catch (e) {
      console.error('[source] stream write failed', e)
      this.active = false
      this.truncated = true
    }
  }

  async stop(): Promise<void> {
    const ws = this.ws
    this.active = false
    if (ws) {
      this.ws = null
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve())
        ws.end()
      })
    }
    await Promise.all(this.closers)
    this.closers = []
  }

  getStatus(): SourceRecorderStatus {
    return {
      recording: this.active,
      frames: this.frames.length,
      samples: this.samples,
      durationMs: this.frames.length ? Date.now() - this.startedAt : 0,
      truncated: this.truncated
    }
  }

  getFrames(): RecordedFrameMeta[] {
    return this.frames.slice()
  }

  getPath(): string {
    return this.segments[0] ?? ''
  }

  async copyTo(target: string): Promise<void> {
    if (this.active) await this.stop()
    if (this.segments.length === 0) throw new Error('没有流式录制文件')
    await fs.copyFile(this.segments[0]!, target)
    for (let i = 1; i < this.segments.length; i++) {
      await fs.appendFile(target, await fs.readFile(this.segments[i]!))
    }
  }

  dispose(): void {
    if (this.ws) {
      this.ws.destroy()
      this.ws = null
    }
    for (const p of this.segments) void fs.unlink(p).catch(() => {})
    this.basePath = ''
    this.segments = []
    this.segmentIndex = 0
    this.currentBytes = 0
    this.frames = []
    this.samples = 0
    this.active = false
    this.truncated = false
    this.pendingBytes = 0
    this.closers = []
  }
}
