<script setup lang="ts">
import { ref } from 'vue'
import { NCard, NSelect, NButton, NCheckbox, NEmpty, NSwitch, useMessage } from 'naive-ui'
import { SpectrogramChart } from '@components/signal'
import type { ColorMap } from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'
import { isDark } from '@renderer/stores/theme'

const message = useMessage()
const chartRef = ref<InstanceType<typeof SpectrogramChart> | null>(null)
const colorMap = ref<ColorMap>('viridis')
const timeSpan = ref(256)
const paused = ref(false)
const autoLevel = ref(false)
const showColorbar = ref(true)
const hasData = ref(false)
const lastMeta = ref({
  rows: 0,
  cols: 0,
  fftSize: 0,
  sampleRate: 0,
  timeStepSec: 0,
  mode: 'real' as 'real' | 'complex',
  outputMode: 'real' as 'real' | 'complex',
  freqStartHz: 0
})

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onSpectrogram((row, frame) => {
  chartRef.value?.appendData(row, {
    sampleRate: frame.sampleRate,
    fftSize: frame.fftSize,
    timeStepSec: frame.timeStepSec,
    seq: frame.seq,
    spectrumMode: frame.spectrumMode,
    freqStartHz: frame.freqStartHz,
    binHz: frame.binHz,
    fftShift: frame.fftShift
  })
  hasData.value = true
  const st = chartRef.value?.getStats()
  if (st)
    lastMeta.value = {
      rows: st.rows,
      cols: st.cols,
      fftSize: st.fftSize ?? 0,
      sampleRate: st.sampleRate ?? 0,
      timeStepSec: st.timeStepSec ?? 0,
      mode: st.spectrumMode ?? 'real',
      outputMode: frame.outputMode ?? lastMeta.value.outputMode,
      freqStartHz: st.freqStartHz ?? 0
    }
})

function onClear(): void {
  chartRef.value?.clear()
  hasData.value = false
  message.success('已清空')
}
function onReset(): void {
  chartRef.value?.resetView()
}
function onExportPng(): void {
  chartRef.value?.exportPNG()
}
function onExportCsv(): void {
  chartRef.value?.exportCSV()
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
            { label: 'turbo', value: 'turbo' },
            { label: 'jet', value: 'jet' },
            { label: 'grayscale', value: 'grayscale' },
            { label: 'hot', value: 'hot' }
          ]"
          style="width: 120px"
        />
        <span>时间窗</span>
        <NSelect
          v-model:value="timeSpan"
          :options="[
            { label: '128 行', value: 128 },
            { label: '256 行', value: 256 },
            { label: '512 行', value: 512 }
          ]"
          style="width: 100px"
        />
        <NCheckbox v-model:checked="autoLevel">自动电平</NCheckbox>
        <NCheckbox v-model:checked="showColorbar">色标</NCheckbox>
        <span style="display: inline-flex; align-items: center; gap: 6px">
          冻结
          <NSwitch v-model:value="paused" size="small" />
        </span>
        <NButton size="small" @click="onReset">复位频率</NButton>
        <NButton size="small" @click="onExportPng">PNG</NButton>
        <NButton size="small" @click="onExportCsv">CSV</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待数据（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        {{ lastMeta.rows }} 行 / {{ lastMeta.cols }} bin ·
        {{ lastMeta.outputMode === 'complex' ? '复数 IQ 源' : '实数源（Q=0）' }} ·
        {{ lastMeta.mode === 'complex' ? '复谱 -Fs/2~+Fs/2' : '单边 0~Fs/2' }} · FFT
        {{ lastMeta.fftSize || '-' }} · Fs {{ lastMeta.sampleRate || '-' }} · Δt
        {{ lastMeta.timeStepSec ? lastMeta.timeStepSec.toExponential(3) + ' s' : '-' }}
        · 重叠 / FFT 处理在服务端配置（请至“Mock 配置”页）
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <SpectrogramChart
          ref="chartRef"
          :theme="isDark ? 'dark' : 'light'"
          :color-map="colorMap"
          :time-span="timeSpan"
          :paused="paused"
          :auto-level="autoLevel"
          :show-colorbar="showColorbar"
          :height="420"
          @update:paused="(v: boolean) => (paused = v)"
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
