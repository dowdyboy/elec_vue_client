<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NSelect,
  NSlider,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import ConstellationChart from '@components/signal/ConstellationChart.vue'
import type {
  ConstellationAnalysisConfig,
  ConstellationAnalysisStats,
  ConstellationModulation,
  ConstellationStats,
  Theme
} from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'

const message = useMessage()
const chartRef = ref<InstanceType<typeof ConstellationChart> | null>(null)
const renderer = ref<'auto' | 'webgl2' | 'canvas2d'>('auto')
const themeKey = ref<Theme>('spectrum')
const pointSize = ref(2)
const alpha = ref(0.7)
const showAxis = ref(true)
const showGrid = ref(true)
const hasData = ref(false)
const points = ref(0)
const stats = ref<ConstellationStats | null>(null)
const analysisStats = ref<ConstellationAnalysisStats | null>(null)
const backend = ref('-')
const sourceMode = ref<'real' | 'complex'>('real')
const sourceWaveform = ref('')
const analysisOn = ref(true)
const analysisMod = ref<ConstellationModulation>('QPSK')
const autoCarrier = ref(true)
const autoSymbolTiming = ref(true)
const samplesPerSymbol = ref(16)
const sampleRateHz = ref(0)
const carrierHz = ref(0)
const analysisConfig = computed<ConstellationAnalysisConfig | undefined>(() => {
  if (
    !analysisOn.value ||
    sourceWaveform.value !== 'digital' ||
    sourceMode.value !== 'complex' ||
    sampleRateHz.value <= 0
  )
    return undefined
  return {
    modulation: analysisMod.value,
    sampleRate: sampleRateHz.value,
    centerFrequencyHz: carrierHz.value,
    samplesPerSymbol: samplesPerSymbol.value,
    autoCarrier: autoCarrier.value,
    autoSymbolTiming: autoSymbolTiming.value
  }
})
const oneDimensional = computed(() => hasData.value && !!stats.value && stats.value.qRms < 1e-9)
let lastStatsAt = 0

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onIq((iq, frame) => {
  if (frame.outputMode) sourceMode.value = frame.outputMode
  if (frame.waveform) sourceWaveform.value = frame.waveform
  if (typeof frame.samplesPerSymbol === 'number' && frame.samplesPerSymbol > 0)
    samplesPerSymbol.value = frame.samplesPerSymbol
  if (typeof frame.sampleRate === 'number' && frame.sampleRate > 0)
    sampleRateHz.value = frame.sampleRate
  if (typeof frame.carrierHz === 'number' && frame.carrierHz > 0) carrierHz.value = frame.carrierHz
  chartRef.value?.appendData(iq)
  hasData.value = true
  points.value = chartRef.value?.getLength() ?? points.value
  const now = performance.now()
  if (now - lastStatsAt > 500) {
    lastStatsAt = now
    const st = chartRef.value?.getStats()
    if (st) stats.value = st
    analysisStats.value = chartRef.value?.getAnalysisStats() ?? null
    backend.value = chartRef.value?.getBackend() ?? '-'
  }
})

function refreshBackend(): void {
  void nextTick(() => {
    backend.value = chartRef.value?.getBackend() ?? '-'
    points.value = chartRef.value?.getLength() ?? 0
  })
}

function onClear(): void {
  chartRef.value?.clear()
  hasData.value = false
  points.value = 0
  stats.value = null
  message.success('已清空')
}

function onResetView(): void {
  chartRef.value?.resetView()
  message.success('已恢复自动量程')
}

function onExportPNG(): void {
  chartRef.value?.exportPNG()
}

function onExportCSV(): void {
  chartRef.value?.exportCSV()
}

onUnmounted(() => {
  lastStatsAt = 0
})

// 分析仪配置切换（纯显示/调制/自动估计）时清空旧点云，避免两套语义混在一起
watch(analysisConfig, () => {
  chartRef.value?.clear()
  hasData.value = false
  points.value = 0
  stats.value = null
  analysisStats.value = null
})
</script>

