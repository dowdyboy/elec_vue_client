<script setup lang="ts">
/**
 * 文件对话框演示页
 * 演示：打开文件 / 保存文件 / 消息对话框
 */
import { ref } from 'vue'
import { NCard, NButton, NInput, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import dialogCode from '../../../main/features/dialog.ts?raw'

const openedFile = ref('')
const saveFileName = ref('我的笔记.txt')
const savedPath = ref('')
const messageResult = ref('')

async function openFile(): Promise<void> {
  // 过滤只显示常见文本类型
  const path = await window.api.dialog.openFile([
    { name: '文本文件', extensions: ['txt', 'md', 'json'] },
    { name: '所有文件', extensions: ['*'] }
  ])
  openedFile.value = path ?? '（用户取消了选择）'
}

async function saveFile(): Promise<void> {
  const path = await window.api.dialog.saveFile({ defaultName: saveFileName.value })
  savedPath.value = path ? `已选择保存位置: ${path}` : '（用户取消了保存）'
}

async function showMessage(): Promise<void> {
  // 消息对话框：返回用户点击的按钮下标（response）
  const { response } = await window.api.dialog.showMessage({
    title: '教学演示：消息对话框',
    message: '这是一个原生消息框。你想怎么做？',
    buttons: ['保存', '取消', '不保存']
  })
  const labels = ['保存', '取消', '不保存']
  messageResult.value = `你点击了「${labels[response]}」（response=${response}）`
}
</script>

<template>
  <FeatureLayout
    title="文件对话框"
    api="dialog"
    intro="打开/保存文件对话框必须由主进程弹出（系统原生窗口）。渲染进程只能把需求通过 IPC 告诉主进程，主进程弹出对话框并返回路径。消息对话框 (showMessageBox) 常用来做「确认删除」「选择保存方式」等交互。"
  >
    <n-card size="small" title="打开文件" style="margin-bottom: 12px">
      <n-button type="primary" @click="openFile">选择文件…</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">{{
        openedFile
      }}</n-text>
    </n-card>

    <n-card size="small" title="保存文件" style="margin-bottom: 12px">
      <n-input v-model:value="saveFileName" placeholder="默认文件名" style="margin-bottom: 8px" />
      <n-button @click="saveFile">选择保存位置…</n-button>
      <n-text v-if="savedPath" depth="3" style="display: block; margin-top: 8px; font-size: 13px">{{
        savedPath
      }}</n-text>
    </n-card>

    <n-card size="small" title="消息对话框">
      <n-button @click="showMessage">弹出原生消息框</n-button>
      <n-text
        v-if="messageResult"
        depth="3"
        style="display: block; margin-top: 8px; font-size: 13px"
      >
        {{ messageResult }}
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/dialog.ts" :code="dialogCode" />
    </template>
  </FeatureLayout>
</template>
