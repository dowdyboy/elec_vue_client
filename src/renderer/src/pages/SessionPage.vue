<script setup lang="ts">
/**
 * 网络会话管理演示页
 * 演示：① Cookie 读写删 ② webRequest 请求拦截 ③ 自定义协议内容（protocol.handle）
 */
import { h, onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NDataTable,
  useMessage,
  NText,
  NTag,
  NAlert,
  NSpace,
  type DataTableColumns
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import cookiesCode from '../../../main/features/cookies.ts?raw'
import webRequestCode from '../../../main/features/webRequest.ts?raw'
import protocolContentCode from '../../../main/features/protocolContent.ts?raw'

const message = useMessage()

// ── ① Cookie 管理 ──
interface CookieRow {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate: number | null
}

const cookies = ref<CookieRow[]>([])
const cookieUrl = ref('https://example.com')
const cookieName = ref('session_id')
const cookieValue = ref('demo-12345')

const cookieColumns: DataTableColumns<CookieRow> = [
  { title: '名称', key: 'name', width: 120 },
  { title: '值', key: 'value', ellipsis: { tooltip: true } },
  { title: '域名', key: 'domain', width: 140 },
  {
    title: '过期',
    key: 'expirationDate',
    width: 90,
    render: (r) =>
      r.expirationDate ? new Date(r.expirationDate * 1000).toLocaleDateString() : '会话级'
  },
  {
    title: '操作',
    key: 'action',
    width: 80,
    render: (row) =>
      h(
        'a',
        { style: 'cursor: pointer; color: #e5484d', onClick: () => removeCookie(row.name) },
        '删除'
      )
  }
]

async function loadCookies(): Promise<void> {
  cookies.value = await window.api.session.getAllCookies()
}

async function addCookie(): Promise<void> {
  const res = await window.api.session.setCookie({
    url: cookieUrl.value,
    name: cookieName.value,
    value: cookieValue.value
  })
  if (!res.ok) {
    message.error(res.error ?? '设置失败（注意 url 需带协议，如 https://example.com）')
    return
  }
  message.success('Cookie 已写入')
  await loadCookies()
}

async function removeCookie(name: string): Promise<void> {
  await window.api.session.removeCookie({ url: cookieUrl.value, name })
  message.info(`已删除 Cookie: ${name}`)
  await loadCookies()
}

// ── ② webRequest 请求拦截 ──
// 默认用本地自闭环下载源（httpServer.ts 的 /download 端点），避免外网源不可达
const interceptUrl = ref('http://127.0.0.1:8765/download?size=1')
const requestLogs = ref<{ time: string; method: string; url: string; injected: boolean }[]>([])
const interceptPresets = [
  { label: '本地 1MB（自闭环，推荐）', value: 'http://127.0.0.1:8765/download?size=1' },
  { label: 'Hetzner 1MB（外网，可能不可达）', value: 'https://speed.hetzner.de/1MB.bin' }
]
const localServerRunning = ref(false)
const serverStarting = ref(false)

async function startLocalServer(): Promise<void> {
  serverStarting.value = true
  try {
    const res = await window.api.httpServer.start(8765)
    if (res.ok) {
      localServerRunning.value = true
      message.success(`本地下载服务器已启动（端口 ${res.port}）`)
    } else if (!res.error?.includes('已在运行')) {
      message.info(res.error ?? '启动失败')
    }
  } finally {
    serverStarting.value = false
  }
}

function triggerRequest(): void {
  // 通过下载触发 Chromium 栈请求（主进程 axios 不走 Chromium 栈，拦不到）
  if (interceptUrl.value.includes('127.0.0.1') && !localServerRunning.value) {
    message.warning('本地源需要先启动服务器（点击上方「启动本地服务器」）')
    return
  }
  window.api.download.start(interceptUrl.value)
  message.info('已触发下载请求（下载也会被 webRequest 记录）')
}

// ── ③ 自定义协议内容 ──
const virtualResult = ref('')
const virtualLoading = ref(false)

async function readVirtual(path: string): Promise<void> {
  virtualLoading.value = true
  try {
    virtualResult.value = await window.api.protocolContent.read(path)
  } catch (error) {
    virtualResult.value = `❌ 读取失败: ${error instanceof Error ? error.message : String(error)}`
  }
  virtualLoading.value = false
}

// ── ④ 会话缓存清理（sessionCleanup.ts）──
async function clearCache(): Promise<void> {
  await window.api.session.clearCache()
  message.success('HTTP 缓存已清理')
}

async function clearStorage(): Promise<void> {
  await window.api.session.clearStorage()
  message.success('存储数据已清理（Cookie/localStorage/IndexedDB）')
}

async function clearAll(): Promise<void> {
  await window.api.session.clearAll()
  message.success('全部会话数据已清空')
}

// ── ⑤ 代理与 UA（sessionConfig.ts）──
const proxyRules = ref('http=127.0.0.1:7897;https=127.0.0.1:7897')
const proxyResult = ref('')
const uaInput = ref('')
const uaResult = ref('')

async function setProxy(): Promise<void> {
  const res = await window.api.sessionConfig.setProxy(proxyRules.value)
  if (res.ok) {
    proxyResult.value = `✅ 已应用代理: ${proxyRules.value}`
    message.success('代理已应用（没有真实代理服务时请求会失败，属预期）')
  } else {
    proxyResult.value = `❌ ${res.error}`
  }
}

async function setProxyDirect(): Promise<void> {
  await window.api.sessionConfig.setProxyMode('direct')
  proxyResult.value = '已恢复直连（不再走代理）'
  message.success('已恢复直连')
}

async function resolveProxy(): Promise<void> {
  const res = await window.api.sessionConfig.resolveProxy('https://example.com')
  proxyResult.value = res.ok ? `https://example.com → ${res.proxy}` : `❌ ${res.error}`
}

async function setUa(): Promise<void> {
  const ua = await window.api.sessionConfig.setUserAgent(uaInput.value)
  uaResult.value = `✅ UA 已设置: ${ua}`
}

async function loadUa(): Promise<void> {
  const ua = await window.api.sessionConfig.getUserAgent()
  uaResult.value = `当前 UA: ${ua}`
}

// ── ⑥ 会话分区（partition.ts）──
async function openIncognito(): Promise<void> {
  const res = await window.api.partition.openIncognito()
  if (res.ok) message.success('已创建无痕窗口（独立内存会话）')
}

async function openPersistent(): Promise<void> {
  const res = await window.api.partition.openPersistent()
  if (res.ok) message.success('已创建持久分区窗口（persist:work）')
}

let dispose: (() => void) | null = null
onMounted(async () => {
  await loadCookies()
  // 自动确保本地自闭环下载源可用（已运行则跳过）
  const status = await window.api.httpServer.getStatus()
  localServerRunning.value = status.running
  if (!status.running) await startLocalServer()
  dispose = window.api.session.onRequestLog((raw) => {
    const log = raw as { time: string; method: string; url: string; injected: boolean }
    requestLogs.value.unshift(log)
    // 截断：最多保留 50 条，防止长时间运行内存增长
    if (requestLogs.value.length > 50) requestLogs.value.pop()
  })
})
onUnmounted(() => dispose?.())
</script>

<template>
  <FeatureLayout
    title="网络会话管理"
    api="session.cookies / webRequest / protocol.handle"
    intro="桌面应用的网络会话能力三件套：Cookie 管理登录态、webRequest 拦截并修改请求、protocol.handle 拦截协议返回自定义内容（虚拟文件/离线资源）。注意 protocol.handle 与「协议与深链接」页不同——那是注册系统协议唤起应用，这里是应用内部响应 URL。"
  >
    <n-card size="small" title="① Cookie 管理（session.cookies）" style="margin-bottom: 12px">
      <div
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px"
      >
        <n-input v-model:value="cookieUrl" placeholder="URL（需带协议）" style="width: 220px" />
        <n-input v-model:value="cookieName" placeholder="名称" style="width: 120px" />
        <n-input v-model:value="cookieValue" placeholder="值" style="width: 140px" />
        <n-button type="primary" @click="addCookie">写入 Cookie</n-button>
        <n-button @click="loadCookies">刷新</n-button>
      </div>
      <n-data-table
        :columns="cookieColumns"
        :data="cookies"
        size="small"
        :bordered="false"
        max-height="220"
      />
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        当前 session 的全部 Cookie（含其他站点写入的）。删除用「示例 URL」+ 名称匹配。
      </n-text>
    </n-card>

    <n-card size="small" title="② 请求拦截（webRequest）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="interceptUrl" placeholder="输入 URL 触发一次下载请求" />
        <n-button type="warning" @click="triggerRequest">触发请求</n-button>
        <n-button :loading="serverStarting" @click="startLocalServer">启动本地服务器</n-button>
        <n-tag v-if="localServerRunning" size="small" type="success" round>已运行</n-tag>
      </div>
      <n-space style="margin-top: 8px">
        <n-button
          v-for="preset in interceptPresets"
          :key="preset.value"
          size="small"
          secondary
          @click="interceptUrl = preset.value"
        >
          {{ preset.label }}
        </n-button>
      </n-space>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        拦截的是 Chromium 网络栈请求（下载/页面 fetch）。主进程 axios 不走此栈，所以用下载触发。
        主进程会向请求注入 <code>X-Demo-Header</code> 头。默认走本地自闭环源 （httpServer.ts 的
        /download 端点，进入本页会自动启动）；若换用外网源 （如 Hetzner 测速文件）在部分网络会 TLS
        握手失败、终端出现 SSL 报错且下载 interrupted——属预期，非代码问题。
      </n-alert>
      <div
        v-if="requestLogs.length"
        style="margin-top: 8px; font-size: 12px; max-height: 160px; overflow-y: auto"
      >
        <div v-for="(log, i) in requestLogs" :key="i" style="padding: 2px 0">
          <n-tag size="tiny" type="success" round>已注入头</n-tag>
          <span style="margin-left: 6px">{{ log.time }} {{ log.method }} {{ log.url }}</span>
        </div>
      </div>
    </n-card>

    <n-card size="small" title="③ 自定义协议内容（protocol.handle）">
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <n-button type="primary" :loading="virtualLoading" @click="readVirtual('/hello.txt')">
          读取 elec-fs://demo/hello.txt
        </n-button>
        <n-button :loading="virtualLoading" @click="readVirtual('/version.json')">
          读取 elec-fs://demo/version.json
        </n-button>
      </div>
      <n-text style="display: block; margin-top: 8px; font-size: 13px; white-space: pre-wrap">{{
        virtualResult
      }}</n-text>
    </n-card>

    <n-card
      size="small"
      title="④ 会话缓存清理（主进程: sessionCleanup.ts）"
      style="margin-top: 12px"
    >
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <n-button @click="clearCache">清 HTTP 缓存</n-button>
        <n-button type="warning" @click="clearStorage"
          >清存储数据（Cookie/localStorage/IndexedDB）</n-button
        >
        <n-button type="error" @click="clearAll">全部清空</n-button>
      </div>
      <n-alert type="warning" :show-icon="true" size="small" style="margin-top: 8px">
        清存储数据会清掉本应用自身的 localStorage（含各页面 UI 状态），属预期行为——
        这正是"退出登录清理"或"隐私清理"的用途。
      </n-alert>
    </n-card>

    <n-card
      size="small"
      title="⑤ 代理与 User-Agent（主进程: sessionConfig.ts）"
      style="margin-top: 12px"
    >
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-input
          v-model:value="proxyRules"
          placeholder="代理规则，如 http=127.0.0.1:7897;https=127.0.0.1:7897"
          style="width: 360px"
        />
        <n-button type="primary" @click="setProxy">应用代理</n-button>
        <n-button @click="setProxyDirect">恢复直连</n-button>
        <n-button @click="resolveProxy">测试解析</n-button>
      </div>
      <n-text v-if="proxyResult" style="display: block; margin-top: 8px; font-size: 12px">{{
        proxyResult
      }}</n-text>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px">
        <n-input
          v-model:value="uaInput"
          placeholder="User-Agent"
          style="flex: 1; min-width: 300px"
        />
        <n-button @click="setUa">设置 UA</n-button>
        <n-button @click="loadUa">查看当前 UA</n-button>
      </div>
      <n-text
        v-if="uaResult"
        style="display: block; margin-top: 8px; font-size: 12px; word-break: break-all"
        >{{ uaResult }}</n-text
      >
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        代理典型场景：抓包调试（Fiddler/Charles 默认监听 127.0.0.1:7897）、公司内网。 "测试解析"用
        resolveProxy 查看某 URL 实际走的代理。
      </n-alert>
    </n-card>

    <n-card
      size="small"
      title="⑥ 会话分区（session.fromPartition，主进程: partition.ts）"
      style="margin-top: 12px"
    >
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <n-button type="primary" @click="openIncognito">创建无痕窗口（内存会话）</n-button>
        <n-button @click="openPersistent">创建持久分区窗口（persist:work）</n-button>
      </div>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        无痕窗口使用独立内存会话（关窗即销毁，Cookie/存储与主会话隔离）； 持久分区数据落盘到
        userData/Partitions/work（可模拟"工作账号"）。 验证方式：在本页 ① 写入 Cookie → 打开无痕窗口
        → 在无痕窗口中看不到该 Cookie。
      </n-alert>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/cookies.ts" :code="cookiesCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/webRequest.ts" :code="webRequestCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/protocolContent.ts" :code="protocolContentCode" />
    </template>
  </FeatureLayout>
</template>
