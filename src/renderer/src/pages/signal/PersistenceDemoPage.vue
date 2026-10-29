<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCard, NSelect, NSlider, NTag } from 'naive-ui'
import { PersistenceSpectrumChart } from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { linearToDb, spectrumToBins } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof PersistenceSpectrumChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const dataSource = ref<'sim' | 'source'>('sim')
const sourceMode = computed(() => dataSource.value === 'source')
const running = ref(true)
const chartSampleRate = ref(2_400_000)
const chartFftSize = ref(1024)
const decay = ref(0.015)
const frames = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let seed = 23
let hop = 60

function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function nextSpectrum(): Float32Array {
  const n = 256
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = -100 + (rnd() - 0.5) * 4
  // 三个跳频窄带 + 一个慢变载波
  for (let k = 0; k < 3; k++) {
    const center = (hop + k * 37 + Math.floor(rnd() * 20)) % n
    const amp = -45 + rnd() * 20
    for (let d = -2; d <= 2; d++) {
      const idx = center + d
      if (idx < 0 || idx >= n) continue
      out[idx] = Math.max(out[idx]!, amp - Math.abs(d) * 8)
    }
  }
  const fixed = 128
  for (let d = -1; d <= 1; d++) out[fixed + d] = Math.max(out[fixed + d]!, -35 - Math.abs(d) * 5)
  hop = (hop + 3) % n
  return out
}

const analysis = computed(() => ({ enabled: true, decay: decay.value }))

function tick(): void {
  if (!running.value || sourceMode.value) return
  chartRef.value?.appendData(nextSpectrum())
  frames.value++
}
function start(): void {
  if (timer) clearInterval(timer)
  if (sourceMode.value) return
  timer = setInterval(tick, 80)
}
function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}
function onToggle(): void {
  running.value = !running.value
  if (running.value) start()
  else stop()
}
function onSourceChange(): void {
  stop()
  onClear()
  if (!sourceMode.value) start()
}
function onClear(): void {
  chartRef.value?.clear()
  frames.value = 0
}

sig.onSpectrum((data, frame) => {
  if (!sourceMode.value) return
  if (frame.sampleRate) chartSampleRate.value = frame.sampleRate
  if (frame.fftSize) chartFftSize.value = frame.fftSize
  const db = frame.dbScale === false ? linearToDb(data) : data
  chartRef.value?.appendData(spectrumToBins(db, 256))
  frames.value++
})

onMounted(() => {
  if (!sourceMode.value) start()
})
onUnmounted(stop)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="持续谱 / 密度谱">
      <template #header-extra>
        <NTag size="small" type="info">{{ frames }} 帧</NTag>
      </template>
      <div class="ps-controls">
        <label>
          数据源
          <NSelect
            v-model:value="dataSource"
            size="small"
            :options="[
              { label: '仿真频谱', value: 'sim' },
              { label: '源频谱', value: 'source' }
            ]"
            style="width: 130px"
            @update:value="onSourceChange"
          />
        </label>
        <label>
          衰减 {{ decay.toFixed(3) }}
          <NSlider v-model:value="decay" :min="0" :max="0.08" :step="0.001" style="width: 200px" />
        </label>
        <NButton v-if="!sourceMode" size="small" @click="onToggle">
          {{ running ? '暂停' : '运行' }}
        </NButton>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <div v-if="sourceMode" class="source-hint">
        使用源频谱帧并重采样到 256 bins；请先在
        <router-link to="/source">信号源工作台</router-link> 启动源。
      </div>
      <PersistenceSpectrumChart
        ref="chartRef"
        :height="440"
        :bins="256"
        :levels="256"
        :min-db="-120"
        :max-db="-10"
        :sample-rate="chartSampleRate"
        :fft-size="chartFftSize"
        :analysis="analysis"
        color-map="turbo"
        :gamma="0.85"
        theme="spectrum"
      />
      <div class="ps-hint">
        X 为频率、Y 为幅度、颜色为命中密度。开启 analysis
        时逐帧累加；关闭后可传入调用方算好的密度矩阵做纯显示。
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.ps-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 13px;
}
.ps-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.ps-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #888;
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
