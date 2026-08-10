<script setup lang="ts">
/**
 * 子窗口演示页：
 * 由窗口管理页的"创建子窗口"按钮触发加载（路由 #/window-demo）
 * 本页面同样拥有完整的 window.api 能力，可演示窗口间独立运行
 */
import { NCard, NButton, NText, NAlert } from 'naive-ui'
import { useRoute } from 'vue-router'
import { ref } from 'vue'

const route = useRoute()

/** 判断当前窗口是否为透明窗口（透明窗口由路由查询参数传入） */
const isTransparent = route.query.transparent === '1'

const received = ref<string[]>([])
const channelPort = ref<MessagePort | null>(null)
const channelLog = ref<string[]>([])

function closeSelf(): void {
  // 子窗口没有自己的"关闭按钮"，通过 IPC 请主进程关闭主窗口没有意义；
  // 正确做法：子窗口自身调用 window.close()（渲染进程关闭自身窗口）
  window.close()
}

/** 无边框窗口自定义标题栏按钮：控制"本窗口"（window:control 作用于发送者窗口） */
function controlWindow(channel: 'minimize' | 'maximize' | 'close'): void {
  window.api.window.control(channel)
}

function openBroadcastDemo(): void {
  // 主窗口在 IPC 页演示广播；子窗口只需监听即可
  window.api.ipc.onBroadcastReceived((data) => {
    received.value.push(data)
  })
  // 演示：子窗口也可以发广播（所有窗口包括主窗口都会收到）
  window.api.ipc.broadcast('来自子窗口的广播')
}

function setupChannel(): void {
  window.api.ipc.createChannel()
  window.api.ipc.onChannelPort((port) => {
    channelPort.value = port
    port.onmessage = (event) => {
      channelLog.value.push(`收到: ${event.data}`)
    }
    port.postMessage('子窗口: 管道已连接')
    channelLog.value.push('已发送: 子窗口: 管道已连接')
  })
}

function sendViaChannel(): void {
  if (!channelPort.value) return
  channelPort.value.postMessage('子窗口通过管道发送消息')
  channelLog.value.push('已发送: 子窗口通过管道发送消息')
}
</script>

<template>
  <div class="demo-page">
    <!-- 自定义标题栏：拖拽区 + 最小化/最大化/关闭（-webkit-app-region 见样式） -->
    <div class="titlebar">
      <span class="drag-hint">
        {{ isTransparent ? '↕ 拖动此区域移动窗口' : '自定义标题栏（无边框窗口）' }}
      </span>
      <div class="titlebar-buttons">
        <button class="tb-btn" title="最小化" @click="controlWindow('minimize')">─</button>
        <button class="tb-btn" title="最大化/还原" @click="controlWindow('maximize')">□</button>
        <button class="tb-btn tb-close" title="关闭" @click="controlWindow('close')">✕</button>
      </div>
    </div>

    <n-alert :type="isTransparent ? 'warning' : 'success'" :show-icon="true">
      <template #header>我是子窗口</template>
      本窗口由主进程创建，加载的是同一个 SPA（路由 #/window-demo）， 说明 Electron 中每个
      BrowserWindow 都是独立运行的渲染进程。
      {{ isTransparent ? '当前窗口为【无边框透明】模式。' : '当前窗口为普通模式。' }}
    </n-alert>

    <n-card size="small" title="窗口操作" style="margin-top: 12px">
      <n-button type="error" @click="closeSelf">关闭本窗口</n-button>
      <n-text depth="3" style="margin-left: 12px; font-size: 12px">
        说明：子窗口关闭自身用 window.close()，无需经过主进程
      </n-text>
    </n-card>

    <n-card size="small" title="多窗口通信演示" style="margin-top: 12px">
      <n-button @click="openBroadcastDemo">订阅广播并发送一条</n-button>
      <div v-if="received.length" style="margin-top: 12px">
        <div v-for="(msg, i) in received" :key="i" style="font-size: 13px">📡 {{ msg }}</div>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        广播经主进程转发，所有窗口（包括主窗口）都能收到
      </n-text>
    </n-card>

    <n-card size="small" title="MessageChannel 管道" style="margin-top: 12px">
      <n-button @click="setupChannel">建立管道</n-button>
      <n-button :disabled="!channelPort" style="margin-left: 8px" @click="sendViaChannel"
        >通过管道发送</n-button
      >
      <div v-if="channelLog.length" style="margin-top: 12px">
        <div v-for="(log, i) in channelLog" :key="i" style="font-size: 13px">🔌 {{ log }}</div>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
/* 无边框窗口自定义标题栏：
   -webkit-app-region: drag 标记拖拽区（系统接管鼠标拖动）
   -webkit-app-region: no-drag 让按钮区域恢复可点击 */
.titlebar {
  -webkit-app-region: drag;
  height: 40px;
  margin-bottom: 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  background: rgba(128, 128, 128, 0.12);
}
.drag-hint {
  font-size: 12px;
  color: var(--text-color-2);
  user-select: none;
}
.titlebar-buttons {
  -webkit-app-region: no-drag;
  display: flex;
  gap: 6px;
}
.tb-btn {
  width: 28px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.2);
  color: var(--text-color-2);
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.tb-btn:hover {
  background: rgba(128, 128, 128, 0.35);
}
.tb-close:hover {
  background: #e5484d;
  color: #fff;
}
</style>
