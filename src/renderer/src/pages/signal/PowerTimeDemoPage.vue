<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NCard, NSelect, NSlider, NSwitch, NTag } from 'naive-ui'
import {
  PowerTimeChart,
  SignalQualityPanel,
  type PowerTimeAnalysisConfig,
  type SignalQualityMetrics
} from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { iqToPowerDb } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof PowerTimeChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const dataSource = ref<'sim' | 'source'>(useRoute().query.src === '1' ? 'source' : 'sim')
const sourceMode = computed(() => dataSource.value === 'source')
const running = ref(true)
const analysisOn = ref(true)
const thresholdDb = ref(-42)
const pulseWidthMs = ref(4)
const periodMs = ref(20)
const noiseDb = ref(2)
const metrics = ref<SignalQualityMetrics>({})
const pulseCount = ref(0)

let timer: ReturnType<typeof setInterval> | null = null
let seed = 7
const sampleRate = 10_000
const framesPerTick = 2048
const dt = 1 / sampleRate
let phase = 0

function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function nextFrame(): Float32Array {
  const out = new Float32Array(framesPerTick)
  const widthSamples = Math.max(1, pulseWidthMs.value / 1000 / dt)
  const periodSamples = Math.max(widthSamples + 1, periodMs.value / 1000 / dt)
  for (let i = 0; i < out.length; i++) {
    const p = phase % periodSamples
    const inPulse = p < widthSamples
    const floor = -75 + (rnd() - 0.5) * noiseDb.value * 2
    out[i] = inPulse ? -20 + (rnd() - 0.5) * noiseDb.value * 2 : floor
    phase += 1
    if (phase >= periodSamples * 1000) phase = 0
  }
  return out
}

const analysis = computed<PowerTimeAnalysisConfig | undefined>(() =>
  analysisOn.value
    ? {
        enabled: true,
        thresholdDb: thresholdDb.value,
        hysteresisDb: 4,
        minWidthSec: 1e-4,
        maxPulses: 512
      }
    : undefined
)
const thresholds = {
  powerDbmMin: -70,
  powerDbmMax: -10,
  paprDbMax: 60
}

function updateMetrics(): void {
  const stats = chartRef.value?.getStats()
  const pulses = chartRef.value?.getPulses()
  pulseCount.value = pulses?.count ?? 0
  metrics.value = stats
    ? {
        powerDbm: stats.mean,
        peakPowerDbm: stats.peak,
        paprDb: stats.paprDb,
        pulseWidthSec: pulses?.widthMeanSec,
        dutyCycle: pulses?.dutyCycle
      }
    : {}
}

function tick(): void {
  if (!running.value || sourceMode.value) return
  chartRef.value?.appendData(nextFrame())
  updateMetrics()
}

function start(): void {
  if (timer) clearInterval(timer)
  if (sourceMode.value) return
  timer = setInterval(tick, 100)
}
function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}
function onToggle(v: boolean): void {
  running.value = v
  if (v) start()
  else stop()
}
function onSourceChange(): void {
  stop()
  onClear()
  if (!sourceMode.value) start()
}
function onClear(): void {
  chartRef.value?.clear()
  metrics.value = {}
  pulseCount.value = 0
}

sig.onIq((data) => {
  if (!sourceMode.value) return
  chartRef.value?.appendData(iqToPowerDb(data))
  updateMetrics()
})

onMounted(() => {
  if (!sourceMode.value) start()
})
onUnmounted(stop)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="功率-时间 / Zero Span">
      <template #header-extra>
        <NTag size="small" type="info">{{ pulseCount }} 脉冲</NTag>
      </template>
      <div class="pt-controls">
        <label>
          数据源
          <NSelect
            v-model:value="dataSource"
            size="small"
            :options="[
              { label: '仿真脉冲', value: 'sim' },
              { label: '源 IQ', value: 'source' }
            ]"
            style="width: 130px"
            @update:value="onSourceChange"
          />
        </label>
        <label v-if="!sourceMode">
          分析
          <NSwitch v-model:value="analysisOn" size="small" />
        </label>
        <label>
          门限 {{ thresholdDb.toFixed(0) }} dB
          <NSlider
            v-model:value="thresholdDb"
            :min="-80"
            :max="-10"
            :step="1"
            style="width: 160px"
          />
        </label>
        <label v-if="!sourceMode">
          脉宽 {{ pulseWidthMs.toFixed(1) }} ms
          <NSlider
            v-model:value="pulseWidthMs"
            :min="0.5"
            :max="10"
            :step="0.1"
            style="width: 150px"
          />
        </label>
        <label v-if="!sourceMode">
          周期 {{ periodMs.toFixed(0) }} ms
          <NSlider v-model:value="periodMs" :min="5" :max="80" :step="1" style="width: 150px" />
        </label>
        <label v-if="!sourceMode">
          噪声 {{ noiseDb.toFixed(1) }} dB
          <NSlider v-model:value="noiseDb" :min="0" :max="10" :step="0.1" style="width: 130px" />
        </label>
        <NButton v-if="!sourceMode" size="small" @click="onToggle(!running)">
          {{ running ? '暂停' : '运行' }}
        </NButton>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <div v-if="sourceMode" class="source-hint">
        使用主进程 IQ 帧计算功率；请先在 <router-link to="/source">信号源工作台</router-link>
        启动源并选择 Pulse/CW。
      </div>
      <PowerTimeChart
        ref="chartRef"
        :height="360"
        :sample-rate="sampleRate"
        :time-step-sec="dt"
        :span="4096"
        :unit="'dBm'"
        :analysis="analysis"
        :threshold-db="analysisOn ? undefined : thresholdDb"
        theme="spectrum"
      />
      <div class="pt-hint">
        纯显示只画功率；开启分析后仅叠加门限/脉冲带并计算脉宽、周期、占空比。高电平为脉冲，低电平为噪声底。
      </div>
    </NCard>

    <SignalQualityPanel
      title="功率/脉冲质量"
      :metrics="metrics"
      :thresholds="thresholds"
      show-pass-fail
    />
  </div>
</template>

<style scoped>
.pt-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
  font-size: 13px;
}
.pt-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.pt-hint {
  margin-top: 8px;
  color: #888;
  font-size: 12px;
}
.source-hint {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(79, 195, 247, 0.08);
  color: #4fc3f7;
  font-size: 12px;
}
.source-hint a {
  color: #4fc3f7;
}
</style>
