<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NCard, NTag } from 'naive-ui'
import {
  ApdCcdfChart,
  SignalQualityPanel,
  type ApdCcdfData,
  type SignalQualityMetrics
} from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { iqToAmplitude } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof ApdCcdfChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const stats = ref<ApdCcdfData | null>(null)
const metrics = ref<SignalQualityMetrics>({})

function updateStats(): void {
  stats.value = chartRef.value?.getStats() ?? null
  metrics.value = stats.value
    ? {
        paprDb: stats.value.paprDb,
        powerDbm: stats.value.meanDb,
        peakPowerDbm: stats.value.peakDb
      }
    : {}
}

function clear(): void {
  chartRef.value?.clear()
  stats.value = null
  metrics.value = {}
}

// 固定消费信号源工作台的 IQ 帧；没有仿真 PAPR 数据源
sig.onIq((data) => {
  chartRef.value?.appendData(iqToAmplitude(data))
  updateStats()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="APD / CCDF">
      <template #header-extra>
        <NTag size="small" type="info">{{ stats?.sampleCount ?? 0 }} 样本</NTag>
      </template>
      <div class="apd-controls">
        <NButton size="small" @click="clear">清空</NButton>
      </div>
      <div class="source-hint">
        数据源固定为 <router-link to="/source">信号源工作台</router-link> 的源 IQ； 请先启动源。
      </div>
      <ApdCcdfChart
        ref="chartRef"
        :height="380"
        :analysis="{ enabled: true, bins: 100 }"
        theme="spectrum"
      />
      <div class="apd-hint">
        APD 为各电平出现概率，CCDF 为超过该电平的概率；PAPR
        来自峰值-均值。稀疏尖峰会抬高高功率尾部。
      </div>
    </NCard>

    <SignalQualityPanel
      title="PAPR / 功率"
      :metrics="metrics"
      :thresholds="{ paprDbMax: 18, powerDbmMin: -40, powerDbmMax: 20 }"
    />
  </div>
</template>

<style scoped>
.apd-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 13px;
}
.apd-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.apd-hint {
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
