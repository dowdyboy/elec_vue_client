<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import {
  ApdCcdfChart,
  EyeDiagramChart,
  PersistenceSpectrumChart,
  PowerTimeChart,
  SignalQualityPanel,
  SmithChart,
  type ApdCcdfData,
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

  await sleep(900)
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
