import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, ['scripts/dual-sim-e2e.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env,
  timeout: 120_000
})
if (result.error) {
  console.error('[dual-sim] spawn failed:', result.error.message)
  process.exit(1)
}
console.log('[dual-sim] electron exit', result.status, result.signal ?? '')
process.exit(result.status ?? 1)
