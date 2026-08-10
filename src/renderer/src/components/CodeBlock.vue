<script setup lang="ts">
import { NButton, NCode } from 'naive-ui'
import { useMessage } from 'naive-ui'

/**
 * 通用源码展示块：
 * - 通过 vite 的 ?raw 导入主进程源码文件（改动主进程代码后这里自动同步）
 * - 一键复制整个模块，方便"复制到别的工程"
 */
const props = defineProps<{
  /** ?raw 导入的源码字符串 */
  code: string
  /** 源文件路径（展示用） */
  file: string
  language?: string
}>()

const message = useMessage()

async function copyCode(): Promise<void> {
  await window.api.clipboard.writeText(props.code)
  message.success('已复制到剪贴板')
}
</script>

<template>
  <div class="code-block">
    <div class="code-toolbar">
      <span class="file-name">{{ file }}</span>
      <n-button size="tiny" secondary type="primary" @click="copyCode">复制源码</n-button>
    </div>
    <n-code :code="code" :language="language ?? 'typescript'" word-wrap />
  </div>
</template>

<style scoped>
.code-block {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--code-toolbar-bg);
}
.file-name {
  font-size: 12px;
  color: var(--text-color-2);
  font-family: monospace;
}
</style>
