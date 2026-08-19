<script setup lang="ts">
/**
 * 平台特性演示页
 * 演示：Windows 任务栏高级（JumpList/OverlayIcon）+ macOS Dock（菜单/最近文档/bounce）
 *       + kiosk 模式 + MediaSession 媒体控制
 */
import { onMounted, onUnmounted, ref } from 'vue'
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
  if (!res.ok) {
    message.error(res.error ?? '仅 Windows 支持')
    return
  }
  // 系统隐私设置禁止自定义分类时，主进程已回退到标准"任务"分类
  if (res.fallback === 'tasks') message.info('系统隐私设置禁止自定义分类，已改用标准"任务"分类显示')
  else message.success('已设置 JumpList 最近文件（右键任务栏图标查看）')
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
// 真实发声：Web Audio 合成提示音（自闭环，无需音频文件）；
// MediaSession 只负责把播放状态同步到系统面板，本身不产生声音
const playing = ref(false)
const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator

let audioCtx: AudioContext | null = null
let toneOscillators: OscillatorNode[] = []
let toneGain: GainNode | null = null

function startTone(): void {
  if (!audioCtx) audioCtx = new AudioContext()
  // 自动播放策略：在用户手势内 resume（点击/系统面板触发均来自用户操作）
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  toneGain = audioCtx.createGain()
  toneGain.gain.value = 0.04 // 低音量柔和音，避免刺耳
  toneGain.connect(audioCtx.destination)
  // 双音叠合（A4 440Hz + C5 523Hz），比单音更温和
  for (const freq of [440, 523]) {
    const osc = audioCtx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(toneGain)
    osc.start()
    toneOscillators.push(osc)
  }
}

function stopTone(): void {
  toneOscillators.forEach((osc) => {
    try {
      osc.stop()
    } catch {
      // 已停止的振荡器再 stop 会抛错，忽略即可
    }
    osc.disconnect()
  })
  toneOscillators = []
  toneGain?.disconnect()
  toneGain = null
}

function togglePlay(): void {
  playing.value = !playing.value
  if (playing.value) startTone()
  else stopTone()
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

// 系统面板的播放/暂停按钮与页面按钮双向同步（注册一次即可）
function setupMediaSessionHandlers(): void {
  navigator.mediaSession.setActionHandler('play', togglePlay)
  navigator.mediaSession.setActionHandler('pause', togglePlay)
}

// 页面卸载时停止发声并复位播放状态
onUnmounted(() => {
  stopTone()
  void audioCtx?.close()
  audioCtx = null
  if (hasMediaSession) navigator.mediaSession.playbackState = 'none'
  disposeThumbar?.() // 移除缩略图按钮点击监听（防重复进入页面叠加监听）
})

// ── Windows Thumbar 缩略图按钮 ──
const thumbarOn = ref(false)
const thumbarLog = ref('')
let disposeThumbar: (() => void) | null = null

async function toggleThumbar(value: boolean): Promise<void> {
  const res = await window.api.taskbar.setThumbar(value)
  if (res.ok) {
    thumbarOn.value = value
    message.success(value ? '已添加缩略图按钮（悬停任务栏图标查看）' : '已移除缩略图按钮')
  } else {
    message.error(res.error ?? '仅 Windows 支持')
  }
}

onMounted(() => {
  // 系统媒体面板的播放/暂停按钮与页面按钮联动
  if (hasMediaSession) setupMediaSessionHandlers()
  // Thumbar 按钮点击事件（点击缩略图上的按钮时触发）
  disposeThumbar = window.api.taskbar.onThumbarClicked((action) => {
    thumbarLog.value = `${new Date().toLocaleTimeString()} 缩略图按钮被点击: ${
      action === 'playpause' ? '播放/暂停' : '下一首'
    }`
    if (action === 'playpause') togglePlay()
  })
})

// ── 任务栏闪烁 ──
async function flashFrame(): Promise<void> {
  const res = await window.api.taskbar.flashFrame()
  if (res.ok) message.success('任务栏图标闪烁 3 秒（最小化窗口后效果更明显）')
  else message.error(res.error ?? '失败')
}
</script>

<template>
  <FeatureLayout
    title="平台特性"
    api="setJumpList / setOverlayIcon / app.dock / setKiosk / MediaSession"
    intro="桌面应用与操作系统深度集成的平台特性：Windows 任务栏跳转列表与图标叠加、macOS Dock 菜单与最近文档、kiosk 锁定全屏（自助终端）、系统媒体控制（MediaSession）、任务栏缩略图按钮（Thumbar）与闪烁提醒。各能力均有平台限制，代码里已做检测与提示。"
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
        JumpList = 右键任务栏图标弹出的最近文件/任务。设置后任务栏右键会出现"最近文件"分类
        （任务项，dev 下无需文件关联即可显示）；路径同时写入系统"最近使用"。OverlayIcon =
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

    <n-card size="small" title="系统媒体控制（MediaSession）" style="margin-bottom: 12px">
      <n-button :type="playing ? 'error' : 'primary'" @click="togglePlay">
        {{ playing ? '⏸ 暂停演示曲目' : '▶ 播放演示曲目' }}
      </n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        {{ hasMediaSession ? '✅ 当前平台支持系统媒体控制' : '❌ 当前环境不支持 MediaSession' }}
        <br />
        播放后会发出柔和提示音（Web Audio 合成，自闭环无音频文件）；Windows 按 Win+G 或音量浮出控件
        可看到媒体卡片并可播放/暂停；macOS 在控制中心可控制。
      </n-text>
    </n-card>

    <n-card
      size="small"
      title="Windows 缩略图按钮（Thumbar）+ 任务栏闪烁"
      style="margin-bottom: 12px"
    >
      <n-alert type="info" :show-icon="true" size="small" style="margin-bottom: 8px">
        当前平台:
        {{ isWin ? 'Windows ✅' : 'Windows ❌（Thumbar 仅 Windows；闪烁在 Windows/Linux 可用）' }}
      </n-alert>
      <n-space wrap>
        <span style="font-size: 13px">缩略图按钮：</span>
        <n-switch :value="thumbarOn" :disabled="!isWin" @update:value="toggleThumbar" />
        <n-button size="small" @click="flashFrame">任务栏图标闪烁 3 秒</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        缩略图按钮：鼠标悬停任务栏图标时，缩略图下方出现 播放/暂停、下一首 两个按钮 （点击会联动上方
        MediaSession）。闪烁：应用在后台时引起注意的经典提醒方式 （macOS 等价物是 Dock
        bounce，见上方演示）。
      </n-text>
      <n-text v-if="thumbarLog" depth="2" style="display: block; margin-top: 4px; font-size: 12px">
        {{ thumbarLog }}
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/taskbar.ts" :code="taskbarCode" />
    </template>
  </FeatureLayout>
</template>
