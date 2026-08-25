/**
 * 信号分析服务端（统一抽象，替代原 signalMockServer）
 * 【设计】信号处理（FFT / 窗 / dB / 重叠）全部在此完成：
 *   - LocalAnalysisSource：本地主进程自产 IQ 并计算频谱/时频（演示用）
 *   - RemoteAnalysisSource：连接外部 socket.io 后端，消费其算好的帧
 *   渲染进程只通过 IPC 'signal:analysis' 收「显示就绪」帧，不感知来源。
 *
 * 外部后端协议（RemoteAnalysisSource 消费）：
 *   emit('signal:analysis', { type:0|1|2, seq, fftSize?, buffer })  // buffer 为 Float32Array 的二进制
 *   后端可反过来接收：
 *   on('signal:analysis:config', patch)  // 配置下发
 *   on('signal:analysis:trigger')        // 触发单帧
 */

import { BrowserWindow, ipcMain } from 'electron'
import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { io as socketIoClient, type Socket as ClientSocket } from 'socket.io-client'
import {
  defaultAnalysisConfig,
  FRAME_TYPE_BY_CODE,
  FRAME_TYPE_CODE,
  sanitizeConfigPatch,
  type AnalysisFrame,
  type ModType,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { applyWindow, getWindow, magnitudeSpectrum, toDB } from '../../shared/signalDsp'

export interface SignalAnalysisSource {
  readonly mode: 'local' | 'remote'
  start(onFrame: (f: AnalysisFrame) => void): void
  stop(): void
  setConfig(patch: Partial<SignalAnalysisConfig>): void
  getConfig(): SignalAnalysisConfig
  trigger(): void
}

// ──────────────────────────────────────────────────
// 本地生成 + 处理
// ──────────────────────────────────────────────────

// 高斯噪声（Box-Muller）
function gaussian(): number {
  const u = Math.random() || 1e-12
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function noiseScale(snrDb: number): number {
  return Math.pow(10, -snrDb / 20)
}

const QPSK_MAP: Array<[number, number]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1]
]
const BPSK_MAP: Array<[number, number]> = [
  [1, 0],
  [-1, 0]
]

/** 从交织复数切片算一行幅度谱（线性或 dB） */
function computeRow(slice: Float32Array, cfg: SignalAnalysisConfig): Float32Array {
  const n = cfg.fftSize
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  const count = Math.min(n, Math.floor(slice.length / 2))
  for (let k = 0; k < count; k++) {
    re[k] = slice[2 * k]
    im[k] = slice[2 * k + 1]
  }
  const win = getWindow(cfg.window, n)
  applyWindow(re, win)
  applyWindow(im, win)
  let mag = magnitudeSpectrum(re, im)
  if (cfg.dbScale) mag = toDB(mag)
  return mag
}

/** 时频图行累计器（按 overlap 在帧间滑动） */
class SpectrogramAccumulator {
  private buf = new Float32Array(0)
  private len = 0
  private pos = 0

  push(iq: Float32Array, cfg: SignalAnalysisConfig): Float32Array[] {
    if (this.buf.length < this.len + iq.length) {
      const next = Math.max(this.len + iq.length, this.buf.length ? this.buf.length * 2 : 8192)
      const nb = new Float32Array(next)
      nb.set(this.buf.subarray(0, this.len))
      this.buf = nb
    }
    this.buf.set(iq, this.len)
    this.len += iq.length

    const need = cfg.fftSize * 2
    const step = Math.max(2, Math.floor(cfg.fftSize * (1 - cfg.overlap)) * 2)
    const rows: Float32Array[] = []
    while (this.pos + need <= this.len) {
      rows.push(computeRow(this.buf.subarray(this.pos, this.pos + need), cfg))
      this.pos += step
    }
    // 压缩已消费部分
    if (this.pos > cfg.fftSize * 4) {
      this.buf.copyWithin(0, this.pos, this.len)
      this.len -= this.pos
      this.pos = 0
    }
    return rows
  }

  reset(): void {
    this.len = 0
    this.pos = 0
  }
}

