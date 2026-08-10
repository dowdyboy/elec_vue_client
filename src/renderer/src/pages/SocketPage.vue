<script setup lang="ts">
/**
 * TCP / UDP 通信演示页
 * 演示：本机"服务端 + 客户端"互发（TCP）、双端口互发（UDP）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, NInputNumber, useMessage, NText, NTag } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import socketCode from '../../../main/features/socket.ts?raw'

const message = useMessage()

// ── TCP 状态 ──
const serverPort = ref(9999)
const serverStarted = ref(false)
const clientConnected = ref(false)
const tcpInput = ref('你好，TCP 服务端！')
const tcpLogs = ref<{ tag: string; msg: string; time: string }[]>([])

const pushTcpLog = (log: { tag: string; msg: string }): void => {
  tcpLogs.value.unshift({ ...log, time: new Date().toLocaleTimeString() })
}

async function startServer(): Promise<void> {
  const res = await window.api.socket.tcp.startServer(serverPort.value)
  if (res.ok) {
    serverStarted.value = true
    message.success(`服务端已启动: 127.0.0.1:${serverPort.value}`)
  } else {
    message.error(res.error ?? '启动失败')
  }
}

async function stopServer(): Promise<void> {
  await window.api.socket.tcp.stopServer()
  serverStarted.value = false
}

async function connect(): Promise<void> {
  const res = await window.api.socket.tcp.connect({ host: '127.0.0.1', port: serverPort.value })
  if (res.ok) {
    clientConnected.value = true
    message.success('客户端已连接（自连自）')
  } else {
    message.error(res.error ?? '连接失败')
  }
}

async function disconnect(): Promise<void> {
  await window.api.socket.tcp.disconnect()
  clientConnected.value = false
}

async function sendTcp(): Promise<void> {
  const res = await window.api.socket.tcp.send(tcpInput.value)
  if (!res.ok) message.error(res.error ?? '发送失败')
}

// ── UDP 状态 ──
const udpPortA = ref(5000)
const udpPortB = ref(5001)
const boundPorts = ref<number[]>([])
const udpMessage = ref('你好，UDP！')
const udpLogs = ref<{ tag: string; msg: string; time: string }[]>([])

const pushUdpLog = (log: { tag: string; msg: string }): void => {
  udpLogs.value.unshift({ ...log, time: new Date().toLocaleTimeString() })
}

async function bindUdp(port: number): Promise<void> {
  await window.api.socket.udp.bind(port)
  if (!boundPorts.value.includes(port)) boundPorts.value.push(port)
  message.success(`已绑定 UDP 端口 ${port}`)
}

async function sendUdp(from: number, to: number): Promise<void> {
  const res = await window.api.socket.udp.send({
    fromPort: from,
    targetPort: to,
    message: udpMessage.value
  })
  if (!res.ok) message.error(res.error ?? '发送失败')
}

// ── 订阅主进程日志推送 ──
let disposers: (() => void)[] = []
onMounted(() => {
  disposers.push(window.api.socket.onTcpLog(pushTcpLog))
  disposers.push(window.api.socket.onUdpLog(pushUdpLog))
})
onUnmounted(() => disposers.forEach((d) => d()))
</script>

<template>
  <FeatureLayout
    title="TCP / UDP 通信"
    api="net（Node.js）/ dgram（Node.js）"
    intro="传输层原生通信：TCP 面向连接、可靠有序（文件传输/远程桌面）；UDP 无连接、低延迟（音视频流/实时游戏）。本页演示「自连自」模式：本机启动服务端 + 客户端互发，无需外部服务器。所有收发都在主进程完成，日志经 IPC 实时推送到页面。"
  >
    <n-card size="small" title="TCP：服务端 + 客户端（自连自）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px">
        <n-input-number
          v-model:value="serverPort"
          placeholder="端口"
          style="width: 130px"
          :min="1"
          :max="65535"
        />
        <n-button type="primary" :disabled="serverStarted" @click="startServer"
          >① 启动服务端</n-button
        >
        <n-button :disabled="!serverStarted" @click="stopServer">停止服务端</n-button>
        <n-button type="warning" :disabled="!serverStarted || clientConnected" @click="connect">
          ② 客户端连接本机
        </n-button>
        <n-button :disabled="!clientConnected" @click="disconnect">断开</n-button>
      </div>
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="tcpInput" placeholder="要发送的消息" :disabled="!clientConnected" />
        <n-button type="primary" :disabled="!clientConnected" @click="sendTcp">③ 发送</n-button>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        流程：启动服务端 → 连接本机 → 发送消息 → 服务端回显。日志如下：
        （停止服务端不会断开已建立的客户端连接——TCP 连接独立于监听端口）
      </n-text>
      <div class="log-box">
        <div v-for="(log, i) in tcpLogs" :key="i" class="log-line">
          <n-tag size="tiny" :type="log.tag === '服务端' ? 'info' : 'success'" round>{{
            log.tag
          }}</n-tag>
          <span style="margin-left: 8px; font-size: 12px">{{ log.time }} {{ log.msg }}</span>
        </div>
        <n-text v-if="!tcpLogs.length" depth="3" style="font-size: 12px"
          >暂无日志，点击上方按钮开始</n-text
        >
      </div>
    </n-card>

    <n-card size="small" title="UDP：双端口互发（无连接）">
      <div
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px"
      >
        <n-input-number
          v-model:value="udpPortA"
          placeholder="端口A"
          style="width: 130px"
          :min="1"
          :max="65535"
        />
        <n-button
          :disabled="boundPorts.includes(Number(udpPortA))"
          @click="bindUdp(Number(udpPortA))"
        >
          绑定 {{ udpPortA }}
        </n-button>
        <n-input-number
          v-model:value="udpPortB"
          placeholder="端口B"
          style="width: 130px"
          :min="1"
          :max="65535"
        />
        <n-button
          :disabled="boundPorts.includes(Number(udpPortB))"
          @click="bindUdp(Number(udpPortB))"
        >
          绑定 {{ udpPortB }}
        </n-button>
      </div>
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="udpMessage" placeholder="消息内容" />
        <n-button
          type="primary"
          :disabled="
            !boundPorts.includes(Number(udpPortA)) || !boundPorts.includes(Number(udpPortB))
          "
          @click="sendUdp(Number(udpPortA), Number(udpPortB))"
        >
          {{ udpPortA }} → {{ udpPortB }}
        </n-button>
        <n-button
          type="warning"
          :disabled="
            !boundPorts.includes(Number(udpPortA)) || !boundPorts.includes(Number(udpPortB))
          "
          @click="sendUdp(Number(udpPortB), Number(udpPortA))"
        >
          {{ udpPortB }} → {{ udpPortA }}
        </n-button>
      </div>
      <div class="log-box">
        <div v-for="(log, i) in udpLogs" :key="i" class="log-line">
          <n-tag size="tiny" type="warning" round>{{ log.tag }}</n-tag>
          <span style="margin-left: 8px; font-size: 12px">{{ log.time }} {{ log.msg }}</span>
        </div>
        <n-text v-if="!udpLogs.length" depth="3" style="font-size: 12px"
          >绑定两个端口后互发消息</n-text
        >
      </div>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/socket.ts" :code="socketCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.log-box {
  margin-top: 8px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px;
}
.log-line {
  padding: 2px 0;
}
</style>
