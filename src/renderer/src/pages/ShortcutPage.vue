<script setup lang="ts">
/**
 * 全局快捷键演示页
 * 演示：系统级快捷键注册 / 注销 / 触发事件
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NSwitch, useMessage, NAlert, NTag } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import shortcutCode from '../../../main/features/globalShortcut.ts?raw'

const message = useMessage()
const enabled = ref(true)
const triggered = ref<{ accelerator: string; time: string }[]>([])

async function toggleShortcuts(value: boolean): Promise<void> {
  enabled.value = await window.api.shortcut.setEnabled(value)
  message.success(enabled.value ? '快捷键已注册' : '快捷键已全部注销')
}

let dispose: (() => void) | null = null
onMounted(() => {
  dispose = window.api.shortcut.onTriggered(({ accelerator }) => {
    triggered.value.unshift({ accelerator, time: new Date().toLocaleTimeString() })
    message.info(`快捷键 ${accelerator} 被触发（即使在后台也生效）`)
  })
})
onUnmounted(() => dispose?.())
</script>

<template>
  <FeatureLayout
    title="全局快捷键"
    api="globalShortcut"
    intro="globalShortcut 注册的是操作系统级快捷键：应用在后台、甚至最小化到托盘时依然生效。典型场景：截图工具、语音助手、快速呼出面板。注意注册冲突（其他应用已占用时 register 返回 false）与退出前注销。"
  >
    <n-card size="small" title="快捷键开关与触发记录" style="margin-bottom: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">快捷键总开关：</span>
        <n-switch v-model:value="enabled" @update:value="toggleShortcuts" />
      </div>
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap">
        <n-tag type="primary">Ctrl+Shift+1 → 触发演示事件</n-tag>
        <n-tag type="primary">Ctrl+Shift+2 → 显示/隐藏主窗口</n-tag>
      </div>
      <div v-if="triggered.length" style="margin-top: 12px; font-size: 13px">
        <div v-for="(item, i) in triggered" :key="i">⚡ {{ item.time }} {{ item.accelerator }}</div>
      </div>
    </n-card>

    <n-alert type="warning" :show-icon="true">
      <template #header>怎么测试？</template>
      先把本窗口最小化（或切到其他应用），再按 Ctrl+Shift+1：
      主窗口会收到触发事件（等回到窗口即可看到记录）。 Ctrl+Shift+2
      会直接把主窗口呼出/隐藏，适合体验"全局热键呼出应用"。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/globalShortcut.ts" :code="shortcutCode" />
    </template>
  </FeatureLayout>
</template>
