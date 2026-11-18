<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import {
  ApdCcdfChart,
  ConstellationChart,
  EyeDiagramChart,
  IqChart,
  PersistenceSpectrumChart,
  PowerTimeChart,
  SignalQualityPanel,
  SmithChart,
  SpectrogramChart,
  SpectrumChart,
  type ApdCcdfData,
  type ExportPayload,
  type EyeStats,
  type PersistenceStats,
  type PulseAnalysis,
  type SignalQualityMetrics,
  type SmithStats
} from '@signal'

declare global {
  interface Window {
    __SMOKE_READY__?: boolean
    __SMOKE_RESULTS__?: Record<string, unknown>
    __SMOKE_ERRORS__?: string[]
  }
}

const powerRef = ref<InstanceType<typeof PowerTimeChart> | null>(null)
const powerData = ref<Float32Array | null>(null)
const eyeRef = ref<InstanceType<typeof EyeDiagramChart> | null>(null)
const persistenceRef = ref<InstanceType<typeof PersistenceSpectrumChart> | null>(null)
const smithRef = ref<InstanceType<typeof SmithChart> | null>(null)
const apdRef = ref<InstanceType<typeof ApdCcdfChart> | null>(null)
const iqRef = ref<InstanceType<typeof IqChart> | null>(null)
const specRef = ref<InstanceType<typeof SpectrumChart> | null>(null)
const spectrogramRef = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const constellationRef = ref<InstanceType<typeof ConstellationChart> | null>(null)

/** 导出 smoke：验证 PNG 管线能产出非空负载（含 exportHandler 路径与 dataURL 路径） */
interface ExportRecord {
  kind: 'png' | 'csv'
  filename: string
  size: number
}
const exportResults: Record<string, ExportRecord> = {}
function recordExport(key: string) {
  return (p: ExportPayload): void => {
    const size = p.kind === 'png' ? (p.dataUrl?.length ?? p.blob?.size ?? 0) : (p.text?.length ?? 0)
    exportResults[key] = { kind: p.kind, filename: p.filename, size }
  }
}
const exportIq = recordExport('iq')
const exportSpectrum = recordExport('spectrum')
const exportSpectrogram = recordExport('spectrogram')
const exportConstellation = recordExport('constellation')
function recordDataUrl(key: string, dataUrl: string | null | undefined): void {
  const size = dataUrl?.length ?? 0
  exportResults[key] = { kind: 'png', filename: `${key}.png`, size }
}

const qualityMetrics = ref<SignalQualityMetrics>({
  evmPercent: 2.4,
  merDb: 32,
  snrDb: 28,
  carrierOffsetHz: -8,
  paprDb: 7.5
})
const qualityThresholds = {
  evmPercentMax: 5,
  merDbMin: 25,
  snrDbMin: 20,
  carrierOffsetHzMax: 50,
  paprDbMax: 10
}
const powerAnalysis = { enabled: true, thresholdDb: -40, hysteresisDb: 4, minWidthSec: 1e-5 }
const persistenceAnalysis = { enabled: true, decay: 0.02 }

const errors: string[] = []
window.__SMOKE_ERRORS__ = errors
window.addEventListener('error', (e) => errors.push(e.message))
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function makePower(): Float32Array {
  const v = new Float32Array(4096)
  for (let i = 0; i < v.length; i++) {
    const phase = i % 600
    v[i] = phase < 80 ? -18 + Math.sin(i / 8) : -82 + (i % 3)
  }
  return v
}

function makeEyeTraces(): Float32Array[] {
  const out: Float32Array[] = []
  for (let k = 0; k < 120; k++) {
    const n = 64
    const t = new Float32Array(n)
    const left = k % 4 < 2 ? 1 : -1
    const right = k % 8 < 4 ? 1 : -1
    const jitter = ((k * 7) % 11) / 80 - 0.06
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1)
      const e = Math.min(1, Math.max(0, (x - 0.35 + jitter) / 0.3))
      const s = e * e * (3 - 2 * e)
      t[i] = left + (right - left) * s
    }
    out.push(t)
  }
  return out
}

