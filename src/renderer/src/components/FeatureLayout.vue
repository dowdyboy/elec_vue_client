<script setup lang="ts">
import { NCard, NTag } from 'naive-ui'

/**
 * 特性页统一三段式布局：
 * ① 原理说明 → ② 在线演示（插槽默认内容） → ③ 关键源码（具名插槽 code）
 */
defineProps<{
  title: string
  /** Electron API 名称，如 BrowserWindow / ipcMain */
  api: string
  /** 一句话原理说明 */
  intro: string
}>()
</script>

<template>
  <div class="feature-layout">
    <n-card size="small" class="section">
      <template #header>
        <div class="card-header">
          <span class="feature-title">{{ title }}</span>
          <n-tag size="small" type="info" round>Electron API: {{ api }}</n-tag>
        </div>
      </template>
      <p class="intro">{{ intro }}</p>
    </n-card>

    <n-card size="small" class="section">
      <template #header>
        <span class="section-title">① 在线演示</span>
      </template>
      <slot />
    </n-card>

    <n-card size="small" class="section">
      <template #header>
        <span class="section-title">② 关键源码（模块顶部注释含复制到新工程的步骤）</span>
      </template>
      <slot name="code" />
    </n-card>
  </div>
</template>

<style scoped>
.feature-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.feature-title {
  font-size: 15px;
  font-weight: 600;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
}
.intro {
  margin: 0;
  color: var(--text-color-2);
  font-size: 13px;
  line-height: 1.7;
}
</style>
