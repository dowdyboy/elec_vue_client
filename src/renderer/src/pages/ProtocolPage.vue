<script setup lang="ts">
/**
 * 自定义协议 + 深链接 + 内嵌网页 演示页
 * 演示：elec-demo:// 协议唤起应用、WebContentsView 内嵌第三方网页
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, NAlert, useMessage, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import protocolCode from '../../../main/features/protocol.ts?raw'

const message = useMessage()

const deepLinkInput = ref('elec-demo://open?from=web')
const deepLinkLog = ref<{ url: string; time: string }[]>([])
const viewUrl = ref('https://example.com')
const viewOpen = ref(false)

// ── 文件关联（open-file）──
const fileOpenInput = ref('C:\\Users\\Public\\示例文档.md')
const fileOpenLog = ref<{ time: string; path: string }[]>([])

function simulateOpenFile(): void {
  window.api.protocol.simulateOpenFile(fileOpenInput.value)
}

function openBySystem(): void {
  // 用系统默认程序打开该协议链接 → 唤起本应用（触发深链接）
  window.api.protocol.openUrl(deepLinkInput.value)
  message.info('已用系统打开链接，本应用将被唤起')
}

async function openView(): Promise<void> {
  if (!viewUrl.value) return
  const res = await window.api.protocol.openView(viewUrl.value)
  if (res.ok) {
    viewOpen.value = true
    message.info('已内嵌网页（覆盖窗口内容，关闭内嵌后可继续操作）')
  } else {
    message.error(res.error ?? '打开失败')
  }
}

async function closeView(): Promise<void> {
  await window.api.protocol.closeView()
  viewOpen.value = false
}

// ── 导航历史（did-navigate 状态推送）──
const navState = ref({ url: '', canGoBack: false, canGoForward: false })

// ── 加载状态监控（loadState.ts）──
interface LoadLog {
  state: string
  time: string
  url: string
  errorDescription?: string
}
const loadLogs = ref<LoadLog[]>([])

const loadTagType = (state: string): 'success' | 'error' | 'warning' | 'info' => {
  if (state === 'loaded') return 'success'
  if (state === 'failed') return 'error'
  if (state === 'loading') return 'warning'
  return 'info'
}

// ── 脚本注入（scriptInjection.ts）──
const injectCode = ref("document.title = '被注入的标题'")
const injectResult = ref('')

async function runInject(): Promise<void> {
  const res = await window.api.inject.execute(injectCode.value)
  injectResult.value = res.ok ? `✅ 执行成功，返回值: ${res.result}` : `❌ ${res.error}`
}

let dispose: (() => void) | null = null
let disposeFile: (() => void) | null = null
let disposeViewClosed: (() => void) | null = null
let disposeNav: (() => void) | null = null
let disposeLoad: (() => void) | null = null
onMounted(() => {
  dispose = window.api.protocol.onDeepLink((url) => {
    deepLinkLog.value.unshift({ url, time: new Date().toLocaleTimeString() })
    message.success(`收到深链接: ${url}`)
  })
  disposeFile = window.api.protocol.onFileOpen((path) => {
    fileOpenLog.value.unshift({ path, time: new Date().toLocaleTimeString() })
    message.info(`收到文件打开请求: ${path}`)
  })
  disposeViewClosed = window.api.protocol.onViewClosed(() => {
    viewOpen.value = false
  })
  disposeNav = window.api.protocol.onNavigation((data) => {
    navState.value = data
  })
  disposeLoad = window.api.web.onLoadState((raw) => {
    const data = raw as LoadLog
    loadLogs.value.unshift(data)
    if (loadLogs.value.length > 20) loadLogs.value.pop()
  })
})
onUnmounted(() => {
  dispose?.()
  disposeFile?.()
  disposeViewClosed?.()
  disposeNav?.()
  disposeLoad?.()
})
</script>

<template>
  <FeatureLayout
    title="自定义协议与深链接"
    api="app.setAsDefaultProtocolClient / WebContentsView"
    intro="深链接：注册自定义协议（如 elec-demo://）后，系统/网页/邮件里的该协议链接可以唤起应用，类似 weixin://、magnet://。WebContentsView 是应用窗口内嵌第三方网页的标准组件（替代已废弃的 BrowserView）。"
  >
    <n-card size="small" title="① 深链接演示" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="deepLinkInput" />
        <n-button type="primary" @click="openBySystem">用系统打开（唤起本应用）</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        也可以手动测试：Win+R 输入 <code>elec-demo://hello?from=winr</code> 回车。
        应用会被唤起并聚焦，收到的链接显示在下方：
      </n-text>
      <div v-if="deepLinkLog.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(log, i) in deepLinkLog" :key="i">🔗 {{ log.time }} {{ log.url }}</div>
      </div>
    </n-card>

    <n-card size="small" title="② 内嵌第三方网页（WebContentsView）">
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="viewUrl" placeholder="要内嵌的网址，如 https://example.com" />
        <n-button type="primary" :disabled="viewOpen" @click="openView">内嵌打开</n-button>
        <n-button :disabled="!viewOpen" @click="closeView">关闭内嵌</n-button>
      </div>
      <n-alert type="warning" :show-icon="true" style="margin-top: 8px" size="small">
        内嵌视图会铺满整个窗口并覆盖当前内容；**按 ESC 键**或点击"关闭内嵌"退出。
        外链页面与主窗口互相隔离（独立渲染进程）。
      </n-alert>
      <div style="margin-top: 8px; font-size: 12px">
        <n-text depth="3"
          >导航历史（内嵌时按 <code>Alt+←</code> 返回 / <code>Alt+→</code> 前进）：</n-text
        >
        <div v-if="navState.url" style="margin-top: 4px">
          <n-tag size="tiny" type="info" round
            >可返回: {{ navState.canGoBack ? '是' : '否' }}</n-tag
          >
          <n-tag size="tiny" type="info" round style="margin-left: 6px"
            >可前进: {{ navState.canGoForward ? '是' : '否' }}</n-tag
          >
          <div style="margin-top: 4px; word-break: break-all">{{ navState.url }}</div>
        </div>
      </div>
    </n-card>

    <n-card size="small" title="③ 文件关联（open-file）" style="margin-top: 12px">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-input
          v-model:value="fileOpenInput"
          placeholder="文件路径（模拟双击文件唤起应用）"
          style="width: 320px"
        />
        <n-button @click="simulateOpenFile">模拟打开文件</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        打包时在 electron-builder.yml 配置 <code>fileAssociations</code> 声明文件类型， 用户双击
        .md/.txt 文件即唤起应用并触发 open-file 事件（macOS）或
        启动参数携带路径（Windows/Linux）。收到的文件显示在下方：
      </n-text>
      <div v-if="fileOpenLog.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(log, i) in fileOpenLog" :key="i">📂 {{ log.time }} {{ log.path }}</div>
      </div>
    </n-card>

    <n-card size="small" title="④ 页面加载状态监控（loadState.ts）" style="margin-top: 12px">
      <div v-if="loadLogs.length" style="font-size: 12px; max-height: 140px; overflow-y: auto">
        <div v-for="(log, i) in loadLogs" :key="i">
          <n-tag size="tiny" :type="loadTagType(log.state)" round>{{ log.state }}</n-tag>
          <span style="margin-left: 6px">{{ log.time }} {{ log.url.slice(0, 60) }}</span>
          <span v-if="log.errorDescription" style="color: #e5484d"
            >（{{ log.errorDescription }}）</span
          >
        </div>
      </div>
      <n-text v-else depth="3" style="font-size: 12px"
        >暂无记录——"内嵌打开"网页时可看到 loading → loaded 事件</n-text
      >
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        did-start-loading / did-finish-load /
        did-fail-load：用于加载指示器与失败错误页（断网时加载失败会显示 failed）。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="⑤ 脚本注入（webContents.executeJavaScript）"
      style="margin-top: 12px"
    >
      <div style="display: flex; gap: 8px">
        <n-input
          v-model:value="injectCode"
          placeholder="JS 表达式，如 document.title = '被注入的标题'"
        />
        <n-button type="primary" @click="runInject">执行</n-button>
      </div>
      <n-text v-if="injectResult" style="display: block; margin-top: 8px; font-size: 12px">{{
        injectResult
      }}</n-text>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        主进程可在任意时刻向页面执行脚本并取回结果（调试/自动化/埋点）。 试试
        <code>document.querySelector('.feature-title')?.textContent</code> 读取页面内容； 对内嵌
        WebContentsView 页面同样适用。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/protocol.ts" :code="protocolCode" />
    </template>
  </FeatureLayout>
</template>
