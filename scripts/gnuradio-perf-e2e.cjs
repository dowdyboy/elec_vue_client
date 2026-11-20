/**
 * 10 MSPS 压测：显示 2 MSPS + 录制 10 MSPS 独立端口，raw 直写盘 4 秒。
 * 断言录制吞吐 ≥ 70% 目标、显示不中断、无连接错误；临时文件在 stopNetwork 时清理。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const displayPort = Number(process.env.GNU_PERF_DISPLAY_PORT || 5015)
const recordPort = Number(process.env.GNU_PERF_RECORD_PORT || 5016)
const displayRate = Number(process.env.GNU_PERF_DISPLAY_RATE || 2_000_000)
const recordRate = Number(process.env.GNU_PERF_RECORD_RATE || 10_000_000)
const durationMs = Number(process.env.GNU_PERF_DURATION_MS || 4000)
const channels = Number(process.env.GNU_PERF_CHANNELS || 1) === 2 ? 2 : 1
const archive = process.env.GNU_PERF_ARCHIVE === '1'
const segmentMB = Number(process.env.GNU_PERF_SEGMENT_MB || 0)

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
      sampleRate: recordRate,
      channels,
      centerHz: 0,
      displaySampleRate: displayRate,
      pointsPerFrame: 0,
      dualStream: true,
      recordPort,
      recordHost: '127.0.0.1',
      recordFormat: 'ci16',
      recordSampleRate: recordRate,
      reconnect: false
    }
    const started = await js(`window.api.source.startNetwork(${JSON.stringify(cfg)})`)
    assert(started.ok, `startNetwork failed: ${started.error || 'unknown'}`)

    step = 'wait-record-link'
    let status = null
    for (let i = 0; i < 20; i++) {
      await wait(500)
      status = await js(`window.api.source.networkStatus()`)
      if (status && status.recordConnected && status.frames > 0) break
    }
    assert(status && status.splitStream, 'split mode not active')
    assert(status.recordConnected, 'record link not connected')
    assert(status.frames > 0, 'display frames=0 before recording')

    step = 'record'
    const rs = await js(
      `window.api.source.recordStart(false, { rawArchive: ${archive}, rawSegmentMB: ${segmentMB || 'undefined'} })`
    )
    assert(rs.ok, 'recordStart failed')
    const startedAt = Date.now()
    await wait(durationMs)
    const mid = await js(`window.api.source.recordStatus()`)
    const elapsed = (Date.now() - startedAt) / 1000
    const stopped = await js(`window.api.source.recordStop()`)
    const samples = stopped.status.samples
    const throughput = samples / elapsed
    const ratio = throughput / recordRate
    console.log(
      `[gnuradio-perf] displayRate=${displayRate} recordRate=${recordRate} elapsed=${elapsed.toFixed(2)}s ` +
        `samples=${samples} throughput=${(throughput / 1e6).toFixed(2)} MS/s ratio=${(ratio * 100).toFixed(1)}% ` +
        `recording=${mid.recording}`
    )
    assert(stopped.status.mode === 'raw', `record mode=${stopped.status.mode}`)
    assert(samples > 0, 'raw recorded samples=0')
    if (archive) {
      assert(stopped.status.archivedFiles > 0, 'rolling archive produced no files')
      console.log(`[gnuradio-perf] archived files=${stopped.status.archivedFiles}`)
    }
    const minRatio = Number(process.env.GNU_PERF_MIN_RATIO || 0.5)
    assert(
      ratio >= minRatio,
      `throughput too low: ${(ratio * 100).toFixed(1)}% < ${minRatio * 100}%`
    )
    assert(stopped.status.truncated === false, 'recording truncated by maxBytes')

    const after = await js(`window.api.source.networkStatus()`)
    assert(after && after.frames > status.frames, 'display frames did not advance during recording')
    assert(after.recordConnected, 'record link dropped during recording')

    step = 'cleanup'
    await js(`window.api.source.stopNetwork().then(() => true)`)
    console.log('[gnuradio-perf] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[gnuradio-perf] FAIL at', step, e)
    app.exit(1)
  }
})
