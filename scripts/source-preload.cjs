/** 源工作台 UI smoke 用最小 preload；不连接主进程。 */
const { contextBridge } = require('electron')

const noop = () => () => {}
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
