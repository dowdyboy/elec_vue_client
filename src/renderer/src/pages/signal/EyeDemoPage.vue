<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCard, NSlider, NTag } from 'naive-ui'
import { EyeDiagramChart, type EyeStats } from '@components/signal'

const chartRef = ref<InstanceType<typeof EyeDiagramChart> | null>(null)
const running = ref(true)
const noise = ref(0.04)
const jitter = ref(0.06)
const stats = ref<EyeStats | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let seed = 17

function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function makeTrace(): Float32Array {
  const n = 64
  const out = new Float32Array(n)
  const left = rnd() > 0.5 ? 1 : -1
  const right = rnd() > 0.5 ? 1 : -1
  const shift = (rnd() - 0.5) * jitter.value * 0.4
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    // 中间 30% 做交叉；两侧平直，形成眼图
    const edge = Math.min(1, Math.max(0, (x - (0.5 - 0.15) + shift) / 0.3))
    const smooth = edge * edge * (3 - 2 * edge)
    out[i] = left + (right - left) * smooth + (rnd() - 0.5) * noise.value
  }
  return out
}

const widthUi = computed(() => (stats.value ? (stats.value.width * 2).toFixed(2) : '—'))
const jitterUi = computed(() => (stats.value ? stats.value.jitterUi.toFixed(3) : '—'))

function tick(): void {
  if (!running.value) return
  chartRef.value?.appendData(makeTrace())
  stats.value = chartRef.value?.getStats() ?? null
}
function start(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 40)
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
  stats.value = null
}
onMounted(start)
onUnmounted(stop)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="眼图">
      <template #header-extra>
        <div style="display: flex; gap: 8px">
          <NTag size="small" type="info">{{ stats?.traceCount ?? 0 }} 轨迹</NTag>
          <NTag size="small">眼宽 {{ widthUi }} UI</NTag>
          <NTag size="small">抖动 {{ jitterUi }} UI</NTag>
        </div>
      </template>
      <div class="eye-controls">
        <label>
          噪声 {{ noise.toFixed(2) }}
          <NSlider v-model:value="noise" :min="0" :max="0.25" :step="0.005" style="width: 180px" />
        </label>
        <label>
          抖动 {{ jitter.toFixed(2) }}
          <NSlider v-model:value="jitter" :min="0" :max="0.5" :step="0.01" style="width: 180px" />
        </label>
        <NButton size="small" @click="onToggle">{{ running ? '暂停' : '运行' }}</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <EyeDiagramChart
        ref="chartRef"
        :height="420"
        :span-symbols="2"
        :samples-per-symbol="32"
        :max-traces="600"
        :alpha="0.35"
        theme="spectrum"
      />
      <div class="eye-hint">
        组件只叠加调用方切好的眼图轨迹；眼高/眼宽/抖动由这些轨迹测量得到，不做时钟恢复。调大噪声/抖动可直接观察眼闭合。
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.eye-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 13px;
}
.eye-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.eye-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #888;
}
</style>
