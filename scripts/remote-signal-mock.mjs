/**
 * 远程信号分析 mock 后端（socket.io）
 * 模拟“真实后端已算好帧”的形态：主进程以 RemoteAnalysisSource 连接此服务
 *
 * 用法:
 *   node scripts/remote-signal-mock.mjs                 # 默认 127.0.0.1:8768
 *   node scripts/remote-signal-mock.mjs --port 8768 --host 127.0.0.1
 *   node scripts/remote-signal-mock.mjs --help
 *
 * 协议（与 src/main/signal/analysisServer.ts 保持一致）:
 *   server emit('signal:analysis', { type:0|1|2, seq, fftSize?, sampleRate?, dbScale?, modType?, buffer: Float32Array二进制 })
 *   server on('signal:analysis:config', patch)  // 前端下发的 SignalAnalysisConfig 变更
 *   server on('signal:analysis:trigger', () => tickOnce())
 *
 * 注意：本文件是纯 JS（零依赖，供独立终端直接运行），算法与 src/shared/signalDsp.ts /
 * src/shared/signalFrames.ts 保持同步；src/shared/remoteScriptParity.test.ts 会对比行计算，
 * 防止三套 Mock 再次漂移。
 */
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { Server } from 'socket.io'

// ── DSP（与 shared/signalDsp.ts 同步）──
export function getWindow(type, n) {
  const w = new Float32Array(n)
  if (type === 'rect') {
    w.fill(1)
    return w
  }
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / (n - 1)
    if (type === 'hann') w[i] = 0.5 * (1 - Math.cos(a))
    else if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(a)
    else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
    else w[i] = 1
  }
  return w
}

let winKey = ''
let winData = new Float32Array(0)
let winGain = 1
export function getWindowInfo(type, n) {
  const key = `${type}:${n}`
  if (key !== winKey) {
    const win = getWindow(type, n)
    let sum = 0
    for (let i = 0; i < n; i++) sum += win[i]
    winData = win
    winGain = n > 0 ? sum / n : 1
    winKey = key
  }
  return { win: winData, gain: winGain }
}

export function magnitudeSpectrum(input, imIn, opts = {}) {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two')
  const re = new Float32Array(n)
  const imm = new Float32Array(n)
  re.set(input)
  if (imIn && imIn.length === n) imm.set(imIn)
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = imm[i]
      imm[i] = imm[j]
      imm[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len
    const wlenR = Math.cos(ang)
    const wlenI = -Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1
      let wi = 0
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k]
        const uI = imm[i + k]
        const vR = re[i + k + len / 2] * wr - imm[i + k + len / 2] * wi
        const vI = re[i + k + len / 2] * wi + imm[i + k + len / 2] * wr
        re[i + k] = uR + vR
        imm[i + k] = uI + vI
        re[i + k + len / 2] = uR - vR
        imm[i + k + len / 2] = uI - vI
        const nxtR = wr * wlenR - wi * wlenI
        const nxtI = wr * wlenI + wi * wlenR
        wr = nxtR
        wi = nxtI
      }
    }
  }
  if (opts.full) {
    const out = new Float32Array(n)
    const shift = opts.fftShift ? n / 2 : 0
    for (let i = 0; i < n; i++) {
      const k = (i + shift) % n
      out[i] = Math.hypot(re[k], imm[k]) / n
    }
    return out
  }
  const out = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], imm[i]) / n
  return out
}

export function toDB(mag, floor = -120) {
  const out = new Float32Array(mag.length)
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i] <= 1e-12 ? floor : 20 * Math.log10(mag[i])
    out[i] = Math.max(floor, v)
  }
  return out
}

/** 由交织复数切片算一行幅度谱（窗相干增益已补偿；模式决定单边/双边） */
export function computeRow(slice, cfg, opts = {}) {
  const n = cfg.fftSize
  const complex = (cfg.spectrumMode ?? 'real') === 'complex'
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  const count = Math.min(n, Math.floor(slice.length / 2))
  for (let k = 0; k < count; k++) {
    re[k] = slice[2 * k] ?? 0
    if (complex) im[k] = slice[2 * k + 1] ?? 0
  }
  const { win, gain } = getWindowInfo(cfg.window, n)
  for (let i = 0; i < n; i++) {
    re[i] *= win[i]
    if (complex) im[i] *= win[i]
  }
  const mag = complex
    ? magnitudeSpectrum(re, im, { full: true, fftShift: true })
    : magnitudeSpectrum(re)
  const inv = gain > 1e-12 ? 1 / gain : 1
  if (complex) {
    for (let i = 0; i < mag.length; i++) mag[i] *= inv
  } else {
    for (let i = 0; i < mag.length; i++) mag[i] *= inv * (i === 0 ? 1 : 2)
  }
  return opts.forceDb || cfg.dbScale ? toDB(mag) : mag
}

