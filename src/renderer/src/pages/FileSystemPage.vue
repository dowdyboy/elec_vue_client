<script setup lang="ts">
/**
 * 文件系统演示页
 * 演示：目录浏览 / 读写文件（经主进程 fs）+ 拖拽获取文件路径
 */
import { h, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NDataTable,
  useMessage,
  NAlert,
  NText,
  type DataTableColumns
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import fsCode from '../../../main/features/fileSystem.ts?raw'

const message = useMessage()

interface DirEntry {
  name: string
  isDirectory: boolean
}

// ── 目录浏览 ──
const currentDir = ref('')
const entries = ref<DirEntry[]>([])
const readError = ref('')

async function pickAndList(): Promise<void> {
  // 选择文件夹（properties: openDirectory 由主进程对话框支持，此处复用 openFile 简化演示）
  // 为教学简单，用"选择文件"并列出其所在目录
  const file = await window.api.dialog.openFile([{ name: '所有文件', extensions: ['*'] }])
  if (!file) return
  const parts = file.split(/[\\/]/)
  parts.pop() // 去掉文件名
  let dir = parts.join('\\')
  // 边界处理：盘符根目录（如 C:\file.txt → "C:"）补全反斜杠，否则相对路径解析错误
  if (/^[A-Za-z]:$/.test(dir)) dir += '\\'
  await listDir(dir)
}

async function listDir(dir: string): Promise<void> {
  const result = await window.api.fs.listDir(dir)
  if (!result.ok) {
    readError.value = result.error
    message.error(`读取失败: ${result.error}`)
    return
  }
  readError.value = ''
  currentDir.value = dir
  entries.value = result.data
}

async function enterDir(name: string): Promise<void> {
  const joined = await window.api.fs.joinPath(currentDir.value, name)
  await listDir(joined)
}

// ── 文件读写 ──
const readTarget = ref('')
const fileContent = ref('')
const writeContent = ref('')
const writeResult = ref('')

async function pickAndRead(): Promise<void> {
  const file = await window.api.dialog.openFile([
    { name: '文本文件', extensions: ['txt', 'md', 'json', 'log'] }
  ])
  if (!file) return
  readTarget.value = file
  const result = await window.api.fs.readFile(file)
  if (!result.ok) {
    message.error(`读取失败: ${result.error}`)
    return
  }
  fileContent.value = result.data
}

async function pickAndWrite(): Promise<void> {
  const path = await window.api.dialog.saveFile({ defaultName: 'electron-demo.txt' })
  if (!path) return
  const result = await window.api.fs.writeFile(path, writeContent.value)
  if (!result.ok) {
    message.error(`写入失败: ${result.error}`)
    return
  }
  writeResult.value = result.data
  message.success('写入成功')
}

// ── 拖拽文件真实路径（webUtils.getPathForFile）──
const droppedFiles = ref<string[]>([])

function onDrop(event: DragEvent): void {
  event.preventDefault()
  // webUtils.getPathForFile 由 preload 暴露：浏览器拖拽的 File 对象 → 系统真实路径
  const files = Array.from(event.dataTransfer?.files ?? [])
  droppedFiles.value = files.map((file) => window.api.fs.getPathForFile(file))
}

// ── 拖拽文件出窗口（webContents.startDrag）──
const dragOutFile = ref('')
const dragOutHint = ref('先在"文件读写"区读取一个文件，或直接选择')

async function pickDragFile(): Promise<void> {
  const file = await window.api.dialog.openFile([{ name: '所有文件', extensions: ['*'] }])
  if (!file) return
  dragOutFile.value = file
  dragOutHint.value = `拖动右侧图标，把文件拖到桌面或资源管理器`
}

function onDragFileStart(event: DragEvent): void {
  if (!dragOutFile.value) return
  // 必须设置拖拽数据，dragstart 才会生效
  event.dataTransfer?.setData('text/plain', dragOutFile.value)
  event.dataTransfer?.setData('DownloadURL', `file:${dragOutFile.value}`)
  // 关键：调用主进程的 webContents.startDrag 开始系统拖拽
  window.api.drag.start(dragOutFile.value)
}

// ── 系统文件图标（app.getFileIcon）──
const iconPath = ref('')
const iconDataUrl = ref('')
const iconHint = ref('')

async function getFileIcon(): Promise<void> {
  if (!iconPath.value) {
    message.warning('请输入文件路径')
    return
  }
  const res = await window.api.fileIcon.get(iconPath.value)
  if (!res.ok) {
    iconHint.value = `获取失败: ${res.error}`
    return
  }
  iconDataUrl.value = res.dataUrl
  iconHint.value = `已获取系统图标（文件名: ${iconPath.value.split(/[\\/]/).pop()}）`
}

// ── shell 文件操作（shellOps.ts）──
const shellFile = ref('')

async function pickShellFile(): Promise<void> {
  const file = await window.api.dialog.openFile([{ name: '所有文件', extensions: ['*'] }])
  if (file) shellFile.value = file
}

async function shellOpen(): Promise<void> {
  const res = await window.api.shell.openPath(shellFile.value)
  if (res.ok) message.success('已用系统默认程序打开')
  else message.error(res.error ?? '打开失败')
}

function showInFolder(): void {
  window.api.shell.showInFolder(shellFile.value)
}

async function shellTrash(): Promise<void> {
  const res = await window.api.shell.trash(shellFile.value)
  if (res.ok) {
    message.success('已移到回收站')
    shellFile.value = ''
  } else {
    message.error(res.error ?? '操作失败')
  }
}

function beep(): void {
  window.api.shell.beep()
}

// ── 目录监听（fs.watch）──
const watching = ref(false)
const watchDir = ref('')
const watchEvents = ref<{ time: string; eventType: string; filename: string }[]>([])
let watchId: number | null = null
let disposeWatch: (() => void) | null = null

async function pickWatchDir(): Promise<void> {
  // 用现有"选择文件并浏览目录"的流程取目录
  const file = await window.api.dialog.openFile([{ name: '所有文件', extensions: ['*'] }])
  if (!file) return
  const parts = file.split(/[\\/]/)
  parts.pop()
  let dir = parts.join('\\')
  if (/^[A-Za-z]:$/.test(dir)) dir += '\\'

  disposeWatch?.()
  const res = await window.api.fs.watch(dir)
  if (!res.ok) {
    message.error(res.error ?? '监听失败')
    return
  }
  watchId = res.id
  watchDir.value = dir
  watchEvents.value = []
  watching.value = true
  disposeWatch = window.api.fs.onWatcherEvent((raw) => {
    const data = raw as { id: number; eventType: string; filename: string; time: string }
    if (data.id !== watchId) return
    watchEvents.value.unshift({
      time: data.time,
      eventType: data.eventType,
      filename: data.filename
    })
    if (watchEvents.value.length > 30) watchEvents.value.pop()
  })
  message.success('开始监听目录变化')
}

async function stopWatch(): Promise<void> {
  if (watchId !== null) await window.api.fs.unwatch(watchId)
  disposeWatch?.()
  watching.value = false
  watchDir.value = ''
  watchId = null
}

// 页面卸载时清理：避免路由切换后 watcher 持续占用
onUnmounted(() => {
  disposeWatch?.()
  if (watchId !== null) {
    window.api.fs.unwatch(watchId)
    watchId = null
  }
})

// ── 表格列 ──
const columns: DataTableColumns<DirEntry> = [
  {
    title: '名称',
    key: 'name',
    render: (row) => (row.isDirectory ? `📁 ${row.name}` : `📄 ${row.name}`)
  },
  {
    title: '操作',
    key: 'action',
    width: 120,
    render: (row) =>
      row.isDirectory
        ? h(
            'a',
            { style: 'cursor: pointer; color: #2f7ef7', onClick: () => enterDir(row.name) },
            '进入'
          )
        : ''
  }
]
</script>

<template>
  <FeatureLayout
    title="文件系统"
    api="fs（Node.js 内置）"
    intro="渲染进程默认无法访问文件系统（安全隔离），所有文件操作通过 IPC 交给主进程执行。本页演示：目录浏览、文本文件读写、文件拖拽。生产工程请务必加路径白名单校验（防任意文件读写）。"
  >
    <n-card size="small" title="目录浏览" style="margin-bottom: 12px">
      <n-button type="primary" @click="pickAndList">选择文件并浏览其所在目录</n-button>
      <n-text v-if="currentDir" depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        当前目录: {{ currentDir }}
      </n-text>
      <n-data-table
        v-if="entries.length"
        :columns="columns"
        :data="entries"
        size="small"
        :bordered="false"
        style="margin-top: 8px"
      />
      <n-text
        v-if="readError"
        type="error"
        style="display: block; margin-top: 8px; font-size: 12px"
      >
        {{ readError }}
      </n-text>
    </n-card>

    <n-card size="small" title="文本文件读写" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px; margin-bottom: 8px">
        <n-button @click="pickAndRead">选择文本文件并读取</n-button>
        <n-button type="warning" @click="pickAndWrite">保存以下内容到文件</n-button>
      </div>
      <n-input
        v-model:value="writeContent"
        type="textarea"
        :rows="3"
        placeholder="要写入文件的内容（写之前可先编辑）"
      />
      <n-text v-if="readTarget" depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        已读取: {{ readTarget }}
      </n-text>
      <n-input
        v-if="fileContent"
        v-model:value="fileContent"
        type="textarea"
        :rows="4"
        style="margin-top: 8px"
      />
      <n-text
        v-if="writeResult"
        type="success"
        style="display: block; margin-top: 8px; font-size: 13px"
      >
        ✅ {{ writeResult }}
      </n-text>
    </n-card>

    <n-card size="small" title="文件拖拽（drag & drop + webUtils 真实路径）">
      <div class="drop-zone" @dragover.prevent @drop="onDrop">把文件拖到这里</div>
      <div v-if="droppedFiles.length" style="margin-top: 8px; font-size: 12px">
        <div v-for="(f, i) in droppedFiles" :key="i">📄 {{ f }}</div>
      </div>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        拖拽显示的是真实系统路径：preload 中通过 webUtils.getPathForFile(file) 获取 （浏览器只能拿到
        File 对象，拿不到路径）。拿到路径后可继续走 fs 读写 IPC。
      </n-alert>
    </n-card>

    <n-card size="small" title="拖拽文件出窗口（webContents.startDrag）" style="margin-top: 12px">
      <n-button size="small" @click="pickDragFile">选择文件</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">{{
        dragOutHint
      }}</n-text>
      <div v-if="dragOutFile" draggable="true" class="drag-out-item" @dragstart="onDragFileStart">
        📄 {{ dragOutFile.split(/[\\/]/).pop() }}
      </div>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        按住上面的文件项拖到桌面/资源管理器，即可复制文件到系统 —— 这依赖主进程的
        <code>webContents.startDrag({ file, icon })</code>。
      </n-alert>
    </n-card>

    <n-card size="small" title="系统文件图标（app.getFileIcon）" style="margin-top: 12px">
      <n-input
        v-model:value="iconPath"
        placeholder="输入文件路径，如 C:\Windows\notepad.exe"
        style="margin-bottom: 8px"
      />
      <n-button size="small" type="primary" @click="getFileIcon">获取系统图标</n-button>
      <div
        v-if="iconDataUrl"
        style="display: flex; align-items: center; gap: 12px; margin-top: 12px"
      >
        <img :src="iconDataUrl" alt="文件图标" style="width: 48px; height: 48px" />
        <n-text depth="3" style="font-size: 12px">{{ iconHint }}</n-text>
      </div>
      <n-text
        v-else-if="iconHint"
        depth="3"
        style="display: block; margin-top: 8px; font-size: 12px"
        >{{ iconHint }}</n-text
      >
    </n-card>

    <n-card
      size="small"
      title="文件操作（shell 模块，主进程: shellOps.ts）"
      style="margin-top: 12px"
    >
      <n-button size="small" type="primary" @click="pickShellFile">选择文件</n-button>
      <n-button size="small" style="margin-left: 8px" @click="beep">系统蜂鸣</n-button>
      <n-tag
        v-if="shellFile"
        size="small"
        type="info"
        round
        style="display: block; margin-top: 8px"
      >
        {{ shellFile }}
      </n-tag>
      <div v-if="shellFile" style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap">
        <n-button size="small" @click="shellOpen">打开文件</n-button>
        <n-button size="small" @click="showInFolder">在文件夹中显示</n-button>
        <n-button size="small" type="error" @click="shellTrash">移到回收站</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        shell 模块：openPath 用系统默认程序打开、showItemInFolder 资源管理器定位、 trashItem
        移到回收站（可恢复）。下载管理页的"打开/定位/回收站"按钮也是调它。
      </n-text>
    </n-card>

    <n-card size="small" title="目录监听（fs.watch）" style="margin-top: 12px">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-button size="small" type="primary" @click="pickWatchDir">选择目录并开始监听</n-button>
        <n-button size="small" type="error" :disabled="!watching" @click="stopWatch"
          >停止监听</n-button
        >
        <n-tag v-if="watching" size="small" type="success" round>监听中: {{ watchDir }}</n-tag>
      </div>
      <div
        v-if="watchEvents.length"
        style="margin-top: 8px; font-size: 12px; max-height: 150px; overflow-y: auto"
      >
        <div v-for="(e, i) in watchEvents" :key="i">
          👁 {{ e.time }} [{{ e.eventType }}] {{ e.filename }}
        </div>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        在资源管理器中往该目录新建/删除/修改文件，事件会实时推送（热同步/构建监视器场景）。
        Windows/macOS 支持递归监听子目录。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/fileSystem.ts" :code="fsCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.drag-out-item {
  margin-top: 8px;
  padding: 10px 14px;
  border: 1px dashed #2f7ef7;
  border-radius: 6px;
  font-size: 13px;
  cursor: grab;
  user-select: none;
  display: inline-block;
}
.drag-out-item:hover {
  background: rgba(47, 126, 247, 0.08);
}
</style>
