<script setup lang="ts">
/**
 * 全局快捷键演示页
 * 演示：系统级快捷键注册 / 注销 / 触发事件 + 应用内按键拦截（before-input-event）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NSwitch, useMessage, NAlert, NTag, NText } from 'naive-ui'
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

// ── 应用内按键拦截（inputHook.ts）──
const blockF12 = ref(false)
const keyLogs = ref<string[]>([])

async function toggleBlockF12(value: boolean): Promise<void> {
  blockF12.value = await window.api.inputHook.setBlockF12(value)
  message.info(blockF12.value ? 'F12 已被吞掉（不再触发任何行为）' : 'F12 已恢复')
}

let dispose: (() => void) | null = null
let disposeKey: (() => void) | null = null
onMounted(() => {
  dispose = window.api.shortcut.onTriggered(({ accelerator }) => {
    triggered.value.unshift({ accelerator, time: new Date().toLocaleTimeString() })
    message.info(`快捷键 ${accelerator} 被触发（即使在后台也生效）`)
  })
  disposeKey = window.api.inputHook.onKey(({ key }) => {
    keyLogs.value.unshift(key)
    if (keyLogs.value.length > 20) keyLogs.value.pop()
  })
})
onUnmounted(() => {
  dispose?.()
  disposeKey?.()
})
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

    <n-card
      size="small"
      title="应用内按键拦截（before-input-event，主进程: inputHook.ts）"
      style="margin-top: 12px"
    >
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">吞掉 F12：</span>
        <n-switch :value="blockF12" @update:value="toggleBlockF12" />
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        与 globalShortcut 的区别：按键拦截仅在窗口聚焦时生效（应用内）， 常用于禁用用户快捷键（如
        F12 调试）或自定义组合键。dev 下 F12 原本用于开关 DevTools（由 inputHook.ts
        统一接管，见源码说明）：吞掉后两者一并禁用；生产环境 Ctrl+R 等由 optimizer 屏蔽。
      </n-text>
      <div v-if="keyLogs.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(key, i) in keyLogs" :key="i">⌨️ 最近按键: {{ key }}</div>
      </div>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/globalShortcut.ts" :code="shortcutCode" />
    </template>
  </FeatureLayout>
</template>
