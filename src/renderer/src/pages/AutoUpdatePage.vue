<script setup lang="ts">
/**
 * 自动更新演示页
 * 演示：检查更新 / 下载 / 安装 完整链路（electron-updater）
 * 说明：dev 模式读取 dev-app-update.yml（example.com 必然失败，展示错误链路）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NAlert, useMessage, NText, NProgress, NTag } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import updateCode from '../../../main/features/autoUpdater.ts?raw'

const message = useMessage()

interface Status {
  type: string
  version?: string
  percent?: number
  message?: string
}

const versionInfo = ref({ name: '', version: '' })
const statusLog = ref<
  { time: string; text: string; kind: 'info' | 'success' | 'warning' | 'error' }[]
>([])
const progress = ref(0)

function append(text: string, kind: Status['type'] = 'info'): void {
  const map: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
    checking: 'info',
    available: 'warning',
    'not-available': 'info',
    progress: 'info',
    downloaded: 'success',
    error: 'error'
  }
  statusLog.value.unshift({
    time: new Date().toLocaleTimeString(),
    text,
    kind: map[kind] ?? 'info'
  })
}

let dispose: (() => void) | null = null
onMounted(async () => {
  versionInfo.value = await window.api.update.getVersion()
  dispose = window.api.update.onStatus((raw) => {
    const status = raw as Status
    switch (status.type) {
      case 'checking':
        append('正在检查更新...')
        break
      case 'available':
        append(`发现新版本 v${status.version}，可点击"下载更新"`)
        break
      case 'not-available':
        append(`已是最新版本（v${status.version ?? '未知'}）`)
        break
      case 'progress':
        progress.value = status.percent ?? 0
        append(`下载中: ${status.percent}%`)
        break
      case 'downloaded':
        append(`新版本 v${status.version} 下载完成，可点击"立即安装"`, 'downloaded')
        break
      case 'error':
        progress.value = 0
        append(`更新失败: ${status.message}`, 'error')
        message.error(`更新失败: ${status.message}`)
        break
    }
  })
})
onUnmounted(() => dispose?.())

async function check(): Promise<void> {
  await window.api.update.check()
}

async function download(): Promise<void> {
  await window.api.update.download()
}

function install(): void {
  window.api.update.install()
}
</script>

<template>
  <FeatureLayout
    title="自动更新"
    api="electron-updater"
    intro="生产应用的标配能力。原理：应用启动后向更新服务器查询版本，发现新版本则下载安装包，重启后完成更新。本工程已配置 generic provider（electron-builder.yml），dev 模式读取 dev-app-update.yml。教学说明：默认更新地址 example.com 必然失败，正好演示完整的错误处理链路。"
  >
    <n-card size="small" title="更新控制台" style="margin-bottom: 12px">
      <div
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px"
      >
        <n-tag type="info" round>当前版本: v{{ versionInfo.version }}</n-tag>
        <n-button type="primary" @click="check">① 检查更新</n-button>
        <n-button :disabled="progress > 0" @click="download">② 下载更新</n-button>
        <n-button type="warning" :disabled="progress <= 0 || progress < 100" @click="install"
          >③ 立即安装</n-button
        >
      </div>
      <n-progress
        v-if="progress > 0"
        type="line"
        :percentage="progress"
        :show-indicator="true"
        style="margin-bottom: 12px"
      />
      <div class="log-box">
        <div v-for="(log, i) in statusLog" :key="i" class="log-line">
          <n-tag size="tiny" :type="log.kind" round>{{ log.kind }}</n-tag>
          <span style="margin-left: 8px; font-size: 12px">{{ log.time }} {{ log.text }}</span>
        </div>
        <n-text v-if="!statusLog.length" depth="3" style="font-size: 12px">
          点击"检查更新"开始（默认地址会快速返回错误，属正常教学演示）
        </n-text>
      </div>
    </n-card>

    <n-alert type="info" :show-icon="true">
      <template #header>如何接上真实的更新服务器？</template>
      1. 在服务器放更新文件（latest.yml + 安装包，electron-builder 构建时生成）<br />
      2. 修改 <code>dev-app-update.yml</code>（开发）与
      <code>electron-builder.yml → publish.url</code>（生产）<br />
      3. 构建时自动把安装包上传到该地址 → 用户启动即自动检查更新
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/autoUpdater.ts" :code="updateCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.log-box {
  margin-top: 8px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px;
}
.log-line {
  padding: 2px 0;
}
</style>
