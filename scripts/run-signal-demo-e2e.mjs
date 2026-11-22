/**
 * 信号演示页回归 runner：清掉 ELECTRON_RUN_AS_NODE 后以 Electron 主进程启动。
 * （本机/CI 环境下该变量可能为 1，会让 require('electron') 退化成路径字符串）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(electron, ['scripts/signal-demo-e2e.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env
})
if (result.error) {
  console.error('[signal-demo] spawn failed:', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
