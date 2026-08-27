/**
 * 内置远端Mock服务端（与 LocalAnalysisSource 同端口互斥，供远程演示一键启动）
 * 复用 shared/signalDsp 计算，行为与 scripts/remote-signal-mock.mjs 一致，
 * 但由 Electron 主进程托管，无需独立终端。
 * 约束：与 signalAnalysis 的本地服务同端口（默认 8767），只能二选一运行（OS 端口占用即互斥）。
 */
import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { ipcMain } from 'electron'
import {
  defaultAnalysisConfig,
  sanitizeConfigPatch,
  type SignalAnalysisConfig
} from '../../shared/signal'
import { applyWindow, getWindow, magnitudeSpectrum, toDB } from '../../shared/signalDsp'

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
function computeRow(slice: Float32Array, cfg: SignalAnalysisConfig): Float32Array {
  const n = cfg.fftSize
  const re = new Float32Array(n),
    im = new Float32Array(n)
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
    const need = cfg.fftSize * 2,
      step = Math.max(2, Math.floor(cfg.fftSize * (1 - cfg.overlap)) * 2)
    const rows: Float32Array[] = []
    while (this.pos + need <= this.len) {
      rows.push(computeRow(this.buf.subarray(this.pos, this.pos + need), cfg))
      this.pos += step
    }
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

export function registerRemoteMockServer(): () => void {
  let io: SocketIOServer | null = null
  let server: http.Server | null = null
  let timer: NodeJS.Timeout | null = null
  let port = 0
  let cfg: SignalAnalysisConfig = defaultAnalysisConfig()
  let seq = 0
  let phase = 0
  const acc = new SpectrogramAccumulator()

  function genFrame(): Float32Array {
    const n = cfg.pointsPerFrame,
      out = new Float32Array(n * 2),
      scale = noiseScale(cfg.snr),
      amp = cfg.amplitude || 1,
      step = (2 * Math.PI * cfg.freq) / cfg.sampleRate
    if (cfg.modType === 'sine') {
      for (let k = 0; k < n; k++) {
        out[2 * k] = amp * Math.cos(phase) + gaussian() * scale
        out[2 * k + 1] = amp * Math.sin(phase) + gaussian() * scale
        phase += step
        if (phase > Math.PI * 2) phase -= Math.PI * 2
      }
      return out
    }
    const S = Math.max(1, cfg.samplesPerSymbol | 0)
    let symI = 0,
      symQ = 0,
      ph = 0
    for (let k = 0; k < n; k++) {
      if (k % S === 0) {
        if (cfg.modType === 'BPSK') {
          const b = Math.random() > 0.5 ? 1 : 0
          ;[symI, symQ] = BPSK_MAP[b]!
        } else if (cfg.modType === 'QPSK') {
          const b = Math.floor(Math.random() * 4)
          ;[symI, symQ] = QPSK_MAP[b]!
        } else if (cfg.modType === '16QAM') {
          const lv = [-3, -1, 1, 3]
          symI = lv[Math.floor(Math.random() * 4)]! / 3
          symQ = lv[Math.floor(Math.random() * 4)]! / 3
        }
      }
      const ci = Math.cos(ph),
        si = Math.sin(ph)
      ph += step
      out[2 * k] = symI * ci - symQ * si + gaussian() * scale * 0.3
      out[2 * k + 1] = symI * si + symQ * ci + gaussian() * scale * 0.3
    }
    return out
  }

  function tick(force = false): void {
    if (!io || !cfg.enabled) return
    // 空闲跳过：无订阅客户端时不做生成/FFT 重计算（trigger 强制一帧不受限）
    if (!force && io.engine.clientsCount === 0) return
    const iq = genFrame(),
      s = ++seq
    io.emit('signal:analysis', {
      type: 2,
      seq: s,
      buffer: Buffer.from(iq.buffer, iq.byteOffset, iq.byteLength),
      modType: cfg.modType
    })
    const need = cfg.fftSize * 2,
      slice = iq.length >= need ? iq.subarray(iq.length - need) : iq
    const spec = computeRow(slice, cfg)
    io.emit('signal:analysis', {
      type: 0,
      seq: s,
      fftSize: cfg.fftSize,
      buffer: Buffer.from(spec.buffer, spec.byteOffset, spec.byteLength),
      modType: cfg.modType
    })
    const rows = acc.push(iq, cfg)
    for (const row of rows) {
      io.emit('signal:analysis', {
        type: 1,
        seq: ++seq,
        fftSize: cfg.fftSize,
        buffer: Buffer.from(row.buffer, row.byteOffset, row.byteLength),
        modType: cfg.modType
      })
    }
  }

  ipcMain.handle(
    'remoteMock:start',
    async (_e, opts?: { port?: number; config?: Partial<SignalAnalysisConfig> }) => {
      if (server || io) return { ok: false, error: '远端Mock已运行，请先停止' }
      const p = opts?.port ?? 8767
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, error: `端口非法: ${p}` }
      if (opts?.config) cfg = { ...cfg, ...opts.config }
      return await new Promise<{ ok: boolean; port?: number; error?: string }>((resolve) => {
        try {
          server = http.createServer((_, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.end(JSON.stringify({ ok: true, note: 'remote mock', port: p }))
          })
          io = new SocketIOServer(server, { cors: { origin: '*' } })
          io.on('connection', (sock) => {
            console.log(`[remote-mock] client ${sock.id} connected`)
            sock.on('signal:analysis:config', (patch: unknown) => {
              console.log('[remote-mock] recv config', patch)
              const res = sanitizeConfigPatch(patch)
              if (!res.ok || !res.value) {
                console.warn('[remote-mock] invalid config ignored:', res.error)
                return
              }
              cfg = { ...cfg, ...res.value } as SignalAnalysisConfig
              acc.reset()
            })
            sock.on('signal:analysis:trigger', () => tick(true))
          })
          const onError = (err: NodeJS.ErrnoException): void => {
            console.error('[remote-mock] server error', err)
            if (timer) {
              clearInterval(timer)
              timer = null
            }
            try {
              io?.close()
            } catch {
              void 0
            }
            io = null
            try {
              server?.close()
            } catch {
              void 0
            }
            server = null
            const msg =
              err.code === 'EADDRINUSE'
                ? `端口 ${p} 已被占用（本地与远端同端口，只能其一运行）`
                : err.message
            resolve({ ok: false, error: msg })
          }
          server.once('error', onError)
          server.listen(p, '127.0.0.1', () => {
            server?.removeListener('error', onError)
            port = p
            console.log(`[remote-mock] listening http://127.0.0.1:${port}`)
            timer = setInterval(tick, Math.max(16, Math.floor(1000 / 60)))
            resolve({ ok: true, port })
          })
        } catch (err) {
          if (timer) {
            clearInterval(timer)
            timer = null
          }
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
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })
    }
  )

  ipcMain.handle('remoteMock:stop', async () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    // 等待端口真正释放，与 signalAnalysis:stop 同样避免重启竞态
    if (io) {
      const closing = io
      io = null
      await new Promise<void>((resolve) => closing.close(() => resolve()))
    }
    if (server) {
      const closing = server
      server = null
      closing.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        closing.close(() => resolve())
        setTimeout(resolve, 500)
      })
    }
    port = 0
    seq = 0
    phase = 0
    acc.reset()
    return { ok: true }
  })

  ipcMain.handle('remoteMock:getStatus', () => ({
    running: !!(server || io),
    port,
    config: { ...cfg }
  }))

  return () => {
    if (timer) clearInterval(timer)
    io?.close()
    server?.close()
    ipcMain.removeHandler('remoteMock:start')
    ipcMain.removeHandler('remoteMock:stop')
    ipcMain.removeHandler('remoteMock:getStatus')
  }
}
