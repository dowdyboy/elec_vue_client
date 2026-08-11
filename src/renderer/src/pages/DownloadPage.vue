<script setup lang="ts">
/**
 * 下载管理演示页
 * 演示：下载进度/暂停/恢复/取消 + 完成后 shell 文件操作联动
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, NProgress, useMessage, NText, NTag, NAlert } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import downloadCode from '../../../main/features/download.ts?raw'

const message = useMessage()

interface DownloadRow {
  id: string
  url: string
  filename: string
  state: string
  percent: number
  receivedBytes: number
  totalBytes: number
  savePath: string
}

const url = ref('https://speed.hetzner.de/10MB.bin')
const downloads = ref<DownloadRow[]>([])
const log = ref<string[]>([])

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

function upsert(row: DownloadRow): void {
  const index = downloads.value.findIndex((d) => d.id === row.id)
  if (index >= 0) downloads.value[index] = { ...downloads.value[index], ...row }
  else downloads.value.unshift(row)
}

async function startDownload(): Promise<void> {
  if (!url.value) {
    message.warning('请输入下载 URL')
    return
  }
  const res = await window.api.download.start(url.value)
  if (!res.ok) message.error(res.error ?? '启动失败')
  else message.success('下载已开始（默认保存到 userData/downloads）')
}

async function pause(id: string): Promise<void> {
  const res = await window.api.download.pause(id)
  if (!res.ok) message.warning(res.error ?? '无法暂停')
}

async function resume(id: string): Promise<void> {
  const res = await window.api.download.resume(id)
  if (!res.ok) message.warning(res.error ?? '无法恢复')
}

async function cancel(id: string): Promise<void> {
  await window.api.download.cancel(id)
}

// ── 完成后联动 shell 操作 ──
async function openFile(row: DownloadRow): Promise<void> {
  await window.api.shell.openPath(row.savePath)
}
async function showInFolder(row: DownloadRow): Promise<void> {
  await window.api.shell.showInFolder(row.savePath)
}
async function trashFile(row: DownloadRow): Promise<void> {
  const res = await window.api.shell.trash(row.savePath)
  if (res.ok) {
    message.success('已移到回收站')
    downloads.value = downloads.value.filter((d) => d.id !== row.id)
  } else {
    message.error(res.error ?? '操作失败')
  }
}

let disposers: (() => void)[] = []
onMounted(() => {
  disposers.push(
    window.api.download.onProgress((raw) => {
      const data = raw as DownloadRow & { state: 'progressing' | 'interrupted' }
      upsert(data)
    })
  )
  disposers.push(
    window.api.download.onDone((raw) => {
      const data = raw as {
        id: string
        url: string
        filename: string
        state: string
        savePath: string
      }
      upsert({
        id: data.id,
        url: data.url,
        filename: data.filename,
        state: data.state,
        percent: data.state === 'completed' ? 100 : 0,
        receivedBytes: 0,
        totalBytes: 0,
        savePath: data.savePath
      })
      log.value.unshift(
        `${new Date().toLocaleTimeString()} 下载结束: ${data.filename} (${data.state})`
      )
      if (data.state === 'completed') {
        message.success(`下载完成: ${data.filename}`)
      }
    })
  )
})
onUnmounted(() => disposers.forEach((d) => d()))

const stateTag = (state: string): 'success' | 'warning' | 'error' | 'info' => {
  if (state === 'completed') return 'success'
  if (state === 'progressing' || state === 'interrupted') return 'warning'
  if (state === 'cancelled') return 'error'
  return 'info'
}
</script>

<template>
  <FeatureLayout
    title="下载管理"
    api="session / DownloadItem"
    intro="桌面应用下载功能的标准实现：will-download 事件在每次下载开始时触发（可设置保存路径），DownloadItem 提供进度/暂停/恢复/取消能力。下载走 Chromium 网络栈，可被 webRequest 拦截（见会话管理页）。本页下载完成后可联动 shell 操作（打开/定位/回收站）。"
  >
    <n-card size="small" title="开始下载" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px">
        <n-input
          v-model:value="url"
          placeholder="下载 URL（如 https://speed.hetzner.de/10MB.bin）"
        />
        <n-button type="primary" @click="startDownload">开始下载</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        默认保存到 userData/downloads 目录（不弹保存框，教学更顺滑）；
        可换任意直链测试，无网络时下载会以 interrupted 结束（同样是真实的失败链路）。
      </n-text>
    </n-card>

    <n-card size="small" title="下载列表">
      <div v-if="downloads.length" style="display: flex; flex-direction: column; gap: 12px">
        <div v-for="row in downloads" :key="row.id" class="dl-row">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px">
            <n-text style="font-size: 13px; word-break: break-all">{{ row.filename }}</n-text>
            <n-tag size="small" :type="stateTag(row.state)" round>{{ row.state }}</n-tag>
          </div>
          <n-progress
            type="line"
            :percentage="row.percent"
            :show-indicator="true"
            style="margin-top: 6px"
          />
          <n-text depth="3" style="font-size: 11px">
            {{ formatBytes(row.receivedBytes) }} / {{ formatBytes(row.totalBytes) }} · 保存于
            {{ row.savePath }}
          </n-text>
          <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap">
            <n-button size="tiny" :disabled="row.state !== 'progressing'" @click="pause(row.id)"
              >暂停</n-button
            >
            <n-button size="tiny" @click="resume(row.id)">恢复</n-button>
            <n-button size="tiny" :disabled="row.state === 'completed'" @click="cancel(row.id)"
              >取消</n-button
            >
            <n-button
              size="tiny"
              type="success"
              :disabled="row.state !== 'completed'"
              @click="openFile(row)"
            >
              打开文件
            </n-button>
            <n-button size="tiny" :disabled="row.state !== 'completed'" @click="showInFolder(row)">
              在文件夹中显示
            </n-button>
            <n-button
              size="tiny"
              type="error"
              :disabled="row.state !== 'completed'"
              @click="trashFile(row)"
            >
              移到回收站
            </n-button>
          </div>
        </div>
      </div>
      <n-text v-else depth="3" style="font-size: 12px">暂无下载，输入 URL 开始</n-text>
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      下载完成后三个操作按钮（打开/定位/回收站）演示的是 shell
      模块能力，见文件系统页的"文件操作"卡片。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/download.ts" :code="downloadCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.dl-row {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
}
</style>
