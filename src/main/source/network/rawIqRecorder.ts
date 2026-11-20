/**
 * 网络源全速 raw 录制：把解析出的 payload 原样写盘（ci16/cf32/ci8），
 * 不做 Float32 转换，适合 AD9361 等高采样率场景。
 *
 * 产物：临时目录下分段 `seg-0001.ci16...` + `meta.json`；导出时合并为单文件 + sidecar JSON。
 * 录制期间用 writableLength 做背压，TcpIqSource 可据此暂停 TCP，尽量避免丢样本。
 */
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { networkBytesPerSample, type NetworkFormat } from '../../../shared/sourceNetwork'
import type { IqPacketMeta } from './iqStreamParser'

export interface RawRecordOptions {
  /** 单段字节数（默认 256 MB） */
  segmentBytes?: number
  /** 总上限（默认 4 GB；0=不限，配合 archiveDir 做滚动归档） */
  maxBytes?: number
  /** 每段写满后自动归档到该目录（重命名/复制 + sidecar；不影响当前段导出） */
  archiveDir?: string
}

export interface RawArchiveFile {
  path: string
  metaPath: string
  bytes: number
  samples: number
  archiveAt: number
}

export interface RawRecordStatus {
  recording: boolean
  frames: number
  samples: number
  bytes: number
  durationMs: number
  segments: number
  truncated: boolean
  backlogBytes: number
  format: NetworkFormat
  /** 通道数（1/2）；samples 按每通道计 */
  channels: number
  /** 滚动归档目录（空=未启用） */
  archiveDir: string
  archivedFiles: number
  archivedBytes: number
  archiveIndexPath: string
  diskFreeBytes: number
  lowDisk: boolean
  sampleRate: number
  centerHz: number
  startedAt: number
  hasUnexported: boolean
}

export interface RawExportResult {
  path: string
  metaPath: string
  bytes: number
  samples: number
  frames: number
  segments: number
}

interface Segment {
  path: string
  bytes: number
  samples: number
  frames: number
}

const DEFAULT_SEGMENT_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024
const HIGH_WATER = 64 * 1024 * 1024
const LOW_WATER = 16 * 1024 * 1024

