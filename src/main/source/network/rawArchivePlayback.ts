/**
 * 连续播放滚动归档目录：读取 index.json，逐段创建 RawIqPlayback，
 * 支持跨段 next/peek/seek/loop 与通道选择。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SourceFrame } from '../../../shared/sourceEngine'
import type { PlaybackSource, SourcePlaybackStatus } from '../../../shared/sourcePlayback'
import type { NetworkFormat } from '../../../shared/sourceNetwork'
import { RawIqPlayback } from './rawIqPlayback'

interface ArchiveIndexEntry {
  path?: string
  metaPath?: string
  bytes?: number
  samples?: number
}

interface SegmentInfo {
  path: string
  format: NetworkFormat
  sampleRate: number
  channels: number
  samples: number
  totalFrames: number
  startMs: number
}

export interface RawArchivePlaybackConfig {
  dir: string
  pointsPerFrame?: number
  channel: number
  fullRate: boolean
  loop?: boolean
}

export class RawArchivePlayback implements PlaybackSource {
  private readonly segments: SegmentInfo[] = []
  private points = 0
  private readonly channel: number
  private readonly displayRate: number
  private readonly totalFrames: number
  private readonly durationMs: number
  private current: RawIqPlayback | null = null
  private currentIndex = -1
  private globalFrame = 0
  private playing = false
  private paused = false
  private loop: boolean
  private cache: SourceFrame | null = null

  constructor(cfg: RawArchivePlaybackConfig) {
    this.channel = Math.max(0, Math.floor(cfg.channel))
    this.loop = cfg.loop !== false
    const indexPath = path.join(cfg.dir, 'index.json')
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      segments?: ArchiveIndexEntry[]
    }
    const entries = Array.isArray(parsed.segments) ? parsed.segments : []
    let maxRate = 0
    for (const e of entries) {
      if (!e.path) continue
      try {
        const meta = JSON.parse(fs.readFileSync(e.metaPath ?? `${e.path}.json`, 'utf8')) as Record<
          string,
          unknown
        >
        const format = meta.sampleFormat
        if (format !== 'ci16' && format !== 'cf32' && format !== 'ci8') continue
        const sampleRate = Number(meta.sampleRate) || 0
        const samples = Number(meta.samples) || 0
        if (sampleRate <= 0 || samples <= 0) continue
        maxRate = Math.max(maxRate, sampleRate)
        this.segments.push({
          path: e.path,
          format,
          sampleRate,
          channels: meta.channels === 2 ? 2 : 1,
          samples,
          totalFrames: 0,
          startMs: 0
        })
      } catch {
        // 跳过损坏/缺失段
      }
    }
    if (this.segments.length === 0) throw new Error('归档目录没有可用段（检查 index.json/sidecar）')
    this.displayRate = cfg.fullRate ? maxRate : Math.min(maxRate, 2_000_000)
    this.points = Math.max(
      1,
      Math.min(
        65_536,
        Math.floor(
          cfg.pointsPerFrame && cfg.pointsPerFrame > 0 ? cfg.pointsPerFrame : this.displayRate / 60
        )
      )
    )
    let totalFrames = 0
    let durationMs = 0
    for (const s of this.segments) {
      s.startMs = durationMs
      const stride = Math.max(1, Math.round(s.sampleRate / this.displayRate))
      s.totalFrames = Math.max(1, Math.ceil(s.samples / (this.points * stride)))
      totalFrames += s.totalFrames
      durationMs += (s.samples / s.sampleRate) * 1000
    }
    this.totalFrames = totalFrames
    this.durationMs = durationMs
  }

  start(): void {
    this.disposeCurrent()
    this.currentIndex = -1
    this.globalFrame = 0
    this.playing = true
    this.paused = false
    this.cache = null
    this.ensureCurrent()
  }

  stop(): void {
    this.playing = false
    this.paused = false
    this.cache = null
    this.disposeCurrent()
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
    this.ensureCurrent()
    const f = this.current?.peek()
    if (f) return f
    // 当前段已读完：先切到下一段，否则 SourceService 会在段边界误判回放结束
    this.disposeCurrent()
    this.currentIndex++
    if (this.currentIndex >= this.segments.length) {
      if (!this.loop) return null
      this.currentIndex = 0
      this.globalFrame = 0
    }
    this.current = this.createSegment(this.currentIndex)
    return this.current.peek()
  }

  seek(index: number): boolean {
    if (!Number.isFinite(index)) return false
    const target = Math.max(0, Math.min(this.totalFrames - 1, Math.floor(index)))
    let acc = 0
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i]!
      if (target < acc + s.totalFrames) {
        this.disposeCurrent()
        this.currentIndex = i
        this.current = this.createSegment(i)
        this.current.seek(target - acc)
        this.globalFrame = target
        this.cache = null
        return true
      }
      acc += s.totalFrames
    }
    return false
  }

  setLoop(loop: boolean): void {
    this.loop = loop
  }

  getStatus(): SourcePlaybackStatus {
    return {
      playing: this.playing,
      paused: this.paused,
      index: Math.min(this.globalFrame, Math.max(0, this.totalFrames - 1)),
      total: this.totalFrames,
      loop: this.loop,
      durationMs: this.durationMs,
      positionMs: Math.min(
        this.durationMs,
        (this.globalFrame * this.points * 1000) / this.displayRate
      ),
      channel: this.channel,
      displaySampleRate: this.displayRate
    }
  }

  dispose(): void {
    this.disposeCurrent()
  }

  private ensureCurrent(): void {
    if (this.current) return
    if (this.currentIndex < 0) this.currentIndex = 0
    if (this.currentIndex >= this.segments.length) {
      if (!this.loop) {
        this.playing = false
        return
      }
      this.currentIndex = 0
      this.globalFrame = 0
    }
    this.current = this.createSegment(this.currentIndex)
  }

  private createSegment(index: number): RawIqPlayback {
    const s = this.segments[index]!
    const play = new RawIqPlayback({
      path: s.path,
      format: s.format,
      sampleRate: s.sampleRate,
      centerHz: 0,
      totalSamples: s.samples,
      displaySampleRate: this.displayRate,
      pointsPerFrame: this.points,
      channels: s.channels,
      channel: Math.min(this.channel, s.channels - 1),
      timeOffsetMs: s.startMs,
      loop: false
    })
    play.start()
    return play
  }

  private advance(): SourceFrame | null {
    this.ensureCurrent()
    if (!this.current) {
      this.playing = false
      return null
    }
    const frame = this.cache ?? this.current.next()
    this.cache = null
    if (frame) {
      this.globalFrame++
      return frame
    }
    this.disposeCurrent()
    this.currentIndex++
    if (this.currentIndex >= this.segments.length) {
      if (!this.loop) {
        this.playing = false
        return null
      }
      this.currentIndex = 0
      this.globalFrame = 0
    }
    this.current = this.createSegment(this.currentIndex)
    return this.advance()
  }

  private disposeCurrent(): void {
    this.current?.dispose()
    this.current = null
  }
}
