<script setup lang="ts">
/**
 * TS 惯用法卡片：
 * - code：TS 源码（只读，高亮）
 * - run：可选运行函数（真实函数，非 eval——CSP 禁止 unsafe-eval），点击"运行"展示输出
 * - tip / pitfall：要点 / 陷阱说明
 */
import { ref } from 'vue'
import { NCard, NButton, NAlert, NText, NCode } from 'naive-ui'
import { formatValue, type RunResult } from './runJs'

const props = defineProps<{
  title: string
  /** 惯用法要点说明 */
  explain: string
  /** TS 源码（只读展示） */
  code: string
  /** 可运行的函数（可选）：返回要展示的值，如 () => greet('小明') */
  run?: () => unknown
  /** 提示要点 */
  tip?: string
  /** 常见陷阱 */
  pitfall?: string
}>()

const runResult = ref<RunResult | null>(null)

function doRun(): void {
  if (!props.run) return
  runResult.value = formatValue(props.run)
}
</script>

<template>
  <n-card size="small" :title="title" style="margin-bottom: 12px">
    <n-text depth="3" style="display: block; font-size: 13px">{{ explain }}</n-text>

    <div style="margin-top: 10px">
      <n-code :code="code" language="typescript" word-wrap />
    </div>

    <div v-if="run" style="display: flex; align-items: center; gap: 8px; margin-top: 10px">
      <n-button size="small" type="primary" secondary @click="doRun">▶ 运行示例</n-button>
      <n-text depth="3" style="font-size: 12px"
        >（类型在编译期检查，运行观察的是等价 JS 行为）</n-text
      >
    </div>
    <pre v-if="runResult" class="ts-output" :class="{ error: !runResult.ok }">{{
      runResult.output
    }}</pre>

    <n-alert v-if="tip" type="info" :show-icon="true" size="small" style="margin-top: 10px">
      <template #header>要点</template>
      {{ tip }}
    </n-alert>
    <n-alert v-if="pitfall" type="warning" :show-icon="true" size="small" style="margin-top: 10px">
      <template #header>常见陷阱</template>
      {{ pitfall }}
    </n-alert>
  </n-card>
</template>

<style scoped>
.ts-output {
  margin-top: 8px;
  padding: 8px 12px;
  /* 主题感知背景/文字：--code-bg 不存在，须用 --code-toolbar-bg（亮/暗都有定义）；
     不设 color 会在暗色主题下继承浅色文字 → 白底白字不可见 */
  background: var(--code-toolbar-bg);
  color: var(--text-color-2);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
}
.ts-output.error {
  color: #e5484d;
}
</style>
