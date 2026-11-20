/**
 * 本机 GNU Radio 一键启动 E2E（需要本机有 radioconda/GNU Radio，不进 CI）：
 * 1) source.localDefaults 探测 Python/脚本
 * 2) source.localStart 启动 tone_pipeline.py，解析 READY 端口
 * 3) source.startNetwork 连接该端口，断言帧到达
 * 4) 停止网络源与本机进程
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
  let win = null
  try {
    step = 'wait-main'
    await wait(2200)
    const wins = BrowserWindow.getAllWindows()
    win =
      wins.find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')) || wins[0]
    assert(win, 'main window not found')
    const js = (code) => win.webContents.executeJavaScript(code, true)

    step = 'defaults'
    const d = await js(`window.api.source.localDefaults()`)
    console.log(
      `[local-gr] python=${JSON.stringify(d.settings.pythonPath)} exists=${d.pythonExists} script=${JSON.stringify(d.scriptPath)} scriptExists=${d.scriptExists}`
    )
    if (!d.pythonExists || !d.scriptExists)
      throw new Error('local GNU Radio not available on this machine (python/script missing)')

    step = 'local-start'
    const started = await js(
      `window.api.source.localStart(${JSON.stringify({
        pythonPath: d.settings.pythonPath,
        scriptDir: d.settings.scriptDir,
        scriptName: d.settings.scriptName,
        sampleRate: 100000,
        centerHz: 0,
        format: 'ci16',
        toneFreq: 10000,
        tcpPort: 0
      })})`
    )
    assert(started.ok, `localStart failed: ${started.error || 'unknown'}`)
    assert(started.status && started.status.port > 0, 'no port from READY')
    console.log(
      `[local-gr] started pid=${started.status.pid} port=${started.status.port} format=${started.status.format}`
    )

    step = 'network'
    await js(`(() => {
      window.__localFrames = 0
      window.__localDispose = window.api.source.onFrame(() => window.__localFrames++)
      return true
    })()`)
    const net = await js(
      `window.api.source.startNetwork(${JSON.stringify({
        host: '127.0.0.1',
        port: started.status.port,
        format: 'ci16',
        sampleRate: 100000,
        centerHz: 0,
        displaySampleRate: 100000,
        pointsPerFrame: 0,
        reconnect: false
      })})`
    )
    assert(net.ok, `startNetwork failed: ${net.error || 'unknown'}`)
    await wait(1200)
    const frames = await js(`window.__localFrames`)
    const status = await js(`window.api.source.networkStatus()`)
    assert(frames > 0, `no source:frame from local pipeline: ${frames}`)
    assert(status && status.connected && status.framed, 'expected framed network source')
    console.log(
      `[local-gr] network ok frames=${frames} packets=${status.packets} droppedPackets=${status.droppedPackets}`
    )

    step = 'cleanup'
    await js(`window.__localDispose?.()`)
    await js(`window.api.source.stopNetwork().then(() => true)`)
    const stopped = await js(`window.api.source.localStop()`)
    assert(stopped.ok, 'localStop failed')
    assert(stopped.status && stopped.status.running === false, 'local process still running')
    console.log('[local-gr] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[local-gr] FAIL at', step, e)
    // best effort cleanup
    try {
      await win?.webContents.executeJavaScript(`window.api.source.localStop()`, true)
    } catch {
      // ignore
    }
    app.exit(1)
  }
})
