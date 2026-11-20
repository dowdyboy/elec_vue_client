/**
 * GNU Radio 网络源 E2E：
 * 1) 连接 scripts/gnuradio-mock-tcp.mjs 的 ci16 单音
 * 2) 断言 source:frame / signal:analysis 帧持续到达
 * 3) 断言录制能收到帧与样本
 * 4) 停止录制/分析/网络源
 *
 * 说明：所有状态断言都在 stop 之前完成；stopNetwork 只检查 IPC 调用成功。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const port = Number(process.env.GNU_MOCK_PORT || 5011)

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

    step = 'subscribe-source'
    await js(`(() => {
      window.__gnuFrames = 0
      window.__gnuDispose = window.api.source.onFrame(() => window.__gnuFrames++)
      return true
    })()`)

    step = 'start-network'
    const cfg = {
      host: '127.0.0.1',
      port,
      format: 'ci16',
      sampleRate: 120000,
      centerHz: 0,
      displaySampleRate: 60000,
      pointsPerFrame: 0,
      dualStream: true,
      reconnect: false
    }
    const started = await js(`window.api.source.startNetwork(${JSON.stringify(cfg)})`)
    assert(started.ok, `startNetwork failed: ${started.error || 'unknown'}`)
    let status = null
    for (let i = 0; i < 12; i++) {
      await wait(500)
      status = await js(`window.api.source.networkStatus()`)
      if (status && status.frames > 0) break
    }

    assert(status && status.connected, 'network source not connected')
    assert(status.frames > 0, `no frames: ${JSON.stringify(status)}`)
    assert(status.samples > 0, 'no samples')
    assert(status.framed === true, 'expected ELIQ framed stream')
    assert(status.packets > 0, 'no framed packets')
    assert(status.dualStream === true, 'expected dual stream')
    assert(status.displayPackets > 0, 'no display packets')
    assert(status.rawPackets > 0, 'no raw packets')
    assert(status.recordSampleRate === 120000, `record rate=${status.recordSampleRate}`)
    assert(status.droppedSamples >= 0, 'invalid dropped count')
    const frames = await js(`window.__gnuFrames`)
    assert(frames > 0, `source:frame not delivered: ${frames}`)
    console.log(
      `[gnuradio] source ok frames=${status.frames} samples=${status.samples} bytes/s=${Math.round(status.bytesPerSecond)}`
    )

    step = 'start-analysis'
    await js(`(() => {
      window.__specFrames = 0
      window.__specDispose = window.api.signalAnalysis.onFrame((f) => { if (f.type === 'spectrum') window.__specFrames++ })
      return true
    })()`)
    const analysis = await js(`window.api.signalAnalysis.start({ mode: 'local' })`)
    if (!analysis.ok && !String(analysis.error || '').includes('已运行'))
      throw new Error(`signalAnalysis.start failed: ${analysis.error}`)
    // LocalAnalysisSource 的 hasConsumers 按订阅计数门控；显式登记订阅
    await js(`window.api.signalAnalysis.subscribe()`)
    await wait(1200)
    const specFrames = await js(`window.__specFrames`)
    assert(specFrames > 0, `no spectrum frames: ${specFrames}`)
    console.log(`[gnuradio] analysis ok spectrumFrames=${specFrames}`)

    step = 'record'
    const rec = await js(`window.api.source.recordStart(false)`)
    assert(rec.ok, 'recordStart failed')
    await wait(800)
    const recStop = await js(`window.api.source.recordStop()`)
    assert(recStop.ok, 'recordStop failed')
    assert(recStop.status.frames > 0, `recorded frames=0: ${JSON.stringify(recStop.status)}`)
    assert(recStop.status.samples > 0, 'recorded samples=0')
    assert(recStop.status.mode === 'raw', `expected raw recording: ${recStop.status.mode}`)
    console.log(
      `[gnuradio] record ok frames=${recStop.status.frames} samples=${recStop.status.samples}`
    )

    step = 'cleanup'
    await js(`(() => { window.__gnuDispose?.(); window.__specDispose?.(); return true })()`)
    await js(`window.api.signalAnalysis.unsubscribe().then(() => true)`)
    await js(`window.api.signalAnalysis.stop().then(() => true)`)
    const stopped = await js(`window.api.source.stopNetwork().then(() => true)`)
    assert(stopped === true, 'stopNetwork failed')

    console.log('[gnuradio] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[gnuradio] FAIL at', step, e)
    app.exit(1)
  }
})
