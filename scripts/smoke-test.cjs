/**
 * 新组件 smoke：加载 playground/dist/smoke.html，运行组件 API，检查结果并截图。
 * 通过 scripts/run-smoke.mjs 启动（Electron 进程）。
 */
if (!process.versions.electron) {
  console.error('[smoke] must run under Electron')
  process.exit(1)
}

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'playground/dist')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu-sandbox')

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`)
  throw new Error(msg)
}

async function run() {
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    useContentSize: true,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  const consoleErrors = []
  win.webContents.on('render-process-gone', (_e, details) => {
    consoleErrors.push(`renderer gone: ${details.reason}`)
  })
  const url = pathToFileURL(path.join(dist, 'smoke.html')).href
  try {
    await win.loadURL(url)
    for (let i = 0; i < 80; i++) {
      const ok = await win.webContents.executeJavaScript('window.__SMOKE_READY__ === true')
      if (ok) break
      if (i === 79) fail('smoke page not ready')
      await wait(100)
    }
    await wait(900)
    const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__SMOKE_RESULTS__)')
    const r = JSON.parse(raw)
    if (!r) fail('no smoke results')
    if (r.errors && r.errors.length) fail(`page errors: ${r.errors.join('; ')}`)
    if (consoleErrors.length) fail(`console errors: ${consoleErrors.join('; ')}`)

    if (!r.power?.pulses?.measured || r.power.pulses.count < 1)
      fail('PowerTime pulses not detected')
    if (!(r.power.stats?.count === 4096)) fail('PowerTime stats wrong')
    if (!(r.eye?.traceCount === 120) || !(r.eye.height > 0) || !(r.eye.width > 0))
      fail('Eye stats invalid')
    if (!(r.persistence?.matrix?.max > 0) || !(r.persistence.matrix.occupied > 0))
      fail('Persistence matrix stats invalid')
    if (!(r.persistence?.analysis?.frames >= 20) || !(r.persistence.analysis.max > 0))
      fail('Persistence analysis stats invalid')
    if (!(r.smith?.points === 160) || !(r.smith.maxGamma > 0.3)) fail('Smith stats invalid')
    if (!(r.apd?.sampleCount === 4000) || !(r.apd.paprDb > 0)) fail('APD stats invalid')
    if (!(r.qualityRows >= 5)) fail('SignalQualityPanel rows missing')
    if (!r.info?.power?.includes('峰值')) fail('PowerTime info not rendered')
    if (!r.info?.eye?.includes('轨迹')) fail('Eye info not rendered')
    if (!r.info?.persistence?.includes('bin')) fail('Persistence info not rendered')
    if (!r.info?.smith?.includes('轨迹')) fail('Smith info not rendered')
    if (!r.info?.apd?.includes('样本')) fail('APD info not rendered')

    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dist, 'smoke.png'), img.toPNG())
    console.log('[smoke] PASS')
    console.log(
      JSON.stringify(
        {
          powerPulses: r.power.pulses.count,
          powerStats: r.power.stats.count,
          eye: { traces: r.eye.traceCount, height: r.eye.height, width: r.eye.width },
          persistence: {
            matrixOccupied: r.persistence.matrix.occupied,
            analysisFrames: r.persistence.analysis.frames
          },
          smith: { points: r.smith.points, maxGamma: r.smith.maxGamma },
          apd: { samples: r.apd.sampleCount, papr: r.apd.paprDb, p01: r.apd.p01Db },
          qualityRows: r.qualityRows,
          screenshot: path.join(dist, 'smoke.png')
        },
        null,
        2
      )
    )
  } finally {
    win.destroy()
  }
}

app
  .whenReady()
  .then(async () => {
    try {
      await run()
      app.exit(0)
    } catch (e) {
      console.error(e && e.stack ? e.stack : String(e))
      app.exit(1)
    }
  })
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
