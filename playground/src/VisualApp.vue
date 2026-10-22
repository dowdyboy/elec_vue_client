<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { IqChart, SpectrumChart } from '@signal'

type Renderer = 'auto' | 'webgl2' | 'canvas2d'
const q = new URLSearchParams(location.search).get('renderer')
const renderer: Renderer = q === 'webgl2' ? 'webgl2' : q === 'auto' ? 'auto' : 'canvas2d'

const iq = ref<InstanceType<typeof IqChart> | null>(null)
const spec = ref<InstanceType<typeof SpectrumChart> | null>(null)

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

onMounted(() => {
  const rand = mulberry32(0x5eed)
  const n = 8192
  const iqData = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const t = k * 0.02
    iqData[2 * k] = Math.sin(t) * 0.6 + (rand() - 0.5) * 0.02
    iqData[2 * k + 1] = Math.cos(t) * 0.45 + (rand() - 0.5) * 0.02
  }
  iq.value?.appendData(iqData, { sampleRate: 1_000_000 })

  const bins = 512
  const specData = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    const f = k / bins
    const tone1 = Math.exp(-((f - 0.18) ** 2) / 0.0005) * 85
    const tone2 = Math.exp(-((f - 0.62) ** 2) / 0.001) * 60
    specData[k] = -98 + tone1 + tone2 + rand() * 1.5
  }
  spec.value?.appendData(specData, { sampleRate: 4_000_000, fftSize: 1024, dbScale: true })

  // 两帧 rAF 后置位，表示首帧已完成调度（harness 再留一点稳定时间）
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
</style>
