<script setup lang="ts">
/**
 * 窗口管理演示页
 * 演示：多窗口 / 最小化 / 最大化 / 全屏 / 置顶 / 无边框透明窗口
 *       + 任务栏进度条 / 角标 / 窗口状态持久化（windowState.ts）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NAlert,
  useMessage,
  NText,
  NInputNumber,
  NTag,
  NSlider
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
// vite 的 ?raw 导入：把主进程源码原文嵌入页面（改源码后自动同步）
import windowManagerCode from '../../../main/features/windowManager.ts?raw'
import windowStateCode from '../../../main/features/windowState.ts?raw'

const message = useMessage()
const alwaysOnTop = ref(false)
const isMaximized = ref(false)
const isFullscreen = ref(false)

async function createChild(mode: 'normal' | 'transparent'): Promise<void> {
  const result = await window.api.window.create(mode)
  message.success(`已创建子窗口 (id: ${result.id}, 模式: ${mode})`)
}

function minimize(): void {
  window.api.window.minimize()
}

function closeWindow(): void {
  window.api.window.close()
}

async function toggleMaximize(): Promise<void> {
  isMaximized.value = await window.api.window.toggleMaximize()
  message.info(isMaximized.value ? '已最大化' : '已还原')
}

async function toggleFullscreen(): Promise<void> {
  isFullscreen.value = await window.api.window.toggleFullscreen()
  message.info(isFullscreen.value ? '已进入全屏 (ESC 退出)' : '已退出全屏')
}

async function toggleAlwaysOnTop(): Promise<void> {
  alwaysOnTop.value = await window.api.window.toggleAlwaysOnTop()
  message.info(alwaysOnTop.value ? '窗口已置顶' : '已取消置顶')
}

// ── 任务栏进度条 + 角标 ──
const badgeCount = ref(5)

async function setProgress(value: number | null, mode?: 'normal' | 'error'): Promise<void> {
  await window.api.taskbar.setProgress(value, mode)
  if (value === null) message.info('进度条已清除（看任务栏图标下方）')
  else message.info(`进度已设为 ${Math.round((value ?? 0) * 100)}%（看任务栏图标）`)
}

async function setBadge(): Promise<void> {
  const count = await window.api.taskbar.setBadge(badgeCount.value)
  message.success(`角标已设为 ${count}（macOS Dock 显示）`)
}

async function clearBadge(): Promise<void> {
  await window.api.taskbar.setBadge(0)
  message.info('角标已清除')
}

// ── 窗口状态持久化（查询在下方合并的 onMounted 中执行）──
const persistedState = ref<string>('')

// ── 毛玻璃效果 + 闪屏重放 ──
const glassResult = ref('')

async function toggleGlass(): Promise<void> {
  const res = await window.api.glass.set(true)
  if (res.ok) {
    glassResult.value = `✅ 已启用毛玻璃（${res.platform}）。关闭后恢复正常：再次点击「关闭毛玻璃」`
    message.success(`毛玻璃已启用（${res.platform}）`)
  } else {
    glassResult.value = `❌ ${res.error}`
    message.error(res.error ?? '不支持')
  }
}

async function disableGlass(): Promise<void> {
  await window.api.glass.set(false)
  glassResult.value = '毛玻璃已关闭'
}

function replaySplash(): void {
  window.api.splash.replay()
  message.info('闪屏已重放（2.5 秒后自动关闭）')
}

// ── 页面缩放（zoom.ts）──
const zoomFactor = ref(1)

async function setZoom(delta: number): Promise<void> {
  zoomFactor.value = (await window.api.zoom.set(zoomFactor.value + delta)) ?? 1
}

async function resetZoom(): Promise<void> {
  zoomFactor.value = await window.api.zoom.reset()
}

// ── 窗口尺寸限制与透明度 ──
const minSizeInput = ref(600)
const maxSizeInput = ref(1600)
const opacityValue = ref(1)

async function applyMinSize(): Promise<void> {
  await window.api.window.setMinSize(minSizeInput.value, 400)
  message.success(`最小尺寸已设为宽 ${minSizeInput.value}`)
}

async function applyMaxSize(): Promise<void> {
  await window.api.window.setMaxSize(maxSizeInput.value, 900)
  message.success(`最大尺寸已设为宽 ${maxSizeInput.value}`)
}

async function applyOpacity(value: number): Promise<void> {
  opacityValue.value = (await window.api.window.setOpacity(value)) ?? 1
}

// ── 窗口事件日志（will-move / will-resize）──
const windowEvents = ref<{ event: string; time: string; bounds: string }[]>([])
let disposeWinEvents: (() => void) | null = null

onMounted(async () => {
  const state = await window.api.window.getPersistedState()
  if (state) {
    persistedState.value = `上次保存: (${state.x}, ${state.y}) ${state.width}×${state.height}${state.maximized ? '，最大化' : ''}`
  } else {
    persistedState.value = '暂无持久化记录（首次启动）'
  }
  zoomFactor.value = (await window.api.zoom.get()) ?? 1
  disposeWinEvents = window.api.window.onEvent((data) => {
    windowEvents.value.unshift(data)
    if (windowEvents.value.length > 10) windowEvents.value.pop()
  })
})
onUnmounted(() => disposeWinEvents?.())
</script>

<template>
  <FeatureLayout
    title="窗口管理"
    api="BrowserWindow / taskbar / windowState"
    intro="BrowserWindow 是 Electron 应用的最小单元。一个应用可以创建多个窗口，每个窗口独立运行一个渲染进程。本页演示多窗口、窗口控制（最小化/最大化/全屏）、置顶、透明无边框窗口，以及任务栏进度条、角标和窗口状态持久化。"
  >
    <n-alert type="info" :show-icon="true" style="margin-bottom: 12px">
      <template #header>试试多窗口</template>
      点击"创建普通子窗口"，新窗口加载的是同一个 SPA 的子页面（#/window-demo），
      可以在两个窗口之间互发广播消息（见 IPC 页）。
    </n-alert>

    <n-card size="small" title="窗口操作" style="margin-bottom: 12px">
      <n-space wrap>
        <n-button type="primary" @click="createChild('normal')">创建普通子窗口</n-button>
        <n-button type="warning" @click="createChild('transparent')">创建透明无边框窗口</n-button>
        <n-button @click="minimize">最小化</n-button>
        <n-button @click="toggleMaximize">{{ isMaximized ? '还原' : '最大化' }}</n-button>
        <n-button @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</n-button>
        <n-button :type="alwaysOnTop ? 'error' : 'default'" @click="toggleAlwaysOnTop">
          {{ alwaysOnTop ? '取消置顶' : '置顶' }}
        </n-button>
        <n-button type="error" @click="closeWindow">关闭窗口</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 12px; font-size: 12px">
        💡 提示：以上按钮都通过 IPC 调用主进程的 BrowserWindow 实例方法（window.api.window.*）。
        「关闭窗口」实际是隐藏到托盘（应用常驻，见系统托盘页）；真正退出请用托盘菜单。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="任务栏进度条与角标（主进程: taskbar.ts）"
      style="margin-bottom: 12px"
    >
      <n-space wrap>
        <n-button size="small" @click="setProgress(0.25)">进度 25%</n-button>
        <n-button size="small" @click="setProgress(0.6)">进度 60%</n-button>
        <n-button size="small" type="success" @click="setProgress(1)">完成 100%</n-button>
        <n-button size="small" type="error" @click="setProgress(0.6, 'error')">出错状态</n-button>
        <n-button size="small" @click="setProgress(null)">清除进度条</n-button>
        <n-input-number
          v-model:value="badgeCount"
          size="small"
          style="width: 100px"
          placeholder="角标数"
          :min="0"
        />
        <n-button size="small" @click="setBadge">设置角标</n-button>
        <n-button size="small" @click="clearBadge">清除角标</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        Windows 任务栏图标下方显示进度；角标（未读数）显示在 macOS Dock / Linux 任务栏。
      </n-text>
    </n-card>

    <n-card size="small" title="窗口状态持久化（主进程: windowState.ts）">
      <n-tag size="small" type="info" round>{{ persistedState }}</n-tag>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        拖动窗口位置或改变大小后，状态会在 500ms 内自动写入 userData/window-state.json；
        重启应用后自动恢复。源码见下方第二段。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="毛玻璃与闪屏（主进程: glassEffect.ts / splash.ts）"
      style="margin-top: 12px"
    >
      <n-space wrap>
        <n-button @click="toggleGlass">启用毛玻璃</n-button>
        <n-button @click="disableGlass">关闭毛玻璃</n-button>
        <n-button type="warning" @click="replaySplash">重放启动闪屏</n-button>
      </n-space>
      <n-text v-if="glassResult" depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        {{ glassResult }}
      </n-text>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        毛玻璃：macOS 走 setVibrancy，Windows 11 走 setBackgroundMaterial（其他系统会提示不支持）。
        闪屏：应用启动时短暂显示 Logo 窗口，主窗口就绪后自动关闭（本应用已默认开启）。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="页面缩放与窗口细节（zoom.ts / windowManager.ts）"
      style="margin-top: 12px"
    >
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <span style="font-size: 13px">页面缩放：</span>
        <n-button size="small" @click="setZoom(-0.1)">-</n-button>
        <n-button size="small" @click="setZoom(0.1)">+</n-button>
        <n-button size="small" @click="resetZoom">重置 100%</n-button>
        <n-tag size="small" type="info" round
          >当前 {{ Math.round(zoomFactor * 100) }}%（Ctrl+滚轮也可缩放）</n-tag
        >
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px">
        <span style="font-size: 13px">窗口透明度：</span>
        <n-slider
          v-model:value="opacityValue"
          :min="0.2"
          :max="1"
          :step="0.05"
          style="width: 200px"
          @update:value="applyOpacity"
        />
        <span style="font-size: 12px; color: var(--text-color-2)"
          >{{ Math.round(opacityValue * 100) }}%</span
        >
        <n-input-number
          v-model:value="minSizeInput"
          size="small"
          style="width: 100px"
          placeholder="最小宽"
        />
        <n-button size="small" @click="applyMinSize">设置最小宽</n-button>
        <n-input-number
          v-model:value="maxSizeInput"
          size="small"
          style="width: 100px"
          placeholder="最大宽"
        />
        <n-button size="small" @click="applyMaxSize">设置最大宽</n-button>
      </div>
      <div v-if="windowEvents.length" style="margin-top: 8px; font-size: 12px">
        <div v-for="(e, i) in windowEvents" :key="i">
          🪟 {{ e.time }} {{ e.event }} → ({{ e.bounds }})
        </div>
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        拖动窗口/调整大小会实时推送 will-move / will-resize 事件（上方日志）。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/windowManager.ts" :code="windowManagerCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/windowState.ts" :code="windowStateCode" />
    </template>
  </FeatureLayout>
</template>
