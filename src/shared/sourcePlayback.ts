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
  durationMs: number
  positionMs: number
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

  /** 跳转到指定帧（越界会夹取） */
  seek(index: number): boolean {
    if (!Number.isFinite(index)) return false
    this.index = Math.max(0, Math.min(this.frames.length - 1, Math.floor(index)))
    return true
  }

  /** 跳转到最接近的时间戳 */
  seekTimestamp(timestamp: number): boolean {
    if (!Number.isFinite(timestamp)) return false
    let lo = 0
    let hi = this.frames.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.frames[mid]!.timestamp < timestamp) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) {
      const prev = this.frames[lo - 1]!
      const cur = this.frames[lo]!
      if (Math.abs(prev.timestamp - timestamp) < Math.abs(cur.timestamp - timestamp)) lo--
    }
    this.index = lo
    return true
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
    const first = this.frames[0]!
    const last = this.frames[this.frames.length - 1]!
    const current = this.frames[Math.min(this.index, this.frames.length - 1)] ?? first
    return {
      playing: this.playing,
      paused: this.paused,
      index: this.index,
      total: this.frames.length,
      loop: this.loop,
      durationMs: Math.max(0, last.timestamp - first.timestamp),
      positionMs: Math.max(0, current.timestamp - first.timestamp)
    }
  }
}
