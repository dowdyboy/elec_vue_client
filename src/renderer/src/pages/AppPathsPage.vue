<script setup lang="ts">
/**
 * 应用数据目录演示页
 * 演示：app.getPath 全景、运行期 setPath（downloads）、setPath('userData') 的限制
 */
import { onMounted, ref } from 'vue'
import { NCard, NButton, NInput, NSpace, NAlert, NText, useMessage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import appPathsCode from '../../../main/features/appPaths.ts?raw'

const message = useMessage()

interface PathRow {
  key: string
  label: string
  note: string
  path: string
}

const rows = ref<PathRow[]>([])
const customDownloads = ref('')
const appInfo = ref<{ appPath: string; appName: string; appVersion: string } | null>(null)

async function loadAll(): Promise<void> {
  rows.value = await window.api.paths.getAll()
  appInfo.value = await window.api.paths.getAppPath()
}

onMounted(loadAll)

/** 运行期修改 downloads 目录（下载管理 download.ts 会落到新目录） */
async function setDownloads(): Promise<void> {
  if (!customDownloads.value.trim()) {
    message.warning('请输入新目录')
    return
  }
  const res = await window.api.paths.set('downloads', customDownloads.value.trim())
  if (res.ok) {
    message.success('已修改下载目录，去"下载管理"页下载文件验证')
    await loadAll()
  } else {
    message.error(res.error ?? '修改失败')
  }
}

/** 故意演示限制：userData 运行期不可修改（必须在 app ready 之前 setPath）
 *  注意：Electron 39 运行期 setPath 已不抛错（见 appPaths.ts 注释），
 *  这里返回的是本工程在 paths:set 通道做的"应用层拦截"——生产同样应自行拦截 */
async function trySetUserData(): Promise<void> {
  const res = await window.api.paths.set('userData', 'C:\\我的数据目录')
  if (res.ok) {
    message.success('拦截未生效？（不应出现——请检查 appPaths.ts 的 paths:set）')
    await loadAll()
  } else {
    message.error(`已被拦截: ${res.error}`)
  }
}
</script>

<template>
  <FeatureLayout
    title="应用数据目录（getPath / setPath）"
    api="app.getPath / app.setPath / app.getAppPath"
    intro="桌面应用的数据落点全貌：userData 放私有数据（SQLite 库、配置），cache/temp 放可清理的缓存，downloads/documents/desktop 放用户可见文件。Electron 提供 getPath/setPath 统一管理这些目录，跨平台自动映射——这是每个真实工程都要面对的'数据放哪里'问题。"
  >
    <n-card size="small" title="目录全景" style="margin-bottom: 12px">
      <n-alert type="info" size="small" :show-icon="true" style="margin-bottom: 8px">
        本工程的 sqlite.ts（app.db）、windowState.ts（window-state.json）都落在
        userData；sessionCleanup.ts 清理的是 cache。
      </n-alert>
      <table class="path-table">
        <thead>
          <tr>
            <th>目录</th>
            <th>实际路径</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <td>
              <b>{{ row.label }}</b> ({{ row.key }})
            </td>
            <td class="mono">{{ row.path }}</td>
            <td class="note">{{ row.note }}</td>
          </tr>
        </tbody>
      </table>
    </n-card>

    <n-card size="small" title="运行期 setPath 演示" style="margin-bottom: 12px">
      <n-space>
        <n-input
          v-model:value="customDownloads"
          placeholder="新的下载目录（绝对路径）"
          style="width: 360px"
        />
        <n-button type="primary" @click="setDownloads">修改 downloads 目录</n-button>
        <n-button @click="trySetUserData">尝试修改 userData（预期失败）</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        downloads 等目录运行期可改（影响 download.ts 默认落点）。userData 不同：Electron 39 运行期
        setPath 已不抛错（老版本的检查被移除），但会造成数据撕裂——getPath 返回新目录，而已初始化的
        Chromium 数据/数据库仍留在旧目录。因此生产必须在 ready
        前设置；本页按钮展示的是本工程的应用层拦截（见 appPaths.ts 源码）。
      </n-text>
    </n-card>

    <n-card size="small" title="应用自身信息">
      <n-text v-if="appInfo" style="font-size: 13px">
        应用名: {{ appInfo.appName }} · 版本: {{ appInfo.appVersion }}
        <br />
        代码目录: <span class="mono">{{ appInfo.appPath }}</span
        >（生产打包后为 resources/app.asar）
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/appPaths.ts" :code="appPathsCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.path-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.path-table th,
.path-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.path-table th {
  color: var(--text-color-2);
  font-weight: 600;
}
.mono {
  font-family: monospace;
  word-break: break-all;
}
.note {
  color: var(--text-color-3);
  max-width: 320px;
}
</style>