function makeSmith(): { i: Float32Array; q: Float32Array; name: string } {
  const n = 160
  const i = new Float32Array(n)
  const q = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n
    i[k] = 0.28 + 0.16 * Math.cos(th)
    q[k] = 0.1 + 0.16 * Math.sin(th)
  }
  return { i, q, name: 'Smoke' }
}

function makeSpectrum(): Float32Array {
  const n = 64
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) v[i] = -100 + (i % 5)
  for (let i = 18; i < 24; i++) v[i] = -35
  return v
}

function makeApdSamples(): Float32Array {
  const n = 4000
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // deterministic pseudo-noise + sparse peaks
    const s = Math.sin(i * 12.9898) * 43758.5453
    const nz = (s - Math.floor(s)) * 2 - 1
    v[i] = nz * 3 + (i % 997 === 0 ? 12 : 0)
  }
  return v
}

/** 确定性伪噪声（禁止 Math.random，保证 smoke 可复现） */
function pseudoNoise(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

function makeIq(): Float32Array {
  const n = 2048
  const v = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const t = k * 0.01
    v[2 * k] = Math.sin(t) * 0.6 + pseudoNoise(k) * 0.01
    v[2 * k + 1] = Math.cos(t) * 0.4 + pseudoNoise(k + 7) * 0.01
  }
  return v
}

function makeConstellationIq(): Float32Array {
  const n = 2048
  const sps = 16
  const v = new Float32Array(n * 2)
  const levels = [-0.7, 0.7]
  let bi = 0
  let bq = 0
  for (let k = 0; k < n; k++) {
    if (k % sps === 0) {
      bi = levels[(k * 7) % 2]!
      bq = levels[(k * 11) % 2]!
    }
    v[2 * k] = bi + pseudoNoise(k) * 0.02
    v[2 * k + 1] = bq + pseudoNoise(k + 3) * 0.02
  }
  return v
}

onMounted(async () => {
  await nextTick()
  const power = makePower()
  powerData.value = power
  await nextTick()
  const powerStats = powerRef.value?.getStats()
  const pulses: PulseAnalysis | null | undefined = powerRef.value?.getPulses()

  eyeRef.value?.appendData(makeEyeTraces())
  const eyeStats: EyeStats | null | undefined = eyeRef.value?.getStats()

  const w = 64
  const h = 32
  const density = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 30 && y === 22) density[y * w + x] = 200
      else if (x === 30) density[y * w + x] = 1
    }
  }
  persistenceRef.value?.setData({ width: w, height: h, minDb: -120, maxDb: -20, density })
  const persistenceMatrixStats: PersistenceStats | null | undefined =
    persistenceRef.value?.getStats()
  for (let f = 0; f < 20; f++) persistenceRef.value?.appendData(makeSpectrum())
  const persistenceAnalysisStats: PersistenceStats | null | undefined =
    persistenceRef.value?.getStats()

  smithRef.value?.appendData(makeSmith())
  const smithStats: SmithStats | null | undefined = smithRef.value?.getStats()

  apdRef.value?.appendData(makeApdSamples())
  const apdStats: ApdCcdfData | null | undefined = apdRef.value?.getStats()

  // 导出管线数据（iq/spectrum/spectrogram/constellation 走 exportHandler）
  iqRef.value?.appendData(makeIq(), { sampleRate: 4096 })
  specRef.value?.appendData(makeSpectrum(), {
    sampleRate: 4096,
    fftSize: 128,
    dbScale: true,
    spectrumMode: 'real',
    freqStartHz: 0,
    binHz: 32,
    fftShift: false
  })
  for (let r = 0; r < 32; r++) {
    const row = makeSpectrum()
    for (let i = 0; i < row.length; i++) row[i] += Math.sin((i + r) * 0.2) * 2
    spectrogramRef.value?.appendData(row, {
      sampleRate: 4096,
      fftSize: 128,
      timeStepSec: 0.01
    })
  }
  constellationRef.value?.appendData(makeConstellationIq())

  await sleep(900)
  // PNG 导出 smoke：5 个 dataURL 返回型 + 4 个 exportHandler 型
  recordDataUrl('power', powerRef.value?.exportPNG())
  recordDataUrl('eye', eyeRef.value?.exportPNG())
  recordDataUrl('persistence', persistenceRef.value?.exportPNG())
  recordDataUrl('smith', smithRef.value?.exportPNG())
  recordDataUrl('apd', apdRef.value?.exportPNG())
  await Promise.all([
    iqRef.value?.exportPNGAsync(),
    specRef.value?.exportPNGAsync(),
    spectrogramRef.value?.exportPNGAsync(),
    constellationRef.value?.exportPNGAsync()
  ])

  const qualityRows = document.querySelectorAll('.sig-quality-item').length
  const info = {
    power: document.querySelector('.sig-power-info')?.textContent?.trim() ?? '',
    eye: document.querySelector('.sig-eye-info')?.textContent?.trim() ?? '',
    persistence: document.querySelector('.sig-persist-info')?.textContent?.trim() ?? '',
    smith: document.querySelector('.sig-smith-info')?.textContent?.trim() ?? '',
    apd: document.querySelector('.sig-apd-info')?.textContent?.trim() ?? ''
  }
  const result = {
    power: { stats: powerStats, pulses },
    eye: eyeStats,
    persistence: { matrix: persistenceMatrixStats, analysis: persistenceAnalysisStats },
    smith: smithStats,
    apd: apdStats,
    exports: exportResults,
    qualityRows,
    info,
    errors
  }
  window.__SMOKE_RESULTS__ = result
  window.__SMOKE_READY__ = true
})
</script>

