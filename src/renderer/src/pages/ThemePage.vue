<script setup lang="ts">
/**
 * 系统主题演示页
 * 演示：nativeTheme 三档切换 + 感知系统主题变化
 * 联动：本页切换会同步影响整个应用的 Naive UI 主题（App.vue 绑定同一状态）
 */
import { ref } from 'vue'
import { NCard, NRadioGroup, NRadio, NAlert, useMessage, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import themeCode from '../../../main/features/theme.ts?raw'
import { setThemeSource, themeSource } from '../stores/theme'

const message = useMessage()

const currentDark = ref(false)
async function getState(): Promise<void> {
  const state = await window.api.theme.getState()
  currentDark.value = state.shouldUseDarkColors
}

async function changeSource(source: 'system' | 'light' | 'dark'): Promise<void> {
  await setThemeSource(source)
  message.success(`主题源已切换为: ${source}`)
  await getState()
}

getState()
</script>

<template>
  <FeatureLayout
    title="系统主题"
    api="nativeTheme"
    intro="nativeTheme 是主进程判断系统主题的权威来源。themeSource 决定应用偏好（system/light/dark），shouldUseDarkColors 是实际生效值。本页与 App.vue 顶部按钮联动，切换后整个应用（含所有页面）明暗主题立即变化；选择「跟随系统」后，修改 Windows/macOS 主题设置，应用会自动跟随。"
  >
    <n-card size="small" title="主题源">
      <n-radio-group :value="themeSource" @update:value="changeSource">
        <n-radio value="system">跟随系统</n-radio>
        <n-radio value="light">强制亮色</n-radio>
        <n-radio value="dark">强制暗色</n-radio>
      </n-radio-group>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        当前 shouldUseDarkColors = {{ currentDark ? 'true（暗色）' : 'false（亮色）' }}
      </n-text>
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      <template #header>跟随系统的联动机制</template>
      选择「跟随系统」后，到系统设置里切换明暗主题（Windows: 设置 → 个性化 → 颜色）， 应用会通过
      nativeTheme 的 updated 事件实时跟随——这就是桌面应用"跟随系统外观"的标准实现。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/theme.ts" :code="themeCode" />
    </template>
  </FeatureLayout>
</template>
