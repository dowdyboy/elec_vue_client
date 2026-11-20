import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const displayPort = Number(process.env.GNU_DUALCH_DISPLAY_PORT || 5018)
const recordPort = Number(process.env.GNU_DUALCH_RECORD_PORT || 5019)
const external = process.env.GNU_DUALCH_EXTERNAL === '1'

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
      '--freq2',
      '15000',
      '--channels',
      '2',
      '--framed'
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env }
  )
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`))
  return child
}

const mocks = external
  ? []
  : [startMock(displayPort, 60000, 'display'), startMock(recordPort, 120000, 'record')]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  if (!external) await sleep(900)
  const result = spawnSync(electron, ['scripts/gnuradio-dualch-e2e.cjs'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...env,
      GNU_DUALCH_DISPLAY_PORT: String(displayPort),
      GNU_DUALCH_RECORD_PORT: String(recordPort)
    },
    timeout: 180_000
  })
  if (result.error) {
    console.error('[gnuradio-dualch] spawn failed:', result.error.message)
    process.exitCode = 1
  } else {
    console.log('[gnuradio-dualch] electron exit', result.status, result.signal ?? '')
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
