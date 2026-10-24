/**
 * 像素级视觉回归（Electron capturePage，无 Playwright 依赖）
 *
 * 单后端运行（VISUAL_MODE=canvas2d|webgl2）：
 *   $env:VISUAL_MODE='canvas2d'
 *   npx electron scripts/visual-regression.cjs
 *
 * 两套后端回归/更新基线请用 runner（每个后端独立 Electron 进程，避免连续创建窗口的 GPU 状态问题）：
 *   node scripts/visual-run-all.mjs
 *   node scripts/visual-run-all.mjs --update
 *
 * 说明：
 * - 页面 playground/visual.html 使用固定种子数据、固定尺寸（1100×360×2 + 1100×300）、dark 主题、en-US 文案；
 *   force-device-scale-factor=1，避免 DPR 差异。
 * - 分别回归 canvas2d 与 webgl2 两套基线；每像素通道差 > VISUAL_PIXEL_DELTA（默认 16）
 *   记为差异像素，差异占比 > VISUAL_MAX_DIFF_RATIO（默认 0.4%）判失败。
 * - 基线是“本机 Electron/GPU/字体”的基线；CI 应在相同镜像生成。
 */
if (!process.versions.electron) {
  console.error(
    '[visual] 必须以 Electron 运行（当前是 Node）。请清除 ELECTRON_RUN_AS_NODE 后用 npx electron scripts/visual-regression.cjs'
  )
  process.exit(1)
}

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'playground/dist')
const baselineDir = path.join(root, 'playground/visual')
const update = process.env.UPDATE_BASELINE === '1'
// 单进程只跑一个后端；两套后端由 scripts/visual-run-all.mjs 分进程调用
const onlyMode = process.env.VISUAL_MODE ?? 'canvas2d'
const modes = [onlyMode]
const maxRatio = Number(process.env.VISUAL_MAX_DIFF_RATIO || '0.004')
const pixelDelta = Number(process.env.VISUAL_PIXEL_DELTA || '16')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu-sandbox')

async function waitForReady(win) {
  for (let i = 0; i < 80; i++) {
    const ok = await win.webContents.executeJavaScript('window.__VISUAL_READY__ === true')
    if (ok) return
    await wait(100)
  }
  throw new Error('visual page not ready')
}

function compare(mode, actual) {
  const baselinePath = path.join(baselineDir, `baseline-${mode}.png`)
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`baseline missing: ${baselinePath} (run with UPDATE_BASELINE=1)`)
  }
  const base = nativeImage.createFromPath(baselinePath)
  if (base.isEmpty()) throw new Error(`baseline unreadable: ${baselinePath}`)
  const sa = base.getSize()
  const sb = actual.getSize()
  if (sa.width !== sb.width || sa.height !== sb.height) {
    throw new Error(
      `size mismatch ${mode}: baseline ${sa.width}x${sa.height}, actual ${sb.width}x${sb.height}`
    )
  }
  const a = base.toBitmap()
  const b = actual.toBitmap()
  if (a.length !== b.length) throw new Error(`bitmap length mismatch ${mode}`)
  let diff = 0
  let maxDelta = 0
  const total = a.length / 4
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
      Math.abs(a[i + 3] - b[i + 3])
    )
    if (d > pixelDelta) diff++
    if (d > maxDelta) maxDelta = d
  }
  const ratio = diff / total
  return { diff, total, ratio, maxDelta, baselinePath }
}

async function runMode(mode) {
  const win = new BrowserWindow({
    width: 1200,
    height: 1160,
    useContentSize: true,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  const url = `${pathToFileURL(path.join(dist, 'visual.html')).href}?renderer=${mode}`
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    console.error(`[visual] did-fail-load ${mode}: ${code} ${desc} ${failedUrl}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[visual] renderer gone ${mode}: ${details.reason}`)
  })
  try {
    await win.loadURL(url)
    await waitForReady(win)
    await wait(500) // 自动量程/平滑稳定；<3s 避免 stale 角标
    const img = await win.webContents.capturePage()
    const actualPath = path.join(dist, `visual-${mode}.png`)
    fs.writeFileSync(actualPath, img.toPNG())
    if (update) {
      fs.mkdirSync(baselineDir, { recursive: true })
      fs.writeFileSync(path.join(baselineDir, `baseline-${mode}.png`), img.toPNG())
      console.log(`[visual] baseline updated: ${mode} (${actualPath})`)
      return true
    }
    const r = compare(mode, img)
    const pct = (r.ratio * 100).toFixed(3)
    if (r.ratio > maxRatio) {
      console.error(
        `[visual] FAIL ${mode}: diff=${r.diff}/${r.total} (${pct}%) maxDelta=${r.maxDelta} > ${maxRatio * 100}%`
      )
      console.error(`[visual] actual: ${actualPath}`)
      return false
    }
    console.log(`[visual] PASS ${mode}: diff=${r.diff}/${r.total} (${pct}%) maxDelta=${r.maxDelta}`)
    return true
  } finally {
    win.destroy()
  }
}

app
  .whenReady()
  .then(async () => {
    let ok = true
    for (let i = 0; i < modes.length; i++) {
      ok = (await runMode(modes[i])) && ok
      await wait(300)
    }
    app.exit(ok ? 0 : 1)
  })
  .catch((e) => {
    console.error('[visual] error:', e && e.stack ? e.stack : String(e))
    app.exit(1)
  })
