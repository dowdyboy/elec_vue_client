/** 源工作台 UI smoke 用最小 preload；不连接主进程。 */
const { contextBridge } = require('electron')

const noop = () => () => {}
let sourceRunning = false
const config = {
  freq: 512,
  snr: 20,
  amplitude: 1,
  modType: 'sine',
  outputMode: 'complex',
  waveform: 'cw',
  modFreq: 50,
  amDepth: 0.5,
  fmDeviation: 200,
  pulsePeriod: 0.01,
  pulseDuty: 0.5,
  toneSpacing: 100,
  sampleRate: 4096,
  pointsPerFrame: 2048,
  samplesPerSymbol: 16,
  enabled: true,
  fftSize: 1024,
  window: 'hann',
  dbScale: true,
  overlap: 0.5,
  spectrumMode: 'real',
  imageDb: -120
}

contextBridge.exposeInMainWorld('api', {
  sweep: {
    start: async () => ({ ok: true }),
    stop: async () => ({ ok: true }),
    getStatus: async () => ({ running: false, config: {} }),
    setConfig: async () => ({ ok: true }),
    trigger: async () => ({ ok: true }),
    onFrame: noop
  },
  source: {
    getStatus: async () => ({ running: sourceRunning, config }),
    start: async () => {
      sourceRunning = true
      return { ok: true, status: { running: true, config } }
    },
    stop: async () => {
      sourceRunning = false
      return { ok: true, status: { running: false, config } }
    },
    setConfig: async () => ({ ok: true, config }),
    trigger: async () => ({ ok: true, seq: 1 }),
    recordStart: async () => ({ ok: true }),
    recordStop: async () => ({ ok: true }),
    recordStatus: async () => ({
      recording: false,
      frames: 0,
      samples: 0,
      durationMs: 0,
      truncated: false
    }),
    recordExport: async () => ({ ok: false, canceled: true }),
    loadPlayback: async () => ({ ok: false, canceled: true }),
    startPlayback: async () => ({ ok: false }),
    pausePlayback: async () => ({ ok: false }),
    resumePlayback: async () => ({ ok: false }),
    stepPlayback: async () => ({ ok: false }),
    setPlaybackSpeed: async () => ({ ok: false }),
    stopPlayback: async () => ({ ok: true }),
    playbackStatus: async () => null,
    onFrame: () => () => {}
  },
  signalAnalysis: {
    getStatus: async () => ({ running: false, mode: 'none', port: 0, config }),
    start: async () => ({ ok: true, mode: 'local', port: 8767 }),
    stop: async () => ({ ok: true }),
    setConfig: async () => ({ ok: true, config }),
    trigger: async () => ({ ok: true }),
    subscribe: async () => ({ ok: true }),
    unsubscribe: async () => ({ ok: true }),
    onFrame: noop,
    onStatus: noop
  }
})
