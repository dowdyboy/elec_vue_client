/**
 * SourceStreamRecorder：把 SourceFrame 原始 IQ 顺序写入临时 .f32 文件，
 * 元数据保存在内存；用于长时间录制，避免主进程堆积全部样本。
 */
import { createWriteStream, type WriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SourceFrame } from '../../shared/sourceEngine'
import type { RecordedFrameMeta, SourceRecorderStatus } from '../../shared/sourceRecorder'

export class SourceStreamRecorder {
  private ws: WriteStream | null = null
  private filePath = ''
  private frames: RecordedFrameMeta[] = []
  private samples = 0
  private startedAt = 0
  private active = false
  private truncated = false

  start(): void {
    this.dispose()
    this.filePath = path.join(
      os.tmpdir(),
      `dsh-source-${Date.now()}-${Math.random().toString(36).slice(2)}.f32`
    )
    this.ws = createWriteStream(this.filePath)
    this.frames = []
    this.samples = 0
    this.startedAt = Date.now()
    this.active = true
    this.truncated = false
  }

  push(frame: SourceFrame): void {
    if (!this.active || !this.ws) return
    try {
      this.ws.write(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength))
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
    if (!ws) return
    this.ws = null
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve())
      ws.end()
    })
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
    return this.filePath
  }

  async copyTo(target: string): Promise<void> {
    if (this.active) await this.stop()
    if (!this.filePath) throw new Error('没有流式录制文件')
    await fs.copyFile(this.filePath, target)
  }

  dispose(): void {
    if (this.ws) {
      this.ws.destroy()
      this.ws = null
    }
    if (this.filePath) {
      void fs.unlink(this.filePath).catch(() => {})
    }
    this.filePath = ''
    this.frames = []
    this.samples = 0
    this.active = false
    this.truncated = false
  }
}
