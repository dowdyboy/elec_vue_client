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
  type EyeInput,
  type PersistenceMatrix,
  type PowerTimeNormalized,
  type SignalQualityMetrics,
  type SignalQualityThresholds,
  type SmithTrace
} from '@signal'

type Renderer = 'auto' | 'webgl2' | 'canvas2d'
const q = new URLSearchParams(location.search).get('renderer')
const renderer: Renderer = q === 'webgl2' ? 'webgl2' : q === 'auto' ? 'auto' : 'canvas2d'

const iq = ref<InstanceType<typeof IqChart> | null>(null)
const spec = ref<InstanceType<typeof SpectrumChart> | null>(null)
const specComplex = ref<InstanceType<typeof SpectrumChart> | null>(null)
const specgram = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const specgramComplex = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const constellation = ref<InstanceType<typeof ConstellationChart> | null>(null)

// 新增 6 个组件走 :data 纯显示路径：数据固定，不启动分析/自动量程等时间相关逻辑
const powerData = ref<PowerTimeNormalized>()
const eyeData = ref<EyeInput>()
const persistenceData = ref<PersistenceMatrix>()
const smithData = ref<SmithTrace>()
const apdData = ref<ApdCcdfData>()

// 固定 metrics/thresholds：CFO 超限同时覆盖 pass/fail 两种状态
const qualityMetrics: SignalQualityMetrics = {
  evmPercent: 2.41,
  merDb: 32.6,
  snrDb: 28.4,
  carrierOffsetHz: -72.5,
  paprDb: 7.6,
  powerDbm: -12.4
}
const qualityThresholds: SignalQualityThresholds = {
  evmPercentMax: 5,
  merDbMin: 25,
  snrDbMin: 20,
  carrierOffsetHzMax: 50,
  paprDbMax: 10,
  powerDbmMin: -20,
  powerDbmMax: 0
}

