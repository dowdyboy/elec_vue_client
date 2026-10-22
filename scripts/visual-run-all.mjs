/**
 * 像素视觉回归 runner：每个后端独立 Electron 进程，避免同一进程连续创建 WebGL/Canvas
 * BrowserWindow 时的 GPU 状态问题。
 *
 * 用法：
 *   node scripts/visual-run-all.mjs            # 对比 canvas2d + webgl2
 *   node scripts/visual-run-all.mjs --update   # 更新两套基线
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('..', import.meta.url))
const update = process.argv.includes('--update')

for (const mode of ['canvas2d', 'webgl2']) {
  const env = { ...process.env, VISUAL_MODE: mode }
  delete env.ELECTRON_RUN_AS_NODE
  if (update) env.UPDATE_BASELINE = '1'
  const r = spawnSync(electron, ['scripts/visual-regression.cjs'], {
    cwd: root,
    stdio: 'inherit',
    env
  })
  if (r.error) {
    console.error('[visual] spawn failed:', r.error.message)
    process.exit(1)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
}
