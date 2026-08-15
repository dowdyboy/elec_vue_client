<script setup lang="ts">
/**
 * 安全实践演示页
 * 演示：权限白名单拦截、外部导航拦截、CSP 说明
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NText, NSwitch, useMessage } from 'naive-ui'
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

// ── 系统权限询问（systemAccess.ts）──
const isMac = window.electron.process.platform === 'darwin'
const accessStatus = ref<{ supported: boolean; camera?: string; microphone?: string } | null>(null)

async function refreshAccessStatus(): Promise<void> {
  accessStatus.value = await window.api.system.getMediaAccessStatus()
}

async function askAccess(type: 'camera' | 'microphone'): Promise<void> {
  const res = await window.api.system.askMediaAccess(type)
  if (!res.ok) {
    message.info(res.error ?? '当前平台不支持此调用')
  } else {
    message.success(res.granted ? `${type} 权限已授予` : `${type} 权限被拒绝`)
  }
  await refreshAccessStatus()
}

// ── 证书校验（certificate.ts）──
const trustAll = ref(false)

async function toggleCertMode(value: boolean): Promise<void> {
  trustAll.value = value
  await window.api.cert.setVerifyMode(value ? 'trustAll' : 'default')
  message[value ? 'warning' : 'success'](
    value ? '已放行所有证书（仅演示用，生产禁用！）' : '已恢复系统默认证书校验'
  )
}

// ── 静默权限检查（security.ts 扩展）──
const silentCheck = ref(false)

async function toggleSilentCheck(value: boolean): Promise<void> {
  silentCheck.value = await window.api.security.setSilentCheck(value)
  message.info(silentCheck.value ? '已启用静默检查（白名单外权限静默拒绝）' : '已关闭静默检查')
}

onMounted(() => {
  dispose = window.api.security.onPermissionDenied((permission) => {
    deniedPermissions.value.unshift(permission)
    message.error(`权限请求被主进程拒绝: ${permission}`)
  })
  refreshAccessStatus()
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
        主进程 security.ts 白名单只放行 clipboard-read / media / display-capture / serial （media 与
        display-capture 供"媒体捕获"页演示），其余权限一律拒绝。被拒绝记录：
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

    <n-card
      size="small"
      title="③ 系统权限询问（macOS，主进程: systemAccess.ts）"
      style="margin-bottom: 12px"
    >
      <div v-if="accessStatus">
        <n-tag size="small" type="info" round>
          摄像头: {{ accessStatus.camera ?? 'N/A' }} · 麦克风:
          {{ accessStatus.microphone ?? 'N/A' }}
        </n-tag>
        <n-text
          v-if="!accessStatus.supported"
          depth="3"
          style="display: block; margin-top: 4px; font-size: 12px"
        >
          Windows/Linux 由 Chromium 权限弹窗处理（受本页 ① 的白名单控制）。
        </n-text>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px">
        <n-button size="small" :disabled="!isMac" @click="askAccess('camera')"
          >请求摄像头权限</n-button
        >
        <n-button size="small" :disabled="!isMac" @click="askAccess('microphone')"
          >请求麦克风权限</n-button
        >
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        授权状态: not-determined（未询问）→ granted（已授予）→ denied（已拒绝）。 macOS
        上必须经主进程 askForMediaAccess 发起系统授权弹窗。
      </n-text>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        ⚠️ 注意两层权限是独立的关系：系统授权（本卡片，macOS 弹窗）允许操作系统层面使用摄像头；
        页面实际调用 getUserMedia 时还会经过本页 ① 的 Chromium 权限白名单（白名单已放行
        media，因此系统授权 + 白名单都通过后即可访问；在"媒体捕获"页可实测， 若把白名单中 media
        注释掉，getUserMedia 将被主进程拒绝——两层权限缺一不可）。
      </n-alert>
    </n-card>

    <n-card
      size="small"
      title="③.5 静默权限检查（setPermissionCheckHandler）"
      style="margin-bottom: 12px"
    >
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">静默检查模式：</span>
        <n-switch :value="silentCheck" @update:value="toggleSilentCheck" />
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        与 ① 的"请求处理器"（有回调交互、可通知页面）不同：检查处理器是<code>无 UI 静默判断</code>
        （如 permissions.query 的返回值），不弹窗、不通知，直接返回 boolean。
        两者共用同一白名单——教学演示了两层权限 API 的关系。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="④ 证书校验策略（主进程: certificate.ts）"
      style="margin-bottom: 12px"
    >
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">放行所有证书（trustAll）：</span>
        <n-switch :value="trustAll" @update:value="toggleCertMode" />
      </div>
      <n-alert type="error" :show-icon="true" size="small" style="margin-top: 8px">
        ⚠️ trustAll 会带来中间人攻击风险（任何人可伪造证书窃取数据），
        仅用于企业内网自签证书或测试环境，生产必须保持默认校验。
      </n-alert>
    </n-card>

    <n-card size="small" title="⑤ 安全基线建议">
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
