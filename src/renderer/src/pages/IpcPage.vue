<script setup lang="ts">
/**
 * IPC 通信演示页
 * 演示 4 种模式：① invoke/handle ② send/on ③ 广播 ④ MessageChannel
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, NAlert, useMessage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import ipcBridgeCode from '../../../main/features/ipcBridge.ts?raw'

const message = useMessage()

// ① invoke/handle
const pingInput = ref('hello electron')
const pingResult = ref('')

// ② send/on
const eventInput = ref('单向消息测试')
const eventReply = ref('')

// ③ 广播
const broadcastInput = ref('大家注意！')
const broadcastReceived = ref<string[]>([])

// ④ MessageChannel
const channelPort = ref<MessagePort | null>(null)
const channelLog = ref<string[]>([])
const channelInput = ref('管道消息')

// ⑤ BroadcastChannel 多窗口直连
const bcInput = ref('BroadcastChannel 消息')
const bcReceived = ref<string[]>([])
const bcChannel = new BroadcastChannel('elec-demo-bc')

bcChannel.onmessage = (event: MessageEvent<string>): void => {
  bcReceived.value.push(event.data)
}

function sendBc(): void {
  bcChannel.postMessage(bcInput.value)
}

/** 订阅所有"主进程 → 渲染进程"的事件（组件卸载时取消） */
const disposers: (() => void)[] = []
function subscribe(cb: () => void | (() => void)): void {
  const dispose = cb()
  if (dispose) disposers.push(dispose)
}

onMounted(() => {
  // ② send/on 的原路回复
  subscribe(() =>
    window.api.ipc.onEventReply((data) => {
      eventReply.value = data
    })
  )
  // ③ 广播接收（所有窗口都收得到）
  subscribe(() =>
    window.api.ipc.onBroadcastReceived((data) => {
      broadcastReceived.value.push(data)
    })
  )
  // ④ MessageChannel 端口接收：preload 收到端口后经 window.postMessage 转移，
  //    页面在此接收（contextBridge 参数会被结构化克隆，端口必须"转移"而非"传递"，见 docs/02）
  window.addEventListener('message', onChannelPortMessage)
})

onUnmounted(() => {
  disposers.forEach((dispose) => dispose())
  window.removeEventListener('message', onChannelPortMessage)
})

// ① 请求-响应：渲染进程等待主进程返回结果
async function doPing(): Promise<void> {
  const result = await window.api.ipc.ping(pingInput.value)
  pingResult.value = `主进程回复: ${result.echo}（时间 ${result.time}）`
}

// ② 单向消息：只发送，回复通过事件异步到达
function doSendEvent(): void {
  window.api.ipc.sendEvent(eventInput.value)
  eventReply.value = '已发送，等待回复...'
}

// ③ 广播：主进程转发给所有窗口（先开一个子窗口再点，效果更直观）
function doBroadcast(): void {
  window.api.ipc.broadcast(broadcastInput.value)
}

// ④ MessageChannel：建立双向管道
function setupChannel(): void {
  window.api.ipc.createChannel()
}

/** ④ 接收 preload 转移过来的 MessagePort（preload 用 window.postMessage 转移，见 preload/index.ts） */
function onChannelPortMessage(event: MessageEvent): void {
  // event.source === window：消息来自 preload（而非 iframe 等外部源）
  if (event.source !== window || event.data !== 'ipc:channel-port') return
  const port = event.ports[0]
  if (!port) return
  channelPort.value = port
  port.onmessage = (e) => {
    channelLog.value.push(`📥 ${e.data}`)
  }
  port.postMessage('你好，主进程管道！')
  channelLog.value.push('📤 已发送: 你好，主进程管道！')
  message.success('管道已建立')
}

function sendViaChannel(): void {
  if (!channelPort.value) return
  channelPort.value.postMessage(channelInput.value)
  channelLog.value.push(`📤 已发送: ${channelInput.value}`)
}
</script>