<template>
  <div style="padding: 16px">
    <NCard title="星座图" style="margin-bottom: 16px">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center">
        <span>后端</span>
        <NSelect
          v-model:value="renderer"
          size="small"
          :options="[
            { label: 'auto', value: 'auto' },
            { label: 'webgl2', value: 'webgl2' },
            { label: 'canvas2d', value: 'canvas2d' }
          ]"
          style="width: 120px"
          @update:value="refreshBackend"
        />
        <span>主题</span>
        <NSelect
          v-model:value="themeKey"
          size="small"
          :options="[
            { label: 'auto（跟随系统）', value: 'auto' },
            { label: 'dark', value: 'dark' },
            { label: 'light', value: 'light' },
            { label: 'spectrum（黑底黄迹）', value: 'spectrum' }
          ]"
          style="width: 190px"
        />
        <span>点数</span>
        <NSlider v-model:value="pointSize" :min="1" :max="6" :step="0.5" style="width: 100px" />
        <span>透明度</span>
        <NSlider v-model:value="alpha" :min="0.1" :max="1" :step="0.05" style="width: 100px" />
        <span>轴</span>
        <NSwitch v-model:value="showAxis" size="small" />
        <span>网格</span>
        <NSwitch v-model:value="showGrid" size="small" />
        <span>分析仪</span>
        <NSwitch
          v-model:value="analysisOn"
          size="small"
          :disabled="sourceWaveform !== 'digital' || sourceMode !== 'complex'"
        />
        <span>调制</span>
        <NSelect
          v-model:value="analysisMod"
          size="small"
          :disabled="!analysisConfig"
          :options="[
            { label: 'BPSK', value: 'BPSK' },
            { label: 'QPSK', value: 'QPSK' },
            { label: '16QAM', value: '16QAM' }
          ]"
          style="width: 92px"
        />
        <span>自动载波</span>
        <NSwitch v-model:value="autoCarrier" size="small" :disabled="!analysisConfig" />
        <span>自动定时</span>
        <NSwitch v-model:value="autoSymbolTiming" size="small" :disabled="!analysisConfig" />
        <NButton size="small" @click="onResetView">自适应</NButton>
        <NButton size="small" @click="onExportPNG">导出 PNG</NButton>
        <NButton size="small" @click="onExportCSV">导出 CSV</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
        <NTag size="small" :bordered="false">{{ backend }}</NTag>
        <NTag size="small" :bordered="false">{{ points }} 点</NTag>
        <NTag size="small" :bordered="false">
          {{ sourceMode === 'complex' ? '复数 IQ' : '实数源（Q=0）' }}
        </NTag>
        <NTag size="small" :bordered="false">
          {{ analysisConfig ? `${analysisMod} 分析仪` : '纯显示' }}
        </NTag>
        <NTag v-if="analysisConfig" size="small" :bordered="false">
          {{ carrierHz }} Hz · {{ samplesPerSymbol }} sps
        </NTag>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        纯显示：IQ 点原样绘制，不做载波/符号/EVM；分析仪：中心频率下变频 + 可选自动载波/定时 +
        判决点/EVM。高 SNR 不会去掉 RRC 过渡轨迹，分析仪只画判决点。自动定时只补偿符号相位；演示源
        通常已对齐，结果为 0，看不到变化是正常的。
      </div>
      <NAlert
        v-if="oneDimensional"
        type="warning"
        title="当前只有 I 路（Q≈0）"
        style="margin-top: 8px"
      >
        当前源是「实数输出」，IQ 捕获 Q=0，星座会退化成一条 I 轴线。要看 QPSK/QAM
        星座，请到「信号源工作台」把输出模式改为「复数 IQ 输出」。
      </NAlert>
      <div
        v-if="!hasData && !sig.remoteError.value"
        style="color: #18a058; font-size: 12px; margin-top: 6px"
      >
        等待服务端（请至「信号源工作台」启动/选择源）
      </div>
      <div
        v-else-if="sig.remoteError.value"
        style="color: #d03050; font-size: 12px; margin-top: 6px"
      >
        远程错误: {{ sig.remoteError.value }}
      </div>
    </NCard>

    <NCard content-style="padding: 0">
      <div style="position: relative; height: 480px">
        <ConstellationChart
          ref="chartRef"
          :key="renderer"
          :renderer="renderer"
          :theme="themeKey"
          :point-size="pointSize"
          :alpha="alpha"
          :axis="showAxis"
          :grid="showGrid"
          :analysis="analysisConfig"
          :height="480"
        />
        <NEmpty
          v-if="!hasData"
          description="暂无数据，请至「信号源工作台」启动源"
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

    <NCard v-if="analysisStats?.measured" title="星座分析" style="margin-top: 16px" size="small">
      <NDescriptions :column="4" size="small" label-placement="left">
        <NDescriptionsItem label="EVM"
          >{{ analysisStats.evmPercent.toFixed(2) }} %</NDescriptionsItem
        >
        <NDescriptionsItem label="MER">{{ analysisStats.merDb.toFixed(2) }} dB</NDescriptionsItem>
        <NDescriptionsItem label="幅度误差">
          {{ (analysisStats.magnitudeErrorRms * 100).toFixed(2) }} %
        </NDescriptionsItem>
        <NDescriptionsItem label="相位误差">
          {{ analysisStats.phaseErrorRmsDeg.toFixed(2) }}°
        </NDescriptionsItem>
        <NDescriptionsItem label="IQ 增益不平衡">
          {{ analysisStats.iqGainImbalanceDb.toFixed(2) }} dB
        </NDescriptionsItem>
        <NDescriptionsItem label="IQ 相位不平衡">
          {{ analysisStats.iqPhaseImbalanceDeg.toFixed(2) }}°
        </NDescriptionsItem>
        <NDescriptionsItem label="载波残差">
          {{ analysisStats.carrierOffsetHz.toFixed(2) }} Hz
        </NDescriptionsItem>
        <NDescriptionsItem label="定时相位">
          {{ analysisStats.symbolTimingOffset.toFixed(3) }} sps
        </NDescriptionsItem>
        <NDescriptionsItem label="符号率">
          {{ analysisStats.symbolRateHz.toFixed(2) }} Bd
        </NDescriptionsItem>
        <NDescriptionsItem label="统计符号">{{ analysisStats.symbolCount }}</NDescriptionsItem>
      </NDescriptions>
    </NCard>

    <NCard v-if="stats" title="统计" style="margin-top: 16px" size="small">
      <NDescriptions :column="4" size="small" label-placement="left">
        <NDescriptionsItem label="缓冲点">{{ stats.points }}</NDescriptionsItem>
        <NDescriptionsItem label="绘制点">{{ stats.renderPoints }}</NDescriptionsItem>
        <NDescriptionsItem label="I RMS">{{ stats.iRms.toFixed(4) }}</NDescriptionsItem>
        <NDescriptionsItem label="Q RMS">{{ stats.qRms.toFixed(4) }}</NDescriptionsItem>
        <NDescriptionsItem label="功率">{{ stats.powerDbfs.toFixed(2) }} dBFS</NDescriptionsItem>
        <NDescriptionsItem label="峰值">{{ stats.peak.toFixed(4) }}</NDescriptionsItem>
        <NDescriptionsItem label="I 范围">
          {{ stats.iMin.toFixed(3) }} … {{ stats.iMax.toFixed(3) }}
        </NDescriptionsItem>
        <NDescriptionsItem label="Q 范围">
          {{ stats.qMin.toFixed(3) }} … {{ stats.qMax.toFixed(3) }}
        </NDescriptionsItem>
      </NDescriptions>
    </NCard>
  </div>
</template>
