<script setup lang="ts">
/**
 * TypeScript 惯用法课程页外壳
 * 用法：<TsPage title="..." intro="..."> …TsExample… </TsPage>
 */
import { NText } from 'naive-ui'

defineProps<{
  /** 课程标题 */
  title: string
  /** 一句话主题说明（出现在页首） */
  intro: string
}>()
</script>

<template>
  <div class="ts-page">
    <n-card size="small" :title="title" class="ts-head">
      <n-text depth="3" style="font-size: 13px">{{ intro }}</n-text>
    </n-card>
    <div style="margin-top: 12px">
      <slot />
    </div>
  </div>
</template>
