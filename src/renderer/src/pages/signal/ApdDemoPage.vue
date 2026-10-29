<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NCard, NSelect, NSlider, NTag } from 'naive-ui'
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
const dataSource = ref<'sim' | 'source'>('sim')
const sourceMode = computed(() => dataSource.value === 'source')
const stats = ref<ApdCcdfData | null>(null)
const metrics = ref<SignalQualityMetrics>({})
const crest = ref(10)
let seed = 31

function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
function gaussian(): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd())
}

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

function generate(): void {
  if (sourceMode.value) return
  const n = 20000
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = gaussian() * 3
    // 稀疏高 PAPR 尖峰
    if (rnd() < 0.002) v += crest.value * (0.5 + rnd())
    out[i] = v
  }
  chartRef.value?.appendData(out)
  updateStats()
}

function clear(): void {
  chartRef.value?.clear()
  stats.value = null
  metrics.value = {}
}

function onSourceChange(): void {
  clear()
  if (!sourceMode.value) generate()
}

sig.onIq((data) => {
  if (!sourceMode.value) return
  chartRef.value?.appendData(iqToAmplitude(data))
  updateStats()
})

onMounted(() => {
  if (!sourceMode.value) generate()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="APD / CCDF">
      <template #header-extra>
        <NTag size="small" type="info">{{ stats?.sampleCount ?? 0 }} 样本</NTag>
      </template>
      <div class="apd-controls">
        <label>
          数据源
          <NSelect
            v-model:value="dataSource"
            size="small"
            :options="[
              { label: '仿真 PAPR', value: 'sim' },
              { label: '源 IQ', value: 'source' }
            ]"
            style="width: 130px"
            @update:value="onSourceChange"
          />
        </label>
        <template v-if="!sourceMode">
          <label>
            尖峰幅度 {{ crest.toFixed(1) }} dB
            <NSlider v-model:value="crest" :min="3" :max="20" :step="0.5" style="width: 180px" />
          </label>
          <NButton size="small" @click="generate">重新生成</NButton>
        </template>
        <NButton size="small" @click="clear">清空</NButton>
      </div>
      <div v-if="sourceMode" class="source-hint">
        从源 IQ 取幅度样本做 APD/CCDF；请先在
        <router-link to="/source">信号源工作台</router-link> 启动源。
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
