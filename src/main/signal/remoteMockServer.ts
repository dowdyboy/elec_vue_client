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
import { createSignalGenerator, type SignalGenerator } from '../../shared/signalDsp'
import { SpectrogramAccumulator, SpectrumAnalyzer } from '../../shared/signalFrames'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

export function registerRemoteMockServer(): () => void {
  let io: SocketIOServer | null = null
  let server: http.Server | null = null
  let timer: NodeJS.Timeout | null = null
  let port = 0
  let cfg: SignalAnalysisConfig = defaultAnalysisConfig()
  let seq = 0
  let gen: SignalGenerator | null = null
  const acc = new SpectrogramAccumulator()
  const spec = new SpectrumAnalyzer()

  function genFrame(): Float32Array {
    return (gen ??= createSignalGenerator(cfg)).next(cfg.pointsPerFrame)
  }

  function tick(force = false): void {
    if (!io) return
    // 与本地源一致：关闭推送后仍允许 trigger 强制单帧
    if (!force && !cfg.enabled) return
    // 空闲跳过：无订阅客户端时不做生成/FFT 重计算（trigger 强制一帧不受限）
    if (!force && io.engine.clientsCount === 0) return
    const iq = genFrame(),
      s = ++seq
    io.emit('signal:analysis', {
      type: 2,
      seq: s,
      sampleRate: cfg.sampleRate,
      outputMode: cfg.outputMode,
      waveform: cfg.waveform,
      buffer: Buffer.from(iq.buffer, iq.byteOffset, iq.byteLength),
      modType: cfg.modType
    })
    const specRow = spec.push(iq, cfg)
    if (specRow) {
      io.emit('signal:analysis', {
        type: 0,
        seq: s,
        fftSize: cfg.fftSize,
        sampleRate: cfg.sampleRate,
        dbScale: cfg.dbScale,
        spectrumMode: cfg.spectrumMode,
        freqStartHz: cfg.spectrumMode === 'complex' ? -cfg.sampleRate / 2 : 0,
        binHz: cfg.sampleRate / cfg.fftSize,
        fftShift: cfg.spectrumMode === 'complex',
        outputMode: cfg.outputMode,
        waveform: cfg.waveform,
        buffer: Buffer.from(specRow.buffer, specRow.byteOffset, specRow.byteLength),
        modType: cfg.modType
      })
    }
    const rows = acc.push(iq, cfg)
    for (const row of rows) {
      io.emit('signal:analysis', {
        type: 1,
        seq: ++seq,
        fftSize: cfg.fftSize,
        sampleRate: cfg.sampleRate,
        dbScale: true,
        spectrumMode: cfg.spectrumMode,
        freqStartHz: cfg.spectrumMode === 'complex' ? -cfg.sampleRate / 2 : 0,
        binHz: cfg.sampleRate / cfg.fftSize,
        fftShift: cfg.spectrumMode === 'complex',
        timeStepSec: (cfg.fftSize * (1 - cfg.overlap)) / cfg.sampleRate,
        outputMode: cfg.outputMode,
        waveform: cfg.waveform,
        buffer: Buffer.from(row.buffer, row.byteOffset, row.byteLength),
        modType: cfg.modType
      })
    }
  }

  ipcMain.handle(
    'remoteMock:start',
    async (e, opts?: { port?: number; config?: Partial<SignalAnalysisConfig> }) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      if (server || io) return { ok: false, error: '远端Mock已运行，请先停止' }
      const p = opts?.port ?? 8767
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, error: `端口非法: ${p}` }
      if (opts?.config) {
        const clean = sanitizeConfigPatch(opts.config)
        if (!clean.ok || !clean.value) return { ok: false, error: clean.error }
        const merged = { ...cfg, ...clean.value }
        if (!(merged.freq > 0 && merged.freq < merged.sampleRate / 2))
          return {
            ok: false,
            error: `freq(${merged.freq}) 须小于 sampleRate/2(${merged.sampleRate / 2})`
          }
        cfg = merged
        gen = null
        spec.reset()
        acc.reset()
      }
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
              const merged = { ...cfg, ...res.value } as SignalAnalysisConfig
              if (!(merged.freq > 0 && merged.freq < merged.sampleRate / 2)) {
                console.warn(
                  `[remote-mock] freq(${merged.freq}) 须小于 sampleRate/2(${merged.sampleRate / 2})，配置忽略`
                )
                return
              }
              cfg = merged
              gen = null // 配置变更：重建生成器
              spec.reset()
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

  ipcMain.handle('remoteMock:stop', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
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
    gen = null
    spec.reset()
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
