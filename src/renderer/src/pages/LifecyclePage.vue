<script setup lang="ts">
/**
 * 生命周期演示页
 * 演示：应用信息、开机自启、单实例锁、生命周期事件日志
 *       + 电源监控（powerMonitor.ts）+ 全局错误日志（errorHandler.ts）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NSwitch,
  NDataTable,
  NAlert,
  useMessage,
  useDialog,
  NText,
  NTag,
  type DataTableColumns
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import lifecycleCode from '../../../main/features/appLifecycle.ts?raw'
import powerCode from '../../../main/features/powerMonitor.ts?raw'
import errorCode from '../../../main/features/errorHandler.ts?raw'

const message = useMessage()

// ── 应用信息 ──
const info = ref<Record<string, string>>({})
async function loadInfo(): Promise<void> {
  const data = await window.api.app.getInfo()
  info.value = {
    应用名: data.name,
    版本: data.version,
    平台: `${data.platform} (${data.arch})`,
    用户数据目录: data.userData
  }
}

// ── 开机自启 ──
const loginItem = ref(false)
async function toggleLoginItem(value: boolean): Promise<void> {
  loginItem.value = await window.api.app.setLoginItem(value)
  message.success(loginItem.value ? '已开启开机自启（写入了系统登录项）' : '已关闭开机自启')
}

// ── 生命周期事件日志 ──
const lifecycleLog = ref<{ event: string; time: string }[]>([])

let disposers: (() => void)[] = []
onMounted(() => {
  loadInfo()
  disposers.push(
    window.api.app.onLifecycle(({ event }) => {
      lifecycleLog.value.unshift({ event, time: new Date().toLocaleTimeString() })
      message.info(`生命周期事件: ${event}`)
    })
  )
  disposers.push(
    window.api.app.onSecondInstance(() => {
      message.warning('检测到应用被再次启动（单实例锁生效），本窗口已聚焦')
    })
  )
})
onUnmounted(() => disposers.forEach((d) => d()))

const columns: DataTableColumns<{ event: string; time: string }> = [
  { title: '时间', key: 'time', width: 100 },
  { title: '事件', key: 'event' }
]

// ── 电源监控（powerMonitor）──
const powerEvents = ref<{ event: string; time: string }[]>([])
const powerStatus = ref('')

async function loadPowerStatus(): Promise<void> {
  const status = await window.api.power.getStatus()
  powerStatus.value = `电源: ${status.onBatteryPower ? '🔋 电池供电' : '🔌 外接电源'}，系统空闲 ${status.idleTimeSeconds} 秒`
}

// ── 全局错误日志（errorHandler）──
interface ErrorRecord {
  time: string
  type: string
  message: string
}
const errorLogs = ref<ErrorRecord[]>([])

// ── 阻止系统睡眠（powerBlocker）──
const blockingSleep = ref(false)

async function togglePowerBlocker(value: boolean): Promise<void> {
  const res = await window.api.powerBlocker.set(value)
  blockingSleep.value = res.active
  message.success(
    blockingSleep.value ? '已阻止系统睡眠（应用运行期间系统不会自动休眠）' : '已解除阻止'
  )
}

// ── 应用重启（relaunch.ts）──
const dialog = useDialog()

function relaunchApp(): void {
  dialog.warning({
    title: '确认重启',
    content: '应用将立即重启（当前未保存的内容会丢失），继续吗？',
    positiveText: '重启',
    negativeText: '取消',
    onPositiveClick: () => {
      message.info('正在重启...')
      window.api.relaunch.now()
    }
  })
}

// ── 崩溃自动恢复（errorHandler.ts）──
const autoRecovery = ref(false)

async function toggleAutoRecovery(value: boolean): Promise<void> {
  autoRecovery.value = await window.api.error.setAutoRecovery(value)
  message.info(autoRecovery.value ? '已开启：渲染进程崩溃后 1 秒自动 reload' : '已关闭自动恢复')
}

// ── 退出前未保存询问（quitGuard.ts）──
const unsavedDirty = ref(false)

async function toggleDirty(value: boolean): Promise<void> {
  unsavedDirty.value = await window.api.quitGuard.setDirty(value)
  message.info(unsavedDirty.value ? '已标记"有未保存修改"（退出时会弹确认框）' : '已清除未保存标记')
}

// ── 崩溃转储信息（crashReporter）──
const crashInfo = ref<{ dumpDir: string } | null>(null)

async function loadCrashInfo(): Promise<void> {
  crashInfo.value = await window.api.error.getCrashInfo()
  message.success('已查询崩溃转储配置')
}

// ── 系统语言/字体（systemInfo.ts）──
const sysInfo = ref<{
  locale: string
  languages: string[]
  platform: string
  arch: string
  fonts: string[]
} | null>(null)

onMounted(() => {
  loadInfo()
  loadPowerStatus()
  window.api.system.getInfo().then((info) => {
    sysInfo.value = info
  })
  disposers.push(
    window.api.app.onLifecycle(({ event }) => {
      lifecycleLog.value.unshift({ event, time: new Date().toLocaleTimeString() })
      message.info(`生命周期事件: ${event}`)
    })
  )
  disposers.push(
    window.api.app.onSecondInstance(() => {
      message.warning('检测到应用被再次启动（单实例锁生效），本窗口已聚焦')
    })
  )
  // 电源事件
  disposers.push(
    window.api.power.onEvent(({ event, time }) => {
      powerEvents.value.unshift({ event, time })
      message.info(`电源事件: ${event}`)
    })
  )
  // 错误日志：初始化加载历史 + 实时监听
  window.api.error.getLogs().then((logs) => {
    errorLogs.value = (logs as ErrorRecord[]).slice(0, 20)
  })
  disposers.push(
    window.api.error.onNew((record) => {
      errorLogs.value.unshift(record as ErrorRecord)
      message.error(`捕获到错误: ${(record as ErrorRecord).type}`)
    })
  )
})
onUnmounted(() => disposers.forEach((d) => d()))
</script>

<template>
  <FeatureLayout
    title="生命周期与单实例"
    api="app / powerMonitor / errorHandler"
    intro="app 模块管理整个应用的生死：单实例锁防止重复启动；开机自启写入系统登录项；生命周期事件（before-quit → will-quit）决定退出流程。单实例是桌面应用的标配能力（如微信、QQ 双击图标只弹出一个窗口）。本页同时演示电源监控（锁屏/睡眠/唤醒）与全局错误捕获。"
  >
    <n-card size="small" title="应用信息" style="margin-bottom: 12px">
      <div v-for="(value, key) in info" :key="key" style="font-size: 13px; padding: 2px 0">
        <b>{{ key }}:</b> <span style="word-break: break-all">{{ value }}</span>
      </div>
    </n-card>

    <n-card size="small" title="开机自启" style="margin-bottom: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">随系统启动：</span>
        <n-switch :value="loginItem" @update:value="toggleLoginItem" />
      </div>
    </n-card>

    <n-card size="small" title="单实例锁演示" style="margin-bottom: 12px">
      <n-alert type="warning" :show-icon="true">
        在打包后的 exe 上双击启动第二次（开发模式可执行 <code>npm run dev</code> 再开一个终端），
        第二次启动会立即退出，第一次启动的窗口会被聚焦，并收到 second-instance 事件。
      </n-alert>
    </n-card>

    <n-card size="small" title="生命周期事件日志">
      <n-text depth="3" style="display: block; margin-bottom: 8px; font-size: 12px">
        关闭窗口或退出应用时，主进程会广播以下事件（顺序：before-quit → will-quit →
        window-all-closed）
      </n-text>
      <n-data-table :columns="columns" :data="lifecycleLog" size="small" :bordered="false" />
    </n-card>

    <n-card size="small" title="电源监控（主进程: powerMonitor.ts）" style="margin-top: 12px">
      <n-tag size="small" type="info" round>{{ powerStatus }}</n-tag>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        锁屏 / 解锁 / 睡眠 / 唤醒 / 电源切换时，主进程推送事件到本页。可 Win+L 锁屏测试：
      </n-text>
      <div v-if="powerEvents.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(e, i) in powerEvents" :key="i">⚡ {{ e.time }} {{ e.event }}</div>
      </div>
    </n-card>

    <n-card size="small" title="阻止系统睡眠（主进程: powerBlocker.ts）" style="margin-top: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">阻止系统自动休眠：</span>
        <n-switch :value="blockingSleep" @update:value="togglePowerBlocker" />
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        典型场景：下载/播放/演示时保持系统唤醒。切换后系统设置里的"自动睡眠"将不再生效
        （电源计划仍可手动休眠）。
      </n-text>
    </n-card>

    <n-card size="small" title="退出前未保存询问（主进程: quitGuard.ts）" style="margin-top: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">模拟"有未保存修改"：</span>
        <n-switch :value="unsavedDirty" @update:value="toggleDirty" />
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        开启后，通过托盘菜单"退出应用"或系统退出：会先弹出确认对话框。
        选择"取消"则留在应用（关闭窗口仍是"隐藏到托盘"行为）。
        这就是生产应用"有未保存修改，确定退出？"的标准实现。
      </n-text>
    </n-card>

    <n-card size="small" title="应用重启（主进程: relaunch.ts）" style="margin-top: 12px">
      <n-button type="warning" @click="relaunchApp">重启应用（app.relaunch）</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        典型场景：设置项"重启生效"、自动更新安装前重启。app.relaunch() 安排重启 + app.exit(0)
        立即退出进程。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="崩溃转储（crashReporter，主进程: errorHandler.ts）"
      style="margin-top: 12px"
    >
      <n-button size="small" @click="loadCrashInfo">查询崩溃转储信息</n-button>
      <div v-if="crashInfo" style="margin-top: 8px; font-size: 12px">
        <div>
          📁 转储目录: <span style="word-break: break-all">{{ crashInfo.dumpDir }}</span>
        </div>
        <n-text depth="3" style="display: block; margin-top: 4px">
          crashReporter 已启动（本地转储，不上报）：渲染进程崩溃时会生成 .dmp 文件。
          生产环境通常配合 uploadToServer 上报到崩溃收集服务。
        </n-text>
      </div>
    </n-card>

    <n-card size="small" title="全局错误日志（主进程: errorHandler.ts）" style="margin-top: 12px">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px">
        <span style="font-size: 13px">崩溃自动恢复（reload）：</span>
        <n-switch :value="autoRecovery" @update:value="toggleAutoRecovery" />
      </div>
      <n-text depth="3" style="display: block; margin-bottom: 8px; font-size: 12px">
        主进程捕获的 uncaughtException / unhandledRejection / 渲染进程崩溃记录：
      </n-text>
      <div v-if="errorLogs.length" style="font-size: 12px">
        <div v-for="(e, i) in errorLogs" :key="i" style="padding: 3px 0">
          <n-tag size="tiny" type="error" round>{{ e.type }}</n-tag>
          <span style="margin-left: 8px">{{ e.time }} {{ e.message }}</span>
        </div>
      </div>
      <n-text v-else depth="3" style="font-size: 12px">暂无错误记录（应用运行健康）</n-text>
    </n-card>

    <n-card size="small" title="系统语言与字体（主进程: systemInfo.ts）" style="margin-top: 12px">
      <div v-if="sysInfo" style="font-size: 13px">
        <div>
          🌐 界面语言: <b>{{ sysInfo.locale }}</b
          >（偏好: {{ sysInfo.languages.join('、') }}）
        </div>
        <div>🖥️ 平台: {{ sysInfo.platform }} ({{ sysInfo.arch }})</div>
        <div v-if="sysInfo.fonts.length">
          🔤 系统字体（前 {{ sysInfo.fonts.length }} 个）: {{ sysInfo.fonts.join(', ') }}
        </div>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        多语言应用初始化时用 getLocale 决定默认语言；字体选择器用 getFonts 列出可用字体。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/appLifecycle.ts" :code="lifecycleCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/powerMonitor.ts" :code="powerCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/errorHandler.ts" :code="errorCode" />
    </template>
  </FeatureLayout>
</template>