/** 升余弦成型脉冲（与 shared 同步） */
export function rcTaps(sps, beta = 0.35, spanSymbols = 6) {
  const S = Math.max(1, Math.round(sps))
  const half = Math.max(1, Math.round(spanSymbols / 2))
  const n = half * S * 2 + 1
  const taps = new Float32Array(n)
  const b = Math.min(1, Math.max(0, beta))
  const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
  for (let i = 0; i < n; i++) {
    const t = (i - half * S) / S
    let v
    if (Math.abs(t) < 1e-9) v = 1
    else if (b > 1e-9 && Math.abs(Math.abs(2 * b * t) - 1) < 1e-6)
      v = (Math.PI / 4) * sinc(1 / (2 * b))
    else v = (sinc(t) * Math.cos(Math.PI * b * t)) / (1 - (2 * b * t) ** 2)
    taps[i] = v
  }
  const c = taps[half * S] || 1
  for (let i = 0; i < n; i++) taps[i] /= c
  return taps
}

/**
 * 有状态信号生成器（与 shared/signalDsp.ts 同步）：
 * - 符号集归一化到 E|a|²=1；噪声每路 σ² = 信号功率/(2·10^(snr/10))
 * - 相位/符号时钟/成型历史跨帧连续
 */
export function createGenerator(cfg, opts = {}) {
  const rng = opts.rng ?? Math.random
  const gauss = () => {
    const u = rng() || 1e-12
    const v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const Fs = cfg.sampleRate > 0 ? cfg.sampleRate : 4096
  const amp = cfg.amplitude || 1
  const outputMode = cfg.outputMode ?? 'real'
  const complexOut = outputMode === 'complex'
  const rawWaveform = cfg.waveform ?? (cfg.modType !== 'sine' ? 'digital' : 'cw')
  const waveform = rawWaveform === 'cw' && cfg.modType !== 'sine' ? 'digital' : rawWaveform
  const isDigital = waveform === 'digital'
  const isNoise = waveform === 'noise'
  const imageDb = cfg.imageDb ?? -120
  const imageGain = complexOut && !isNoise && imageDb > -119.9 ? Math.pow(10, imageDb / 20) : 0
  const modFreq = cfg.modFreq ?? 50
  const modStep = (2 * Math.PI * modFreq) / Fs
  const amDepth = Math.min(1, Math.max(0, cfg.amDepth ?? 0.5))
  const fmDev = Math.max(0, cfg.fmDeviation ?? 200)
  const pulsePeriod = Math.max(1e-6, cfg.pulsePeriod ?? 0.01)
  const pulseDuty = Math.min(1, Math.max(0, cfg.pulseDuty ?? 0.5))
  const toneSpacing = Math.max(0, cfg.toneSpacing ?? 100)
  const carrierStep = (2 * Math.PI * cfg.freq) / Fs
  const tone1Step = (2 * Math.PI * (cfg.freq - toneSpacing / 2)) / Fs
  const tone2Step = (2 * Math.PI * (cfg.freq + toneSpacing / 2)) / Fs
  const S = Math.max(1, cfg.samplesPerSymbol | 0)
  const taps = isDigital ? rcTaps(S, 0.35, 6) : null
  const half = taps ? (taps.length - 1) / 2 : 0
  let pulsePower = 1
  if (taps) {
    let energy = 0
    for (let i = 0; i < taps.length; i++) energy += taps[i] * taps[i]
    pulsePower = energy / S
  }
  let powerFactor = 1
  if (waveform === 'am') powerFactor = 1 + (amDepth * amDepth) / 2
  else if (waveform === 'pulse') powerFactor = pulseDuty
  else if (waveform === 'twoTone') powerFactor = 0.5
  else if (isDigital) powerFactor = pulsePower
  const noiseSigma = Math.sqrt(
    (amp * amp * powerFactor * (1 + imageGain * imageGain)) / (2 * Math.pow(10, cfg.snr / 10))
  )
  const SQRT1_2 = Math.SQRT1_2
  const digitalModType = cfg.modType === 'sine' ? 'BPSK' : cfg.modType

  let phase = 0
  let phase2 = 0
  let modPhase = 0
  let sampleIndex = 0
  let baseM = 0
  const symI = []
  const symQ = []

  function wrapPhase(p) {
    const twoPi = Math.PI * 2
    let v = p % twoPi
    if (v < 0) v += twoPi
    return v
  }
  function newSymbol() {
    if (digitalModType === 'BPSK') return rng() > 0.5 ? [1, 0] : [-1, 0]
    if (digitalModType === 'QPSK') {
      const map = [
        [SQRT1_2, SQRT1_2],
        [-SQRT1_2, SQRT1_2],
        [-SQRT1_2, -SQRT1_2],
        [SQRT1_2, -SQRT1_2]
      ]
      return map[Math.floor(rng() * 4)]
    }
    if (digitalModType === '16QAM') {
      const inv = 1 / Math.sqrt(10)
      const lv = [-3, -1, 1, 3]
      return [lv[Math.floor(rng() * 4)] * inv, lv[Math.floor(rng() * 4)] * inv]
    }
    return [0, 0]
  }
  function ensureSymbol(m) {
    while (baseM + symI.length <= m) {
      const [i, q] = newSymbol()
      symI.push(i)
      symQ.push(q)
    }
  }
  function trimSymbols(minM) {
    const drop = minM - 8 - baseM
    if (drop > 64) {
      symI.splice(0, drop)
      symQ.splice(0, drop)
      baseM += drop
    }
  }

  return {
    next(n) {
      const out = new Float32Array(n * 2)
      if (isNoise) {
        if (complexOut) {
          for (let k = 0; k < n; k++) {
            out[2 * k] = amp * SQRT1_2 * gauss()
            out[2 * k + 1] = amp * SQRT1_2 * gauss()
          }
        } else {
          for (let k = 0; k < n; k++) {
            out[2 * k] = amp * gauss()
            out[2 * k + 1] = 0
          }
        }
        sampleIndex += n
        return out
      }
      for (let k = 0; k < n; k++) {
        const t = sampleIndex + k
        let zr = 0
        let zi = 0
        if (isDigital) {
          const mMin = Math.ceil((t - half) / S)
          const mMax = Math.floor((t + half) / S)
          ensureSymbol(mMax)
          let bi = 0
          let bq = 0
          for (let m = mMin; m <= mMax; m++) {
            const j = m - baseM
            if (j < 0) continue
            const h = taps[t - m * S + half]
            if (!h) continue
            bi += symI[j] * h
            bq += symQ[j] * h
          }
          const c = Math.cos(phase)
          const s = Math.sin(phase)
          zr = bi * c - bq * s
          zi = bi * s + bq * c
        } else if (waveform === 'twoTone') {
          zr = 0.5 * (Math.cos(phase) + Math.cos(phase2))
          zi = 0.5 * (Math.sin(phase) + Math.sin(phase2))
        } else {
          let env = 1
          if (waveform === 'am') env = 1 + amDepth * Math.cos(modPhase)
          else if (waveform === 'pulse') {
            const phaseInPeriod = (t / Fs) % pulsePeriod
            env = phaseInPeriod < pulsePeriod * pulseDuty ? 1 : 0
          }
          zr = env * Math.cos(phase)
          zi = env * Math.sin(phase)
        }
        if (complexOut) {
          if (imageGain > 0) {
            zr *= 1 + imageGain
            zi *= 1 - imageGain
          }
          out[2 * k] = amp * zr + gauss() * noiseSigma
          out[2 * k + 1] = amp * zi + gauss() * noiseSigma
        } else {
          out[2 * k] = amp * zr + gauss() * noiseSigma
          out[2 * k + 1] = 0
        }
        if (waveform === 'fm') {
          phase = wrapPhase(phase + carrierStep + ((2 * Math.PI * fmDev) / Fs) * Math.cos(modPhase))
        } else if (waveform === 'twoTone') {
          phase = wrapPhase(phase + tone1Step)
          phase2 = wrapPhase(phase2 + tone2Step)
        } else {
          phase = wrapPhase(phase + carrierStep)
        }
        if (waveform === 'am' || waveform === 'fm') {
          modPhase = wrapPhase(modPhase + modStep)
        }
        if (isDigital && k % 256 === 0) trimSymbols(Math.ceil((t - half) / S))
      }
      sampleIndex += n
      return out
    },
    reset() {
      phase = 0
      phase2 = 0
      modPhase = 0
      sampleIndex = 0
      baseM = 0
      symI.length = 0
      symQ.length = 0
    }
  }
}

/** 跨帧频谱分析器（pointsPerFrame < fftSize 时凑满再算） */
export class SpectrumAnalyzer {
  constructor() {
    this.buf = new Float32Array(0)
    this.len = 0
    this.fftSize = 0
  }
  push(iq, cfg) {
    const need = cfg.fftSize * 2
    if (!(need > 0) || iq.length === 0) return null
    if (this.fftSize !== cfg.fftSize || this.buf.length !== need) {
      this.fftSize = cfg.fftSize
      this.buf = new Float32Array(need)
      this.len = 0
    }
    if (iq.length >= need) {
      this.buf.set(iq.subarray(iq.length - need))
      this.len = need
    } else {
      const keep = Math.min(this.len, need - iq.length)
      if (keep < this.len) this.buf.copyWithin(0, this.len - keep, this.len)
      this.len = keep
      this.buf.set(iq, this.len)
      this.len += iq.length
    }
    if (this.len < need) return null
    return computeRow(this.buf.subarray(0, need), cfg)
  }
  reset() {
    this.len = 0
  }
}

/** 时频行累计器（固定 dB 行） */
export class SpectrogramAccumulator {
  constructor() {
    this.buf = new Float32Array(0)
    this.len = 0
    this.pos = 0
  }
  push(iq, cfg) {
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
    const rows = []
    while (this.pos + need <= this.len) {
      rows.push(computeRow(this.buf.subarray(this.pos, this.pos + need), cfg, { forceDb: true }))
      this.pos += step
    }
    if (this.pos > cfg.fftSize * 4) {
      this.buf.copyWithin(0, this.pos, this.len)
      this.len -= this.pos
      this.pos = 0
    }
    return rows
  }
  reset() {
    this.len = 0
    this.pos = 0
  }
}

export function defaultCfg() {
  return {
    freq: 512,
    snr: 20,
    amplitude: 1,
    modType: 'sine',
    outputMode: 'real',
    waveform: 'cw',
    modFreq: 50,
    amDepth: 0.5,
    fmDeviation: 200,
    pulsePeriod: 0.01,
    pulseDuty: 0.5,
    toneSpacing: 100,
    sampleRate: 4096,
    pointsPerFrame: 2048,
    samplesPerSymbol: 16,
    enabled: true,
    fftSize: 1024,
    window: 'hann',
    dbScale: true,
    overlap: 0.5,
    spectrumMode: 'real',
    imageDb: -120
  }
}

/** 配置校验（与 src/shared/signal.ts sanitizeConfigPatch 同步） */
export function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const out = {}
  const num = (k) => (typeof patch[k] === 'number' && Number.isFinite(patch[k]) ? patch[k] : null)
  const int = (k) => {
    const v = num(k)
    return v === null ? null : Math.trunc(v)
  }
  const freq = num('freq')
  const srInPatch = num('sampleRate')
  if (freq !== null && freq > 0 && !(srInPatch !== null && srInPatch > 0 && freq >= srInPatch / 2))
    out.freq = freq
  const snr = num('snr')
  if (snr !== null && snr >= 0 && snr <= 100) out.snr = snr
  const amp = num('amplitude')
  if (amp !== null && amp > 0 && amp <= 10) out.amplitude = amp
  if (['sine', 'BPSK', 'QPSK', '16QAM'].includes(patch.modType)) out.modType = patch.modType
  if (patch.outputMode === 'real' || patch.outputMode === 'complex')
    out.outputMode = patch.outputMode
  if (['cw', 'am', 'fm', 'pulse', 'twoTone', 'noise', 'digital'].includes(patch.waveform))
    out.waveform = patch.waveform
  const modFreq = num('modFreq')
  if (modFreq !== null && modFreq > 0 && modFreq <= 1_000_000) out.modFreq = modFreq
  const amDepth = num('amDepth')
  if (amDepth !== null && amDepth >= 0 && amDepth <= 1) out.amDepth = amDepth
  const fmDeviation = num('fmDeviation')
  if (fmDeviation !== null && fmDeviation >= 0 && fmDeviation <= 1_000_000)
    out.fmDeviation = fmDeviation
  const pulsePeriod = num('pulsePeriod')
  if (pulsePeriod !== null && pulsePeriod >= 1e-6 && pulsePeriod <= 10)
    out.pulsePeriod = pulsePeriod
  const pulseDuty = num('pulseDuty')
  if (pulseDuty !== null && pulseDuty >= 0 && pulseDuty <= 1) out.pulseDuty = pulseDuty
  const toneSpacing = num('toneSpacing')
  if (toneSpacing !== null && toneSpacing >= 0 && toneSpacing <= 1_000_000)
    out.toneSpacing = toneSpacing
  const sr = int('sampleRate')
  if (sr !== null && sr >= 256 && sr <= 4194304) out.sampleRate = sr
  const ppf = int('pointsPerFrame')
  if (ppf !== null && ppf >= 64 && ppf <= 65536) out.pointsPerFrame = ppf
  const sps = int('samplesPerSymbol')
  if (sps !== null && sps >= 1 && sps <= 1024) out.samplesPerSymbol = sps
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled
  const fft = int('fftSize')
  if (fft !== null && fft >= 64 && fft <= 65536 && (fft & (fft - 1)) === 0) out.fftSize = fft
  if (['rect', 'hann', 'hamming', 'blackman'].includes(patch.window)) out.window = patch.window
  if (typeof patch.dbScale === 'boolean') out.dbScale = patch.dbScale
  const overlap = num('overlap')
  if (overlap !== null && overlap >= 0 && overlap <= 0.9) out.overlap = overlap
  if (patch.spectrumMode === 'real' || patch.spectrumMode === 'complex')
    out.spectrumMode = patch.spectrumMode
  const imageDb = num('imageDb')
  if (imageDb !== null && imageDb >= -120 && imageDb <= 0) out.imageDb = imageDb
  return out
}

