#!/usr/bin/env node
/**
 * GNU Radio / TCP IQ Mock 服务（无需安装 GNU Radio 即可验证网络源）
 *
 * 用法：
 *   node scripts/gnuradio-mock-tcp.mjs --port 5000 --format ci16 --sample-rate 200000 --freq 10000
 *   双流：再加 --dual --display-sample-rate 60000（msgType=1 raw + msgType=4 显示）
 *   压测：--fast（单 tick 波形只算一次，避免 mock 成为瓶颈）
 *
 * 输出：60fps 推送一个复数单音；ci16 按 32767 归一化，cf32 直接 float，ci8 按 127。
 * 这是 Phase 1 的测试/演示服务，正式 GNU Radio flowgraph 见 docs/SRC-02。
 */
import net from 'node:net'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}

const port = Number(arg('port', '5000'))
const host = arg('host', '127.0.0.1')
const format = arg('format', 'ci16')
const sampleRate = Number(arg('sample-rate', '200000'))
const freq = Number(arg('freq', '10000'))
const freq2 = Number(arg('freq2', String(freq * 1.5)))
const channels = Number(arg('channels', '1')) === 2 ? 2 : 1
const centerHz = Number(arg('center-hz', '0'))
const amplitude = Number(arg('amplitude', '0.5'))
const dual = args.includes('--dual')
const fast = args.includes('--fast')
const displaySampleRate = Number(arg('display-sample-rate', String(sampleRate)))
const framed = args.includes('--framed') || dual

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[gnuradio-mock] invalid --port')
  process.exit(1)
}
if (!['ci16', 'cf32', 'ci8'].includes(format)) {
  console.error('[gnuradio-mock] --format must be ci16 | cf32 | ci8')
  process.exit(1)
}
if (!(sampleRate > 0) || !(freq >= 0) || !(amplitude > 0)) {
  console.error('[gnuradio-mock] invalid --sample-rate / --freq / --amplitude')
  process.exit(1)
}

const bytesPerSample = format === 'cf32' ? 8 : format === 'ci16' ? 4 : 2
const formatCode = format === 'cf32' ? 0 : format === 'ci16' ? 1 : 2
const samplesPerTick = Math.max(1, Math.round(sampleRate / 60))
const TAU = Math.PI * 2
const step = (TAU * freq) / sampleRate
const step2 = (TAU * freq2) / sampleRate
let phase2 = 0
const displayStride = Math.max(1, Math.round(sampleRate / Math.max(1, displaySampleRate)))
const actualDisplayRate = sampleRate / displayStride

/** ELIQ 48 字节帧头（与 src/main/source/network/iqStreamParser.ts 对应） */
function makeHeader(seq, payloadBytes, msgType = 1, rate = sampleRate) {
  const h = Buffer.alloc(48)
  h.write('ELIQ', 0, 'ascii')
  h.writeUInt8(1, 4)
  h.writeUInt8(msgType, 5)
  h.writeUInt16LE(48, 6)
  h.writeUInt32LE(seq >>> 0, 8)
  h.writeBigUInt64LE(BigInt(Date.now()) * 1000000n, 12)
  h.writeUInt32LE(rate >>> 0, 20)
  h.writeDoubleLE(centerHz, 24)
  h.writeUInt8(formatCode, 32)
  h.writeUInt8(channels, 33)
  h.writeUInt32LE(payloadBytes >>> 0, 36)
  return h
}

/** 简单抽取（仅 mock 演示；正式桥用 scipy resample_poly） */
function decimatePayload(payload, stride) {
  if (stride <= 1) return payload
  const count = Math.floor(payload.length / bytesPerSample / channels / stride)
  const out = Buffer.allocUnsafe(count * channels * bytesPerSample)
  for (let k = 0; k < count; k++) {
    for (let ch = 0; ch < channels; ch++) {
      const src = (k * stride * channels + ch) * bytesPerSample
      const dst = (k * channels + ch) * bytesPerSample
      payload.copy(out, dst, src, src + bytesPerSample)
    }
  }
  return out
}

function makeBufferFast() {
  // 压测专用：单 tick 波形只算一次，之后复用，避免把 mock 的三角函数算成瓶颈
  if (!fastBuffer) fastBuffer = buildSamples(samplesPerTick)
  return fastBuffer
}

function buildSamples(count) {
  const buf = Buffer.allocUnsafe(count * channels * bytesPerSample)
  for (let k = 0; k < count; k++) {
    for (let ch = 0; ch < channels; ch++) {
      const ph = ch === 0 ? phase + k * step : phase2 + k * step2
      const i = amplitude * Math.cos(ph)
      const q = amplitude * Math.sin(ph)
      const off = (channels === 1 ? k : k * 2 + ch) * bytesPerSample
      if (format === 'ci16') {
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(i * 32767))), off)
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(q * 32767))), off + 2)
      } else if (format === 'cf32') {
        buf.writeFloatLE(i, off)
        buf.writeFloatLE(q, off + 4)
      } else {
        buf.writeInt8(Math.max(-128, Math.min(127, Math.round(i * 127))), off)
        buf.writeInt8(Math.max(-128, Math.min(127, Math.round(q * 127))), off + 1)
      }
    }
  }
  phase = (phase + count * step) % TAU
  phase2 = (phase2 + count * step2) % TAU
  return buf
}

function makeBuffer() {
  return fast ? makeBufferFast() : buildSamples(samplesPerTick)
}

let fastBuffer = null

let phase = 0

const server = net.createServer((socket) => {
  console.log(`[gnuradio-mock] client connected ${socket.remoteAddress}:${socket.remotePort}`)
  socket.setNoDelay(true)
  let paused = false
  let seq = 0
  socket.on('drain', () => {
    paused = false
  })
  socket.on('error', (err) => {
    console.error('[gnuradio-mock] client error:', err.message)
  })
  const timer = setInterval(() => {
    if (paused) return
    try {
      const payload = makeBuffer()
      let packet = payload
      if (framed) {
        const raw = Buffer.concat([makeHeader(seq++, payload.length, 1, sampleRate), payload])
        if (dual) {
          const displayPayload = decimatePayload(payload, displayStride)
          const display = Buffer.concat([
            makeHeader(seq++, displayPayload.length, 4, actualDisplayRate),
            displayPayload
          ])
          packet = Buffer.concat([raw, display])
        } else {
          packet = raw
        }
      }
      if (!socket.write(packet) && !fast) paused = true
    } catch (e) {
      console.error('[gnuradio-mock] write failed:', e instanceof Error ? e.message : String(e))
      clearInterval(timer)
      socket.destroy()
    }
  }, 1000 / 60)
  socket.on('close', () => {
    clearInterval(timer)
    console.log('[gnuradio-mock] client disconnected')
  })
})

server.on('error', (err) => {
  console.error('[gnuradio-mock] server error:', err.message)
  process.exit(1)
})

server.listen(port, host, () => {
  console.log(
    `[gnuradio-mock] listening ${host}:${port} ${format} ${sampleRate} S/s channels=${channels} ` +
      `freq=${freq} Hz center=${centerHz} Hz header=${framed ? 'ELIQ' : 'off'} ` +
      `dual=${dual ? 'on' : 'off'} display=${dual ? actualDisplayRate.toFixed(0) : sampleRate} S/s`
  )
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
