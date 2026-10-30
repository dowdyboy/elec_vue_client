/**
 * SourcePlayback：按帧回放已录制的 SourceFrame。
 * 纯数据类，不依赖 Electron/fs；主进程负责解析 .f32 + .json。
 */
import type { SourceFrame } from './sourceEngine'

export interface SourcePlaybackStatus {
  playing: boolean
  paused: boolean
  index: number
  total: number
  loop: boolean
}

export class SourcePlayback {
  private index = 0
  private playing = false
  private paused = false
  private loop: boolean
  private readonly frames: SourceFrame[]

  constructor(frames: SourceFrame[], opts: { loop?: boolean } = {}) {
    if (frames.length === 0) throw new Error('playback needs at least one frame')
    this.frames = frames
    this.loop = opts.loop !== false
  }

  start(): void {
    this.index = 0
    this.playing = true
    this.paused = false
  }

  stop(): void {
    this.playing = false
    this.paused = false
  }

  pause(): void {
    if (this.playing) this.paused = true
  }

  resume(): void {
    if (this.playing) this.paused = false
  }

  setLoop(loop: boolean): void {
    this.loop = loop
  }

  /** 查看下一帧但不前进 */
  peek(): SourceFrame | null {
    if (!this.playing) return null
    return (
      this.frames[this.index >= this.frames.length ? (this.loop ? 0 : this.index) : this.index] ??
      null
    )
  }

  /** 暂停/播放状态下手工前进一帧 */
  step(): SourceFrame | null {
    if (!this.playing) return null
    return this.advance()
  }

  next(): SourceFrame | null {
    if (!this.playing || this.paused) return null
    return this.advance()
  }

  private advance(): SourceFrame | null {
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
      paused: this.paused,
      index: this.index,
      total: this.frames.length,
      loop: this.loop
    }
  }
}
