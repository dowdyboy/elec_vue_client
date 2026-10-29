<script setup lang="ts">
/**
 * AnalysisConfigPage（分析配置）
 * 只管理 FFT/窗/dB/重叠/频谱语义；源参数在 /source。
 */
import { onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NSelect,
  NSlider,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import {
  defaultAnalysisConfig,
  type SignalAnalysisConfig,
  type SpectrumMode,
  type WindowType
} from '../../../../shared/signal'

const message = useMessage()
const fftSize = ref(1024)
const windowType = ref<WindowType>('hann')
const dbScale = ref(true)
const overlap = ref(0.5)
const spectrumMode = ref<SpectrumMode>('real')
const running = ref(false)
const mode = ref('none')
const loading = ref(false)

async function refresh(): Promise<void> {
  try {
    const st = (await window.api.signalAnalysis.getStatus()) as {
      running: boolean
      mode: string
      config?: SignalAnalysisConfig
    }
    running.value = st.running
    mode.value = st.mode
    const c = st.config
    if (c) {
      if (typeof c.fftSize === 'number') fftSize.value = c.fftSize
      if (c.window) windowType.value = c.window
      if (typeof c.dbScale === 'boolean') dbScale.value = c.dbScale
      if (typeof c.overlap === 'number') overlap.value = c.overlap
      if (c.spectrumMode) spectrumMode.value = c.spectrumMode
    }
  } catch {
    running.value = false
  }
}

async function apply(): Promise<void> {
  loading.value = true
  try {
    const patch: Partial<SignalAnalysisConfig> = {
      fftSize: fftSize.value,
      window: windowType.value,
      dbScale: dbScale.value,
      overlap: overlap.value,
      spectrumMode: spectrumMode.value
    }
    const r = (await window.api.signalAnalysis.setConfig(
      patch as unknown as Record<string, unknown>
    )) as { ok: boolean; error?: string }
    if (!r.ok) message.error(r.error || '应用失败')
    else message.success('分析配置已应用')
    await refresh()
  } finally {
    loading.value = false
  }
}

function reset(): void {
  const d = defaultAnalysisConfig()
  fftSize.value = d.fftSize
  windowType.value = d.window
  dbScale.value = d.dbScale
  overlap.value = d.overlap
  spectrumMode.value = d.spectrumMode
}

onMounted(refresh)
</script>

<template>
  <div style="padding: 16px; max-width: 760px">
    <NCard title="📐 分析配置" :bordered="false">
      <template #header-extra>
        <NTag :type="running ? 'success' : 'default'" :bordered="false">
          {{ running ? `运行中 (${mode})` : '未运行' }}
        </NTag>
      </template>
      <NAlert type="info" :bordered="false" style="margin-bottom: 14px">
        这里只配置 FFT/窗/dB/重叠/频谱语义。源类型、载波、幅度、AWGN 请到
        <router-link to="/source">信号源工作台</router-link>；源是否运行由源页控制。
      </NAlert>
      <NForm label-placement="left" label-width="128" size="small">
        <NFormItem label="FFT 大小">
          <NSelect
            v-model:value="fftSize"
            :options="
              [256, 512, 1024, 2048, 4096, 8192].map((v) => ({ label: String(v), value: v }))
            "
            style="width: 200px"
          />
        </NFormItem>
        <NFormItem label="窗函数">
          <NSelect
            v-model:value="windowType"
            :options="[
              { label: 'Hann', value: 'hann' },
              { label: 'Hamming', value: 'hamming' },
              { label: 'Blackman', value: 'blackman' },
              { label: 'Rect', value: 'rect' }
            ]"
            style="width: 200px"
          />
        </NFormItem>
        <NFormItem label="频谱语义">
          <NSelect
            v-model:value="spectrumMode"
            :options="[
              { label: 'real 单边 0~Fs/2', value: 'real' },
              { label: 'complex 完整复谱 -Fs/2~+Fs/2', value: 'complex' }
            ]"
            style="width: 280px"
          />
        </NFormItem>
        <NFormItem label="dB 缩放">
          <NSwitch v-model:value="dbScale" />
        </NFormItem>
        <NFormItem label="时频重叠">
          <NSlider v-model:value="overlap" :min="0" :max="0.9" :step="0.05" style="width: 240px" />
          <span style="margin-left: 8px; color: #888">{{ (overlap * 100).toFixed(0) }}%</span>
        </NFormItem>
        <NFormItem>
          <div style="display: flex; gap: 8px">
            <NButton type="primary" size="small" :loading="loading" @click="apply">应用</NButton>
            <NButton size="small" @click="reset">恢复默认</NButton>
          </div>
        </NFormItem>
      </NForm>
    </NCard>
  </div>
</template>
