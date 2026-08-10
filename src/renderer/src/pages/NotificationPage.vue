<script setup lang="ts">
/**
 * 系统通知演示页
 * 演示：发送系统通知、点击通知聚焦窗口
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NInput, useMessage, NAlert, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import notificationCode from '../../../main/features/notification.ts?raw'

const message = useMessage()
const title = ref('Electron 教学')
const body = ref('这是一条来自主进程的系统通知')
const clicked = ref('')
const actionResult = ref('')

function send(): void {
  window.api.notification.show({ title: title.value, body: body.value })
}

/** 带动作按钮的通知（macOS 显示按钮；Windows 需打包后 toast 支持） */
function sendWithActions(): void {
  window.api.notification.show({
    title: '更新提示',
    body: '发现新版本 v2.0，是否立即更新？',
    actions: ['立即更新', '稍后提醒']
  })
}

let dispose: (() => void) | null = null
let disposeAction: (() => void) | null = null
onMounted(() => {
  // 点击通知 → 主进程聚焦窗口并回传事件
  dispose = window.api.notification.onClicked((options) => {
    clicked.value = `你点击了通知「${options.title}」，窗口已自动聚焦`
    message.success(clicked.value)
  })
  // 动作按钮 → 回传下标
  disposeAction = window.api.notification.onAction(({ index }) => {
    const labels = ['立即更新', '稍后提醒']
    actionResult.value = `你点击了动作按钮「${labels[index]}」（index=${index}）`
    message.success(actionResult.value)
  })
})
onUnmounted(() => {
  dispose?.()
  disposeAction?.()
})
</script>

<template>
  <FeatureLayout
    title="系统通知"
    api="Notification"
    intro="系统通知由主进程创建（渲染进程的 web Notification 在 Electron 中默认不可用）。支持标题、正文、图标，并可监听点击事件做业务处理（如聚焦窗口、跳转页面）。在 Windows/macOS 上会显示为原生通知样式。"
  >
    <n-card size="small" title="发送一条通知" style="margin-bottom: 12px">
      <n-input v-model:value="title" placeholder="标题" style="margin-bottom: 8px" />
      <n-input
        v-model:value="body"
        placeholder="正文"
        type="textarea"
        :rows="2"
        style="margin-bottom: 8px"
      />
      <n-button type="primary" @click="send">发送通知</n-button>
      <n-button type="warning" style="margin-left: 8px" @click="sendWithActions"
        >带动作按钮的通知</n-button
      >
      <div v-if="clicked" style="margin-top: 8px; font-size: 13px">🔔 {{ clicked }}</div>
      <div v-if="actionResult" style="margin-top: 4px; font-size: 13px">🔘 {{ actionResult }}</div>
    </n-card>

    <n-alert type="info" :show-icon="true">
      <template #header>演示要点</template>
      发送后系统右下角会弹出通知。点击通知 → 主窗口自动聚焦， 页面收到
      <code>notification:clicked</code> 事件并显示提示。
      <br />
      <n-text depth="3">Windows 若未显示通知，请检查系统通知设置是否允许本应用推送。</n-text>
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/notification.ts" :code="notificationCode" />
    </template>
  </FeatureLayout>
</template>
