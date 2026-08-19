<script setup lang="ts">
/**
 * GPU 信息与硬件加速演示页
 * 演示：GPU 特性状态表、基本信息查询、硬件加速开关（标记 + 重启生效）
 */
import { onMounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NAlert,
  NText,
  NSwitch,
  NCode,
  useDialog,
  useMessage
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import gpuInfoCode from '../../../main/features/gpuInfo.ts?raw'

const dialog = useDialog()
const message = useMessage()

const featureRows = ref<{ feature: string; status: string }[]>([])
const basicInfo = ref('')
const accelerated = ref(true)
const platform = ref('')
const loading = ref(false)

/** 状态值 → 中文含义（Electron 官方取值） */
const STATUS_LABELS: Record<string, string> = {
  disabled_software: '软件渲染（禁用加速）',
  disabled_off: '已关闭',
  disabled_off_ok: '已关闭（可用）',
  unavailable_software: '不可用（软件）',
  unavailable_off: '不可用（关闭）',
  unavailable_off_ok: '不可用（关闭，正常）',
  enabled_readback: '硬件加速（回读）',
  enabled_force: '强制启用',
  enabled: '硬件加速',
  enabled_on: '已开启',
  enabled_force_on: '强制开启'
}

async function loadFeatureStatus(): Promise<void> {
  loading.value = true
  try {
    const status = (await window.api.gpu.getFeatureStatus()) as Record<string, string>
    featureRows.value = Object.entries(status).map(([feature, value]) => ({
      feature,
      status: STATUS_LABELS[value] ?? value
    }))
  } finally {
    loading.value = false
  }
}

async function loadBasicInfo(): Promise<void> {
  const info = await window.api.gpu.getInfo()
  basicInfo.value = JSON.stringify(info, null, 2)
}

onMounted(async () => {
  await loadFeatureStatus()
  await loadBasicInfo()
  const state = await window.api.gpu.getAccelerationState()
  accelerated.value = state.accelerated
  platform.value = state.platform
})

/** 切换硬件加速：写标记文件 → 询问重启（开关在重启后生效） */
async function toggleAcceleration(value: boolean): Promise<void> {
  dialog.warning({
    title: '需要重启应用',
    content: `切换硬件加速必须重启才能生效（disable-gpu 开关只能在 app ready 之前追加）。${
      value ? '' : '禁用后界面将使用软件渲染，可能出现卡顿。'
    }是否立即重启？`,
    positiveText: '立即重启',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.api.gpu.setAcceleration(value)
      const res = await window.api.relaunch.now()
      // 开发模式自动重启会杀掉 electron-vite 的 dev server → 白屏，提示手动重启
      if (res.devMode) {
        message.info('已写入硬件加速标记，开发模式请手动重启 npm run dev 生效')
        return
      }
    }
  })
}
</script>

<template>
  <FeatureLayout
    title="GPU 信息与硬件加速"
    api="app.getGPUFeatureStatus / getGPUInfo / commandLine.appendSwitch"
    intro="Electron 界面由 GPU 加速渲染（Canvas/WebGL/视频解码等），个别机器显卡驱动异常会出现黑屏、花屏、卡顿。排查第一步就是看 GPU 状态：getGPUFeatureStatus 逐项列出加速特性，getGPUInfo 给出显卡型号与驱动版本（报 bug 时必附）。最后的手段是禁用硬件加速（软渲染），代价是明显变卡。"
  >
    <n-card size="small" title="硬件加速开关" style="margin-bottom: 12px">
      <n-space align="center">
        <n-switch :value="accelerated" @update:value="toggleAcceleration" />
        <n-text
          >当前硬件加速: <b>{{ accelerated ? '开启 ✅' : '已禁用 ❌（软渲染）' }}</b></n-text
        >
        <n-text depth="3" style="font-size: 12px">（平台: {{ platform }}）</n-text>
      </n-space>
      <n-alert type="info" size="small" :show-icon="true" style="margin-top: 8px">
        切换流程：写/删 userData 下的标记文件 → 重启（复用 relaunch.ts）→ 启动时 applyGpuCommandLine
        在 app ready 之前追加 disable-gpu 开关。体验后记得重新开启。
      </n-alert>
    </n-card>

    <n-card size="small" title="GPU 特性状态表" style="margin-bottom: 12px">
      <n-space style="margin-bottom: 8px">
        <n-button size="small" :loading="loading" @click="loadFeatureStatus">刷新状态表</n-button>
        <n-button size="small" @click="loadBasicInfo">刷新基本信息</n-button>
      </n-space>
      <div v-for="row in featureRows" :key="row.feature" class="gpu-row">
        <span class="gpu-name">{{ row.feature }}</span>
        <span
          class="gpu-status"
          :class="{ soft: row.status.includes('软件') || row.status.includes('不可用') }"
        >
          {{ row.status }}
        </span>
      </div>
    </n-card>

    <n-card size="small" title="GPU 基本信息（bug 上报必备）">
      <n-code :code="basicInfo || '加载中…'" language="json" word-wrap />
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/gpuInfo.ts" :code="gpuInfoCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.gpu-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-color);
  font-size: 12px;
}
.gpu-name {
  font-family: monospace;
}
.gpu-status.soft {
  color: var(--warning-color);
}
</style>
