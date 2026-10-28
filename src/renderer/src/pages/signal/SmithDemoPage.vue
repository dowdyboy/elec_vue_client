<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NCard, NTag } from 'naive-ui'
import { SmithChart, type SmithTrace } from '@components/signal'

const chartRef = ref<InstanceType<typeof SmithChart> | null>(null)
const points = ref(0)
const vswr = ref(0)

function makeTraces(): SmithTrace[] {
  const traces: SmithTrace[] = []
  for (let t = 0; t < 3; t++) {
    const n = 240
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const th = (2 * Math.PI * k) / n
      if (t === 0) {
        // 偏离中心的小圆（失配轨迹）
        i[k] = 0.28 + 0.16 * Math.cos(th)
        q[k] = 0.12 + 0.16 * Math.sin(th)
      } else if (t === 1) {
        // 螺旋：逐渐靠近中心（调谐）
        const r = 0.45 * (1 - k / n) + 0.05
        i[k] = r * Math.cos(th * 3)
        q[k] = r * Math.sin(th * 3)
      } else {
        // 接近匹配点的短弧
        i[k] = 0.06 + 0.04 * Math.cos(th)
        q[k] = -0.05 + 0.04 * Math.sin(th)
      }
    }
    traces.push({ i, q, name: t === 0 ? 'Antenna' : t === 1 ? 'Tune' : 'Match' })
  }
  return traces
}

function regenerate(): void {
  const traces = makeTraces()
  chartRef.value?.setData(traces)
  const s = chartRef.value?.getStats()
  points.value = s?.points ?? 0
  vswr.value = s?.maxVswr ?? 0
}

onMounted(regenerate)
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="Smith 圆图">
      <template #header-extra>
        <div style="display: flex; gap: 8px">
          <NTag size="small" type="info">{{ points }} 点</NTag>
          <NTag size="small">最大 VSWR {{ vswr.toFixed(2) }}</NTag>
        </div>
      </template>
      <div class="sm-controls">
        <NButton size="small" @click="regenerate">重新生成</NButton>
        <NButton size="small" @click="chartRef?.clear()">清空</NButton>
      </div>
      <SmithChart ref="chartRef" :height="520" :z0="50" theme="spectrum" />
      <div class="sm-hint">
        纯显示复反射系数轨迹；网格为等电阻圆/等电抗圆。移动鼠标查看 Γ、VSWR、回波损耗和阻抗。
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.sm-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}
.sm-hint {
  margin-top: 8px;
  color: #888;
  font-size: 12px;
}
</style>
