/**
 * Source IPC E2E（真实主进程服务 + 真实 preload + 隐藏 BrowserWindow）
 * 覆盖：OFDM source、signal:analysis 消费、内存/流式录制、回放暂停/单步/seek、
 *       S11 sweep 帧。
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerSignalAnalysisServer } from '../src/main/signal/analysisServer'
import { getSourceService, registerSourceService } from '../src/main/source/sourceService'
import { registerSweepService } from '../src/main/sweep/sweepService'
import type { SourceFrame } from '../src/shared/sourceEngine'
import { defaultAnalysisConfig } from '../src/shared/signal'
import { defaultSweepConfig } from '../src/shared/sweep'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function run(): Promise<void> {
  const disposers = [
    registerSourceService(),
    registerSignalAnalysisServer(),
    registerSweepService()
  ]
  const service = getSourceService()
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(process.cwd(), 'scripts/source-ipc-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[renderer:${level}]`, message)
    if (level >= 3) errors.push(String(message))
  })
  await win.loadFile(path.join(process.cwd(), 'scripts/source-ipc-e2e.html'))
  await wait(300)
  const js = <T>(code: string): Promise<T> =>
    win.webContents.executeJavaScript(code, true) as Promise<T>
  console.log(
    '[source-ipc] api=',
    await js<string>('typeof window.api + ":" + typeof window.api?.source')
  )

  // 1) OFDM source
  const cfg = {
    ...defaultAnalysisConfig(),
    waveform: 'ofdm',
    outputMode: 'complex',
    ofdmSubcarriers: 16,
    ofdmCpRatio: 0.25,
    pointsPerFrame: 512,
    sampleRate: 4096,
    freq: 512,
    fftSize: 256
  }
  const setR = await js<{ ok: boolean; error?: string; __error?: string }>(
    `(async () => {
      try { return await window.api.source.setConfig(${JSON.stringify(cfg)}) }
      catch (e) { return { ok: false, __error: String(e), stack: e && e.stack } }
    })()`
  )
  assert(setR.ok, `source setConfig failed: ${setR.error ?? setR.__error}`)
  const startR = await js<{ ok: boolean }>('window.api.source.start()')
  assert(startR.ok, 'source start failed')
  await wait(350)
  const src = await js<Array<Record<string, number | string>>>(
    `window.__sourceFrames.map((f) => ({
      seq: f.seq,
      waveform: f.waveform,
      outputMode: f.outputMode,
      dataLength: f.data.length,
      qAbs: (() => { let s = 0; for (let k = 1; k < f.data.length; k += 2) s += Math.abs(f.data[k]); return s })()
    }))`
  )
  assert(src.length > 0, 'no source frames')
  assert(src[0]!.waveform === 'ofdm', `waveform=${src[0]!.waveform}`)
  assert(src[0]!.dataLength === 1024, `dataLength=${src[0]!.dataLength}`)
  assert(Number(src[0]!.qAbs) > 0, 'OFDM Q energy is zero')

  // 2) analysis consumer
  const aStart = await js<{ ok: boolean; error?: string }>(
    `window.api.signalAnalysis.start({ mode: 'local' })`
  )
  assert(aStart.ok, `analysis start failed: ${aStart.error}`)
  await js('window.api.signalAnalysis.subscribe()')
  await js('window.__analysisFrames = []')
  await wait(500)
  const af = await js<Array<{ type: string; dataLength: number }>>(
    `window.__analysisFrames.map((f) => ({ type: f.type, dataLength: f.data.length }))`
  )
  assert(
    af.some((f) => f.type === 'iq'),
    'no analysis IQ frames'
  )
  assert(
    af.some((f) => f.type === 'spectrum'),
    'no analysis spectrum frames'
  )

  // 3) memory recording
  await js('window.api.source.recordStart(false)')
  await wait(250)
  const memStop = await js<{ ok: boolean; status?: { frames: number; samples: number } }>(
    'window.api.source.recordStop()'
  )
  assert(memStop.status && memStop.status.frames > 0, 'memory recording captured no frames')
  assert(memStop.status.samples > 0, 'memory recording captured no samples')

  // 4) streaming recording + concatenated export
  await js('window.api.source.recordStart(true)')
  await wait(300)
  const streamStop = await js<{ ok: boolean; status?: { samples: number; truncated: boolean } }>(
    'window.api.source.recordStop()'
  )
  assert(streamStop.status && streamStop.status.samples > 0, 'stream recording captured no samples')
  const streamPath = path.join(os.tmpdir(), `dsh-e2e-${Date.now()}.f32`)
  await service.copyStreamRecording(streamPath)
  const st = await fs.stat(streamPath)
  assert(
    st.size === streamStop.status.samples * 8,
    `stream file size ${st.size} != samples*8 ${streamStop.status.samples * 8}`
  )
  await fs.unlink(streamPath).catch(() => {})

  // 5) playback: capture some frames then load/pause/step/seek
  const captured: SourceFrame[] = []
  const unsub = service.subscribe((f) => captured.push(f))
  await wait(250)
  unsub()
  service.stop()
  assert(captured.length > 0, 'failed to capture playback frames')
  await service.loadPlayback(captured)
  service.startPlayback()
  await js('window.__sourceFrames = []')
  await wait(200)
  const playing = Number(await js<number>('window.__sourceFrames.length'))
  assert(playing > 0, 'playback produced no frames')
  await js('window.api.source.pausePlayback()')
  await wait(150)
  const before = Number(await js<number>('window.__sourceFrames.length'))
  await wait(150)
  const after = Number(await js<number>('window.__sourceFrames.length'))
  assert(after === before, `playback did not pause (${before} -> ${after})`)
  await js('window.api.source.stepPlayback()')
  await wait(80)
  const stepped = Number(await js<number>('window.__sourceFrames.length'))
  assert(stepped > after, 'playback step did not emit a frame')
  await js('window.api.source.seekPlayback(0)')
  const pst = await js<{ index: number; total: number } | null>(
    'window.api.source.playbackStatus()'
  )
  assert(pst && pst.index === 0 && pst.total === captured.length, 'playback seek failed')

  // 5b) timestamp timing / speed / loop
  await js('window.api.source.resumePlayback()')
  await js('window.api.source.setPlaybackTiming("timestamp")')
  await js('window.__sourceFrames = []')
  await wait(300)
  const timestampFrames = Number(await js<number>('window.__sourceFrames.length'))
  assert(timestampFrames > 0, 'timestamp playback produced no frames')
  await js('window.api.source.setPlaybackSpeed(2)')
  await js('window.api.source.setPlaybackLoop(false)')
  const pst2 = await js<{ timing: string; speed: number; loop: boolean } | null>(
    'window.api.source.playbackStatus()'
  )
  assert(pst2?.timing === 'timestamp', `playback timing=${pst2?.timing}`)
  assert(pst2?.speed === 2, `playback speed=${pst2?.speed}`)
  assert(pst2?.loop === false, `playback loop=${pst2?.loop}`)
  await js('window.api.source.stopPlayback()')

  // 6) S11 sweep
  const sweepCfg = { ...defaultSweepConfig(), points: 51, calDelayPs: 100, calLossDb: 1 }
  const swSet = await js<{ ok: boolean; error?: string }>(
    `window.api.sweep.setConfig(${JSON.stringify(sweepCfg)})`
  )
  assert(swSet.ok, `sweep setConfig failed: ${swSet.error}`)
  await js('window.api.sweep.start()')
  await wait(700)
  const sw = await js<Array<{ length: number; gammaAbs: number }>>(
    `window.__sweepFrames.map((f) => ({
      length: f.frequencies.length,
      gammaAbs: Math.hypot(f.gammaI[0], f.gammaQ[0])
    }))`
  )
  assert(sw.length > 0, 'no sweep frames')
  assert(sw[0]!.length === 51, `sweep points=${sw[0]!.length}`)
  assert(Number(sw[0]!.gammaAbs) > 0, 'sweep gamma zero')
  await js('window.api.sweep.stop()')

  await js('window.api.signalAnalysis.stop()')
  await js('window.api.source.stop()')
  if (errors.length) throw new Error(`renderer console errors: ${errors.join('; ')}`)
  console.log(
    `[source-ipc] PASS sourceFrames=${src.length} analysisFrames=${af.length} memFrames=${memStop.status.frames} streamSamples=${streamStop.status.samples} playbackSeek=${pst.index}/${pst.total} sweep=${sw.length}`
  )
  win.destroy()
  for (const d of disposers) d()
}

app.commandLine.appendSwitch('disable-gpu-sandbox')
app
  .whenReady()
  .then(async () => {
    try {
      await run()
      app.exit(0)
    } catch (e) {
      console.error('[source-ipc] FAIL', e)
      app.exit(1)
    }
  })
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