class LocalAnalysisSource implements SignalAnalysisSource {
  readonly mode = 'local' as const
  private config: SignalAnalysisConfig
  private timer: NodeJS.Timeout | null = null
  private seq = 0
  private phase = 0
  private acc = new SpectrogramAccumulator()
  private onFrame: ((f: AnalysisFrame) => void) | null = null
  private lastErrAt = 0
  /** 消费者守卫：无窗口且无外部订阅时跳过重计算（trigger 强制一帧不受限） */
  hasConsumers: (() => boolean) | null = null

  constructor(initial?: SignalAnalysisConfig) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
  }

  start(onFrame: (f: AnalysisFrame) => void): void {
    this.onFrame = onFrame
    if (this.timer) return
    const interval = Math.max(16, Math.floor(1000 / 60))
    this.timer = setInterval(() => this.tick(), interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.onFrame = null
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.acc.reset()
  }

  getConfig(): SignalAnalysisConfig {
    return { ...this.config }
  }

  trigger(): void {
    this.tick(true)
  }

  private logError(e: unknown): void {
    const now = Date.now()
    if (now - this.lastErrAt > 5000) {
      this.lastErrAt = now
      console.error('[signal:local] tick failed', e)
    }
  }

  private genFrame(): Float32Array {
    const cfg = this.config
    const n = cfg.pointsPerFrame
    const out = new Float32Array(n * 2)
    const scale = noiseScale(cfg.snr)
    const step = (2 * Math.PI * cfg.freq) / cfg.sampleRate
    if (cfg.modType === 'sine') {
      for (let k = 0; k < n; k++) {
        const i = Math.cos(this.phase) + gaussian() * scale
        const q = Math.sin(this.phase) + gaussian() * scale
        out[2 * k] = i
        out[2 * k + 1] = q
        this.phase += step
        if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2
      }
      return out
    }
    // 调制（基带 × 载波搬频）
    const S = Math.max(1, cfg.samplesPerSymbol | 0)
    let symI = 0
    let symQ = 0
    let ph = 0
    for (let k = 0; k < n; k++) {
      if (k % S === 0) {
        if (cfg.modType === 'BPSK') {
          const b = Math.random() > 0.5 ? 1 : 0
          ;[symI, symQ] = BPSK_MAP[b]!
        } else if (cfg.modType === 'QPSK') {
          const b = Math.floor(Math.random() * 4)
          ;[symI, symQ] = QPSK_MAP[b]!
        } else if (cfg.modType === '16QAM') {
          const levels = [-3, -1, 1, 3]
          symI = levels[Math.floor(Math.random() * 4)]! / 3
          symQ = levels[Math.floor(Math.random() * 4)]! / 3
        }
      }
      const ci = Math.cos(ph)
      const si = Math.sin(ph)
      ph += step
      out[2 * k] = symI * ci - symQ * si + gaussian() * scale * 0.3
      out[2 * k + 1] = symI * si + symQ * ci + gaussian() * scale * 0.3
    }
    return out
  }

  private tick(force = false): void {
    if (!this.onFrame) return
    if (!force && !this.config.enabled) return
    if (!force && this.hasConsumers && !this.hasConsumers()) return
    try {
      const cfg = this.config
      const iq = this.genFrame()
      const seq = ++this.seq
      // IQ（时域图）
      this.onFrame({ type: 'iq', seq, data: iq, modType: cfg.modType })
      // 频谱（最新 fftSize 复数样本）
      const need = cfg.fftSize * 2
      const slice = iq.length >= need ? iq.subarray(iq.length - need) : iq
      const spec = computeRow(slice, cfg)
      this.onFrame({
        type: 'spectrum',
        seq,
        data: spec,
        fftSize: cfg.fftSize,
        modType: cfg.modType
      })
      // 时频（重叠行）
      const rows = this.acc.push(iq, cfg)
      for (const row of rows) {
        this.onFrame({
          type: 'spectrogram',
          seq: ++this.seq,
          data: row,
          fftSize: cfg.fftSize,
          modType: cfg.modType
        })
      }
    } catch (e) {
      // 防御：非法配置（如非 2 的幂 fftSize）不应让主进程定时器反复抛未捕获异常
      this.logError(e)
    }
  }
}

// ──────────────────────────────────────────────────
// 远程后端（socket.io 客户端）
// ──────────────────────────────────────────────────