/** 固定种子 PRNG（mulberry32）：坐标/字体/数据完全确定，截图才可像素回归 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

onMounted(async () => {
  const rand = mulberry32(0x5eed)
  const n = 8192
  const iqData = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const t = k * 0.02
    iqData[2 * k] = Math.sin(t) * 0.6 + (rand() - 0.5) * 0.02
    iqData[2 * k + 1] = Math.cos(t) * 0.45 + (rand() - 0.5) * 0.02
  }
  iq.value?.appendData(iqData, { sampleRate: 1_000_000 })

  // 星座：纯显示路径——调用方给基带 QPSK 四簇，组件不做载波/符号/EVM
  const constN = 4096
  const constSps = 16
  const constData = new Float32Array(constN * 2)
  const levels = [-0.7, 0.7]
  let bi = 0
  let bq = 0
  for (let k = 0; k < constN; k++) {
    if (k % constSps === 0) {
      bi = levels[(rand() * 2) | 0]!
      bq = levels[(rand() * 2) | 0]!
    }
    constData[2 * k] = bi + (rand() - 0.5) * 0.05
    constData[2 * k + 1] = bq + (rand() - 0.5) * 0.05
  }
  constellation.value?.appendData(constData)

  const bins = 512
  const specData = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    const f = k / bins
    const tone1 = Math.exp(-((f - 0.18) ** 2) / 0.0005) * 85
    const tone2 = Math.exp(-((f - 0.62) ** 2) / 0.001) * 60
    specData[k] = -98 + tone1 + tone2 + rand() * 1.5
  }
  spec.value?.appendData(specData, { sampleRate: 4_000_000, fftSize: 1024, dbScale: true })

  // 复谱：完整 1024 bin、-Fs/2~+Fs/2；正负频率各一个峰，验证带符号轴
  const complexBins = 1024
  const complexRow = new Float32Array(complexBins)
  const binHz = 4_000_000 / complexBins
  for (let k = 0; k < complexBins; k++) {
    const hz = (k - complexBins / 2) * binHz
    const negTone = Math.exp(-((hz + 700_000) ** 2) / (2 * 45_000 ** 2)) * 80
    const posTone = Math.exp(-((hz - 400_000) ** 2) / (2 * 90_000 ** 2)) * 55
    complexRow[k] = -112 + negTone + posTone + rand() * 1.2
  }
  const complexMeta = {
    sampleRate: 4_000_000,
    fftSize: complexBins,
    spectrumMode: 'complex' as const,
    freqStartHz: -2_000_000,
    binHz,
    fftShift: true,
    dbScale: true
  }
  specComplex.value?.appendData(complexRow, complexMeta)

  // 复谱时频：64 行 × 1024 bin，正负频率各一条漂移谱峰
  for (let r = 0; r < 64; r++) {
    const row = new Float32Array(complexBins)
    const negCenter = -700_000 + 120_000 * Math.sin(r * 0.09)
    const posCenter = 400_000 - 80_000 * Math.cos(r * 0.07)
    for (let k = 0; k < complexBins; k++) {
      const hz = (k - complexBins / 2) * binHz
      const p1 = Math.exp(-((hz - negCenter) ** 2) / (2 * 35_000 ** 2)) * 78
      const p2 = Math.exp(-((hz - posCenter) ** 2) / (2 * 60_000 ** 2)) * 52
      row[k] = -110 + p1 + p2 + rand() * 1.1
    }
    specgramComplex.value?.appendData(row, {
      ...complexMeta,
      timeStepSec: complexBins / 4_000_000
    })
  }

  // 时频：128 行 × 512 bin 的确定性瀑布（两条缓慢漂移的谱峰）
  const bins2 = 512
  for (let r = 0; r < 128; r++) {
    const row = new Float32Array(bins2)
    const c1 = 0.2 + 0.04 * Math.sin(r * 0.06)
    const c2 = 0.66 + 0.02 * Math.cos(r * 0.08)
    for (let k = 0; k < bins2; k++) {
      const f = k / bins2
      const p1 = Math.exp(-((f - c1) ** 2) / 0.00045) * 88
      const p2 = Math.exp(-((f - c2) ** 2) / 0.0009) * 62
      row[k] = -105 + p1 + p2 + rand() * 1.2
    }
    specgram.value?.appendData(row, {
      sampleRate: 4_000_000,
      fftSize: 1024,
      timeStepSec: 1024 / 4_000_000
    })
  }

  // 功率-时间：固定 2048 点脉冲串（1 MHz 采样 → 2.048 ms 窗），关闭自动量程避免逐帧抖动
  const powerN = 2048
  const powerValues = new Float32Array(powerN)
  const powerRand = mulberry32(0x51a7)
  for (let k = 0; k < powerN; k++) {
    const burst = k % 256 < 96
    powerValues[k] = (burst ? -22 : -78) + 2.4 * Math.sin(k * 0.21) + (powerRand() - 0.5) * 1.6
  }
  powerData.value = { values: powerValues, sampleRate: 1_000_000 }

  // 眼图：120 条固定轨迹，每条 2 UI / 65 点（32 sps），平滑沿 + 固定抖动
  const eyeTraces: Float32Array[] = []
  const eyeRand = mulberry32(0xe1e0)
  for (let k = 0; k < 120; k++) {
    const trace = new Float32Array(65)
    const left = eyeRand() < 0.5 ? -1 : 1
    const right = eyeRand() < 0.5 ? -1 : 1
    const jitter = (eyeRand() - 0.5) * 0.06
    for (let i = 0; i < trace.length; i++) {
      const x = i / (trace.length - 1)
      const edge = Math.min(1, Math.max(0, (x - 0.34 - jitter) / 0.3))
      const smooth = edge * edge * (3 - 2 * edge)
      trace[i] = left + (right - left) * smooth + (eyeRand() - 0.5) * 0.03
    }
    eyeTraces.push(trace)
  }
  eyeData.value = { traces: eyeTraces, spanSymbols: 2 }

  // 持续谱：256 bin × 128 level 固定密度矩阵（两条随频率缓慢起伏的密度脊）
  const matrixWidth = 256
  const matrixHeight = 128
  const matrixMinDb = -120
  const matrixMaxDb = -20
  const density = new Float32Array(matrixWidth * matrixHeight)
  const persistenceRand = mulberry32(0x9e37)
  for (let x = 0; x < matrixWidth; x++) {
    const f = x / (matrixWidth - 1)
    const ridge1 = -78 + 14 * Math.sin(f * 6.2)
    const ridge2 = -46 + 7 * Math.cos(f * 4.4)
    for (let y = 0; y < matrixHeight; y++) {
      const db = matrixMinDb + (y / (matrixHeight - 1)) * (matrixMaxDb - matrixMinDb)
      const band1 = Math.exp(-((db - ridge1) ** 2) / (2 * 2.6 ** 2)) * 180
      const band2 = Math.exp(-((db - ridge2) ** 2) / (2 * 3.4 ** 2)) * 120
      const noise = persistenceRand() < 0.3 ? 1 + persistenceRand() * 2 : 0
      density[y * matrixWidth + x] = Math.round(band1 + band2) + noise
    }
  }
  persistenceData.value = {
    density,
    width: matrixWidth,
    height: matrixHeight,
    minDb: matrixMinDb,
    maxDb: matrixMaxDb
  }

  // Smith 圆图：解析式 Γ 螺旋轨迹（|Γ| 0.10→0.72，相位 -0.6→2.8π）
  const smithN = 240
  const smithI = new Float32Array(smithN)
  const smithQ = new Float32Array(smithN)
  for (let k = 0; k < smithN; k++) {
    const t = k / (smithN - 1)
    const mag = 0.1 + 0.62 * t
    const phase = -0.6 + 2.8 * Math.PI * t
    smithI[k] = mag * Math.cos(phase)
    smithQ[k] = mag * Math.sin(phase)
  }
  smithData.value = { i: smithI, q: smithQ, name: 'S11 sweep' }

  // APD/CCDF：解析式固定曲线（均值 1.8 dB、σ=3.4 dB；CCDF 用 logistic 近似）
  const apdN = 100
  const apdDbMin = -20
  const apdDbMax = 26
  const apdSigma = 3.4
  const apdMean = 1.8
  const apdX = new Float32Array(apdN)
  const apdY = new Float32Array(apdN)
  const ccdfX = new Float32Array(apdN)
  const ccdfY = new Float32Array(apdN)
  for (let k = 0; k < apdN; k++) {
    const db = apdDbMin + (k / (apdN - 1)) * (apdDbMax - apdDbMin)
    const z = (db - apdMean) / apdSigma
    apdX[k] = db
    ccdfX[k] = db
    apdY[k] = 14.5 * Math.exp(-0.5 * z * z)
    ccdfY[k] = 100 / (1 + Math.exp(1.2 * z))
  }
  apdData.value = {
    apd: { x: apdX, y: apdY },
    ccdf: { x: ccdfX, y: ccdfY },
    meanDb: apdMean,
    peakDb: 23.8,
    paprDb: 22,
    p01Db: 21.4,
    p1Db: 14.8,
    sampleCount: 8192
  }

  // 等子组件收到 :data（watcher 落数据并调度绘制）后再等两帧，表示首帧已完成
  await nextTick()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ;(window as unknown as { __VISUAL_READY__?: boolean }).__VISUAL_READY__ = true
    })
  })
})
</script>

<template>
  <div class="visual-page">
    <div class="chart-row">
      <IqChart
        ref="iq"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="360"
        :fps-limit="30"
      />
    </div>
    <div class="chart-row">
      <SpectrumChart
        ref="spec"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="360"
        :fps-limit="30"
        :traces="[{ mode: 'clear' }, { mode: 'maxHold' }]"
      />
    </div>
    <div class="chart-row chart-row-complex-spectrum">
      <SpectrumChart
        ref="specComplex"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="280"
        :fps-limit="30"
        spectrum-mode="complex"
        :sample-rate="4_000_000"
        :fft-size="1024"
        :freq-start-hz="-2000000"
        :bin-hz="3906.25"
        :fft-shift="true"
      />
    </div>
    <div class="chart-row chart-row-specgram">
      <SpectrogramChart
        ref="specgram"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="300"
        :time-span="128"
        :sample-rate="4_000_000"
        :fft-size="1024"
        :fps-limit="30"
      />
    </div>
    <div class="chart-row chart-row-complex-specgram">
      <SpectrogramChart
        ref="specgramComplex"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="240"
        :time-span="64"
        spectrum-mode="complex"
        :sample-rate="4_000_000"
        :fft-size="1024"
        :freq-start-hz="-2000000"
        :bin-hz="3906.25"
        :fft-shift="true"
        :fps-limit="30"
      />
    </div>
    <div class="chart-row chart-row-constellation">
      <ConstellationChart
        ref="constellation"
        :renderer="renderer"
        theme="dark"
        locale="en-US"
        :width="1100"
        :height="320"
        :point-size="2"
        :alpha="0.7"
        :fps-limit="30"
      />
    </div>
    <!-- 新增 6 个组件：两列网格、1100px 宽、每格 240px；数据均为固定种子 PRNG/解析式 -->
    <div class="chart-grid">
      <div class="chart-cell">
        <PowerTimeChart
          :data="powerData"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :width="540"
          :height="240"
          :fps-limit="30"
          unit="dBm"
          :sample-rate="1000000"
          :span="2048"
          :auto-scale="false"
          :y-min="-95"
          :y-max="-5"
        />
      </div>
      <div class="chart-cell">
        <EyeDiagramChart
          :data="eyeData"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :width="540"
          :height="240"
          :fps-limit="30"
          :span-symbols="2"
          :auto-scale="false"
          :y-min="-1.6"
          :y-max="1.6"
        />
      </div>
      <div class="chart-cell">
        <PersistenceSpectrumChart
          :data="persistenceData"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :width="540"
          :height="240"
          :fps-limit="30"
          :bins="256"
          :levels="128"
          :min-db="-120"
          :max-db="-20"
          :sample-rate="4000000"
          :fft-size="1024"
        />
      </div>
      <div class="chart-cell">
        <SmithChart
          :data="smithData"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :width="540"
          :height="240"
          :fps-limit="30"
        />
      </div>
      <div class="chart-cell">
        <ApdCcdfChart
          :data="apdData"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :width="540"
          :height="240"
          :fps-limit="30"
        />
      </div>
      <div class="chart-cell">
        <!-- 面板无 canvas：theme/renderer/fps-limit 只作用例约定；暗色由下方 :deep 固定 -->
        <SignalQualityPanel
          :metrics="qualityMetrics"
          :thresholds="qualityThresholds"
          :renderer="renderer"
          theme="dark"
          locale="en-US"
          :fps-limit="30"
          compact
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.visual-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 1100px;
}
.chart-row {
  width: 1100px;
  height: 360px;
}
.chart-row-specgram {
  height: 300px;
}
.chart-row-complex-spectrum {
  height: 280px;
}
.chart-row-complex-specgram {
  height: 240px;
}
.chart-row-constellation {
  height: 320px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  width: 1100px;
}
.chart-cell {
  height: 240px;
  min-width: 0;
}
/* 540px 窄格下 APD 的完整 info 会压到右上角 Canvas2D 角标：缩一号字并在角标前截断 */
.chart-cell :deep(.sig-apd-info) {
  font-size: 11px;
  max-width: 412px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* SignalQualityPanel 没有 theme prop：用其公开 CSS 变量固定暗色，避免 prefers-color-scheme 漂移 */
.visual-page :deep(.sig-quality) {
  --sq-bg: rgba(255, 255, 255, 0.03);
  --sq-border: rgba(255, 255, 255, 0.14);
  --sq-text: #e6edf3;
  --sq-muted: #9aa4b2;
  --sq-pass: #56d364;
  --sq-fail: #ff7b72;
  --sq-unknown: #d2a8ff;
}
</style>
