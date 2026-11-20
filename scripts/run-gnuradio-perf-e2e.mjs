import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const displayPort = Number(process.env.GNU_PERF_DISPLAY_PORT || 5015)
const recordPort = Number(process.env.GNU_PERF_RECORD_PORT || 5016)
const displayRate = Number(process.env.GNU_PERF_DISPLAY_RATE || 2_000_000)
const recordRate = Number(process.env.GNU_PERF_RECORD_RATE || 10_000_000)
const durationMs = Number(process.env.GNU_PERF_DURATION_MS || 4000)
const external = process.env.GNU_PERF_EXTERNAL === '1'

function startMock(port, rate, label) {
  const child = spawn(
    process.execPath,
    [
      'scripts/gnuradio-mock-tcp.mjs',
      '--port',
      String(port),
      '--format',
      'ci16',
      '--sample-rate',
      String(rate),
      '--freq',
      '10000',
      '--framed',
      '--fast'
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env }
  )
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`))
  return child
}

const mocks = external
  ? []
  : [startMock(displayPort, displayRate, 'display'), startMock(recordPort, recordRate, 'record')]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  if (!external) await sleep(1000)
  const result = spawnSync(electron, ['scripts/gnuradio-perf-e2e.cjs'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...env,
      GNU_PERF_DISPLAY_PORT: String(displayPort),
      GNU_PERF_RECORD_PORT: String(recordPort),
      GNU_PERF_DISPLAY_RATE: String(displayRate),
      GNU_PERF_RECORD_RATE: String(recordRate),
      GNU_PERF_DURATION_MS: String(durationMs),
      GNU_PERF_CHANNELS: String(process.env.GNU_PERF_CHANNELS || 1),
      GNU_PERF_ARCHIVE: process.env.GNU_PERF_ARCHIVE || '0',
      GNU_PERF_SEGMENT_MB: process.env.GNU_PERF_SEGMENT_MB || '0'
    },
    timeout: 180_000
  })
  if (result.error) {
    console.error('[gnuradio-perf] spawn failed:', result.error.message)
    process.exitCode = 1
  } else {
    console.log('[gnuradio-perf] electron exit', result.status, result.signal ?? '')
    process.exitCode = result.status ?? 1
  }
} finally {
  for (const m of mocks) {
    try {
      m.kill()
    } catch {
      // ignore
    }
  }
}