function toFloat32(buffer: unknown): Float32Array {
  if (!buffer) return new Float32Array(0)
  if (buffer instanceof ArrayBuffer) {
    return buffer.byteLength % 4 ? new Float32Array(0) : new Float32Array(buffer)
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
    if (buffer.byteLength % 4 !== 0) return new Float32Array(0)
    // Buffer 可能来自池化 ArrayBuffer，byteOffset 未 4 对齐会抛 RangeError，需拷贝
    if (buffer.byteOffset % 4 === 0) {
      try {
        return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      } catch {
        // fallthrough to copy
      }
    }
    const out = new Float32Array(buffer.byteLength / 4)
    for (let i = 0; i < out.length; i++) out[i] = buffer.readFloatLE(i * 4)
    return out
  }
  if (ArrayBuffer.isView(buffer)) {
    const v = buffer as ArrayBufferView
    if (v.byteLength % 4 !== 0) return new Float32Array(0)
    if (v.byteOffset % 4 === 0) {
      try {
        return new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4)
      } catch {
        // fallthrough to copy
      }
    }
    // 非对齐或异常 → 按字节拷贝
    const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    const copy = new Uint8Array(u8.length)
    copy.set(u8)
    // copy.buffer 此时对齐（0 偏移）
    return new Float32Array(copy.buffer)
  }
  if (Array.isArray(buffer)) {
    try {
      return new Float32Array(buffer as number[])
    } catch {
      return new Float32Array(0)
    }
  }
  if (typeof buffer === 'string') {
    try {
      const bin = Buffer.from(buffer, 'base64')
      if (bin.length % 4 === 0 && bin.length > 0) {
        if (bin.byteOffset % 4 === 0) {
          try {
            return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4)
          } catch {
            // fallthrough
          }
        }
        const out = new Float32Array(bin.byteLength / 4)
        for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(i * 4)
        return out
      }
    } catch {
      // ignore
    }
    return new Float32Array(0)
  }
  if (typeof buffer === 'object') {
    const obj = buffer as Record<string, unknown>
    // 兼容 {data: number[]}（含 JSON 反序列化出的 {type:'Buffer', data:[...]} 形态）
    if (Array.isArray(obj.data)) {
      try {
        return new Float32Array(obj.data as number[])
      } catch {
        return new Float32Array(0)
      }
    }
  }
  return new Float32Array(0)
}

function extractRemotePayload(p: Record<string, unknown>): unknown {
  // 容错：buffer / data / payload / samples / timeData / i / payloadData 等
  return (
    p.buffer ?? p.data ?? p.payload ?? p.samples ?? p.timeData ?? (p.payloadData as unknown) ?? p
  )
}

function parseRemoteType(raw: unknown): import('../../shared/signal').AnalysisFrameType {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return FRAME_TYPE_BY_CODE[raw] ?? 'iq'
  }
  if (typeof raw === 'string') {
    const s = raw.toLowerCase()
    if (s === 'spectrum' || s === 'spectrogram' || s === 'iq')
      return s as import('../../shared/signal').AnalysisFrameType
    // string numeric "0"/"1"/"2"
    const n = Number(s)
    if (!Number.isNaN(n)) return FRAME_TYPE_BY_CODE[n] ?? 'iq'
    const map: Record<string, import('../../shared/signal').AnalysisFrameType> = {
      '0': 'spectrum',
      '1': 'spectrogram',
      '2': 'iq',
      psd: 'spectrum',
      waterfall: 'spectrogram'
    }
    if (map[s]) return map[s]
  }
  return 'iq'
}

function parseRemoteModType(raw: unknown): ModType | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toUpperCase()
  if (s === 'SINE' || s === 'BPSK' || s === 'QPSK' || s === '16QAM') return s as ModType
  return undefined
}

class RemoteAnalysisSource implements SignalAnalysisSource {
  readonly mode = 'remote' as const
  private config: SignalAnalysisConfig
  private sock: ClientSocket | null = null
  private onFrame: ((f: AnalysisFrame) => void) | null = null
  private url: string

  constructor(
    private rawUrl: string,
    initial?: SignalAnalysisConfig,
    private onStatus?: (s: { connected: boolean; error?: string }) => void
  ) {
    this.config = initial ? { ...initial } : defaultAnalysisConfig()
    // socket.io 需 http(s) 握手，若传入 ws(s) 则转 http(s)
    if (rawUrl.startsWith('ws://')) this.url = 'http://' + rawUrl.slice(5)
    else if (rawUrl.startsWith('wss://')) this.url = 'https://' + rawUrl.slice(6)
    else this.url = rawUrl
  }