// ── 服务端 ──
export function startServer(opts = {}) {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 8768
  let cfg = defaultCfg()
  let seq = 0
  let gen = null
  const acc = new SpectrogramAccumulator()
  const spec = new SpectrumAnalyzer()
  let io = null

  function genFrame() {
    return (gen ??= createGenerator(cfg)).next(cfg.pointsPerFrame)
  }

  function tick(force = false) {
    if (!io) return
    // 与本地源一致：关闭推送后仍允许 trigger 强制单帧
    if (!force && !cfg.enabled) return
    if (!force && io.engine.clientsCount === 0) return
    const iq = genFrame()
    const s = ++seq
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

  const httpServer = http.createServer((_, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify({ ok: true, note: 'remote signal mock', host, port, cfg }))
  })
  io = new Server(httpServer, { cors: { origin: '*' } })

  io.on('connection', (sock) => {
    console.log(`[remote-mock] client connected ${sock.id} from ${sock.handshake.address}`)
    sock.on('signal:analysis:config', (patch) => {
      console.log('[remote-mock] recv config', patch)
      const clean = sanitizePatch(patch)
      if (!clean || Object.keys(clean).length === 0) {
        console.warn('[remote-mock] invalid config ignored')
        return
      }
      const merged = { ...cfg, ...clean }
      if (!(merged.freq > 0 && merged.freq < merged.sampleRate / 2)) {
        console.warn(
          `[remote-mock] freq(${merged.freq}) 须小于 sampleRate/2(${merged.sampleRate / 2})，配置忽略`
        )
        return
      }
      cfg = merged
      // 分析器/生成器状态一起重建（相位/符号/成型历史重置）
      spec.reset()
      acc.reset()
      gen = null
    })
    sock.on('signal:analysis:trigger', () => {
      console.log('[remote-mock] trigger once')
      tick(true)
    })
    sock.on('disconnect', (reason) => console.log(`[remote-mock] disconnect ${sock.id} ${reason}`))
  })

  let timer = null
  httpServer.on('error', (err) => {
    console.error(
      '[remote-mock] server error:',
      err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : err.message
    )
    process.exit(1)
  })
  httpServer.listen(port, host, () => {
    console.log(`[remote-mock] listening http://${host}:${port} (socket.io)`)
    console.log(`[remote-mock] cfg`, cfg)
    console.log('[remote-mock] 等待 Electron 以 remote 模式连接')
    timer = setInterval(() => tick(false), Math.max(16, Math.floor(1000 / 60)))
    console.log('[remote-mock] tick 60fps started')
  })

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    io.close()
    httpServer.close(() => process.exit(0))
  }
  process.on('SIGINT', () => {
    console.log('\n[remote-mock] shutting down')
    stop()
  })
  process.on('SIGTERM', stop)
  return { stop, tick }
}

// ── CLI（仅在直接运行时启动；被 import 时只导出纯函数，便于单测对比）──
const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
用法: node scripts/remote-signal-mock.mjs [options]

Options:
  --host <host>   监听地址 (默认 127.0.0.1)
  --port <port>   监听端口 (默认 8768)
  --help          帮助
示例:
  node scripts/remote-signal-mock.mjs
  node scripts/remote-signal-mock.mjs --port 8768
`)
    process.exit(0)
  }
  const getArg = (name, def) => {
    const idx = args.indexOf(name)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def
  }
  const host = getArg('--host', '127.0.0.1')
  const port = Number(getArg('--port', '8768'))
  startServer({ host, port })
}
