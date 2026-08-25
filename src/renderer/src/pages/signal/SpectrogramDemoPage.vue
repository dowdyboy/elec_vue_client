<script setup lang="ts">
import { ref } from 'vue'
import { NCard, NSelect, NButton, NEmpty, useMessage } from 'naive-ui'
import SpectrogramChart from '@components/signal/SpectrogramChart.vue'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { isDark } from '@renderer/stores/theme'

const message = useMessage()
const chartRef = ref<InstanceType<typeof SpectrogramChart> | null>(null)
// 展示配置（组件端）
const colorMap = ref<'viridis' | 'jet' | 'grayscale' | 'hot'>('viridis')
const hasData = ref(false)

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onSpectrogram((row) => {
  chartRef.value?.appendData(row)
  hasData.value = true
})

function onClear(): void {
  chartRef.value?.clear()
  hasData.value = false
  message.success('已清空')
}
</script>

<template>
  <div style="padding: 16px">
    <NCard title="🌈 时频图（瀑布）" style="margin-bottom: 16px">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center">
        <span>色阶</span>
        <NSelect
          v-model:value="colorMap"
          :options="[
            { label: 'viridis', value: 'viridis' },
            { label: 'jet', value: 'jet' },
            { label: 'grayscale', value: 'grayscale' },
            { label: 'hot', value: 'hot' }
          ]"
          style="width: 120px"
        />
        <NButton size="small" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待数据（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        重叠 / FFT 等处理在服务端配置（请至“Mock 配置”页），组件只累计并上色展示。主题跟随全局。
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <SpectrogramChart
          ref="chartRef"
          :theme="isDark ? 'dark' : 'light'"
          :color-map="colorMap"
          :time-span="128"
          :height="420"
        />
        <NEmpty
          v-if="!hasData"
          description="暂无数据，请至“Mock 配置”页启动服务…"
          style="
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: color-mix(in srgb, var(--n-color) 92%, transparent);
            margin: 0;
          "
        />
      </div>
    </NCard>
  </div>
</template>