  start(onFrame: (f: AnalysisFrame) => void): void {
    this.onFrame = onFrame
    console.log(`[signal:remote] connecting to ${this.url} (raw=${this.rawUrl})`)
    this.sock = socketIoClient(this.url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      timeout: 5000
    })
    this.sock.on('signal:analysis', (raw: unknown) => {
      try {
        const p = (raw ?? {}) as Record<string, unknown>
        const rawType = p.type as unknown
        const type = parseRemoteType(rawType)
        const seq = typeof p.seq === 'number' ? p.seq : Date.now()
        const fftSize =
          typeof p.fftSize === 'number'
            ? p.fftSize
            : typeof p.fft_size === 'number'
              ? (p.fft_size as number)
              : undefined
        const modType = parseRemoteModType(p.modType) ?? parseRemoteModType(p.mod_type)
        const payload = extractRemotePayload(p)
        let data: Float32Array
        if (
          payload &&
          typeof payload === 'object' &&
          !ArrayBuffer.isView(payload as ArrayBufferView) &&
          !(payload instanceof ArrayBuffer) &&
          !Array.isArray(payload) &&
          typeof (payload as Record<string, unknown>).buffer !== 'string'
        ) {
          const obj = payload as Record<string, unknown>
          const hasIQ =
            (Array.isArray(obj.i) ||
              obj.i instanceof Float32Array ||
              ArrayBuffer.isView(obj.i as ArrayBufferView)) &&
            (Array.isArray(obj.q) ||
              obj.q instanceof Float32Array ||
              ArrayBuffer.isView(obj.q as ArrayBufferView))
          const hasCh =
            (Array.isArray(obj.ch0) || Array.isArray(obj.I) || Array.isArray(obj.iData)) &&
            (Array.isArray(obj.ch1) || Array.isArray(obj.Q) || Array.isArray(obj.qData))
          if (hasIQ || hasCh) {
            const getArr = (v: unknown): number[] | null => {
              if (Array.isArray(v)) return v as number[]
              if (v instanceof Float32Array) return Array.from(v)
              if (ArrayBuffer.isView(v as ArrayBufferView))
                return Array.from(v as unknown as number[])
              return null
            }
            const iArr = getArr(obj.i ?? obj.I ?? obj.ch0 ?? obj.iData)
            const qArr = getArr(obj.q ?? obj.Q ?? obj.ch1 ?? obj.qData)
            if (iArr && qArr) {
              const n = Math.min(iArr.length, qArr.length)
              const inter = new Float32Array(n * 2)
              for (let k = 0; k < n; k++) {
                inter[2 * k] = iArr[k] ?? 0
                inter[2 * k + 1] = qArr[k] ?? 0
              }
              data = inter
            } else {
              data = toFloat32(payload)
            }
          } else if (typeof obj.data === 'string' && typeof payload === 'object') {
            data = toFloat32(obj.data)
          } else {
            data = toFloat32(payload)
          }
        } else {
          data = toFloat32(payload)
        }
        if (!data || data.length === 0) {
          console.warn('[signal:remote] empty payload', {
            keys: Object.keys(p),
            rawType,
            fftSize,
            payloadType: payload
              ? ((payload as object).constructor?.name ?? typeof payload)
              : 'null'
          })
        }
        this.onFrame?.({ type, seq, data: data ?? new Float32Array(0), fftSize, modType })
      } catch (e) {
        console.error('[signal:remote] parse failed', e)
      }
    })
    this.sock.on('connect', () => {
      this.sock?.emit('signal:analysis:config', this.config)
      this.onStatus?.({ connected: true })
    })
    this.sock.on('disconnect', (reason: string) => {
      this.onStatus?.({ connected: false, error: `disconnect: ${reason}` })
    })
    let lastErrMsg = ''
    this.sock.on('connect_error', (err: Error) => {
      const rawMsg = err?.message ?? String(err)
      if (rawMsg === lastErrMsg) return
      lastErrMsg = rawMsg
      // 常见：远端未启动 / 非 socket.io / 端口/协议错
      const hint =
        rawMsg.includes('websocket error') || rawMsg.includes('xhr poll error')
          ? ` (url=${this.url}) - 请确认已在独立终端运行: npm run mock:remote 或 node scripts/remote-signal-mock.mjs`
          : ` (url=${this.url})`
      const msg = `${rawMsg}${hint}`
      console.error('[signal:remote] connect_error', msg)
      this.onStatus?.({ connected: false, error: msg })
      // 避免刷屏：3秒后允许再次提示
      setTimeout(() => {
        lastErrMsg = ''
      }, 3000)
    })
  }

  stop(): void {
    this.sock?.close()
    this.sock = null
    this.onFrame = null
  }

  setConfig(patch: Partial<SignalAnalysisConfig>): void {
    this.config = { ...this.config, ...patch }
    this.sock?.emit('signal:analysis:config', patch)
  }

  getConfig(): SignalAnalysisConfig {
    return { ...this.config }
  }

  trigger(): void {
    this.sock?.emit('signal:analysis:trigger')
  }
}

