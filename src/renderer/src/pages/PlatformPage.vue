<script setup lang="ts">
/**
 * 平台特性演示页
 * 演示：Windows 任务栏高级（JumpList/OverlayIcon）+ macOS Dock（菜单/最近文档/bounce）
 *       + kiosk 模式 + MediaSession 媒体控制
 */
import { onUnmounted, ref } from 'vue'
import { NCard, NButton, NSwitch, NAlert, useMessage, NText, NInput } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import taskbarCode from '../../../main/features/taskbar.ts?raw'

const message = useMessage()

const isMac = window.electron.process.platform === 'darwin'
const isWin = window.electron.process.platform === 'win32'

// ── Windows：JumpList 最近文件 ──
const jumpFile = ref('C:\\Users\\Public\\示例文档.txt')

async function setJumpList(): Promise<void> {
  const res = await window.api.taskbar.setJumpList([jumpFile.value])
  if (res.ok) message.success('已设置 JumpList 最近文件（右键任务栏图标查看）')
  else message.error(res.error ?? '仅 Windows 支持')
}

// ── Windows：OverlayIcon ──
const overlayOn = ref(false)
async function toggleOverlay(value: boolean): Promise<void> {
  overlayOn.value = await window.api.taskbar.setOverlay(value)
  message.info(overlayOn.value ? '已叠加图标（看任务栏图标右下角）' : '已移除叠加图标')
}

// ── macOS：Dock 菜单 + 最近文档 + bounce ──
async function setDockMenu(): Promise<void> {
  const res = await window.api.taskbar.setDockMenu()
  if (res.ok) message.success('已设置 Dock 右键菜单（右键 Dock 图标查看）')
  else message.error(res.error ?? '仅 macOS 支持')
}

function addRecentDocument(): void {
  window.api.taskbar.addRecentDocument()
  message.info('已添加最近文档（macOS Dock 弹跳提示）')
}

// ── kiosk 模式 ──
const kioskOn = ref(false)
async function toggleKiosk(value: boolean): Promise<void> {
  kioskOn.value = await window.api.window.setKiosk(value)
  message.warning(
    kioskOn.value
      ? '已进入 kiosk 锁定全屏（Esc 无法退出，只能再次点击本按钮或 Alt+F4 关闭窗口）'
      : '已退出 kiosk 模式'
  )
}

// ── MediaSession 媒体控制（系统媒体面板）──
const playing = ref(false)
const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator

function togglePlay(): void {
  playing.value = !playing.value
  if (!hasMediaSession) return
  if (playing.value) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Electron 教学演示曲目',
      artist: '教学与模板项目',
      album: '平台特性'
    })
    // 系统媒体面板（Windows 媒体浮出控件 / macOS 控制中心）的播放状态
    navigator.mediaSession.playbackState = 'playing'
  } else {
    navigator.mediaSession.playbackState = 'paused'
  }
}

// 页面卸载时复位播放状态
onUnmounted(() => {
  if (hasMediaSession) navigator.mediaSession.playbackState = 'none'
})
</script>

<template>
  <FeatureLayout
    title="平台特性"
    api="setJumpList / setOverlayIcon / app.dock / setKiosk / MediaSession"
    intro="桌面应用与操作系统深度集成的平台特性：Windows 任务栏跳转列表与图标叠加、macOS Dock 菜单与最近文档、kiosk 锁定全屏（自助终端），以及系统媒体控制（MediaSession）。各能力均有平台限制，代码里已做检测与提示。"
  >
    <n-card size="small" title="Windows 任务栏高级" style="margin-bottom: 12px">
      <n-alert type="info" :show-icon="true" size="small" style="margin-bottom: 8px">
        当前平台: {{ isWin ? 'Windows ✅' : 'Windows ❌（仅 Windows 支持，跳过体验）' }}
      </n-alert>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-input
          v-model:value="jumpFile"
          placeholder="文件路径（添加到 JumpList 最近文件）"
          style="width: 320px"
        />
        <n-button :disabled="!isWin" @click="setJumpList">设置 JumpList</n-button>
        <span style="font-size: 13px">叠加图标：</span>
        <n-switch :value="overlayOn" :disabled="!isWin" @update:value="toggleOverlay" />
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        JumpList = 右键任务栏图标弹出的最近文件/任务；OverlayIcon =
        图标右下角小角标（如"新消息"红点）。
      </n-text>
    </n-card>

    <n-card size="small" title="macOS Dock 能力" style="margin-bottom: 12px">
      <n-alert type="info" :show-icon="true" size="small" style="margin-bottom: 8px">
        当前平台: {{ isMac ? 'macOS ✅' : 'macOS ❌（仅 macOS 支持）' }}
      </n-alert>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <n-button :disabled="!isMac" @click="setDockMenu">设置 Dock 右键菜单</n-button>
        <n-button :disabled="!isMac" @click="addRecentDocument"
          >添加最近文档（含 bounce 动画）</n-button
        >
      </div>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        Dock 菜单 = 右键 Dock 图标的快捷操作；最近文档会出现在 Dock 图标右键的"最近使用"中。
      </n-text>
    </n-card>

    <n-card size="small" title="kiosk 锁定全屏（自助终端/大屏）" style="margin-bottom: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <span style="font-size: 13px">kiosk 模式：</span>
        <n-switch :value="kioskOn" @update:value="toggleKiosk" />
      </div>
      <n-alert type="warning" :show-icon="true" size="small" style="margin-top: 8px">
        进入后窗口锁定全屏且 Esc/系统快捷键无法退出（教学演示请再次点击开关退出，或 Alt+F4 关闭）。
      </n-alert>
    </n-card>

    <n-card size="small" title="系统媒体控制（MediaSession）">
      <n-button :type="playing ? 'error' : 'primary'" @click="togglePlay">
        {{ playing ? '⏸ 暂停演示曲目' : '▶ 播放演示曲目' }}
      </n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        {{ hasMediaSession ? '✅ 当前平台支持系统媒体控制' : '❌ 当前环境不支持 MediaSession' }}
        <br />
        播放后：Windows 按 Win+G 或音量浮出控件可看到媒体卡片；macOS 在控制中心可控制播放/暂停。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/taskbar.ts" :code="taskbarCode" />
    </template>
  </FeatureLayout>
</template>
