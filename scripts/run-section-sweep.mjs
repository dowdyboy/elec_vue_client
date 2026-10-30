import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, ['scripts/section-sweep.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (result.error) {
  console.error('[sections] spawn failed:', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
