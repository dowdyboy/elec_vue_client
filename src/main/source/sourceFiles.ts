/**
 * 源文件选择与解析（从 sourceService.ts 拆出）
 *
 * 只做"对话框 + 文件读写 + 帧重建"，不持有服务状态：
 *   - pickRecording()            选择 .f32/.json 内存录制并重建 SourceFrame[]
 *   - pickRawRecordingFile()     选择网络源 raw 录制（.ci16/.cf32/.ci8 + sidecar）
 *   - pickArbitraryIq()          任意裸 IQ 导入（按文件大小/用户输入推断格式）
 *   - readRawMeta()              读 raw 录制的 sidecar JSON
 */
import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import type { SignalAnalysisConfig } from '../../shared/signal'
import type { SourceFrame } from '../../shared/sourceEngine'

interface LoadRecordingResult {
  ok: boolean
  canceled?: boolean
  error?: string
  path?: string
  frames?: SourceFrame[]
}

/** 选择 .f32/.json 录制文件并重建 SourceFrame */
export async function pickRecording(): Promise<LoadRecordingResult> {
  const focused = BrowserWindow.getFocusedWindow()
  const opts = {
    title: '打开源录制（.f32 + .json）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [
      { name: 'Source IQ', extensions: ['f32', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const ret = focused
    ? await dialog.showOpenDialog(focused, opts)
    : await dialog.showOpenDialog(opts)
  if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
  const selected = ret.filePaths[0]!
  const f32Path = selected.toLowerCase().endsWith('.f32')
    ? selected
    : selected.replace(/\.json$/i, '.f32')
  const jsonPath = selected.toLowerCase().endsWith('.json')
    ? selected
    : selected.replace(/\.f32$/i, '.json')
  try {
    const metaRaw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
      format?: string
      /** 新录制写 signal；旧录制缺省按 wall（用累计采样时间换算成信号时间） */
      timebase?: 'signal' | 'wall'
      sampleRate?: number | null
      frames?: Array<{
        seq: number
        timestamp: number
        wallTimestamp?: number
        sampleRate: number | null
        centerFrequencyHz: number | null
        outputMode: 'real' | 'complex'
        waveform: SourceFrame['waveform']
        modType: SourceFrame['modType']
        samplesPerSymbol: number
        amplitude: number
        sampleCount: number
      }>
    }
    if (metaRaw.format !== 'source-iq-f32-v1' || !Array.isArray(metaRaw.frames))
      return { ok: false, error: '元数据格式不是 source-iq-f32-v1' }
    const buf = await fs.readFile(f32Path)
    // 大录制（1GB 级）不再逐帧拷贝：整体只保有一份 Float32 视图，帧用 subarray 共享内存。
    // readFile 返回的 Buffer 通常自成一块 ArrayBuffer（byteOffset 0），此时零拷贝；否则退回一次拷贝。
    const all =
      buf.byteOffset % 4 === 0
        ? new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
        : (() => {
            const copy = new Uint8Array(buf.byteLength)
            copy.set(buf)
            return new Float32Array(copy.buffer)
          })()
    const fallbackRate =
      typeof metaRaw.sampleRate === 'number' && metaRaw.sampleRate > 0 ? metaRaw.sampleRate : 4096
    const wallTimebase = metaRaw.timebase !== 'signal'
    const frames: SourceFrame[] = []
    let off = 0
    let signalMs = 0
    for (const m of metaRaw.frames) {
      const n = m.sampleCount >>> 0
      if (n === 0 || off + n * 8 > buf.length)
        return { ok: false, error: 'IQ 文件与元数据长度不匹配' }
      const data = all.subarray(off / 4, off / 4 + n * 2)
      off += n * 8
      // 录制中途改过采样率时元数据顶层的 sampleRate 为 null，逐帧优先、再回退顶层/默认
      const frameSampleRate =
        typeof m.sampleRate === 'number' && m.sampleRate > 0 ? m.sampleRate : fallbackRate
      // 旧录制只有墙钟 timestamp：按累计采样时间重算信号时间，保证按时间戳回放是信号实时
      const timestamp = wallTimebase ? signalMs : m.timestamp
      signalMs += (n / frameSampleRate) * 1000
      frames.push({
        seq: m.seq,
        timestamp,
        wallTimestamp: m.wallTimestamp ?? (wallTimebase ? m.timestamp : undefined),
        sampleRate: frameSampleRate,
        centerFrequencyHz:
          typeof m.centerFrequencyHz === 'number' && Number.isFinite(m.centerFrequencyHz)
            ? m.centerFrequencyHz
            : 0,
        outputMode: m.outputMode,
        waveform: m.waveform,
        modType: m.modType,
        samplesPerSymbol: m.samplesPerSymbol,
        amplitude: m.amplitude,
        data
      })
    }
    if (frames.length === 0) return { ok: false, error: '录制文件没有帧' }
    return { ok: true, path: f32Path, frames }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

interface RawMetaInfo {
  path: string
  format: 'cf32' | 'ci16' | 'ci8'
  channels: number
  sampleRate: number
  centerHz: number
  samples: number
}

/** 读取 raw 录制 sidecar（<raw>.json）；找不到/格式不符返回 null */
export async function readRawMeta(rawPath: string): Promise<RawMetaInfo | null> {
  const jsonPath = rawPath.toLowerCase().endsWith('.json') ? rawPath : `${rawPath}.json`
  const actualRaw = jsonPath.toLowerCase().endsWith('.json') ? jsonPath.slice(0, -5) : rawPath
  try {
    const meta = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as Record<string, unknown>
    if (meta.format !== 'raw-iq-v1') return null
    const format = meta.sampleFormat
    if (format !== 'cf32' && format !== 'ci16' && format !== 'ci8') return null
    const sampleRate = typeof meta.sampleRate === 'number' ? meta.sampleRate : 0
    const samples = typeof meta.samples === 'number' ? Math.floor(meta.samples) : 0
    if (!(sampleRate > 0) || samples <= 0) return null
    const centerHz = typeof meta.centerHz === 'number' ? meta.centerHz : 0
    const channels = meta.channels === 2 ? 2 : 1
    return { path: actualRaw, format, channels, sampleRate, centerHz, samples }
  } catch {
    return null
  }
}

export async function pickRawRecordingFile(): Promise<{
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}> {
  const focused = BrowserWindow.getFocusedWindow()
  const opts = {
    title: '打开网络源 raw 录制（.ci16/.cf32/.ci8 + .json）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [
      { name: 'Raw IQ', extensions: ['ci16', 'cf32', 'ci8', 'bin'] },
      { name: 'JSON metadata', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const ret = focused
    ? await dialog.showOpenDialog(focused, opts)
    : await dialog.showOpenDialog(opts)
  if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
  return { ok: true, path: ret.filePaths[0] }
}

/** 任意原始 IQ 文件（little-endian interleaved f32）→ SourceFrame */
export async function pickArbitraryIq(
  config: SignalAnalysisConfig
): Promise<LoadRecordingResult & { truncated?: boolean }> {
  const focused = BrowserWindow.getFocusedWindow()
  const opts = {
    title: '导入任意 IQ（little-endian interleaved f32）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [
      { name: 'Raw IQ', extensions: ['f32', 'bin', 'raw'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const ret = focused
    ? await dialog.showOpenDialog(focused, opts)
    : await dialog.showOpenDialog(opts)
  if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
  const path = ret.filePaths[0]!
  try {
    const stat = await fs.stat(path)
    const maxSamples = 8_000_000
    const readBytes = Math.min(stat.size, maxSamples * 8)
    if (readBytes < 16) return { ok: false, error: 'IQ 文件过短' }
    const fh = await fs.open(path, 'r')
    let buf: Buffer
    try {
      buf = Buffer.alloc(readBytes)
      const { bytesRead } = await fh.read(buf, 0, readBytes, 0)
      if (bytesRead < 16) return { ok: false, error: 'IQ 文件过短' }
      buf = buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
    const totalSamples = Math.floor(stat.size / 8)
    const samples = Math.floor(buf.length / 8)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + samples * 8)
    const all = new Float32Array(ab)
    const perFrame = Math.max(1, Math.floor(config.pointsPerFrame))
    const frames: SourceFrame[] = []
    const wallNow = Date.now()
    for (let start = 0, seq = 1; start < samples; start += perFrame, seq++) {
      const count = Math.min(perFrame, samples - start)
      frames.push({
        seq,
        // 文件回放的信号时间由采样位置推导（与 sampleRate 一致）
        timestamp: (start / config.sampleRate) * 1000,
        wallTimestamp: wallNow,
        sampleRate: config.sampleRate,
        centerFrequencyHz: config.freq,
        outputMode: config.outputMode,
        waveform: 'file',
        modType: 'sine',
        samplesPerSymbol: config.samplesPerSymbol,
        amplitude: config.amplitude,
        data: all.slice(start * 2, (start + count) * 2)
      })
    }
    return { ok: true, path, frames, truncated: samples < totalSamples }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