// ──────────────────────────────────────────────────
// 注册（主进程）：统一把帧转发给渲染进程 + 可选 socket.io 外部观众
// ──────────────────────────────────────────────────

export function registerSignalAnalysisServer(): () => void {
  let source: SignalAnalysisSource | null = null
  let io: SocketIOServer | null = null
  let server: http.Server | null = null
  let port = 0
  // 持久化配置（未运行时也保留，供下次 start 使用；setConfig 即更新此处，重启生效）
  let persistedConfig: SignalAnalysisConfig = defaultAnalysisConfig()
  let persistedRemoteUrl = 'http://127.0.0.1:8768'
  let lastEmptyWarnAt = 0

  function isValidUrl(u: string): boolean {
    try {
      const parsed = new URL(u)
      return (
        parsed.protocol === 'http:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'ws:' ||
        parsed.protocol === 'wss:'
      )
    } catch {
      return false
    }
  }

  async function closeIoAndServer(): Promise<void> {
    if (io) {
      const closing = io
      io = null
      await new Promise<void>((resolve) => closing.close(() => resolve()))
    }
    if (server) {
      const closing = server
      server = null
      // 强制断开残留 keep-alive 连接，确保端口立即可复用（Node ≥18.2）
      closing.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        closing.close(() => resolve())
        setTimeout(resolve, 500) // 兜底超时，避免异常连接卡住关闭流程
      })
    }
  }

  function emitFrame(f: AnalysisFrame): void {
    if (!f.data || f.data.length === 0) {
      const now = Date.now()
      if (now - lastEmptyWarnAt > 5000) {
        lastEmptyWarnAt = now
        console.warn('[signal] emit empty frame', f.type, f.seq)
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('signal:analysis', f)
    }
    if (io) {
      // 用 Buffer.from(TypedArray) 直拷，避免池化 offset 对齐陷阱
      let buf: Buffer
      try {
        buf = Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength)
      } catch {
        // 极端非对齐或异常则回退为按字节拷贝
        buf = Buffer.from(new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength))
      }
      io.emit('signal:analysis', {
        type: FRAME_TYPE_CODE[f.type],
        seq: f.seq,
        fftSize: f.fftSize,
        modType: f.modType,
        buffer: buf
      })
    }
  }

  function broadcastRemoteStatus(s: { connected: boolean; error?: string; url?: string }): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('signal:analysis:status', s)
    }
  }

  ipcMain.handle(
    'signalAnalysis:start',
    async (_e, opts?: { mode?: 'local' | 'remote'; port?: number; remoteUrl?: string }) => {
      if (source) return { ok: false, error: '已运行，请先停止' }
      const mode = opts?.mode ?? 'local'
      // 校验
      if (mode === 'local') {
        const p = opts?.port ?? (port || 8767)
        if (!Number.isInteger(p) || p < 1 || p > 65535)
          return { ok: false, error: `端口非法: ${p}` }
      } else if (mode === 'remote') {
        const u = opts?.remoteUrl ?? persistedRemoteUrl
        if (!isValidUrl(u)) return { ok: false, error: `remoteUrl 非法: ${u}` }
      } else {
        return { ok: false, error: `未知模式: ${mode}` }
      }
      try {
        if (mode === 'remote') {
          const u = opts?.remoteUrl ?? persistedRemoteUrl
          persistedRemoteUrl = u
          source = new RemoteAnalysisSource(u, persistedConfig, (s) =>
            broadcastRemoteStatus({ ...s, url: u })
          )
          // 立即告知前端“连接中”
          broadcastRemoteStatus({ connected: false, url: u })
          source.start(emitFrame)
          return { ok: true, mode, remoteUrl: persistedRemoteUrl }
        } else {
          const p = opts?.port ?? 8767
          const local = new LocalAnalysisSource(persistedConfig)
          // 消费者守卫：无窗口且无外部 socket.io 订阅时跳过重计算
          local.hasConsumers = () => BrowserWindow.getAllWindows().length > 0 || io !== null
          source = local
          // 本地模式同时起一个 socket.io 服务，供外部观众订阅 analysis 帧（同端口互斥）
          server = http.createServer((_, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.end(JSON.stringify({ ok: true, note: 'signal analysis server' }))
          })
          io = new SocketIOServer(server, { cors: { origin: '*' } })
          const listenResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
            const onErr = (err: NodeJS.ErrnoException): void => {
              console.error('[signalAnalysis] server error', err)
              const msg =
                err.code === 'EADDRINUSE'
                  ? `端口 ${p} 已被占用（本地与远端同端口，只能其一运行）`
                  : err.message
              resolve({ ok: false, error: msg })
            }
            server!.once('error', onErr)
            server!.listen(p, '127.0.0.1', () => {
              server?.removeListener('error', onErr)
              port = p
              resolve({ ok: true })
            })
          })
          if (!listenResult.ok) {
            source = null
            try {
              io.close()
            } catch {
              void 0
            }
            io = null
            try {
              server.close()
            } catch {
              void 0
            }
            server = null
            return { ok: false, error: listenResult.error }
          }
          source.start(emitFrame)
          return { ok: true, mode, port, remoteUrl: persistedRemoteUrl }
        }
      } catch (err) {
        source = null
        if (io) {
          try {
            io.close()
          } catch {
            void 0
          }
          io = null
        }
        if (server) {
          try {
            server.close()
          } catch {
            void 0
          }
          server = null
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('signalAnalysis:stop', async () => {
    const wasRemote = source?.mode === 'remote'
    source?.stop()
    source = null
    if (wasRemote)
      broadcastRemoteStatus({ connected: false, error: 'stopped', url: persistedRemoteUrl })
    // 等待端口真正释放，消除「停止后立即重启」的 EADDRINUSE 竞态
    await closeIoAndServer()
    port = 0
    return { ok: true }
  })

  ipcMain.handle('signalAnalysis:getStatus', () => ({
    running: source !== null,
    mode: source?.mode ?? 'none',
    port,
    remoteUrl: persistedRemoteUrl,
    config: source?.getConfig() ?? persistedConfig
  }))

  ipcMain.handle('signalAnalysis:setConfig', (_e, patch: unknown) => {
    // 即时生效：校验 → 更新持久化配置 → 同步运行中的 source（FFT/窗等变更由前端组件自适应）
    const res = sanitizeConfigPatch(patch)
    if (!res.ok || !res.value) return { ok: false, error: res.error }
    const merged = { ...persistedConfig, ...res.value }
    if (!(merged.freq > 0 && merged.freq < merged.sampleRate / 2))
      return {
        ok: false,
        error: `freq(${merged.freq}) 须小于 sampleRate/2(${merged.sampleRate / 2})`
      }
    persistedConfig = merged
    if (source) source.setConfig(res.value)
    // remoteUrl 若随配置下发（可选），同步处理
    const maybeUrl = (patch as Record<string, unknown>).remoteUrl
    if (typeof maybeUrl === 'string' && maybeUrl && isValidUrl(maybeUrl))
      persistedRemoteUrl = maybeUrl
    return {
      ok: true,
      config: source?.getConfig() ?? persistedConfig,
      remoteUrl: persistedRemoteUrl
    }
  })

  ipcMain.handle('signalAnalysis:trigger', () => {
    source?.trigger()
    return { ok: true }
  })

  return () => {
    source?.stop()
    source = null
    ipcMain.removeHandler('signalAnalysis:start')
    ipcMain.removeHandler('signalAnalysis:stop')
    ipcMain.removeHandler('signalAnalysis:getStatus')
    ipcMain.removeHandler('signalAnalysis:setConfig')
    ipcMain.removeHandler('signalAnalysis:trigger')
    void closeIoAndServer()
  }
}
