/**
 * SourcePlayback：按帧回放已录制的 SourceFrame。
 * 纯数据类，不依赖 Electron/fs；主进程负责解析 .f32 + .json。
 */
import type { SourceFrame } from './sourceEngine'

export interface SourcePlaybackStatus {
  playing: boolean
  index: number
  total: number
  loop: boolean
}

export class SourcePlayback {
  private index = 0
  private playing = false
  private readonly frames: SourceFrame[]
  private readonly loop: boolean

  constructor(frames: SourceFrame[], opts: { loop?: boolean } = {}) {
    if (frames.length === 0) throw new Error('playback needs at least one frame')
    this.frames = frames
    this.loop = opts.loop !== false
  }

  start(): void {
    this.index = 0
    this.playing = true
  }

  stop(): void {
    this.playing = false
  }

  next(): SourceFrame | null {
    if (!this.playing) return null
    if (this.index >= this.frames.length) {
      if (!this.loop) {
        this.playing = false
        return null
      }
      this.index = 0
    }
    return this.frames[this.index++] ?? null
  }

  getStatus(): SourcePlaybackStatus {
    return {
      playing: this.playing,
      index: this.index,
      total: this.frames.length,
      loop: this.loop
    }
  }
}
