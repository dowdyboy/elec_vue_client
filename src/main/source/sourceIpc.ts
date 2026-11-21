/**
 * 源服务的 IPC 注册（从 sourceService.ts 拆出）
 *
 * 33 个 source:* 通道：订阅投递、启停、双通道合成源、网络源、录制、回放控制、
 * 以及把 source:frame 只投递给"订阅过"的窗口（多窗口不互相刷帧）。
 * 逻辑原样搬移，仅把服务实例改为从 getSourceService() 取。
 */
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeConfigPatch } from '../../shared/signal'
import { sanitizeNetworkConfig } from '../../shared/sourceNetwork'
import { SourceRecorder } from '../../shared/sourceRecorder'
import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'
import type { Disposer } from '../utils/disposable'
import { RawIqRecorder } from './network/rawIqRecorder'
import { getSourceService, resetSourceService } from './sourceService'
import { pickRecording, pickRawRecordingFile, pickArbitraryIq, readRawMeta } from './sourceFiles'

export function registerSourceService(): Disposer {
  // 单实例启动：清掉上次崩溃/测试留下的 raw 临时目录（Windows 下 fd 未关时跳过）
  RawIqRecorder.cleanupStaleTempDirs()
  const service = getSourceService()
  /** 已挂过 destroyed/navigation 监听的 webContents，避免重复挂 */
  const watchedSenders = new Set<number>()
  const watchedDualSenders = new Set<number>()

  ipcMain.handle('source:subscribe', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const id = e.sender.id
    service.subscribeWindow(id)
    if (!watchedSenders.has(id)) {
      watchedSenders.add(id)
      e.sender.once('destroyed', () => {
        watchedSenders.delete(id)
        service.clearWindowSubscriber(id)
      })
      // 跨文档导航/刷新后旧订阅作废（did-navigate 不含 hash 路由切换）
      e.sender.on('did-navigate', () => service.clearWindowSubscriber(id))
      e.sender.on('render-process-gone', () => {
        watchedSenders.delete(id)
        service.clearWindowSubscriber(id)
      })
    }
    return { ok: true }
  })

  ipcMain.handle('source:unsubscribe', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.unsubscribeWindow(e.sender.id)
    return { ok: true }
  })

  ipcMain.handle('source:subscribeDual', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const id = e.sender.id
    service.subscribeDualWindow(id)
    if (!watchedDualSenders.has(id)) {
      watchedDualSenders.add(id)
      e.sender.once('destroyed', () => {
        watchedDualSenders.delete(id)
        service.clearDualWindowSubscriber(id)
      })
    }
    return { ok: true }
  })

  ipcMain.handle('source:unsubscribeDual', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.unsubscribeDualWindow(e.sender.id)
    return { ok: true }
  })

  ipcMain.handle('source:start', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.start()
    return { ok: true, status: service.getStatus() }
  })

  ipcMain.handle('source:stop', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stop()
    return { ok: true, status: service.getStatus() }
  })

  ipcMain.handle('source:startDualSim', (e, cfg?: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = service.startDualSim(cfg)
    return { ...r, status: service.getStatus() }
  })

  ipcMain.handle('source:stopDualSim', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stopDualSim()
    return { ok: true, status: service.getStatus() }
  })

  ipcMain.handle('source:getStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.getStatus()
  })

  ipcMain.handle('source:setConfig', (e, patch: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = sanitizeConfigPatch(patch)
    if (!r.ok) return { ok: false, error: r.error }
    service.setConfig(r.value ?? {})
    return { ok: true, config: service.getStatus().config }
  })

  ipcMain.handle('source:startNetwork', async (e, cfg: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const r = sanitizeNetworkConfig(cfg)
    if (!r.ok || !r.value) return { ok: false, error: r.error }
    return service.startNetwork(r.value)
  })

  ipcMain.handle('source:stopNetwork', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    await service.disposeNetworkAsync()
    return { ok: true }
  })

  ipcMain.handle('source:networkStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.networkStatus()
  })

  ipcMain.handle('source:setActiveChannel', (e, channel: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.setActiveChannel(typeof channel === 'number' ? channel : 0)
    return { ok: true, status: service.networkStatus() }
  })

  ipcMain.handle('source:trigger', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const emitted = service.trigger()
    return { ok: true, emitted, seq: service.lastSeq }
  })

  ipcMain.handle(
    'source:recordStart',
    async (
      e,
      stream: unknown,
      opts?: { confirmDiscard?: boolean; rawArchive?: boolean; rawSegmentMB?: number }
    ) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      const r = await service.recordStart(!!stream, {
        confirmDiscard: opts?.confirmDiscard === true,
        rawArchive: opts?.rawArchive === true,
        rawSegmentMB: opts?.rawSegmentMB
      })
      return { ...r, status: service.recordStatus() }
    }
  )

  ipcMain.handle('source:recordStop', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    await service.recordStop()
    return { ok: true, status: service.recordStatus() }
  })

  ipcMain.handle('source:recordStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.recordStatus()
  })

  ipcMain.handle('source:recordExport', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    // 网络源：全速 raw 录制导出（ci16/cf32/ci8 + sidecar JSON）
    if (service.isRawRecordingMode()) {
      const raw = service.rawRecordStatus()
      if (!raw || raw.bytes === 0) return { ok: false, error: '没有可导出的 raw 录制' }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ext = raw.format
      const opts = {
        title: '导出网络源 raw IQ（原始样本 + 元数据）',
        defaultPath: `source-raw-${stamp}.${ext}`,
        filters: [
          { name: `Raw IQ (${ext})`, extensions: [ext] },
          { name: 'All Files', extensions: ['*'] }
        ]
      }
      const focused = BrowserWindow.getFocusedWindow()
      const ret = focused
        ? await dialog.showSaveDialog(focused, opts)
        : await dialog.showSaveDialog(opts)
      if (ret.canceled || !ret.filePath) return { ok: false, canceled: true }
      const target = ret.filePath.toLowerCase().endsWith(`.${ext}`)
        ? ret.filePath
        : `${ret.filePath}.${ext}`
      try {
        const r = await service.exportRawRecording(target)
        return {
          ok: true,
          path: r.path,
          metaPath: r.metaPath,
          frames: r.frames,
          samples: r.samples
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const streamMode = service.isStreamRecordingMode()
    // 先确认有数据、再弹保存框；取消保存不会顺手停掉正在进行的录制
    const preview = streamMode ? service.streamFrames() : service.recordFrames()
    if (preview.length === 0) return { ok: false, error: '没有可导出的录制帧' }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const opts = {
      title: '导出源录制（原始 IQ + 元数据）',
      defaultPath: `source-recording-${stamp}.f32`,
      filters: [
        { name: 'Float32 IQ', extensions: ['f32'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const focused = BrowserWindow.getFocusedWindow()
    const ret = focused
      ? await dialog.showSaveDialog(focused, opts)
      : await dialog.showSaveDialog(opts)
    if (ret.canceled || !ret.filePath) return { ok: false, canceled: true }
    const f32Path = ret.filePath.toLowerCase().endsWith('.f32')
      ? ret.filePath
      : `${ret.filePath}.f32`
    const jsonPath = f32Path.replace(/\.f32$/i, '.json')
    try {
      await service.recordStop()
      const frames = streamMode ? service.streamFrames() : service.recordFrames()
      if (streamMode) {
        await service.copyStreamRecording(f32Path)
      } else {
        const rawFrames = frames as ReturnType<SourceRecorder['getFrames']>
        const totalFloats = rawFrames.reduce((n, f) => n + f.data.length, 0)
        const buf = Buffer.allocUnsafe(totalFloats * 4)
        let off = 0
        for (const f of rawFrames) {
          for (let i = 0; i < f.data.length; i++) {
            buf.writeFloatLE(f.data[i]!, off)
            off += 4
          }
        }
        await fs.writeFile(f32Path, buf)
      }
      const sampleRates = new Set(frames.map((f) => f.sampleRate))
      const totalSamples = frames.reduce((n, f) => n + f.sampleCount, 0)
      const meta = {
        format: 'source-iq-f32-v1',
        endianness: 'little',
        layout: 'interleaved IQ',
        // 新录制时间基：timestamp 为信号时间；wallTimestamp 保留真实采集时刻
        timebase: 'signal' as const,
        createdAt: new Date().toISOString(),
        sampleRate: sampleRates.size === 1 ? frames[0]!.sampleRate : null,
        totalSamples,
        frames: frames.map((f) => ({
          seq: f.seq,
          timestamp: f.timestamp,
          wallTimestamp: f.wallTimestamp,
          sampleRate: f.sampleRate,
          centerFrequencyHz: f.centerFrequencyHz,
          outputMode: f.outputMode,
          waveform: f.waveform,
          modType: f.modType,
          samplesPerSymbol: f.samplesPerSymbol,
          amplitude: f.amplitude,
          sampleCount: f.sampleCount
        }))
      }
      await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8')
      service.markRecordingExported()
      return {
        ok: true,
        path: f32Path,
        metaPath: jsonPath,
        frames: frames.length,
        samples: totalSamples
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('source:importIq', async (e, opts?: { confirmDiscard?: boolean }) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
      return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
    const r = await pickArbitraryIq(service.getStatus().config)
    if (!r.ok || !r.frames) return { ok: false, canceled: r.canceled, error: r.error }
    await service.loadPlayback(r.frames)
    service.startPlayback()
    return { ok: true, path: r.path, truncated: r.truncated, status: service.playbackStatus() }
  })

  ipcMain.handle('source:loadPlayback', async (e, opts?: { confirmDiscard?: boolean }) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
      return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
    const r = await pickRecording()
    if (!r.ok || !r.frames) return { ok: false, canceled: r.canceled, error: r.error }
    await service.loadPlayback(r.frames)
    service.startPlayback()
    return { ok: true, path: r.path, status: service.playbackStatus() }
  })

  ipcMain.handle(
    'source:loadRawPlayback',
    async (
      e,
      target?: unknown,
      opts?: { confirmDiscard?: boolean; channel?: number; fullRate?: boolean }
    ) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
        return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
      const chosen =
        typeof target === 'string' && target.trim()
          ? { ok: true, path: target }
          : await pickRawRecordingFile()
      if (!chosen.ok || !chosen.path)
        return { ok: false, canceled: chosen.canceled, error: chosen.error }
      const meta = await readRawMeta(chosen.path)
      if (!meta) return { ok: false, error: '未找到 raw 元数据（<file>.json）或格式不是 raw-iq-v1' }
      const displaySampleRate = opts?.fullRate
        ? meta.sampleRate
        : Math.min(meta.sampleRate, 2_000_000)
      const pointsPerFrame = Math.max(256, Math.min(65_536, Math.round(displaySampleRate / 60)))
      try {
        await service.loadRawPlayback({
          path: meta.path,
          format: meta.format,
          sampleRate: meta.sampleRate,
          centerHz: meta.centerHz,
          totalSamples: meta.samples,
          displaySampleRate,
          pointsPerFrame,
          channels: meta.channels,
          channel: opts?.channel === 1 ? 1 : 0,
          loop: true
        })
        service.startPlayback()
        return { ok: true, path: meta.path, status: service.playbackStatus() }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    'source:loadRawArchivePlayback',
    async (
      e,
      target?: unknown,
      opts?: { confirmDiscard?: boolean; channel?: number; fullRate?: boolean }
    ) => {
      if (!isTrustedSender(e)) return FORBIDDEN
      if (service.hasUnexportedRecording() && opts?.confirmDiscard !== true)
        return { ok: false, needsConfirm: true, error: '存在未导出的录制，先导出或确认丢弃' }
      let dir = typeof target === 'string' && target.trim() ? target : ''
      if (!dir) {
        const focused = BrowserWindow.getFocusedWindow()
        const ret = focused
          ? await dialog.showOpenDialog(focused, {
              title: '打开滚动归档目录（含 index.json）',
              defaultPath: join(app.getPath('userData'), 'raw-archive'),
              properties: ['openDirectory']
            })
          : await dialog.showOpenDialog({
              title: '打开滚动归档目录（含 index.json）',
              defaultPath: join(app.getPath('userData'), 'raw-archive'),
              properties: ['openDirectory']
            })
        if (ret.canceled || ret.filePaths.length === 0) return { ok: false, canceled: true }
        dir = ret.filePaths[0]
      }
      try {
        await service.loadArchivePlayback({
          dir,
          channel: opts?.channel === 1 ? 1 : 0,
          fullRate: opts?.fullRate === true,
          loop: true
        })
        service.startPlayback()
        return { ok: true, path: dir, status: service.playbackStatus() }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('source:startPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.startPlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:pausePlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.pausePlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:resumePlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.resumePlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:stepPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.stepPlayback(), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackSpeed', (e, speed: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (typeof speed !== 'number') return { ok: false, error: 'speed 非法' }
    return { ok: service.setPlaybackSpeed(speed), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackTiming', (e, timing: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (timing !== 'fixed' && timing !== 'timestamp') return { ok: false, error: 'timing 非法' }
    return { ok: service.setPlaybackTiming(timing), status: service.playbackStatus() }
  })

  ipcMain.handle('source:setPlaybackLoop', (e, loop: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return { ok: service.setPlaybackLoop(!!loop), status: service.playbackStatus() }
  })

  ipcMain.handle('source:seekPlayback', (e, index: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    if (typeof index !== 'number') return { ok: false, error: 'index 非法' }
    return { ok: service.seekPlayback(index), status: service.playbackStatus() }
  })

  ipcMain.handle('source:stopPlayback', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    service.stopPlayback()
    return { ok: true, status: service.playbackStatus() }
  })

  ipcMain.handle('source:playbackStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return service.playbackStatus()
  })

  return () => {
    service.dispose()
    resetSourceService()
    watchedSenders.clear()
    watchedDualSenders.clear()
    ipcMain.removeHandler('source:subscribe')
    ipcMain.removeHandler('source:unsubscribe')
    ipcMain.removeHandler('source:subscribeDual')
    ipcMain.removeHandler('source:unsubscribeDual')
    ipcMain.removeHandler('source:start')
    ipcMain.removeHandler('source:stop')
    ipcMain.removeHandler('source:startDualSim')
    ipcMain.removeHandler('source:stopDualSim')
    ipcMain.removeHandler('source:getStatus')
    ipcMain.removeHandler('source:setConfig')
    ipcMain.removeHandler('source:startNetwork')
    ipcMain.removeHandler('source:stopNetwork')
    ipcMain.removeHandler('source:networkStatus')
    ipcMain.removeHandler('source:setActiveChannel')
    ipcMain.removeHandler('source:trigger')
    ipcMain.removeHandler('source:recordStart')
    ipcMain.removeHandler('source:recordStop')
    ipcMain.removeHandler('source:recordStatus')
    ipcMain.removeHandler('source:recordExport')
    ipcMain.removeHandler('source:importIq')
    ipcMain.removeHandler('source:loadPlayback')
    ipcMain.removeHandler('source:loadRawPlayback')
    ipcMain.removeHandler('source:loadRawArchivePlayback')
    ipcMain.removeHandler('source:startPlayback')
    ipcMain.removeHandler('source:pausePlayback')
    ipcMain.removeHandler('source:resumePlayback')
    ipcMain.removeHandler('source:stepPlayback')
    ipcMain.removeHandler('source:setPlaybackSpeed')
    ipcMain.removeHandler('source:setPlaybackTiming')
    ipcMain.removeHandler('source:setPlaybackLoop')
    ipcMain.removeHandler('source:seekPlayback')
    ipcMain.removeHandler('source:stopPlayback')
    ipcMain.removeHandler('source:playbackStatus')
  }
}
