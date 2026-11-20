/**
 * Raw IQ 回放 E2E：生成临时 ci16 + sidecar，调用 source.loadRawPlayback，
 * 断言回放状态与进度，最后停止并清理。
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-e2e-'))
const rawPath = path.join(dir, 'raw.ci16')
const sampleRate = 4000000
const samples = 6000
const buf = Buffer.allocUnsafe(samples * 4)
for (let k = 0; k < samples; k++) {
  buf.writeInt16LE(
    Math.round(0.5 * 32767 * Math.cos((2 * Math.PI * 10000 * k) / sampleRate)),
    k * 4
  )
  buf.writeInt16LE(
    Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 10000 * k) / sampleRate)),
    k * 4 + 2
  )
}
fs.writeFileSync(rawPath, buf)
fs.writeFileSync(
  `${rawPath}.json`,
  JSON.stringify({
    format: 'raw-iq-v1',
    sampleFormat: 'ci16',
    bytesPerSample: 4,
    sampleRate,
    centerHz: 0,
    bytes: buf.length,
    samples,
    frames: 1,
    segments: 1
  })
)

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

    step = 'load'
    const r = await js(`window.api.source.loadRawPlayback(${JSON.stringify(rawPath)})`)
    assert(r.ok, `loadRawPlayback failed: ${r.error || 'unknown'}`)
    const st = await js(`window.api.source.playbackStatus()`)
    assert(st && st.total > 0, 'no playback frames')
    assert(st.playing, 'playback not started')
    assert(st.displaySampleRate === 2000000, `default extract rate=${st.displaySampleRate}`)
    console.log(`[raw-playback] loaded total=${st.total} durationMs=${Math.round(st.durationMs)}`)
    await js(`window.api.source.setPlaybackLoop(false).then(() => true)`)

    step = 'progress'
    await wait(400)
    const st2 = await js(`window.api.source.playbackStatus()`)
    assert(st2 && (st2.index > 0 || !st2.playing), 'playback did not advance')
    console.log(`[raw-playback] progress index=${st2.index}/${st2.total}`)
    await js(`window.api.source.stopPlayback().then(() => true)`)

    step = 'full-rate'
    const full = await js(
      `window.api.source.loadRawPlayback(${JSON.stringify(rawPath)}, { fullRate: true })`
    )
    assert(full.ok, `full-rate load failed: ${full.error || 'unknown'}`)
    const fst = await js(`window.api.source.playbackStatus()`)
    assert(fst && fst.displaySampleRate === 4000000, `full rate=${fst && fst.displaySampleRate}`)
    console.log('[raw-playback] full-rate displaySampleRate=4000000')
    await js(`window.api.source.stopPlayback().then(() => true)`)

    step = 'archive-playback'
    const archiveDir = path.join(dir, 'archive')
    fs.mkdirSync(archiveDir)
    for (let i = 0; i < 2; i++) {
      const p = path.join(archiveDir, `part-${i}.ci16`)
      fs.writeFileSync(p, Buffer.alloc(4 * 4)) // 4 samples
      fs.writeFileSync(
        `${p}.json`,
        JSON.stringify({
          format: 'raw-iq-v1',
          sampleFormat: 'ci16',
          bytesPerSample: 4,
          channels: 1,
          sampleRate: 1000,
          centerHz: 0,
          bytes: 16,
          samples: 4,
          frames: 1
        })
      )
    }
    fs.writeFileSync(
      path.join(archiveDir, 'index.json'),
      JSON.stringify({
        version: 1,
        segments: [0, 1].map((i) => ({
          path: path.join(archiveDir, `part-${i}.ci16`),
          metaPath: path.join(archiveDir, `part-${i}.ci16.json`)
        }))
      })
    )
    const ap = await js(
      `window.api.source.loadArchivePlayback(${JSON.stringify(archiveDir)}, { fullRate: true })`
    )
    assert(ap.ok, `archive playback failed: ${ap.error || 'unknown'}`)
    const ast = await js(`window.api.source.playbackStatus()`)
    assert(ast && ast.total === 2, `archive total=${ast && ast.total}`)
    console.log('[raw-playback] archive playback total=2')
    await js(`window.api.source.stopPlayback().then(() => true)`)

    step = 'cleanup'
    console.log('[raw-playback] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[raw-playback] FAIL at', step, e)
    app.exit(1)
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})
