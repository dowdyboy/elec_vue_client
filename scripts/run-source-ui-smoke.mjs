import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(electron, ['scripts/source-ui-smoke.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (r.error) {
  console.error('[source-ui] spawn failed:', r.error.message)
  process.exit(1)
}
process.exit(r.status ?? 1)
