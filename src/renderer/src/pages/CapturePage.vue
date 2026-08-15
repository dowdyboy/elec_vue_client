<script setup lang="ts">
/**
 * 桌面捕获演示页
 * 演示：枚举屏幕/窗口源（缩略图）、截取当前窗口、保存 PNG
 */
import { ref } from 'vue'
import { NCard, NButton, NAlert, useMessage, NText, NImage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import captureCode from '../../../main/features/desktopCapture.ts?raw'

const message = useMessage()

interface SourceItem {
  id: string
  name: string
  thumbnail: string | null
  displayId: string
}

const sources = ref<SourceItem[]>([])
const captured = ref('')
const loading = ref(false)

async function getSources(): Promise<void> {
  loading.value = true
  sources.value = await window.api.capture.getSources()
  loading.value = false
  message.success(`枚举到 ${sources.value.length} 个屏幕/窗口源`)
}

async function captureWindow(): Promise<void> {
  const res = await window.api.capture.capturePage()
  if (!res.ok) {
    message.error(res.error ?? '截图失败')
    return
  }
  captured.value = res.dataUrl
  message.success('已截取当前窗口')
}

async function saveCapture(): Promise<void> {
  if (!captured.value) return
  const res = await window.api.capture.savePng(captured.value)
  if (res.ok) {
    message.success(`已保存: ${res.path}`)
  } else {
    message.error(res.error ?? '保存失败')
  }
}
</script>

<template>
  <FeatureLayout
    title="桌面捕获"
    api="desktopCapturer / webContents.capturePage"
    intro="desktopCapturer 枚举系统所有屏幕与窗口源（带缩略图），是录屏、屏幕共享类应用（OBS、视频会议）的基础；capturePage 截取当前窗口内容。注意：展示桌面共享/录屏需要 getDisplayMedia 类的持续捕获（完整链路见「媒体捕获」页），本页演示静态截图链路。"
  >
    <n-card size="small" title="① 枚举屏幕 / 窗口源" style="margin-bottom: 12px">
      <n-button type="primary" :loading="loading" @click="getSources">获取屏幕源</n-button>
      <div
        v-if="sources.length"
        style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px"
      >
        <div v-for="src in sources" :key="src.id" style="text-align: center">
          <n-image
            v-if="src.thumbnail"
            :src="src.thumbnail"
            width="160"
            :fallback-src="undefined"
            style="border-radius: 6px; border: 1px solid var(--border-color)"
          />
          <div
            v-else
            style="
              width: 160px;
              height: 90px;
              border-radius: 6px;
              border: 1px solid var(--border-color);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <n-text depth="3" style="font-size: 11px">无缩略图</n-text>
          </div>
          <n-text
            depth="3"
            style="
              display: block;
              font-size: 12px;
              max-width: 160px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            "
          >
            {{ src.name }}
          </n-text>
        </div>
      </div>
      <n-text
        v-else-if="!loading"
        depth="3"
        style="display: block; margin-top: 8px; font-size: 12px"
      >
        点击按钮查看所有屏幕与打开的窗口（缩略图为 320×180）
      </n-text>
    </n-card>

    <n-card size="small" title="② 截取当前窗口并保存">
      <n-button type="warning" @click="captureWindow">截取当前窗口</n-button>
      <n-button type="primary" :disabled="!captured" style="margin-left: 8px" @click="saveCapture">
        保存为 PNG
      </n-button>
      <div v-if="captured" style="margin-top: 12px">
        <n-image :src="captured" width="480" />
      </div>
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      <template #header>安全提示</template>
      Windows 上录屏/捕获存在系统级权限限制；本页的缩略图与窗口截图在教学场景够用。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/desktopCapture.ts" :code="captureCode" />
    </template>
  </FeatureLayout>
</template>
