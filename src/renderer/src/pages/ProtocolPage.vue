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

let dispose: (() => void) | null = null
onMounted(() => {
  dispose = window.api.protocol.onDeepLink((url) => {
    deepLinkLog.value.unshift({ url, time: new Date().toLocaleTimeString() })
    message.success(`收到深链接: ${url}`)
  })
})
onUnmounted(() => dispose?.())
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
        内嵌视图会铺满整个窗口并覆盖当前内容；关闭后恢复。外链页面与主窗口互相隔离（独立渲染进程）。
      </n-alert>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/protocol.ts" :code="protocolCode" />
    </template>
  </FeatureLayout>
</template>
