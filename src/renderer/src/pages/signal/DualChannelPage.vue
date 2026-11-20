<script setup lang="ts">
/**
 * 双通道主分析页：RX0/RX1 并排 IQ + 频谱，可选时频/星座、同步缩放与跨通道测量。
 * 数据来自 source:dualFrame（网络源 channels=2 或应用内双通道合成源）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NCheckbox,
  NFormItem,
  NGrid,
  NGi,
  NInputNumber,
  NSpace,
  NTag
} from 'naive-ui'
import { ConstellationChart, IqChart, SpectrogramChart, SpectrumChart } from '@components/signal'
import type { SourceFrame } from '../../../../shared/sourceEngine'
import { buildSourcePreviewSpectrum } from '../../../../shared/sourcePreview'
import { computeDualChannelMetrics } from '../../../../shared/sourceDualMetrics'

const iq0 = ref<InstanceType<typeof IqChart> | null>(null)
const iq1 = ref<InstanceType<typeof IqChart> | null>(null)
const spec0 = ref<InstanceType<typeof SpectrumChart> | null>(null)
const spec1 = ref<InstanceType<typeof SpectrumChart> | null>(null)
const spectro0 = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const spectro1 = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const const0 = ref<InstanceType<typeof ConstellationChart> | null>(null)
const const1 = ref<InstanceType<typeof ConstellationChart> | null>(null)

const syncZoom = ref(true)
const showExtra = ref(false)
const hasFrame = ref(false)
const frameCounts = [0, 0]
const simRunning = ref(false)
const simBusy = ref(false)
const simFreq0 = ref<number | null>(10000)
const simFreq1 = ref<number | null>(15000)
const simPhase = ref<number | null>(30)
const metrics = ref({ ampRatio: 0, phaseDeg: 0, corr: 0 })
const latest: Array<SourceFrame | null> = [null, null]
let dispose: (() => void) | null = null
let syncing = false
let lastMetricAt = 0

function computeMetrics(): void {
  const a = latest[0]
  const b = latest[1]
  if (!a || !b) return
  const m = computeDualChannelMetrics(a.data, b.data)
  if (m) metrics.value = m
}

function append(channel: 0 | 1, frame: SourceFrame): void {
  frameCounts[channel]++
  latest[channel] = frame
  if (!hasFrame.value) hasFrame.value = true
  const iq = channel === 0 ? iq0.value : iq1.value
  iq?.appendData(frame.data, { sampleRate: frame.sampleRate })
  const constellation = channel === 0 ? const0.value : const1.value
  if (showExtra.value) constellation?.appendData(frame.data)
  if (frameCounts[channel]! % 2 !== 0) return
  const preview = buildSourcePreviewSpectrum(frame, { spectrumMode: 'complex' })
  if (!preview) return
  const meta = {
    fftSize: preview.fftSize,
    sampleRate: preview.sampleRate,
    dbScale: preview.dbScale,
    spectrumMode: preview.spectrumMode,
    freqStartHz: preview.freqStartHz,
    binHz: preview.binHz,
    fftShift: preview.fftShift,
    timestamp: frame.timestamp
  }
  const spectrum = channel === 0 ? spec0.value : spec1.value
  spectrum?.appendData(preview.data, meta)
  if (showExtra.value) {
    const s = channel === 0 ? spectro0.value : spectro1.value
    s?.appendData(preview.data, meta)
  }
  const now = Date.now()
  if (now - lastMetricAt > 500) {
    lastMetricAt = now
    computeMetrics()
  }
}

function syncIq(
  from: 0 | 1,
  v: { xMin: number; xMax: number; yMin: number; yMax: number; yAuto: boolean }
): void {
  if (!syncZoom.value || syncing) return
  const target = from === 0 ? iq1.value : iq0.value
  if (!target) return
  syncing = true
  target.setViewport({
    xMin: v.xMin,
    xMax: v.xMax,
    yMin: v.yMin,
    yMax: v.yMax,
    autoScale: v.yAuto
  })
  queueMicrotask(() => {
    syncing = false
  })
}

function syncSpectrum(
  from: 0 | 1,
  v: { xMin: number; xMax: number; yMin: number; yMax: number; yAuto: boolean }
): void {
  if (!syncZoom.value || syncing) return
  const target = from === 0 ? spec1.value : spec0.value
  if (!target) return
  syncing = true
  target.setViewport({
    xMin: v.xMin,
    xMax: v.xMax,
    yMin: v.yMin,
    yMax: v.yMax,
    autoScale: v.yAuto
  })
  queueMicrotask(() => {
    syncing = false
  })
}

async function startSim(): Promise<void> {
  simBusy.value = true
  try {
    const r = await window.api.source.startDualSim({
      freq0: Number(simFreq0.value ?? 10000),
      freq1: Number(simFreq1.value ?? 15000),
      phaseDeg: Number(simPhase.value ?? 30)
    })
    if (!r.ok) return
    simRunning.value = true
  } finally {
    simBusy.value = false
  }
}

async function stopSim(): Promise<void> {
  await window.api.source.stopDualSim()
  simRunning.value = false
}

onMounted(async () => {
  dispose = window.api.source.onDualFrame((frame) => {
    const ch = frame.channel === 1 ? 1 : 0
    append(ch, frame)
  })
  try {
    const st = await window.api.source.getStatus()
    simRunning.value = st?.backend === 'dual-sim'
  } catch {
    // 忽略启动竞态
  }
})

onUnmounted(() => {
  dispose?.()
  dispose = null
})
</script>

<template>
  <div class="dual-page">
    <div class="page-head">
      <div>
        <h2>📡 双通道并排（RX0 / RX1）</h2>
        <p class="sub">
          网络源 channels=2 或应用内双通道合成源；跨通道测量在下方，常规主分析仍只使用选中通道。
        </p>
      </div>
      <NTag :type="hasFrame ? 'success' : 'default'" :bordered="false">
        {{ hasFrame ? '接收中' : '等待双通道数据' }}
      </NTag>
    </div>

    <NCard size="small" style="margin-bottom: 12px">
      <NSpace align="center" :size="12">
        <NButton
          size="small"
          type="primary"
          :loading="simBusy"
          :disabled="simRunning"
          @click="startSim"
        >
          启动内置双通道模拟
        </NButton>
        <NButton size="small" :disabled="!simRunning" @click="stopSim">停止模拟</NButton>
        <NFormItem label="RX0 Hz" :show-feedback="false" style="margin: 0">
          <NInputNumber
            v-model:value="simFreq0"
            :min="0"
            :step="1000"
            size="small"
            style="width: 110px"
          />
        </NFormItem>
        <NFormItem label="RX1 Hz" :show-feedback="false" style="margin: 0">
          <NInputNumber
            v-model:value="simFreq1"
            :min="0"
            :step="1000"
            size="small"
            style="width: 110px"
          />
        </NFormItem>
        <NFormItem label="相位°" :show-feedback="false" style="margin: 0">
          <NInputNumber
            v-model:value="simPhase"
            :min="-180"
            :max="180"
            size="small"
            style="width: 90px"
          />
        </NFormItem>
        <NCheckbox v-model:checked="syncZoom">同步缩放</NCheckbox>
        <NCheckbox v-model:checked="showExtra">时频/星座</NCheckbox>
      </NSpace>
    </NCard>

    <NCard size="small" style="margin-bottom: 12px">
      <div class="metrics">
        <span
          >幅度比 <b>{{ metrics.ampRatio.toFixed(3) }}</b></span
        >
        <span
          >相位差 <b>{{ metrics.phaseDeg.toFixed(2) }}°</b></span
        >
        <span
          >相关系数 <b>{{ metrics.corr.toFixed(4) }}</b></span
        >
        <span class="hint">双通道合成源可改 RX0/RX1 频率和相位验证</span>
      </div>
    </NCard>

    <NGrid :cols="24" :x-gap="16" :y-gap="16">
      <NGi :span="12">
        <NCard title="RX0 IQ" size="small">
          <IqChart
            ref="iq0"
            :height="250"
            :max-points="300000"
            @viewport-change="(v) => syncIq(0, v)"
          />
        </NCard>
        <NCard title="RX0 频谱" size="small" style="margin-top: 12px">
          <SpectrumChart
            ref="spec0"
            :height="230"
            :fft-size="1024"
            @viewport-change="(v) => syncSpectrum(0, v)"
          />
        </NCard>
      </NGi>
      <NGi :span="12">
        <NCard title="RX1 IQ" size="small">
          <IqChart
            ref="iq1"
            :height="250"
            :max-points="300000"
            @viewport-change="(v) => syncIq(1, v)"
          />
        </NCard>
        <NCard title="RX1 频谱" size="small" style="margin-top: 12px">
          <SpectrumChart
            ref="spec1"
            :height="230"
            :fft-size="1024"
            @viewport-change="(v) => syncSpectrum(1, v)"
          />
        </NCard>
      </NGi>
    </NGrid>

    <template v-if="showExtra">
      <NGrid :cols="24" :x-gap="16" :y-gap="16" style="margin-top: 16px">
        <NGi :span="12">
          <NCard title="RX0 时频" size="small">
            <SpectrogramChart ref="spectro0" :height="200" :fft-size="1024" />
          </NCard>
        </NGi>
        <NGi :span="12">
          <NCard title="RX1 时频" size="small">
            <SpectrogramChart ref="spectro1" :height="200" :fft-size="1024" />
          </NCard>
        </NGi>
      </NGrid>
      <NGrid :cols="24" :x-gap="16" :y-gap="16" style="margin-top: 16px">
        <NGi :span="12">
          <NCard title="RX0 星座" size="small">
            <ConstellationChart ref="const0" :height="220" :max-points="4096" />
          </NCard>
        </NGi>
        <NGi :span="12">
          <NCard title="RX1 星座" size="small">
            <ConstellationChart ref="const1" :height="220" :max-points="4096" />
          </NCard>
        </NGi>
      </NGrid>
    </template>
  </div>
</template>

<style scoped>
.dual-page {
  padding: 4px;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.page-head h2 {
  margin: 0 0 4px;
}
.sub {
  margin: 0;
  opacity: 0.7;
  max-width: 760px;
}
.metrics {
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}
.metrics b {
  font-variant-numeric: tabular-nums;
}
.hint {
  opacity: 0.7;
}
</style>
