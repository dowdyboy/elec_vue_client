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
import type { ConstellationStats } from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { isDark } from '@renderer/stores/theme'

const message = useMessage()
const chartRef = ref<InstanceType<typeof ConstellationChart> | null>(null)
const renderer = ref<'auto' | 'webgl2' | 'canvas2d'>('auto')
const pointSize = ref(2)
const alpha = ref(0.7)
const showAxis = ref(true)
const showGrid = ref(true)
const hasData = ref(false)
const points = ref(0)
const stats = ref<ConstellationStats | null>(null)
const backend = ref('-')
const sourceMode = ref<'real' | 'complex'>('real')
const sourceWaveform = ref('')
const symbolStrobe = ref(true)
const samplesPerSymbol = ref(16)
const effectiveStrobe = computed(() => symbolStrobe.value && sourceWaveform.value === 'digital')
const oneDimensional = computed(() => hasData.value && !!stats.value && stats.value.qRms < 1e-9)
let lastStatsAt = 0

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onIq((iq, frame) => {
  if (frame.outputMode) sourceMode.value = frame.outputMode
  if (frame.waveform) sourceWaveform.value = frame.waveform
  if (typeof frame.samplesPerSymbol === 'number' && frame.samplesPerSymbol > 0)
    samplesPerSymbol.value = frame.samplesPerSymbol
  chartRef.value?.appendData(iq, {
    sampleRate: frame.sampleRate,
    carrierHz: frame.outputMode === 'complex' ? frame.carrierHz : 0,
    samplesPerSymbol: frame.samplesPerSymbol
  })
  hasData.value = true
  points.value = chartRef.value?.getLength() ?? points.value
  const now = performance.now()
  if (now - lastStatsAt > 500) {
    lastStatsAt = now
    const st = chartRef.value?.getStats()
    if (st) stats.value = st
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

watch(symbolStrobe, () => {
  chartRef.value?.clear()
  hasData.value = false
  points.value = 0
  stats.value = null
})

// 首帧 waveform 元数据到达后才确定是否抽点；清掉此前可能混入的原始采样
watch(effectiveStrobe, (v) => {
  if (!v) return
  chartRef.value?.clear()
  hasData.value = false
  points.value = 0
  stats.value = null
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
        <span>点数</span>
        <NSlider v-model:value="pointSize" :min="1" :max="6" :step="0.5" style="width: 100px" />
        <span>透明度</span>
        <NSlider v-model:value="alpha" :min="0.1" :max="1" :step="0.05" style="width: 100px" />
        <span>轴</span>
        <NSwitch v-model:value="showAxis" size="small" />
        <span>网格</span>
        <NSwitch v-model:value="showGrid" size="small" />
        <span>符号抽点</span>
        <NSwitch
          v-model:value="symbolStrobe"
          size="small"
          :disabled="sourceWaveform !== 'digital'"
        />
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
          {{ effectiveStrobe ? '符号判决点' : '全部采样' }}
        </NTag>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        高 SNR 只去噪声，不会去掉 RRC 符号过渡轨迹；开启「符号抽点」按
        {{ samplesPerSymbol }} 点/符号只显示判决点。滚轮缩放、拖拽平移、双击恢复自动量程。
      </div>
      <NAlert
        v-if="oneDimensional"
        type="warning"
        title="当前只有 I 路（Q≈0）"
        style="margin-top: 8px"
      >
        Mock 当前是「实数输出」，IQ 捕获 Q=0，星座会退化成一条 I 轴线。要看 QPSK/QAM
        星座，请到「Mock 配置」把输出模式改为「复数 IQ 输出」。
      </NAlert>
      <div
        v-if="!hasData && !sig.remoteError.value"
        style="color: #18a058; font-size: 12px; margin-top: 6px"
      >
        等待服务端（请至「Mock 配置」页启动/选择源）
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
          :theme="isDark ? 'dark' : 'light'"
          :point-size="pointSize"
          :alpha="alpha"
          :axis="showAxis"
          :grid="showGrid"
          :symbol-strobe="effectiveStrobe"
          :samples-per-symbol="samplesPerSymbol"
          :height="480"
        />
        <NEmpty
          v-if="!hasData"
          description="暂无数据，请至「Mock 配置」页启动服务"
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