export class RawIqRecorder {
  /** 清理上次异常退出/测试遗留的 elec-raw-* 临时目录（单实例启动时调用） */
  static cleanupStaleTempDirs(): number {
    let removed = 0
    try {
      for (const entry of readdirSync(os.tmpdir(), { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('elec-raw-')) continue
        try {
          rmSync(path.join(os.tmpdir(), entry.name), { recursive: true, force: true })
          removed++
        } catch {
          // 文件仍被占用：留给下次启动
        }
      }
    } catch {
      // 无法读临时目录：忽略
    }
    return removed
  }
  private readonly format: NetworkFormat
  private readonly bps: number
  private readonly channels: number
  private readonly sampleRate: number
  private readonly centerHz: number
  private dir = ''
  private ws: WriteStream | null = null
  private segments: Segment[] = []
  private recording = false
  private truncated = false
  private frames = 0
  private totalBytes = 0
  private totalSamples = 0
  /** 当前未归档段字节/样本（导出 sidecar 必须与实际文件一致） */
  private exportBytes = 0
  private exportSamples = 0
  private exportFrames = 0
  private readonly archives: RawArchiveFile[] = []
  private archiveDir = ''
  private archiveQueue: Promise<void> = Promise.resolve()
  private archiveSeq = 0
  private diskFreeBytes = 0
  private lowDisk = false
  private startedAt = 0
  private firstTsNs = 0
  private lastTsNs = 0
  private segmentIndex = 0
  private currentBytes = 0
  private segmentBytes = DEFAULT_SEGMENT_BYTES
  private maxBytes = DEFAULT_MAX_BYTES
  private exported = false
  private closers: Promise<void>[] = []

  constructor(format: NetworkFormat, sampleRate: number, centerHz: number, channels = 1) {
    this.format = format
    this.bps = networkBytesPerSample(format)
    this.channels = channels === 2 ? 2 : 1
    this.sampleRate = sampleRate
    this.centerHz = centerHz
  }

  async start(opts: RawRecordOptions = {}): Promise<void> {
    this.segmentBytes = Math.max(1 * 1024 * 1024, opts.segmentBytes ?? DEFAULT_SEGMENT_BYTES)
    this.maxBytes =
      opts.maxBytes === 0
        ? Number.POSITIVE_INFINITY
        : Math.max(this.segmentBytes, opts.maxBytes ?? DEFAULT_MAX_BYTES)
    this.archiveDir = opts.archiveDir?.trim() ?? ''
    if (this.archiveDir) {
      await fs.mkdir(this.archiveDir, { recursive: true })
      await this.refreshDiskFree()
    }
    this.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elec-raw-'))
    this.recording = true
    this.truncated = false
    this.frames = 0
    this.totalBytes = 0
    this.totalSamples = 0
    this.exportBytes = 0
    this.exportSamples = 0
    this.exportFrames = 0
    this.archives.length = 0
    this.archiveQueue = Promise.resolve()
    this.archiveSeq = 0
    this.diskFreeBytes = 0
    this.lowDisk = false
    this.startedAt = Date.now()
    this.firstTsNs = 0
    this.lastTsNs = 0
    this.segmentIndex = 0
    this.currentBytes = 0
    this.segments = []
    this.closers = []
    this.exported = false
    this.openSegment()
  }

  push(payload: Uint8Array, meta: IqPacketMeta | null): void {
    if (!this.recording || !this.ws || payload.length === 0) return
    if (this.totalBytes + payload.length > this.maxBytes) {
      this.truncated = true
      this.recording = false
      const ws = this.ws
      this.ws = null
      if (ws) {
        this.closers.push(closePromise(ws))
        ws.end()
      }
      return
    }
    if (this.currentBytes > 0 && this.currentBytes + payload.length > this.segmentBytes) {
      this.rotate()
      if (!this.ws) return
    }
    const buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
    const ok = this.ws!.write(buf)
    this.currentBytes += buf.length
    this.totalBytes += buf.length
    this.totalSamples += buf.length / (this.bps * this.channels)
    this.exportBytes += buf.length
    this.exportSamples += buf.length / (this.bps * this.channels)
    this.exportFrames++
    this.frames++
    const seg = this.segments[this.segments.length - 1]!
    seg.bytes += buf.length
    seg.samples += buf.length / (this.bps * this.channels)
    seg.frames++
    if (meta) {
      if (this.firstTsNs === 0) this.firstTsNs = meta.timestampNs
      this.lastTsNs = meta.timestampNs
    }
    if (!ok) {
      // backpressure 由 writableLength 反映，TcpIqSource 会暂停 TCP
    }
  }

  getStatus(): RawRecordStatus {
    const durationMs = this.durationMs()
    return {
      recording: this.recording,
      frames: this.frames,
      samples: Math.floor(this.totalSamples),
      bytes: this.totalBytes,
      durationMs,
      segments: this.segments.length,
      truncated: this.truncated,
      backlogBytes: this.ws?.writableLength ?? 0,
      format: this.format,
      channels: this.channels,
      archiveDir: this.archiveDir,
      archivedFiles: this.archives.length,
      archivedBytes: this.archives.reduce((sum, a) => sum + a.bytes, 0),
      archiveIndexPath: this.archiveDir ? path.join(this.archiveDir, 'index.json') : '',
      diskFreeBytes: this.diskFreeBytes,
      lowDisk: this.lowDisk,
      sampleRate: this.sampleRate,
      centerHz: this.centerHz,
      startedAt: this.startedAt,
      hasUnexported: this.exportBytes > 0 && !this.exported
    }
  }

  shouldPause(): boolean {
    return this.recording && (this.ws?.writableLength ?? 0) > HIGH_WATER
  }

  shouldResume(): boolean {
    return (this.ws?.writableLength ?? 0) < LOW_WATER
  }

  async stop(): Promise<void> {
    this.recording = false
    const ws = this.ws
    this.ws = null
    if (ws) {
      this.closers.push(closePromise(ws))
      ws.end()
    }
    await Promise.all(this.closers)
    this.closers = []
    await this.archiveQueue
    await this.writeMeta()
  }

  async exportTo(target: string): Promise<RawExportResult> {
    if (this.recording) await this.stop()
    if (this.segments.length === 0 || this.exportBytes === 0)
      throw new Error('没有可导出的 raw 录制')
    await concatSegments(
      this.segments.map((s) => s.path),
      target
    )
    this.exported = true
    const metaPath = `${target}.json`
    await fs.writeFile(metaPath, JSON.stringify(this.metaJson(), null, 2), 'utf8')
    return {
      path: target,
      metaPath,
      bytes: this.exportBytes,
      samples: Math.floor(this.exportSamples),
      frames: this.exportFrames,
      segments: this.segments.length
    }
  }

  async dispose(): Promise<void> {
    await this.stop()
    if (this.dir) {
      await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {})
      this.dir = ''
    }
    this.segments = []
    this.totalBytes = 0
    this.totalSamples = 0
    this.exportBytes = 0
    this.exportSamples = 0
    this.exportFrames = 0
    this.archives.length = 0
    this.frames = 0
    this.exported = false
  }

  private openSegment(): void {
    const p = path.join(
      this.dir,
      `seg-${String(this.segmentIndex++).padStart(4, '0')}.${this.format}`
    )
    const ws = createWriteStream(p)
    ws.on('error', () => {
      this.truncated = true
      this.recording = false
      if (this.ws === ws) this.ws = null
    })
    this.ws = ws
    this.segments.push({ path: p, bytes: 0, samples: 0, frames: 0 })
    this.currentBytes = 0
  }

