/**
 * 独立双 TCP 端口 E2E：显示 mock :5013 + 录制 mock :5014，
 * 应用 recordPort 指向 5014，断言 splitStream/recordConnected/两路包与 raw 录制。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const displayPort = Number(process.env.GNU_SPLIT_DISPLAY_PORT || 5013)
const recordPort = Number(process.env.GNU_SPLIT_RECORD_PORT || 5014)

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

    step = 'start'
    const cfg = {
      host: '127.0.0.1',
      port: displayPort,
      format: 'ci16',
      sampleRate: 120000,
      centerHz: 0,
      displaySampleRate: 60000,
      pointsPerFrame: 0,
      dualStream: true,
      recordPort,
      recordHost: '127.0.0.1',
      recordFormat: 'ci16',
      recordSampleRate: 120000,
      reconnect: false
    }
    const started = await js(`window.api.source.startNetwork(${JSON.stringify(cfg)})`)
    assert(started.ok, `startNetwork failed: ${started.error || 'unknown'}`)

    step = 'wait-status'
    let status = null
    for (let i = 0; i < 16; i++) {
      await wait(500)
      status = await js(`window.api.source.networkStatus()`)
      if (status && status.frames > 0 && status.recordConnected) break
    }
    assert(status && status.connected, 'display link not connected')
    assert(status.frames > 0, `no display frames: ${JSON.stringify(status)}`)
    assert(status.splitStream === true, 'expected splitStream')
    assert(status.recordConnected === true, 'record link not connected')
    assert(status.displayPackets > 0, 'no display packets')
    assert(status.rawPackets > 0, 'no raw packets')
    assert(status.displaySampleRate === 60000, `display rate=${status.displaySampleRate}`)
    assert(status.recordSampleRate === 120000, `record rate=${status.recordSampleRate}`)
    console.log(
      `[gnuradio-split] display frames=${status.frames} displayPackets=${status.displayPackets} ` +
        `rawPackets=${status.rawPackets} recordConnected=${status.recordConnected}`
    )

    step = 'record'
    const rs = await js(`window.api.source.recordStart(false)`)
    assert(rs.ok, 'recordStart failed')
    await wait(900)
    const stopped = await js(`window.api.source.recordStop()`)
    assert(stopped.status.mode === 'raw', `record mode=${stopped.status.mode}`)
    assert(stopped.status.samples > 0, 'raw recorded samples=0')
    console.log(`[gnuradio-split] raw recorded samples=${stopped.status.samples}`)

    step = 'cleanup'
    await js(`window.api.source.stopNetwork().then(() => true)`)
    console.log('[gnuradio-split] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[gnuradio-split] FAIL at', step, e)
    app.exit(1)
  }
})
