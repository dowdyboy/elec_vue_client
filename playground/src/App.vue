<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { IqChart, SpectrumChart, type Theme } from '@signal'

const iq = ref<InstanceType<typeof IqChart> | null>(null)
const spec = ref<InstanceType<typeof SpectrumChart> | null>(null)
// 支持 ?renderer=canvas2d / webgl2，便于无 WebGL2 环境/截图冒烟
const initialRenderer = new URLSearchParams(location.search).get('renderer')
const renderer = ref<'auto' | 'webgl2' | 'canvas2d'>(
  initialRenderer === 'webgl2' || initialRenderer === 'canvas2d' ? initialRenderer : 'auto'
)
const locale = ref<'zh-CN' | 'en-US'>('zh-CN')
const theme = ref<Theme>('dark')
const paused = ref(false)
const traces = ref([
  { mode: 'clear' as const, label: 'LIVE' },
  { mode: 'maxHold' as const, label: 'MAX' }
])

let timer = 0
let worker: Worker | null = null
let phase = 0

/** 生成 int16 交织 IQ 并交给 Worker 解析（演示 Worker ingestion 路径） */
function tickIq(): void {
  const n = 2048
  const buf = new Int16Array(n * 2)
  for (let k = 0; k < n; k++) {
    const t = phase + k
    buf[2 * k] = Math.round(Math.sin(t * 0.02) * 20000)
    buf[2 * k + 1] = Math.round(Math.cos(t * 0.02) * 18000)
  }
  phase += n
  worker?.postMessage(buf.buffer, [buf.buffer])
}

/** 生成模拟 dB 频谱（512 bin） */
function tickSpectrum(): void {
  const bins = 512
  const data = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    const f = k / bins
    const tone1 = Math.exp(-((f - 0.25) ** 2) / 0.0004) * 80
    const tone2 = Math.exp(-((f - 0.62) ** 2) / 0.0009) * 55
    data[k] = -100 + tone1 + tone2 + Math.random() * 3
  }
  spec.value?.appendData(data, { sampleRate: 4_000_000, fftSize: 1024, dbScale: true })
}

onMounted(() => {
  worker = new Worker(new URL('./iqWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<Float32Array>) => {
    iq.value?.appendData(ev.data, { sampleRate: 1_000_000 })
  }
  timer = window.setInterval(() => {
    tickIq()
    tickSpectrum()
  }, 50)
})

onUnmounted(() => {
  window.clearInterval(timer)
  worker?.terminate()
  worker = null
})
</script>

<template>
  <div class="page">
    <header>
      <h1>Signal Charts Playground</h1>
      <p>
        不依赖 Electron 的最小 Vite 宿主：两个组件、Worker int16 解析、运行时切换渲染后端/主题。
      </p>
      <div class="controls">
        <label>
          renderer
          <select v-model="renderer">
            <option value="auto">auto (WebGL2 → Canvas2D)</option>
            <option value="webgl2">webgl2</option>
            <option value="canvas2d">canvas2d</option>
          </select>
        </label>
        <label>
          theme
          <select v-model="theme">
            <option value="dark">dark</option>
            <option value="light">light</option>
            <option value="spectrum">spectrum</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label>
          locale
          <select v-model="locale">
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <label class="check">
          <input v-model="paused" type="checkbox" />
          spectrum paused
        </label>
        <span class="hint">renderer 变更会重建组件（挂载时决定后端）</span>
      </div>
    </header>

    <section>
      <h2>IQ · Worker int16 → Float32</h2>
      <IqChart
        ref="iq"
        :key="'iq-' + renderer"
        :renderer="renderer"
        :theme="theme"
        :locale="locale"
        :height="360"
        :labels="{ x: 'Time', y: 'Amplitude', aria: 'IQ time domain' }"
      />
    </section>

    <section>
      <h2>Spectrum · dBFS · multi-trace</h2>
      <SpectrumChart
        ref="spec"
        :key="'spec-' + renderer"
        v-model:paused="paused"
        v-model:traces="traces"
        :renderer="renderer"
        :theme="theme"
        :locale="locale"
        :height="360"
        :labels="{ x: 'Frequency', y: 'Level (dBFS)', aria: 'Spectrum' }"
        :legend="true"
      />
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
}
header h1 {
  margin: 0 0 6px;
  font-size: 20px;
}
header p {
  margin: 0 0 12px;
  color: #8b949e;
  font-size: 13px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  font-size: 13px;
}
.controls select {
  margin-left: 6px;
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 3px 6px;
}
.check input {
  margin-right: 4px;
}
.hint {
  color: #6e7681;
}
section {
  margin-bottom: 24px;
}
h2 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 500;
  color: #8b949e;
}
</style>
