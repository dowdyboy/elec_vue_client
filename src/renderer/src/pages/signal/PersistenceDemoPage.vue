<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCard, NSlider, NTag } from 'naive-ui'
import { PersistenceSpectrumChart } from '@components/signal'

const chartRef = ref<InstanceType<typeof PersistenceSpectrumChart> | null>(null)
const running = ref(true)
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
  if (!running.value) return
  chartRef.value?.appendData(nextSpectrum())
  frames.value++
}
function start(): void {
  if (timer) clearInterval(timer)
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
function onClear(): void {
  chartRef.value?.clear()
  frames.value = 0
}
onMounted(start)
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
          衰减 {{ decay.toFixed(3) }}
          <NSlider v-model:value="decay" :min="0" :max="0.08" :step="0.001" style="width: 200px" />
        </label>
        <NButton size="small" @click="onToggle">{{ running ? '暂停' : '运行' }}</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <PersistenceSpectrumChart
        ref="chartRef"
        :height="440"
        :bins="256"
        :levels="256"
        :min-db="-120"
        :max-db="-10"
        :sample-rate="2_400_000"
        :fft-size="1024"
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
</style>
