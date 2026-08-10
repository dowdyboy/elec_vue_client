<script setup lang="ts">
/**
 * 剪贴板演示页
 * 演示：文本 / HTML 富文本 / 图片 的读写
 */
import { ref } from 'vue'
import { NCard, NButton, NInput, NSpace, useMessage, NImage, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import clipboardCode from '../../../main/features/clipboard.ts?raw'

const message = useMessage()

const text = ref('这是要写入剪贴板的文本')
const readText = ref('')
const html = ref('<b>加粗</b> 与 <i>斜体</i> 的富文本（可粘贴到 Word）')
const readHtml = ref('')
const imageDataUrl = ref('')

async function writeText(): Promise<void> {
  await window.api.clipboard.writeText(text.value)
  message.success('文本已写入剪贴板')
}

async function readClipboardText(): Promise<void> {
  readText.value = await window.api.clipboard.readText()
}

async function writeHtml(): Promise<void> {
  await window.api.clipboard.writeHtml(html.value)
  message.success('HTML 已写入剪贴板（试试粘贴到 Word/WPS）')
}

async function readClipboardHtml(): Promise<void> {
  readHtml.value = await window.api.clipboard.readHtml()
}

/** 用 canvas 生成一张演示图片 → dataURL → 写入剪贴板 */
function generateImage(): void {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 150
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const gradient = ctx.createLinearGradient(0, 0, 300, 150)
  gradient.addColorStop(0, '#2f7ef7')
  gradient.addColorStop(1, '#7c3aed')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 300, 150)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Electron 剪贴板', 150, 85)
  imageDataUrl.value = canvas.toDataURL('image/png')
}

async function writeImage(): Promise<void> {
  if (!imageDataUrl.value) {
    message.warning('请先点击"生成演示图片"')
    return
  }
  await window.api.clipboard.writeImage(imageDataUrl.value)
  message.success('图片已写入剪贴板（试试粘贴到聊天窗口）')
}

async function readClipboardImage(): Promise<void> {
  const dataUrl = await window.api.clipboard.readImage()
  if (dataUrl === 'data:image/png;base64,') {
    message.warning('剪贴板中没有图片')
    return
  }
  // 临时预览：把读到的图片塞进一个 img 元素
  const img = document.createElement('img')
  img.src = dataUrl
  img.style.maxWidth = '300px'
  img.style.display = 'block'
  img.style.marginTop = '8px'
  img.alt = '剪贴板图片'
  // 直接替换预览区
  const preview = document.getElementById('image-preview')
  if (preview) preview.innerHTML = ''
  document.getElementById('image-preview')?.appendChild(img)
  message.success('已读取剪贴板图片')
}

async function clearClipboard(): Promise<void> {
  await window.api.clipboard.clear()
  message.info('剪贴板已清空')
}
</script>

<template>
  <FeatureLayout
    title="剪贴板"
    api="clipboard"
    intro="Electron 的 clipboard 比浏览器 navigator.clipboard 更强：支持读写 HTML 富文本和图片，且由主进程统一管理权限（见安全实践页的权限白名单）。本页演示文本 / 富文本 / 图片三种格式的读写。"
  >
    <n-card size="small" title="文本" style="margin-bottom: 12px">
      <n-input v-model:value="text" style="margin-bottom: 8px" />
      <n-space>
        <n-button type="primary" @click="writeText">写入剪贴板</n-button>
        <n-button @click="readClipboardText">读取剪贴板</n-button>
      </n-space>
      <n-text v-if="readText" depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        读到的内容: {{ readText }}
      </n-text>
    </n-card>

    <n-card size="small" title="HTML 富文本" style="margin-bottom: 12px">
      <n-input v-model:value="html" style="margin-bottom: 8px" />
      <n-space>
        <n-button @click="writeHtml">写入（含格式）</n-button>
        <n-button @click="readClipboardHtml">读取源码</n-button>
      </n-space>
      <n-text v-if="readHtml" depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        读到的 HTML: {{ readHtml }}
      </n-text>
    </n-card>

    <n-card size="small" title="图片">
      <n-space>
        <n-button @click="generateImage">生成演示图片</n-button>
        <n-button type="warning" :disabled="!imageDataUrl" @click="writeImage"
          >图片写入剪贴板</n-button
        >
        <n-button @click="readClipboardImage">读取剪贴板图片</n-button>
        <n-button @click="clearClipboard">清空剪贴板</n-button>
      </n-space>
      <div v-if="imageDataUrl" style="margin-top: 8px">
        <n-image :src="imageDataUrl" width="300" />
      </div>
      <div id="image-preview" />
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/clipboard.ts" :code="clipboardCode" />
    </template>
  </FeatureLayout>
</template>