<template>
  <FeatureLayout
    title="IPC 通信"
    api="ipcMain / ipcRenderer / MessageChannelMain"
    intro="IPC（Inter-Process Communication）是主进程与渲染进程通信的桥梁。由于渲染进程没有 Node.js 能力（安全限制），所有系统级操作（文件、网络、系统 API）都要通过 IPC 交给主进程执行。本页演示 4 种模式，覆盖了日常开发的全部场景。"
  >
    <!-- ① invoke/handle -->
    <n-card
      size="small"
      title="① invoke/handle —— 请求-响应（最常用，有返回值）"
      style="margin-bottom: 12px"
    >
      <n-input
        v-model:value="pingInput"
        placeholder="输入要发送给主进程的内容"
        style="margin-bottom: 8px"
      />
      <n-button type="primary" @click="doPing">发送并等待返回</n-button>
      <div v-if="pingResult" style="margin-top: 8px; font-size: 13px">{{ pingResult }}</div>
    </n-card>

    <!-- ② send/on -->
    <n-card size="small" title="② send/on —— 单向消息 + 事件回复" style="margin-bottom: 12px">
      <n-input v-model:value="eventInput" placeholder="输入消息" style="margin-bottom: 8px" />
      <n-button @click="doSendEvent">发送（不等待）</n-button>
      <div v-if="eventReply" style="margin-top: 8px; font-size: 13px">↩️ {{ eventReply }}</div>
    </n-card>

    <!-- ③ 广播 -->
    <n-card size="small" title="③ 广播 —— 一对多（多窗口通信）" style="margin-bottom: 12px">
      <n-input
        v-model:value="broadcastInput"
        placeholder="输入广播内容"
        style="margin-bottom: 8px"
      />
      <n-button @click="doBroadcast">广播给所有窗口</n-button>
      <n-alert type="info" :show-icon="true" style="margin-top: 8px" size="small">
        先到"窗口管理"页创建一个子窗口，再点广播，子窗口和主窗口都会收到
      </n-alert>
      <div v-if="broadcastReceived.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(msg, i) in broadcastReceived" :key="i">📡 收到: {{ msg }}</div>
      </div>
    </n-card>

    <!-- ④ MessageChannel -->
    <n-card size="small" title="④ MessageChannel —— 双向管道（高频数据流）">
      <n-button type="primary" :disabled="!!channelPort" @click="setupChannel">建立管道</n-button>
      <div style="display: flex; gap: 8px; margin-top: 8px">
        <n-input v-model:value="channelInput" placeholder="输入管道消息" :disabled="!channelPort" />
        <n-button :disabled="!channelPort" @click="sendViaChannel">发送</n-button>
      </div>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        关键坑：contextIsolation 下 MessagePort 不能作为参数经 contextBridge 传给页面
        （结构化克隆会断开端口连接）。本页采用官方模式：preload 用 window.postMessage
        把端口"转移"到主世界，页面监听 window 的 message 事件接收。
      </n-alert>
      <div v-if="channelLog.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(log, i) in channelLog" :key="i">{{ log }}</div>
      </div>
    </n-card>

    <!-- ⑤ BroadcastChannel 多窗口直连 -->
    <n-card
      size="small"
      title="⑤ BroadcastChannel —— 多窗口直连（不经主进程）"
      style="margin-top: 12px"
    >
      <n-input
        v-model:value="bcInput"
        placeholder="输入消息（所有窗口的同一频道都能收到）"
        style="margin-bottom: 8px"
      />
      <n-button @click="sendBc">广播到所有窗口（浏览器原生）</n-button>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        BroadcastChannel 是浏览器原生 API：同一 origin 的所有窗口（含子窗口）共享频道，
        无需经过主进程中转 —— 比方案③的"主进程广播"链路更短，适合简单通知。
      </n-alert>
      <div v-if="bcReceived.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(msg, i) in bcReceived" :key="i">📻 收到: {{ msg }}</div>
      </div>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/ipcBridge.ts" :code="ipcBridgeCode" />
    </template>
  </FeatureLayout>
</template>
