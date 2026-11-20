/**
 * 应用内双通道合成源 E2E：不依赖 GNU Radio / 硬件，
 * 启动 dual sim → 打开 /signal/dual → 断言双通道页面、图表和“接收中”。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

app.whenReady().then(async () => {
  let step = 'init'
  try {
    step = 'wait-main'
    await wait(2200)
    const wins = BrowserWindow.getAllWindows()
    const win =
      wins.find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')) || wins[0]
    assert(win, 'main window not found')
    const js = (code) => win.webContents.executeJavaScript(code, true)

    step = 'start-sim'
    const r = await js(
      `window.api.source.startDualSim({ sampleRate: 100000, pointsPerFrame: 2048, ` +
        `freq0: 10000, freq1: 15000, amplitude0: 0.5, amplitude1: 0.35, phaseDeg: 30, snr: 60 })`
    )
    assert(r.ok, `startDualSim failed: ${r.error || 'unknown'}`)
    const st = await js(`window.api.source.getStatus()`)
    assert(st.backend === 'dual-sim', `backend=${st.backend}`)
    assert(st.running === true, 'dual sim not running')
    console.log('[dual-sim] started backend=dual-sim')

    step = 'page'
    await js(`location.hash = '#/signal/dual'; true`)
    await wait(1500)
    const info = await js(
      `({ page: !!document.querySelector('.dual-page'), ` +
        `canvases: document.querySelectorAll('.dual-page canvas').length, ` +
        `text: document.querySelector('.dual-page')?.innerText || '' })`
    )
    assert(info.page, 'dual page not rendered')
    assert(info.canvases >= 4, `dual page canvases=${info.canvases}`)
    assert(/接收中/.test(info.text), 'dual page did not receive frames')
    console.log(`[dual-sim] page canvases=${info.canvases} receiving=true`)

    step = 'stop-sim'
    const stopped = await js(`window.api.source.stopDualSim()`)
    assert(stopped.ok, 'stopDualSim failed')
    const st2 = await js(`window.api.source.getStatus()`)
    assert(st2.backend !== 'dual-sim', `backend after stop=${st2.backend}`)
    console.log('[dual-sim] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[dual-sim] FAIL at', step, e)
    app.exit(1)
  }
})
