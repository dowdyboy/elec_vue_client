/**
 * Electron 截图冒烟（不依赖 Playwright）
 *
 * 前置：npx vite preview --config playground/vite.config.ts --port 4173
 * 运行（环境变量传参；Windows 需清掉 ELECTRON_RUN_AS_NODE）：
 *   $env:ELECTRON_RUN_AS_NODE = $null
 *   $env:SHOT_URL='http://127.0.0.1:4173/?renderer=canvas2d'
 *   $env:SHOT_OUT='playground/dist/canvas2d.png'
 *   npx electron scripts/screenshot-playground.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// 用环境变量传参（Electron CLI 在带额外参数时会把 appPath 解析得不可靠）：
//   $env:SHOT_URL='http://127.0.0.1:4173/?renderer=canvas2d'; $env:SHOT_OUT='playground/dist/canvas2d.png'
//   npx electron scripts/screenshot-playground.cjs
const url = process.env.SHOT_URL || 'http://127.0.0.1:4173/?renderer=canvas2d'
const out = process.env.SHOT_OUT || path.join(__dirname, '../playground/dist/screenshot.png')
const logFile = path.join(__dirname, '../playground/dist/electron.log')
function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* ignore */
  }
  console.log(line)
}

app.commandLine.appendSwitch('disable-gpu-sandbox')
log('[shot] url=', url)
app
  .whenReady()
  .then(async () => {
    log('[shot] ready')
    const win = new BrowserWindow({
      width: 1280,
      height: 1120,
      show: true,
      webPreferences: { backgroundThrottling: false }
    })
    log('[shot] window')
    win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
      log('[shot] did-fail-load', code, desc, failedUrl)
    })
    win.webContents.on('did-finish-load', () => log('[shot] did-finish-load'))
    win.webContents.on('render-process-gone', (_e, details) => {
      log('[renderer gone]', details.reason)
    })
    win.webContents.on('console-message', (...args) => {
      const msg =
        args[1] && typeof args[1] === 'object' && 'message' in args[1] ? args[1].message : args[2]
      if (msg) log('[page]', msg)
    })
    log('[shot] loadURL...')
    await win.loadURL(url)
    log('[shot] loaded')
    await new Promise((r) => setTimeout(r, 3000))
    log('[shot] capture')
    const size = await win.webContents.executeJavaScript(
      '({ canvases: document.querySelectorAll("canvas").length, w: innerWidth, h: innerHeight })'
    )
    log('[page] layout', size)
    const img = await win.webContents.capturePage()
    // 非空断言：抽样统计颜色数，避免“白屏/黑屏”截图被误判为成功
    const bmp = img.toBitmap()
    const colors = new Set()
    for (let i = 0; i < bmp.length; i += 4 * 101) {
      colors.add(`${bmp[i]},${bmp[i + 1]},${bmp[i + 2]}`)
      if (colors.size >= 32) break
    }
    log('[shot] sampled colors', colors.size)
    if (colors.size < 8) {
      throw new Error(`screenshot appears blank (colors=${colors.size})`)
    }
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, img.toPNG())
    log('[screenshot]', out, img.getSize())
    app.quit()
  })
  .catch((e) => {
    log('[shot] failed', e && e.stack ? e.stack : String(e))
    app.exit(1)
  })
