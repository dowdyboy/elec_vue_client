<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NTag } from 'naive-ui'
import { EyeDiagramChart, type EyeStats } from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { iqToEyeTraces } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof EyeDiagramChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const eyeSps = ref(16)
const stats = ref<EyeStats | null>(null)

const widthUi = computed(() => (stats.value ? (stats.value.width * 2).toFixed(2) : '—'))
const jitterUi = computed(() => (stats.value ? stats.value.jitterUi.toFixed(3) : '—'))

function onClear(): void {
  chartRef.value?.clear()
  stats.value = null
}

// 固定消费信号源工作台的 IQ 帧；没有仿真眼图数据源
sig.onIq((data, frame) => {
  const sps = frame.samplesPerSymbol ?? 16
  if (sps >= 2) eyeSps.value = sps
  const traces = iqToEyeTraces(data, sps, 2, 4)
  for (const trace of traces) chartRef.value?.appendData(trace)
  if (traces.length) stats.value = chartRef.value?.getStats() ?? null
})
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
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <div class="source-hint">
        数据源固定为 <router-link to="/source">信号源工作台</router-link> 的源 IQ； 按源帧的
        samplesPerSymbol 切眼图轨迹。请先启动 BPSK/QPSK/16QAM。
      </div>
      <EyeDiagramChart
        ref="chartRef"
        :height="420"
        :span-symbols="2"
        :samples-per-symbol="eyeSps"
        :max-traces="600"
        :alpha="0.35"
        theme="spectrum"
      />
      <div class="eye-hint">
        组件只叠加调用方切好的眼图轨迹；眼高/眼宽/抖动由源 IQ 轨迹测量得到，不做时钟恢复。
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
