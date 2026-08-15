<script setup lang="ts">
/**
 * 网络通信演示页
 * 演示：① 主进程 HTTP 请求（axios，绕过 CORS）② WebSocket 概念说明
 *       + 网络在线状态（netStatus.ts）
 * 注意：socket.io-client 需要配套服务器，本页以说明 + 代码展示为主
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, NSpace, useMessage, NAlert, NText, NTag } from 'naive-ui'
import { io, type Socket } from 'socket.io-client'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import networkCode from '../../../main/features/network.ts?raw'
import socketServerCode from '../../../main/features/socketServer.ts?raw'

const message = useMessage()

/** 默认走本页自带的本地 HTTP 服务器（100% 可达；外网接口受网络/代理影响，见下方提示） */
const url = ref('http://127.0.0.1:8765/api/info')
const loading = ref(false)
const result = ref('')

/** 预设演示地址（本地回环 > 稳定站点 > 外网 JSON 接口） */
const presetUrls = [
  { label: '本地接口（需先启动服务器）', value: 'http://127.0.0.1:8765/api/info' },
  { label: 'example.com（稳定 HTML）', value: 'https://example.com' },
  { label: 'httpbin.org（JSON 演示）', value: 'https://httpbin.org/get' },
  { label: 'GitHub API', value: 'https://api.github.com/zen' }
]

async function doHttpGet(): Promise<void> {
  if (!url.value) {
    message.warning('请输入 URL')
    return
  }
  loading.value = true
  result.value = '请求中...'
  const res = await window.api.network.httpGet(url.value)
  loading.value = false
  if (!res.ok) {
    result.value = `❌ 请求失败: ${res.error}`
    message.error(`请求失败: ${res.error}`)
    return
  }
  result.value = `HTTP ${res.status}\n${res.data}`
}

// ── DNS 解析（network.ts 扩展）──
const dnsInput = ref('github.com')
const dnsLoading = ref(false)
const dnsResult = ref('')

async function resolveDns(): Promise<void> {
  if (!dnsInput.value) {
    message.warning('请输入域名')
    return
  }
  dnsLoading.value = true
  const res = await window.api.network.resolveDns(dnsInput.value)
  dnsLoading.value = false
  dnsResult.value = res.ok
    ? `✅ ${dnsInput.value} → ${res.addresses.join('、')}`
    : `❌ 解析失败: ${res.error}`
}

// ── HTTP 服务器（httpServer.ts）──
const serverRunning = ref(false)
const serverResult = ref('')

async function startServer(): Promise<void> {
  const res = await window.api.httpServer.start(8765)
  if (res.ok) {
    serverRunning.value = true
    serverResult.value = `✅ 服务器已启动: http://127.0.0.1:${res.port}`
    message.success('本地 HTTP 服务器已启动')
  } else {
    serverResult.value = `❌ ${res.error}`
  }
}

async function stopServer(): Promise<void> {
  await window.api.httpServer.stop()
  serverRunning.value = false
  serverResult.value = '服务器已停止'
}

