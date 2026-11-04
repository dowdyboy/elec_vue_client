<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NSlider, NSwitch, NTag } from 'naive-ui'
import {
  PowerTimeChart,
  SignalQualityPanel,
  type PowerTimeAnalysisConfig,
  type SignalQualityMetrics
} from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { iqToPowerDb } from '../../../../shared/sourceAdapters'

const chartRef = ref<InstanceType<typeof PowerTimeChart> | null>(null)
const sig = useSignalAnalysis({ autoSubscribe: true })
const sourceSampleRate = ref(4096)
const analysisOn = ref(true)
const thresholdDb = ref(-42)
const metrics = ref<SignalQualityMetrics>({})
const pulseCount = ref(0)

const timeStepSec = computed(() => (sourceSampleRate.value > 0 ? 1 / sourceSampleRate.value : 1e-6))

const analysis = computed<PowerTimeAnalysisConfig | undefined>(() =>
  analysisOn.value
    ? {
        enabled: true,
        thresholdDb: thresholdDb.value,
        hysteresisDb: 4,
        minWidthSec: 1e-4,
        maxPulses: 512
      }
    : undefined
)
const thresholds = {
  powerDbmMin: -70,
  powerDbmMax: -10,
  paprDbMax: 60
}

function updateMetrics(): void {
  const stats = chartRef.value?.getStats()
  const pulses = chartRef.value?.getPulses()
  pulseCount.value = pulses?.count ?? 0
  metrics.value = stats
    ? {
        powerDbm: stats.mean,
        peakPowerDbm: stats.peak,
        paprDb: stats.paprDb,
        pulseWidthSec: pulses?.widthMeanSec,
        dutyCycle: pulses?.dutyCycle
      }
    : {}
}

function onClear(): void {
  chartRef.value?.clear()
  metrics.value = {}
  pulseCount.value = 0
}

// 固定消费信号源工作台的 IQ 帧；没有仿真数据源
sig.onIq((data, frame) => {
  const rate = frame.sampleRate
  if (rate && rate > 0) sourceSampleRate.value = rate
  chartRef.value?.appendData(iqToPowerDb(data))
  updateMetrics()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="功率-时间 / Zero Span">
      <template #header-extra>
        <NTag size="small" type="info">{{ pulseCount }} 脉冲</NTag>
      </template>
      <div class="pt-controls">
        <label>
          分析
          <NSwitch v-model:value="analysisOn" size="small" />
        </label>
        <label>
          门限 {{ thresholdDb.toFixed(0) }} dB
          <NSlider
            v-model:value="thresholdDb"
            :min="-80"
            :max="-10"
            :step="1"
            style="width: 160px"
          />
        </label>
        <NButton size="small" @click="onClear">清空</NButton>
      </div>
      <div class="source-hint">
        数据源固定为 <router-link to="/source">信号源工作台</router-link> 的源 IQ；请先启动源， 推荐
        Pulse/CW。
      </div>
      <PowerTimeChart
        ref="chartRef"
        :height="360"
        :sample-rate="sourceSampleRate"
        :time-step-sec="timeStepSec"
        :span="4096"
        :unit="'dBm'"
        :analysis="analysis"
        :threshold-db="analysisOn ? undefined : thresholdDb"
        theme="spectrum"
      />
      <div class="pt-hint">
        纯显示只画功率；开启分析后仅叠加门限/脉冲带并计算脉宽、周期、占空比。高电平为脉冲，低电平为噪声底。
      </div>
    </NCard>

    <SignalQualityPanel
      title="功率/脉冲质量"
      :metrics="metrics"
      :thresholds="thresholds"
      show-pass-fail
    />
  </div>
</template>

<style scoped>
.pt-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
  font-size: 13px;
}
.pt-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #666;
}
.pt-hint {
  margin-top: 8px;
  color: #888;
  font-size: 12px;
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
