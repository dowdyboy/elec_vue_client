<script setup lang="ts">
/**
 * 网络通信演示页
 * 演示：① 主进程 HTTP 请求（axios，绕过 CORS）② WebSocket 概念说明
 *       + 网络在线状态（netStatus.ts）
 * 注意：socket.io-client 需要配套服务器，本页以说明 + 代码展示为主
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, useMessage, NAlert, NText, NTag } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import networkCode from '../../../main/features/network.ts?raw'

const message = useMessage()

const url = ref('https://httpbin.org/get')
const loading = ref(false)
const result = ref('')

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
onUnmounted(() => disposeNet?.())
</script>

<template>
  <FeatureLayout
    title="网络通信"
    api="axios（主进程）/ socket.io-client（渲染进程）"
    intro="桌面应用网络请求的两种主流方案：① 在主进程用 axios 发 HTTP——可以绕过浏览器 CORS 限制、统一鉴权与错误处理；② 在渲染进程直接使用 socket.io-client 建 WebSocket——浏览器原生能力，适合实时推送（聊天、仪表盘）。"
  >
    <n-card size="small" title="HTTP（主进程 axios）" style="margin-bottom: 12px">
      <n-input v-model:value="url" placeholder="http://..." style="margin-bottom: 8px" />
      <n-button type="primary" :loading="loading" @click="doHttpGet">发起 GET 请求</n-button>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        默认使用 httpbin.org 公共接口；如网络不可达可换成其他 URL（如 http://example.com）。演示
        CORS 差异：在渲染进程直接用 fetch 会被跨域拦截，经主进程则没有此限制。
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

    <n-card size="small" title="WebSocket（socket.io-client）">
      <n-text depth="3" style="font-size: 13px">
        WebSocket 需要在渲染进程直连服务器，代码模式如下（需配合 socket.io 服务器）：
      </n-text>
      <pre class="code-snippet">
// 渲染进程（浏览器原生能力，无需主进程中转）
import { io } from 'socket.io-client'

const socket = io('https://your-server.com')
socket.on('connect', () => socket.emit('message', 'hello'))
socket.on('message', (data) => console.log('收到:', data))</pre>
      <n-text depth="3" style="font-size: 12px">
        💡 本项目已内置 socket.io-client 依赖。若你已有 socket.io 服务器，可直接在渲染进程使用。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/network.ts" :code="networkCode" />
    </template>
  </FeatureLayout>
</template>
