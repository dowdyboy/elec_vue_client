<script setup lang="ts">
/**
 * 安全实践演示页
 * 演示：权限白名单拦截、外部导航拦截、CSP 说明
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NText, useMessage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import securityCode from '../../../main/features/security.ts?raw'

const message = useMessage()
const deniedPermissions = ref<string[]>([])

/** ① 演示权限/弹窗拦截：window.open 会被 setWindowOpenHandler 拦下转交系统浏览器 */
async function triggerPermission(): Promise<void> {
  try {
    // 尝试打开外部站点：setWindowOpenHandler 会拦截，改为系统浏览器打开，
    // 应用内不会出现新窗口
    window.open('https://example.com', '_blank')
    message.info('窗口打开请求已发出（会被 setWindowOpenHandler 拦截并转交系统浏览器）')
  } catch (err) {
    message.error(String(err))
  }
}

/** ② 演示导航拦截：点击按钮让页面尝试跳转外部站点 */
function triggerNavigation(): void {
  // 通过 window.location 跳转外部站点会触发 will-navigate 拦截
  message.info('尝试跳转外部站点（会被 will-navigate 拦截，转交系统浏览器）')
  setTimeout(() => {
    window.location.href = 'https://example.com'
  }, 300)
}

let dispose: (() => void) | null = null
onMounted(() => {
  dispose = window.api.security.onPermissionDenied((permission) => {
    deniedPermissions.value.unshift(permission)
    message.error(`权限请求被主进程拒绝: ${permission}`)
  })
})
onUnmounted(() => dispose?.())
</script>

<template>
  <FeatureLayout
    title="安全实践"
    api="session / webContents"
    intro="Electron 安全三件套：① contextIsolation + sandbox（渲染进程与 Node 隔离，本工程 webPreferences 已开启 contextIsolation，preload 只暴露白名单 API）；② 权限白名单：页面请求摄像头/麦克风/剪贴板等权限必须经主进程裁决；③ 导航拦截：防止页面被钓鱼跳转到外部网站。"
  >
    <n-card size="small" title="① 权限白名单拦截" style="margin-bottom: 12px">
      <n-button type="primary" @click="triggerPermission">尝试请求弹窗权限（会被拦截）</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        主进程 security.ts 只放行 clipboard-read，其余权限一律拒绝。 被拒绝记录：
      </n-text>
      <div v-if="deniedPermissions.length" style="margin-top: 4px; font-size: 13px">
        <div v-for="(p, i) in deniedPermissions" :key="i">🛡️ {{ p }}</div>
      </div>
    </n-card>

    <n-card size="small" title="② 外部导航拦截" style="margin-bottom: 12px">
      <n-button @click="triggerNavigation">尝试跳转到 example.com（会被拦截）</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">
        will-navigate 拦截：页面内任何跳转外部站点的尝试都会被阻止，
        改为调用系统默认浏览器打开（shell.openExternal）。
      </n-text>
    </n-card>

    <n-card size="small" title="③ 安全基线建议">
      <n-text depth="3" style="font-size: 13px">
        1. 永远开启 contextIsolation，preload 只暴露最小化 API（本工程 preload/index.ts 即范例）<br />
        2. 生产环境建议 sandbox: true（本工程保持模板默认 false 便于教学演示）<br />
        3. 外部链接一律 shell.openExternal（已在主窗口 setWindowOpenHandler 实现）<br />
        4. 禁用 webview 标签（已实现 will-attach-webview 拦截）<br />
        5. 生产环境为渲染进程配置 CSP（详见 docs/12-安全实践.md）
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/security.ts" :code="securityCode" />
    </template>
  </FeatureLayout>
</template>