  private rotate(): void {
    const ws = this.ws
    if (!ws) return
    const closed = this.segments[this.segments.length - 1]
    this.ws = null
    const closedPromise = closePromise(ws)
    this.closers.push(closedPromise)
    ws.end()
    this.openSegment()
    if (this.archiveDir && closed && closed.bytes > 0) {
      this.queueArchive(closed, closedPromise)
    }
  }

  /** 已写满的段异步归档；不阻塞录音写入，stop/export 会等待队列完成 */
  private queueArchive(seg: Segment, closed: Promise<void>): void {
    this.archiveQueue = this.archiveQueue
      .then(async () => {
        await closed
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
        const name = `raw-${stamp}-${process.pid}-${String(this.archiveSeq++).padStart(3, '0')}.${this.format}`
        const target = path.join(this.archiveDir, name)
        try {
          await fs.rename(seg.path, target)
        } catch {
          await fs.copyFile(seg.path, target)
          await fs.rm(seg.path, { force: true })
        }
        const metaPath = `${target}.json`
        const meta = {
          format: 'raw-iq-v1',
          sampleFormat: this.format,
          bytesPerSample: this.bps,
          channels: this.channels,
          sampleRate: this.sampleRate,
          centerHz: this.centerHz,
          bytes: seg.bytes,
          samples: Math.floor(seg.samples),
          frames: seg.frames,
          segments: 1,
          truncated: false,
          archivedAt: Date.now()
        }
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
        const entry: RawArchiveFile = {
          path: target,
          metaPath,
          bytes: seg.bytes,
          samples: Math.floor(seg.samples),
          archiveAt: Date.now()
        }
        this.archives.push(entry)
        await this.updateArchiveIndex(entry)
        await this.refreshDiskFree()
        this.segments = this.segments.filter((s) => s !== seg)
        this.exportBytes = Math.max(0, this.exportBytes - seg.bytes)
        this.exportSamples = Math.max(0, this.exportSamples - seg.samples)
        this.exportFrames = Math.max(0, this.exportFrames - seg.frames)
      })
      .catch((e) => {
        console.error('[raw] segment archive failed', e)
        this.truncated = true
      })
  }

  private durationMs(): number {
    if (this.firstTsNs > 0 && this.lastTsNs >= this.firstTsNs) {
      return Math.max(0, (this.lastTsNs - this.firstTsNs) / 1e6)
    }
    if (this.sampleRate > 0) return (this.totalSamples / this.sampleRate) * 1000
    return 0
  }

  private async updateArchiveIndex(entry: RawArchiveFile): Promise<void> {
    if (!this.archiveDir) return
    const indexPath = path.join(this.archiveDir, 'index.json')
    let segments: RawArchiveFile[] = []
    try {
      const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
        segments?: RawArchiveFile[]
      }
      if (Array.isArray(parsed.segments)) segments = parsed.segments
    } catch {
      // 首次归档
    }
    segments.push(entry)
    await fs.writeFile(indexPath, JSON.stringify({ version: 1, segments }, null, 2), 'utf8')
  }

  private async refreshDiskFree(): Promise<void> {
    if (!this.archiveDir) return
    try {
      const st = await fs.statfs(this.archiveDir)
      this.diskFreeBytes = Number(st.bavail) * Number(st.bsize)
      this.lowDisk = this.diskFreeBytes < 1024 * 1024 * 1024
    } catch {
      this.diskFreeBytes = 0
      this.lowDisk = false
    }
  }

  private metaJson(): Record<string, unknown> {
    return {
      format: 'raw-iq-v1',
      sampleFormat: this.format,
      bytesPerSample: this.bps,
      channels: this.channels,
      sampleRate: this.sampleRate,
      centerHz: this.centerHz,
      bytes: this.exportBytes,
      samples: Math.floor(this.exportSamples),
      frames: this.exportFrames,
      segments: this.segments.length,
      truncated: this.truncated,
      startedAt: this.startedAt,
      durationMs: this.durationMs()
    }
  }

  private async writeMeta(): Promise<void> {
    if (!this.dir || this.totalBytes === 0) return
    await fs.writeFile(
      path.join(this.dir, 'meta.json'),
      JSON.stringify(this.metaJson(), null, 2),
      'utf8'
    )
  }
}

function closePromise(ws: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve())
  })
}

async function concatSegments(paths: string[], target: string): Promise<void> {
  const out = createWriteStream(target, { flags: 'w' })
  try {
    for (const p of paths) {
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(p)
        rs.on('error', reject)
        rs.on('end', resolve)
        rs.pipe(out, { end: false })
      })
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject)
      out.end(() => resolve())
    })
  } catch (e) {
    out.destroy()
    throw e
  }
}
