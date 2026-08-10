<script setup lang="ts">
/**
 * 原生菜单演示页
 * 演示：应用菜单（窗口顶部）+ 右键上下文菜单
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NAlert, useMessage, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import menuCode from '../../../main/features/menu.ts?raw'

const message = useMessage()
const clicked = ref('')

let dispose: (() => void) | null = null

function showContext(): void {
  window.api.menu.showContext()
}

onMounted(() => {
  dispose = window.api.menu.onItemClicked((label) => {
    clicked.value = label
    message.success(label)
  })
})
onUnmounted(() => dispose?.())
</script>

<template>
  <FeatureLayout
    title="原生菜单"
    api="Menu"
    intro="两类原生菜单：① 应用菜单：窗口顶部的菜单栏（macOS 在系统顶部），本工程已在主进程自定义了「教学示例」菜单；② 上下文菜单：右键弹出，本页通过 IPC 触发弹出。菜单项可绑定快捷键（accelerator）与内置行为（role）。"
  >
    <n-card size="small" title="应用菜单" style="margin-bottom: 12px">
      <n-text depth="3" style="font-size: 13px">
        请看窗口顶部菜单栏（Windows 上默认隐藏，按 Alt 显示）：包含「教学示例」菜单，
        其中有外部链接打开、全屏切换（F11）、开发者工具（Ctrl+Shift+I）三个菜单项。
      </n-text>
    </n-card>

    <n-card size="small" title="右键上下文菜单">
      <n-button type="primary" @click="showContext">在鼠标位置弹出右键菜单</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        菜单包含内置复制/剪切/粘贴（role）与自定义菜单项。点击「自定义菜单项」后，
        主进程会把点击事件发回本页面：<b>{{ clicked }}</b>
      </n-text>
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      role 是 Electron 内置行为：如 copy/cut/paste/quit 等，无需自己写实现，且自动适配系统快捷键。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/menu.ts" :code="menuCode" />
    </template>
  </FeatureLayout>
</template>
