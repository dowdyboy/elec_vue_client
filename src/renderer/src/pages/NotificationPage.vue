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

/** 平台通知能力（主进程 notification:getPlatformInfo） */
const platformInfo = ref<{
  platform: string
  aumid?: string
  shortcutExists?: boolean
  actionsSupported: boolean
  hint: string
} | null>(null)
const registering = ref(false)

function send(): void {
  window.api.notification.show({ title: title.value, body: body.value })
}

/** 带动作按钮的通知（Windows 需 AUMID 快捷方式注册，见上方平台状态卡） */
function sendWithActions(): void {
  window.api.notification.show({
    title: '更新提示',
    body: '发现新版本 v2.0，是否立即更新？',
    actions: ['立即更新', '稍后提醒']
  })
}

/** Windows dev 一键解锁：创建带 AUMID 的开始菜单快捷方式 */
async function registerShortcut(): Promise<void> {
  registering.value = true
  try {
    const res = await window.api.notification.registerShortcut()
    if (res.ok) {
      message.success('快捷方式已创建，请重新点击"带动作按钮的通知"查看按钮')
      platformInfo.value = await window.api.notification.getPlatformInfo()
    } else {
      message.error(res.error ?? '创建失败')
    }
  } finally {
    registering.value = false
  }
}

let dispose: (() => void) | null = null
let disposeAction: (() => void) | null = null
onMounted(async () => {
  platformInfo.value = await window.api.notification.getPlatformInfo()
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
    <n-alert
      v-if="platformInfo"
      :type="platformInfo.actionsSupported ? 'success' : 'warning'"
      :show-icon="true"
      style="margin-bottom: 12px"
    >
      <template #header>
        动作按钮平台状态（{{ platformInfo.platform }}）:
        {{ platformInfo.actionsSupported ? '可用 ✅' : '受限 ⚠️' }}
      </template>
      {{ platformInfo.hint }}
      <template v-if="platformInfo.platform === 'win32' && !platformInfo.shortcutExists">
        <div style="margin-top: 8px">
          <n-button size="small" type="primary" :loading="registering" @click="registerShortcut">
            一键创建开始菜单快捷方式（注册 AUMID）
          </n-button>
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">
            打包安装（build:win）时安装程序会自动创建，无需此步
          </n-text>
        </div>
      </template>
      <template v-if="platformInfo.platform === 'win32' && platformInfo.shortcutExists">
        <div style="margin-top: 8px; font-size: 12px">
          若按钮仍未出现，按顺序排查：① 重启应用后重试；② 仍无效 → 注销或重启一次 （Windows
          推送通知平台 WpnUserService 缓存"快捷方式表"，程序化新建的 .lnk 需缓存刷新后才被 toast
          按钮判定认可）；③ 检查通知右上角是否有 ∨ 展开箭头 （Win11
          会把按钮折叠，点击展开可见）。打包安装后无此问题。
        </div>
      </template>
    </n-alert>

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
