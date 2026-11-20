import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.GNU_MOCK_PORT || 5011)
const external = process.env.GNU_EXTERNAL === '1'

let mock = null
if (!external) {
  mock = spawn(
    process.execPath,
    [
      'scripts/gnuradio-mock-tcp.mjs',
      '--port',
      String(port),
      '--format',
      'ci16',
      '--sample-rate',
      '120000',
      '--display-sample-rate',
      '60000',
      '--freq',
      '10000',
      '--framed',
      '--dual'
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }
  )

  await new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error('mock server start timeout'))
    }, 8000)
    mock.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      process.stdout.write(text)
      if (!done && text.includes('listening')) {
        done = true
        clearTimeout(timer)
        resolve()
      }
    })
    mock.on('exit', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`mock server exited early: ${code}`))
    })
  }).catch((err) => {
    console.error('[gnuradio] mock start failed:', err.message)
    mock?.kill()
    process.exit(1)
  })
}

const env = { ...process.env, GNU_MOCK_PORT: String(port) }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(electron, ['scripts/gnuradio-e2e.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env,
  timeout: 180_000
})

mock?.kill()
if (result.error) {
  console.error('[gnuradio] spawn failed:', result.error.message)
  process.exit(1)
}
console.log('[gnuradio] electron exit', result.status, result.signal ?? '')
process.exit(result.status ?? 1)
