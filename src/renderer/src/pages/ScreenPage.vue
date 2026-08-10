<script setup lang="ts">
/**
 * 屏幕信息演示页
 * 演示：多显示器信息查询、光标位置、显示器热插拔监听
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NDataTable, useMessage, NText, type DataTableColumns } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import screenCode from '../../../main/features/screenInfo.ts?raw'

const message = useMessage()

interface DisplayInfo {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
}

const displays = ref<DisplayInfo[]>([])
const cursor = ref('')

async function refresh(): Promise<void> {
  const info = await window.api.screen.getInfo()
  displays.value = info.displays
  cursor.value = `x=${info.cursor.x}, y=${info.cursor.y}`
  message.success('屏幕信息已刷新')
}

const columns: DataTableColumns<DisplayInfo> = [
  { title: '显示器 ID', key: 'id', width: 100 },
  {
    title: '位置 (x, y)',
    key: 'bounds',
    width: 140,
    render: (row) => `${row.bounds.x}, ${row.bounds.y}`
  },
  {
    title: '分辨率',
    key: 'size',
    width: 120,
    render: (row) => `${row.bounds.width} × ${row.bounds.height}`
  },
  { title: '缩放比', key: 'scaleFactor', width: 90 },
  { title: '主屏', key: 'primary', width: 80, render: (row) => (row.primary ? '✅' : '') }
]

let dispose: (() => void) | null = null
onMounted(() => {
  refresh()
  // 显示器插入/拔出/分辨率变化 → 主进程推送 → 自动刷新
  dispose = window.api.screen.onDisplaysChanged((info) => {
    displays.value = (info as { displays: DisplayInfo[] }).displays
    message.info('显示器配置变化，已自动刷新')
  })
})
onUnmounted(() => dispose?.())
</script>

<template>
  <FeatureLayout
    title="屏幕信息"
    api="screen"
    intro="screen 模块仅主进程可用，用于获取所有显示器信息（分辨率、缩放比、位置）、光标坐标，并监听显示器热插拔。典型用途：多屏应用把窗口定位到指定显示器、按缩放比适配高分屏。"
  >
    <n-card size="small" title="显示器列表">
      <n-button type="primary" style="margin-bottom: 8px" @click="refresh">刷新信息</n-button>
      <n-text depth="3" style="display: block; margin-bottom: 8px; font-size: 12px">
        光标位置: {{ cursor }}（可拖动窗口观察变化）
      </n-text>
      <n-data-table :columns="columns" :data="displays" size="small" :bordered="false" />
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        💡 如有条件，可以插拔显示器（或修改分辨率），页面会自动刷新。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/screenInfo.ts" :code="screenCode" />
    </template>
  </FeatureLayout>
</template>
