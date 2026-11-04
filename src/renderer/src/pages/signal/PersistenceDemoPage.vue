<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NSlider, NTag } from 'naive-ui'
import { PersistenceSpectrumChart } from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { linearToDb, spectrumToBins } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof PersistenceSpectrumChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const chartSampleRate = ref(4096)
const chartFftSize = ref(1024)
const decay = ref(0.015)
const frames = ref(0)

const analysis = computed(() => ({ enabled: true, decay: decay.value }))

function onClear(): void {
  chartRef.value?.clear()
  frames.value = 0
}

// 固定消费信号源工作台的分析频谱帧；没有仿真频谱数据源
sig.onSpectrum((data, frame) => {
  if (frame.sampleRate) chartSampleRate.value = frame.sampleRate
  if (frame.fftSize) chartFftSize.value = frame.fftSize
  const db = frame.dbScale === false ? linearToDb(data) : data
  chartRef.value?.appendData(spectrumToBins(db, 256))
  frames.value++
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="持续谱 / 密度谱">
      <template #header-extra>
        <NTag size="small" type="info">{{ frames }} 帧</NTag>
      </template>
      <div class="ps-controls">
        <label>
          衰减 {{ decay.toFixed(3) }}
          <NSlider v-model:value="decay" :min="0" :max="0.08" :step="0.001" style="width: 200px" />
        </label>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <div class="source-hint">
        数据源固定为 <router-link to="/source">信号源工作台</router-link> 的源频谱帧； 请先启动源。
      </div>
      <PersistenceSpectrumChart
        ref="chartRef"
        :height="440"
        :bins="256"
        :levels="256"
        :min-db="-120"
        :max-db="-10"
        :sample-rate="chartSampleRate"
        :fft-size="chartFftSize"
        :analysis="analysis"
        color-map="turbo"
        :gamma="0.85"
        theme="spectrum"
      />
      <div class="ps-hint">
        X 为频率、Y 为幅度、颜色为命中密度。开启 analysis
        时逐帧累加；关闭后可传入调用方算好的密度矩阵做纯显示。
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.ps-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 13px;
}
.ps-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.ps-hint {
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
