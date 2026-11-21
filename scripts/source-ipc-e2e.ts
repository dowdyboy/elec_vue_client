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
import { registerRemoteMockServer } from '../src/main/signal/remoteMockServer'
import { getSourceService } from '../src/main/source/sourceService'
import { registerSourceService } from '../src/main/source/sourceIpc'
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
    registerSweepService(),
    registerRemoteMockServer()
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

  // 1b) source:frame 只投递给已订阅窗口：退订后不再接收，重新订阅恢复
  await js('window.api.source.unsubscribe()')
  await js('window.__sourceFrames = []')
  await wait(220)
  const unsubFrames = Number(await js<number>('window.__sourceFrames.length'))
  assert(unsubFrames === 0, `source:frame leaked to unsubscribed window: ${unsubFrames}`)
  await js('window.api.source.subscribe()')
  await wait(220)
  const resubFrames = Number(await js<number>('window.__sourceFrames.length'))
  assert(resubFrames > 0, 'source:frame did not resume after re-subscribe')

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

  // 2b) 远程分析链路：内置 remoteMock(socket.io) → RemoteAnalysisSource → signal:analysis
  await js('window.api.signalAnalysis.stop()')
  await js('window.__analysisFrames = []')
  await js('window.__remoteStatus = []')
  const remotePort = 18799
  const mockStart = await js<{ ok: boolean; port?: number; error?: string }>(
    `window.api.remoteMock.start({ port: ${remotePort} })`
  )
  assert(mockStart.ok, `remote mock start failed: ${mockStart.error}`)
  const remoteStart = await js<{ ok: boolean; mode?: string; error?: string }>(
    `window.api.signalAnalysis.start({ mode: 'remote', remoteUrl: 'http://127.0.0.1:${remotePort}' })`
  )
  assert(
    remoteStart.ok && remoteStart.mode === 'remote',
    `remote analysis start failed: ${remoteStart.error}`
  )
  await wait(900)
  const remoteFrames = await js<Array<{ type: string; dataLength: number }>>(
    `window.__analysisFrames.map((f) => ({ type: f.type, dataLength: f.data.length }))`
  )
  assert(
    remoteFrames.some((f) => f.type === 'iq'),
    'remote analysis produced no IQ frames'
  )
  assert(
    remoteFrames.some((f) => f.type === 'spectrum'),
    'remote analysis produced no spectrum frames'
  )
  const remoteStatuses =
    await js<Array<{ connected: boolean; error?: string }>>('window.__remoteStatus')
  assert(
    remoteStatuses.some((s) => s.connected === true),
    'remote analysis never reported connected'
  )
  const remoteInfo = await js<{ mode?: string }>('window.api.signalAnalysis.getStatus()')
  assert(remoteInfo.mode === 'remote', `remote analysis mode=${remoteInfo.mode}`)
  await js('window.api.signalAnalysis.stop()')
  await wait(250)
  const stoppedStatuses =
    await js<Array<{ connected: boolean; error?: string }>>('window.__remoteStatus')
  const lastStatus = stoppedStatuses[stoppedStatuses.length - 1]
  assert(lastStatus && lastStatus.connected === false, 'remote stop was not reported')
  assert(!lastStatus.error, `remote stop reported an error: ${lastStatus.error}`)
  await js('window.api.remoteMock.stop()')

  // 3) memory recording
  await js('window.api.source.recordStart(false)')
  await wait(250)
  const memStop = await js<{ ok: boolean; status?: { frames: number; samples: number } }>(
    'window.api.source.recordStop()'
  )
  assert(memStop.status && memStop.status.frames > 0, 'memory recording captured no frames')
  assert(memStop.status.samples > 0, 'memory recording captured no samples')

  // 3b) 未导出录制保护：换模式/新录制必须先确认，不能静默丢弃
  const guard = await js<{ ok: boolean; needsConfirm?: boolean }>(
    'window.api.source.recordStart(true)'
  )
  assert(
    guard.ok === false && guard.needsConfirm === true,
    'unexported recording was discarded silently'
  )
  const recStatus = await js<{ hasUnexported?: boolean }>('window.api.source.recordStatus()')
  assert(recStatus.hasUnexported === true, 'recordStatus.hasUnexported should be true')

  // 4) streaming recording + concatenated export
  const streamStart = await js<{ ok: boolean; status?: { recording: boolean } }>(
    'window.api.source.recordStart(true, { confirmDiscard: true })'
  )
  assert(streamStart.ok && streamStart.status?.recording === true, 'stream recording did not start')
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

  // 5c) 回放倍速不得泄漏到直播：设 4x 后启动实时源，0.5s 内仍应约 30 帧（60fps），而不是 ~120 帧
  await js('window.api.source.setPlaybackSpeed(4)')
  await js('window.api.source.start()')
  await js('window.__sourceFrames = []')
  await wait(500)
  const liveFrames = Number(await js<number>('window.__sourceFrames.length'))
  assert(
    liveFrames >= 12 && liveFrames <= 60,
    `live frame rate polluted by playback speed: ${liveFrames} frames in 500ms`
  )
  await js('window.api.source.stop()')

  // 5d) 0 Hz 基带：分析配置与源共享同一合法域（0 ≤ freq < Fs/2）
  const zeroHz = await js<{ ok: boolean; error?: string }>(
    'window.api.signalAnalysis.setConfig({ freq: 0, sampleRate: 4096 })'
  )
  assert(zeroHz.ok, `analysis setConfig rejected 0 Hz baseband: ${zeroHz.error}`)
  await js('window.api.signalAnalysis.setConfig({ freq: 512 })')

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
