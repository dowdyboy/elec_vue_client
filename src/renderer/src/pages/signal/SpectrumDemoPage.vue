<script setup lang="ts">
import { ref } from 'vue'
import { NCard, NButton, NEmpty, useMessage } from 'naive-ui'
import SpectrumChart from '@components/signal/SpectrumChart.vue'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { isDark } from '@renderer/stores/theme'

const message = useMessage()
const chartRef = ref<InstanceType<typeof SpectrumChart> | null>(null)
const hasData = ref(false)

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onSpectrum((data) => {
  chartRef.value?.appendData(data)
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
    <NCard title="📊 频谱（FFT）" style="margin-bottom: 16px">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center">
        <NButton size="small" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待数据（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
        <span
          v-else-if="!hasData && sig.remoteConnected.value"
          style="color: #18a058; font-size: 12px"
          >远程已连接，等待帧…（若持续空帧请看主进程控制台“empty payload”）</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        FFT / 窗 / dB 等处理均在服务端完成（请至“Mock 配置”页配置），组件只做展示。主题跟随全局。
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <SpectrumChart
          ref="chartRef"
          :theme="isDark ? 'dark' : 'light'"
          :line-color="'#1976d2'"
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
