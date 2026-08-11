<script setup lang="ts">
/**
 * 打印演示页
 * 演示：printToPDF 将当前页面导出为 PDF 文件
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, useMessage, NAlert, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import printCode from '../../../main/features/print.ts?raw'

const message = useMessage()
const fileName = ref('Electron教学-页面.pdf')
const result = ref('')
const loading = ref(false)
const pdfPath = ref('')
const pdfViewed = ref(false)

async function exportPdf(): Promise<void> {
  loading.value = true
  const res = await window.api.print.toPdf({ defaultName: fileName.value })
  loading.value = false
  if (!res.ok) {
    result.value = `导出取消或失败: ${res.error ?? ''}`
    return
  }
  result.value = `✅ 已导出: ${res.path}（${(res.size / 1024).toFixed(1)} KB）`
  pdfPath.value = res.path
  message.success('PDF 导出成功')
}

/** 用 WebContentsView 加载 PDF（file:// URL，Chromium 内置 PDF 查看器） */
async function viewPdf(): Promise<void> {
  if (!pdfPath.value) return
  // encodeURI 处理中文/特殊字符路径（仅编码文件名部分，保留 /）
  const encoded = pdfPath.value
    .split(/[\\/]/)
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join('/')
  const fileUrl = 'file:///' + encoded
  const res = await window.api.protocol.openView(fileUrl)
  if (res.ok) {
    pdfViewed.value = true
    message.info('已在窗口内打开 PDF（按 ESC 或点击"关闭 PDF 视图"返回本页）')
  } else {
    message.error(res.error ?? '打开失败')
  }
}

// ESC 关闭视图时同步按钮状态
let disposeViewClosed: (() => void) | null = null
onMounted(() => {
  disposeViewClosed = window.api.protocol.onViewClosed(() => {
    pdfViewed.value = false
  })
})
onUnmounted(() => disposeViewClosed?.())

async function closePdfView(): Promise<void> {
  await window.api.protocol.closeView()
  pdfViewed.value = false
}
</script>

<template>
  <FeatureLayout
    title="打印 / 导出 PDF"
    api="webContents.printToPDF"
    intro="把窗口内容导出为 PDF：printToPDF 返回 PDF 二进制（Buffer），配合保存对话框落盘。若需直接调用系统打印机，使用 webContents.print()（参数类似：silent、printBackground 等）。报表、票据、网页存档类应用常用。"
  >
    <n-card size="small" title="导出当前页面为 PDF">
      <n-input v-model:value="fileName" placeholder="文件名" style="margin-bottom: 8px" />
      <n-button type="primary" :loading="loading" @click="exportPdf"
        >生成 PDF（整个页面内容）</n-button
      >
      <n-text v-if="result" style="display: block; margin-top: 8px; font-size: 13px">{{
        result
      }}</n-text>
    </n-card>

    <n-card size="small" title="在窗口内查看 PDF（内置 PDF 查看器）" style="margin-top: 12px">
      <n-text depth="3" style="display: block; margin-bottom: 8px; font-size: 13px">
        先生成 PDF，再点击查看：通过 WebContentsView 加载 file:// PDF， Chromium 内置 PDF
        查看器直接渲染（缩放/翻页/打印）。**按 ESC 键**或点击按钮关闭后回到本页。
      </n-text>
      <n-button type="warning" :disabled="!pdfPath" @click="viewPdf">在窗口内查看 PDF</n-button>
      <n-button :disabled="!pdfViewed" style="margin-left: 8px" @click="closePdfView"
        >关闭 PDF 视图</n-button
      >
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      <template #header>演示说明</template>
      生成的 PDF 包含本页全部内容（A4、含背景色）。生产应用中，
      通常先创建一个隐藏窗口加载专用"报表模板"页面，再对那个窗口调用 printToPDF。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/print.ts" :code="printCode" />
    </template>
  </FeatureLayout>
</template>