async function callLocalApi(): Promise<void> {
  try {
    // 渲染进程直接 fetch 本地接口（服务器已加 CORS 头）
    const response = await fetch('http://127.0.0.1:8765/api/info')
    const data = await response.json()
    serverResult.value = `✅ 本地接口返回: ${JSON.stringify(data, null, 2)}`
  } catch (error) {
    serverResult.value = `❌ 请求失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

// ── WebSocket（socket.io 自闭环演示，主进程: socketServer.ts）──
const wsServerRunning = ref(false)
const wsConnected = ref(false)
const wsLogs = ref<string[]>([])
const wsInput = ref('你好，主进程！')
/** 服务端每秒推送的最新状态（tick 单独展示，避免刷屏日志） */
const wsTick = ref('')
let socket: Socket | null = null

function pushWsLog(line: string): void {
  wsLogs.value.unshift(line)
  if (wsLogs.value.length > 50) wsLogs.value.pop()
}

async function startWsServer(): Promise<void> {
  const res = await window.api.socketServer.start(8766)
  if (res.ok) {
    wsServerRunning.value = true
    message.success(`socket.io 服务已启动（端口 ${res.port}）`)
  } else {
    message.error(res.error ?? '启动失败')
  }
}

async function stopWsServer(): Promise<void> {
  disconnectWs()
  await window.api.socketServer.stop()
  wsServerRunning.value = false
  wsTick.value = ''
  message.info('socket.io 服务已停止')
}

function connectWs(): void {
  if (socket) return
  // socket.io-client 直连本机回环（CSP connect-src 已放行 127.0.0.1:*，见 index.html）
  socket = io('http://127.0.0.1:8766')
  socket.on('connect', () => {
    wsConnected.value = true
    pushWsLog('🟢 已连接')
  })
  socket.on('disconnect', () => {
    wsConnected.value = false
    wsTick.value = ''
    pushWsLog('🔴 已断开')
  })
  // ① 服务端推送：连接即发欢迎消息
  socket.on('welcome', (data: { message: string }) => pushWsLog(`📩 ${data.message}`))
  // ② 双向实时：echo 回显
  socket.on('echo', (data: { received: string; time: string }) =>
    pushWsLog(`↩️ 回显: ${data.received}（${data.time}）`)
  )
  // ③ 服务端每秒 tick 推送（最新一条单独展示）
  socket.on('tick', (data: { time: string; clients: number }) => {
    wsTick.value = `${data.time} · 在线客户端 ${data.clients}`
  })
}

function disconnectWs(): void {
  socket?.disconnect()
  socket = null
}

function sendWs(): void {
  if (!socket?.connected) {
    message.warning('请先连接')
    return
  }
  socket.emit('message', wsInput.value)
  pushWsLog(`📤 已发送: ${wsInput.value}`)
}

// ── 网络在线状态（netStatus.ts）──
const online = ref(true)
const onlineTime = ref('')

let disposeNet: (() => void) | null = null
onMounted(async () => {
  const status = await window.api.net.getStatus()
  online.value = status.online
  disposeNet = window.api.net.onStatus((data) => {
    online.value = data.online
    onlineTime.value = data.time
    message[data.online ? 'success' : 'error'](
      `网络${data.online ? '已恢复' : '已断开'}（${data.time}）`
    )
  })
})
onUnmounted(() => {
  disposeNet?.()
  disconnectWs()
})
</script>

<template>
  <FeatureLayout
    title="网络通信"
    api="axios（主进程）/ socket.io-client（渲染进程）"
    intro="桌面应用网络请求的两种主流方案：① 在主进程用 axios 发 HTTP——可以绕过浏览器 CORS 限制、统一鉴权与错误处理；② 在渲染进程直接使用 socket.io-client 建 WebSocket——浏览器原生能力，适合实时推送（聊天、仪表盘）。"
  >
    <n-card size="small" title="HTTP（主进程 axios）" style="margin-bottom: 12px">
      <n-input v-model:value="url" placeholder="http://..." style="margin-bottom: 8px" />
      <n-space style="margin-bottom: 8px">
        <n-button type="primary" :loading="loading" @click="doHttpGet">发起 GET 请求</n-button>
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
      <n-alert type="info" :show-icon="true" size="small">
        默认地址是本页下方"HTTP 服务器"的本地接口（先点"启动服务器"再请求，100% 可达）。
        外网地址失败通常是网络/代理原因：主进程 axios 走 Node 网络栈、**不使用系统代理**
        （需要时自行配置，见 docs/28）；超时（10s）时建议换预设地址。演示 CORS 差异：
        在渲染进程直接用 fetch 会被跨域拦截，经主进程则没有此限制。
      </n-alert>
      <n-text style="display: block; margin-top: 8px; font-size: 12px; white-space: pre-wrap">{{
        result
      }}</n-text>
    </n-card>

    <n-card size="small" title="DNS 解析（net.resolveHost）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="dnsInput" placeholder="域名，如 github.com" />
        <n-button type="primary" :loading="dnsLoading" @click="resolveDns">解析</n-button>
      </div>
      <n-text v-if="dnsResult" style="display: block; margin-top: 8px; font-size: 12px">{{
        dnsResult
      }}</n-text>
    </n-card>

    <n-card
      size="small"
      title="HTTP 服务器（主进程 node:http，httpServer.ts）"
      style="margin-bottom: 12px"
    >
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-button type="primary" :disabled="serverRunning" @click="startServer"
          >启动服务器（8765）</n-button
        >
        <n-button :disabled="!serverRunning" @click="stopServer">停止服务器</n-button>
        <n-button :disabled="!serverRunning" @click="callLocalApi">访问本机接口</n-button>
        <n-tag v-if="serverRunning" size="small" type="success" round
          >运行中: http://127.0.0.1:8765</n-tag
        >
      </div>
      <n-text
        v-if="serverResult"
        style="display: block; margin-top: 8px; font-size: 12px; white-space: pre-wrap"
        >{{ serverResult }}</n-text
      >
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        主进程用 node:http 起本地服务（应用内 API mock、局域网共享）。"访问本机接口"演示渲染进程
        fetch 调用本地 API（无跨域限制）。另有 /download 下载端点（支持 Range），供「下载管理」
        页做自闭环下载演示（见 docs/22）。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="网络在线状态（net.online，主进程: netStatus.ts）"
      style="margin-bottom: 12px"
    >
      <n-tag :type="online ? 'success' : 'error'" round size="medium">
        {{ online ? '✅ 当前在线' : '❌ 当前离线' }}
      </n-tag>
      <n-text v-if="onlineTime" depth="3" style="margin-left: 8px; font-size: 12px">
        最近状态变化: {{ onlineTime }}
      </n-text>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        拔掉网线/关闭 WiFi 试试：事件实时推送，页面立即更新。注意 net.isOnline() 只反映系统网络
        连通性（不等于能访问特定服务器），业务探测用 HTTP 请求。
      </n-text>
    </n-card>

    <n-card size="small" title="WebSocket（socket.io 自闭环演示，主进程: socketServer.ts）">
      <n-space>
        <n-button type="primary" :disabled="wsServerRunning" @click="startWsServer">
          启动 socket.io 服务（8766）
        </n-button>
        <n-button :disabled="!wsServerRunning" @click="stopWsServer">停止服务</n-button>
        <n-button :disabled="!wsServerRunning || wsConnected" @click="connectWs">连接</n-button>
        <n-button :disabled="!wsConnected" @click="disconnectWs">断开</n-button>
        <n-tag v-if="wsTick" size="small" type="success" round>{{ wsTick }}</n-tag>
      </n-space>
      <n-space style="margin-top: 8px">
        <n-input
          v-model:value="wsInput"
          style="width: 240px"
          placeholder="发送内容"
          :disabled="!wsConnected"
        />
        <n-button :disabled="!wsConnected" @click="sendWs">发送（echo 回显）</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        自闭环（无需外网）：主进程起 socket.io 服务 → 渲染进程 socket.io-client 直连回环地址。 与
        HTTP 对比：① 双向实时（echo 无需新请求）② 服务端主动推送（每秒 tick，HTTP
        无法由服务器发起）。客户端连接外网服务器同理（CSP connect-src 需放行目标域名，见 docs/14）。
      </n-text>
      <div v-if="wsLogs.length" style="margin-top: 8px; font-size: 12px">
        <div v-for="(log, i) in wsLogs" :key="i">{{ log }}</div>
      </div>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/network.ts" :code="networkCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/socketServer.ts" :code="socketServerCode" />
    </template>
  </FeatureLayout>
</template>