<template>
  <div class="smoke">
    <section class="cell">
      <h3>PowerTime</h3>
      <PowerTimeChart
        ref="powerRef"
        :data="powerData"
        :height="250"
        :unit="'dBm'"
        :sample-rate="10000"
        :analysis="powerAnalysis"
        theme="spectrum"
      />
    </section>
    <section class="cell">
      <h3>Eye</h3>
      <EyeDiagramChart ref="eyeRef" :height="250" :span-symbols="2" theme="spectrum" />
    </section>
    <section class="cell">
      <h3>Persistence</h3>
      <PersistenceSpectrumChart
        ref="persistenceRef"
        :height="250"
        :bins="64"
        :levels="32"
        :min-db="-120"
        :max-db="-20"
        :analysis="persistenceAnalysis"
        color-map="turbo"
        theme="spectrum"
      />
    </section>
    <section class="cell">
      <h3>Smith</h3>
      <SmithChart ref="smithRef" :height="250" theme="spectrum" />
    </section>
    <section class="cell">
      <h3>APD/CCDF</h3>
      <ApdCcdfChart
        ref="apdRef"
        :height="250"
        :analysis="{ enabled: true, bins: 64 }"
        theme="spectrum"
      />
    </section>
    <section class="cell">
      <h3>IQ / Spectrum / Spectrogram / Constellation export</h3>
      <div class="export-grid">
        <IqChart
          ref="iqRef"
          :height="200"
          :sample-rate="4096"
          :export-handler="exportIq"
          theme="spectrum"
        />
        <SpectrumChart
          ref="specRef"
          :height="200"
          :sample-rate="4096"
          :fft-size="128"
          :export-handler="exportSpectrum"
          theme="spectrum"
        />
        <SpectrogramChart
          ref="spectrogramRef"
          :height="200"
          :time-span="32"
          :sample-rate="4096"
          :fft-size="128"
          :export-handler="exportSpectrogram"
          theme="spectrum"
        />
        <ConstellationChart
          ref="constellationRef"
          :height="200"
          :point-size="2"
          :export-handler="exportConstellation"
          theme="spectrum"
        />
      </div>
    </section>
    <section class="cell">
      <h3>Quality</h3>
      <SignalQualityPanel
        :metrics="qualityMetrics"
        :thresholds="qualityThresholds"
        title="Smoke quality"
      />
    </section>
  </div>
</template>

<style scoped>
.smoke {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 1380px;
}
.export-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.cell {
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 6px;
  min-width: 0;
}
h3 {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 500;
  color: #8b949e;
}
</style>
