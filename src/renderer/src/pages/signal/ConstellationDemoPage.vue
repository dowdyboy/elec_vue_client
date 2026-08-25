<script setup lang="ts">
import { ref } from 'vue'
import { NCard, NSlider, NButton, NEmpty, useMessage } from 'naive-ui'
import ConstellationChart from '@components/signal/ConstellationChart.vue'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { isDark } from '@renderer/stores/theme'

const message = useMessage()
const chartRef = ref<InstanceType<typeof ConstellationChart> | null>(null)
const pointSize = ref(2)
const hasData = ref(false)

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onIq((iq) => {
  chartRef.value?.appendData(iq)
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
    <NCard title="✨ 星座图" style="margin-bottom: 16px">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center">
        <span>点大小</span>
        <NSlider v-model:value="pointSize" :min="1" :max="6" style="width: 100px" />
        <NButton size="small" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待服务端（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        星座图绘制服务端下发的原始 IQ；调制 / 信噪比等请至“Mock
        配置”页配置，重启后生效。主题跟随全局。
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <ConstellationChart
          ref="chartRef"
          :theme="isDark ? 'dark' : 'light'"
          :point-size="pointSize"
          :alpha="0.7"
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
