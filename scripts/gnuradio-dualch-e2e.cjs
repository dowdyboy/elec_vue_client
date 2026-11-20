/**
 * AD9361 双通道模拟 E2E：两路 mock（显示 60 kS/s、录制 120 kS/s，均为 2ch 交织），
 * 应用配置 channels=2，验证解交织、RX0/RX1 切换、双通道 raw 录制与 sidecar channels=2。
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const displayPort = Number(process.env.GNU_DUALCH_DISPLAY_PORT || 5018)
const recordPort = Number(process.env.GNU_DUALCH_RECORD_PORT || 5019)

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
      channels: 2,
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
    assert(status && status.splitStream, 'split mode not active')
    assert(status.channels === 2, `channels=${status.channels}`)
    assert(status.frames > 0, 'no frames')
    assert(status.recordConnected, 'record link not connected')
    console.log(
      `[gnuradio-dualch] channels=${status.channels} frames=${status.frames} ` +
        `displayPackets=${status.displayPackets} rawPackets=${status.rawPackets}`
    )

    step = 'channel-switch'
    await js(
      `window.__dualChFrames = []; window.__dualChAll = []; ` +
        `window.__dualChUnsub = window.api.source.onFrame((f) => window.__dualChFrames.push(f.channel)); ` +
        `window.__dualAllUnsub = window.api.source.onDualFrame((f) => window.__dualChAll.push(f.channel)); true`
    )
    await wait(600)
    const allChans = await js(`window.__dualChAll`)
    assert(
      allChans.includes(0) && allChans.includes(1),
      `dual preview did not see both channels: ${JSON.stringify(allChans.slice(0, 20))}`
    )
    const sw = await js(`window.api.source.setActiveChannel(1)`)
    assert(sw.ok, 'setActiveChannel failed')
    await wait(800)
    const chans = await js(`window.__dualChFrames`)
    assert(chans.includes(1), `no channel-1 frames: ${JSON.stringify(chans.slice(0, 20))}`)
    const st2 = await js(`window.api.source.networkStatus()`)
    assert(st2.activeChannel === 1, `activeChannel=${st2.activeChannel}`)
    console.log(`[gnuradio-dualch] RX1 frames observed=${chans.length}`)

    step = 'dual-page'
    await js(`location.hash = '#/signal/dual'; true`)
    await wait(1200)
    const page = await js(
      `({ page: !!document.querySelector('.dual-page'), canvases: document.querySelectorAll('.dual-page canvas').length })`
    )
    assert(page.page, 'dual-channel page not rendered')
    assert(page.canvases >= 4, `dual-channel page canvases=${page.canvases}`)
    console.log(`[gnuradio-dualch] dual page canvases=${page.canvases}`)

    step = 'record'
    const rs = await js(`window.api.source.recordStart(false)`)
    assert(rs.ok, 'recordStart failed')
    await wait(900)
    const stopped = await js(`window.api.source.recordStop()`)
    assert(stopped.status.mode === 'raw', `mode=${stopped.status.mode}`)
    assert(stopped.status.channels === 2, `record channels=${stopped.status.channels}`)
    assert(stopped.status.samples > 0, 'no raw samples')
    console.log(
      `[gnuradio-dualch] raw samples/ch=${stopped.status.samples} channels=${stopped.status.channels}`
    )

    step = 'raw-playback-channel'
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dualch-play-'))
    const rawPath = path.join(dir, 'dual.ci16')
    fs.writeFileSync(rawPath, Buffer.alloc(4 * 2 * 4)) // 4 samples/ch × 2ch
    fs.writeFileSync(
      `${rawPath}.json`,
      JSON.stringify({
        format: 'raw-iq-v1',
        sampleFormat: 'ci16',
        bytesPerSample: 4,
        channels: 2,
        sampleRate: 120000,
        centerHz: 0,
        bytes: 32,
        samples: 4,
        frames: 1,
        segments: 1
      })
    )
    const pb = await js(
      `window.api.source.loadRawPlayback(${JSON.stringify(rawPath)}, { channel: 1, confirmDiscard: true })`
    )
    assert(pb.ok, `loadRawPlayback failed: ${pb.error || 'unknown'}`)
    const pst = await js(`window.api.source.playbackStatus()`)
    assert(pst && pst.channel === 1, `playback channel=${pst && pst.channel}`)
    console.log('[gnuradio-dualch] raw playback channel=RX1')
    await js(`window.api.source.stopPlayback().then(() => true)`)
    fs.rmSync(dir, { recursive: true, force: true })

    step = 'cleanup'
    await js(`window.__dualChUnsub && window.__dualChUnsub(); true`)
    await js(`window.__dualAllUnsub && window.__dualAllUnsub(); true`)
    await js(`window.api.source.stopNetwork().then(() => true)`)
    console.log('[gnuradio-dualch] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[gnuradio-dualch] FAIL at', step, e)
    app.exit(1)
  }
})
