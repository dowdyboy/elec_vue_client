<script setup lang="ts">
/**
 * 下载管理演示页
 * 演示：下载进度/暂停/恢复/取消 + 完成后 shell 文件操作联动
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NProgress,
  NSpace,
  useMessage,
  NText,
  NTag,
  NAlert
} from 'naive-ui'
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

const url = ref('http://127.0.0.1:8765/download?size=20')
const downloads = ref<DownloadRow[]>([])
const log = ref<string[]>([])
const serverStarting = ref(false)

/** 预设下载地址（自闭环本地源 > 外网演示源） */
const presetUrls = [
  { label: '本地 20MB（约3秒，可演示暂停/恢复）', value: 'http://127.0.0.1:8765/download?size=20' },
  {
    label: '本地 50MB（无延迟，测大文件）',
    value: 'http://127.0.0.1:8765/download?size=50&delay=0'
  },
  {
    label: 'Hetzner 10MB（外网，国内可能 interrupted）',
    value: 'https://speed.hetzner.de/10MB.bin'
  }
]

/** 自闭环下载源：复用 httpServer.ts 的本地服务器（/download 端点，见 docs/22） */
async function startLocalServer(): Promise<void> {
  serverStarting.value = true
  try {
    const res = await window.api.httpServer.start(8765)
    if (res.ok) message.success(`本地下载服务器已启动（端口 ${res.port}）`)
    else message.info(res.error ?? '启动失败')
  } finally {
    serverStarting.value = false
  }
}

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

/** 仅更新已有行的状态（upsert 会合并整行，不适用于只有 id+state 的推送） */
function setState(id: string, state: string): void {
  const index = downloads.value.findIndex((d) => d.id === id)
  if (index >= 0) downloads.value[index] = { ...downloads.value[index], state }
}

async function startDownload(): Promise<void> {
  if (!url.value) {
    message.warning('请输入下载 URL')
    return
  }
  const res = await window.api.download.start(url.value)
  if (!res.ok) message.error(res.error ?? '启动失败')
  else message.success('下载已开始（保存到系统下载目录，可在"数据目录"页修改）')
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
onMounted(async () => {
  // 回放主进程缓存（活动 + 历史）：此前完成的下载（如媒体捕获页"保存录屏"）
  // 不会因页面未挂载而丢失；按完成时间升序 upsert，最新记录落在列表顶部
  const records = (await window.api.download.list()) as Array<DownloadRow & { finishedAt?: number }>
  records
    .slice()
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .forEach((r) => upsert(r))
  disposers.push(
    window.api.download.onProgress((raw) => {
      const data = raw as DownloadRow & { state: 'progressing' | 'interrupted' }
      upsert(data)
    })
  )
  disposers.push(
    // 暂停/恢复状态推送：Electron 的 updated 事件不映射 paused（会收到空串），
    // 主进程在 pause/resume 成功后经 download:state 通道主动推送（见 download.ts）
    window.api.download.onState((data) => {
      setState(data.id, data.state)
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
        <n-input v-model:value="url" placeholder="下载 URL" />
        <n-button type="primary" @click="startDownload">开始下载</n-button>
        <n-button :loading="serverStarting" @click="startLocalServer">启动本地下载服务器</n-button>
      </div>
      <n-space style="margin-top: 8px">
        <n-button
          v-for="preset in presetUrls"
          :key="preset.value"
          size="small"
          secondary
          @click="url = preset.value"
        >
          {{ preset.label }}
        </n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        自闭环推荐：先点「启动本地下载服务器」再下载默认地址（主进程 /download 端点，可调大小与
        速度，支持 Range → 暂停/恢复可实测）。状态 interrupted = 网络不可达，国内访问外网演示源
        （Hetzner）常见。默认保存到系统下载目录（app.getPath('downloads')，可在"数据目录"页修改）。
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
            <n-button
              size="tiny"
              :disabled="!['paused', 'interrupted'].includes(row.state)"
              @click="resume(row.id)"
              >恢复</n-button
            >
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
