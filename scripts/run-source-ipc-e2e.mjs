import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const outfile = 'out/test/source-ipc-e2e.cjs'

await mkdir('out/test', { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/source-ipc-e2e.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  outfile
})

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, [outfile], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (result.error) {
  console.error('[source-ipc] spawn failed:', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
