<script setup lang="ts">
/**
 * 媒体捕获演示页
 * 演示：摄像头/麦克风预览（getUserMedia）+ 录制（MediaRecorder）+ 桌面录屏（getDisplayMedia）
 * 权限链路：security.ts 白名单放行 media / display-capture → 录屏还需主进程
 *           setDisplayMediaRequestHandler 授权（Electron 默认不支持 getDisplayMedia）
 *           → macOS 还需系统级授权（systemAccess.ts）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { NCard, NButton, NSpace, NAlert, NText, NModal, NImage, useMessage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import securityCode from '../../../main/features/security.ts?raw'
import desktopCaptureCode from '../../../main/features/desktopCapture.ts?raw'

const message = useMessage()

/** 与主进程 desktopCapture.ts 推送的源结构一致 */
interface DisplaySourceInfo {
  id: string
  name: string
  thumbnail: string | null
}

const camVideo = ref<HTMLVideoElement | null>(null)
const camPlayback = ref<HTMLVideoElement | null>(null)
const screenVideo = ref<HTMLVideoElement | null>(null)
const screenPlayback = ref<HTMLVideoElement | null>(null)

let camStream: MediaStream | null = null
let camRecorder: MediaRecorder | null = null
let camChunks: Blob[] = []
let camBlobUrl = ''

let screenStream: MediaStream | null = null
let screenRecorder: MediaRecorder | null = null
let screenChunks: Blob[] = []
let screenBlobUrl = ''

const camActive = ref(false)
const camRecording = ref(false)
const screenActive = ref(false)
const screenRecording = ref(false)
const macMediaStatus = ref<string>('')

// ── 录屏源选择弹窗（主进程 setDisplayMediaRequestHandler 接管）──
const showSourcePicker = ref(false)
const displaySources = ref<DisplaySourceInfo[]>([])
/** 本次录屏请求的 token（与主进程 pendingDisplays 关联，见 desktopCapture.ts） */
const pickToken = ref('')
let disposeDisplaySources: (() => void) | null = null

/** 选择受支持的 webm 编码（vp9 不支持则退回默认） */
function pickMime(): string {
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
}

onMounted(async () => {
  // 主进程 setDisplayMediaRequestHandler → 推送 { token, sources } → 弹窗选择
  disposeDisplaySources = window.api.capture.onDisplaySources((payload) => {
    pickToken.value = payload.token
    displaySources.value = payload.sources
    showSourcePicker.value = true
  })
  // macOS：查询系统级媒体权限（应用白名单之外的"第二道锁"，见 systemAccess.ts）
  const status = await window.api.system.getMediaAccessStatus()
  if (status.supported) {
    macMediaStatus.value = `摄像头: ${status.camera} · 麦克风: ${status.microphone}（如未授权，请在系统设置中允许）`
  }
})

onUnmounted(() => {
  disposeDisplaySources?.() // 移除录屏源事件监听
  if (showSourcePicker.value) cancelSource() // 弹窗未关时通知主进程取消
  stopCamera()
  stopScreen()
})

// ── 摄像头 / 麦克风 ────────────────────────────────
async function startCamera(): Promise<void> {
  try {
    // 权限请求 → security.ts 的 setPermissionRequestHandler（白名单含 media）
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    if (camVideo.value) camVideo.value.srcObject = camStream
    camActive.value = true
    message.success('摄像头/麦克风已打开')
  } catch (error) {
    message.error(
      `无法访问媒体设备: ${(error as Error).message}（检查 security.ts 白名单与系统授权）`
    )
  }
}

function stopCamera(): void {
  camStream?.getTracks().forEach((track) => track.stop())
  camStream = null
  camActive.value = false
  stopCamRecord()
}

/** 录制 5 秒（或手动停止）→ 生成 webm 回放 */
function startCamRecord(): void {
  if (!camStream) {
    message.warning('请先打开摄像头')
    return
  }
  camChunks = []
  camRecorder = new MediaRecorder(camStream, { mimeType: pickMime() })
  camRecorder.ondataavailable = (e): void => {
    if (e.data.size > 0) camChunks.push(e.data)
  }
  camRecorder.onstop = (): void => {
    if (camBlobUrl) URL.revokeObjectURL(camBlobUrl)
    camBlobUrl = URL.createObjectURL(new Blob(camChunks, { type: 'video/webm' }))
    if (camPlayback.value) {
      camPlayback.value.src = camBlobUrl
      camPlayback.value.play()
    }
    camRecording.value = false
  }
  camRecorder.start()
  camRecording.value = true
  message.info('录制中…（再次点击停止）')
}

function stopCamRecord(): void {
  if (camRecorder && camRecorder.state !== 'inactive') camRecorder.stop()
}

function toggleCamRecord(): void {
  camRecording.value ? stopCamRecord() : startCamRecord()
}

// ── 桌面录屏（getDisplayMedia）────────────────────
async function startScreen(): Promise<void> {
  try {
    // 触发主进程 setDisplayMediaRequestHandler（desktopCapture.ts）：
    // 枚举源 → 推给本页弹窗 → 用户选择 → 授权流返回（Electron 默认不支持 getDisplayMedia）
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    if (screenVideo.value) screenVideo.value.srcObject = screenStream
    screenActive.value = true
    // 用户点"停止共享"（浏览器自带提示条）时同步状态
    screenStream.getVideoTracks()[0]?.addEventListener('ended', stopScreen)
    message.success('已开始共享（应用内弹窗选择的屏幕/窗口）')
  } catch (error) {
    // 取消 / 超时 / 无源时：主进程 callback({}) → Chromium 拒绝 Promise
    message.info(`已取消共享: ${(error as Error).name}`)
  }
}

/** 弹窗中选择某个屏幕/窗口：回传 token + 源信息，getDisplayMedia 的 Promise 随之 resolve */
function pickSource(sourceId: string, sourceName: string): void {
  showSourcePicker.value = false
  window.api.capture.selectDisplaySource(pickToken.value, sourceId, sourceName)
}

function cancelSource(): void {
  showSourcePicker.value = false
  if (pickToken.value) window.api.capture.cancelDisplaySource(pickToken.value)
}

function stopScreen(): void {
  screenStream?.getTracks().forEach((track) => track.stop())
  screenStream = null
  screenActive.value = false
  stopScreenRecord()
}

function startScreenRecord(): void {
  if (!screenStream) {
    message.warning('请先开始共享')
    return
  }
  screenChunks = []
  screenRecorder = new MediaRecorder(screenStream, { mimeType: pickMime() })
  screenRecorder.ondataavailable = (e): void => {
    if (e.data.size > 0) screenChunks.push(e.data)
  }
  screenRecorder.onstop = (): void => {
    if (screenBlobUrl) URL.revokeObjectURL(screenBlobUrl)
    screenBlobUrl = URL.createObjectURL(new Blob(screenChunks, { type: 'video/webm' }))
    if (screenPlayback.value) screenPlayback.value.src = screenBlobUrl
    screenRecording.value = false
  }
  screenRecorder.start()
  screenRecording.value = true
  message.info('录屏中…（再次点击停止）')
}

function stopScreenRecord(): void {
  if (screenRecorder && screenRecorder.state !== 'inactive') screenRecorder.stop()
}

function toggleScreenRecord(): void {
  screenRecording.value ? stopScreenRecord() : startScreenRecord()
}

/** 保存录屏：blob URL + a[download] 会走 will-download → 联动下载管理（download.ts） */
function saveScreen(): void {
  if (!screenBlobUrl) {
    message.warning('请先录制一段视频')
    return
  }
  const a = document.createElement('a')
  a.href = screenBlobUrl
  a.download = `录屏-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`
  a.click()
  message.success('已发起保存，去"下载管理"页查看进度（will-download 链路）')
}
</script>

<template>
  <FeatureLayout
    title="媒体捕获（摄像头/麦克风/录屏）"
    api="getUserMedia / getDisplayMedia / MediaRecorder"
    intro="视频会议、录屏软件的技术底座。链路：页面申请权限 → security.ts 白名单裁决（media / display-capture）→ 录屏还需主进程 setDisplayMediaRequestHandler 授权（Electron 默认不支持 getDisplayMedia，不注册会抛 NotSupportedError）→ macOS 还需系统级授权 → 拿到 MediaStream 预览 → MediaRecorder 录制 webm。注意双重权限：应用白名单之外，macOS 还有系统隐私设置这'第二道锁'。"
  >
    <n-card size="small" title="摄像头 / 麦克风（getUserMedia）" style="margin-bottom: 12px">
      <n-alert
        v-if="macMediaStatus"
        type="info"
        size="small"
        :show-icon="true"
        style="margin-bottom: 8px"
      >
        macOS 系统级权限状态: {{ macMediaStatus }}
      </n-alert>
      <n-space>
        <n-button type="primary" :disabled="camActive" @click="startCamera">打开摄像头</n-button>
        <n-button :disabled="!camActive" @click="stopCamera">关闭</n-button>
        <n-button :disabled="!camActive" @click="toggleCamRecord">
          {{ camRecording ? '停止录制' : '录制 5 秒' }}
        </n-button>
      </n-space>
      <div style="display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap">
        <video ref="camVideo" autoplay muted playsinline class="media-box"></video>
        <video ref="camPlayback" controls playsinline class="media-box"></video>
      </div>
      <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px">
        左：实时预览 · 右：录制回放（录制由 MediaRecorder 输出 webm 流，无需主进程参与）
      </n-text>
    </n-card>

    <n-card size="small" title="桌面录屏（getDisplayMedia）">
      <n-space>
        <n-button type="primary" :disabled="screenActive" @click="startScreen"
          >开始屏幕共享</n-button
        >
        <n-button :disabled="!screenActive" @click="stopScreen">停止共享</n-button>
        <n-button :disabled="!screenActive" @click="toggleScreenRecord">
          {{ screenRecording ? '停止录屏' : '开始录屏' }}
        </n-button>
        <n-button type="success" :disabled="!screenBlobUrl" @click="saveScreen">
          保存录屏（联动下载管理）
        </n-button>
      </n-space>
      <div style="display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap">
        <video ref="screenVideo" autoplay muted playsinline class="media-box"></video>
        <video ref="screenPlayback" controls playsinline class="media-box"></video>
      </div>
      <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px">
        点击"开始屏幕共享"会弹出应用内选择器（主进程枚举的屏幕/窗口缩略图，见下方弹窗）；录制停止后右侧为回放。
        保存走 a[download] → will-download → download.ts 完整下载链路。
      </n-text>
    </n-card>

    <!-- 屏幕源选择弹窗（替代 Chromium 默认选择器：主进程 setDisplayMediaRequestHandler 接管） -->
    <n-modal
      :show="showSourcePicker"
      :mask-closable="false"
      @update:show="(v: boolean) => !v && cancelSource()"
    >
      <n-card style="width: 640px" title="选择要共享的屏幕 / 窗口">
        <n-alert type="info" size="small" :show-icon="true" style="margin-bottom: 8px">
          列表由主进程 desktopCapturer.getSources 枚举并推送；选择后 getDisplayMedia 的 Promise 才会
          resolve。
        </n-alert>
        <template v-if="displaySources.length === 0">
          <n-alert type="warning" size="small">没有可用屏幕源（将取消本次共享请求）</n-alert>
        </template>
        <div
          v-else
          style="display: flex; gap: 12px; flex-wrap: wrap; max-height: 380px; overflow: auto"
        >
          <div
            v-for="src in displaySources"
            :key="src.id"
            class="source-item"
            @click="pickSource(src.id, src.name)"
          >
            <n-image
              v-if="src.thumbnail"
              :src="src.thumbnail"
              width="180"
              :fallback-src="undefined"
              preview-disabled
              style="
                border-radius: 6px;
                border: 1px solid var(--border-color);
                pointer-events: none;
              "
            />
            <div v-else class="source-placeholder">
              <n-text depth="3" style="font-size: 11px">无缩略图</n-text>
            </div>
            <n-text
              depth="2"
              style="
                display: block;
                font-size: 12px;
                max-width: 180px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              "
            >
              {{ src.name }}
            </n-text>
          </div>
        </div>
        <template #footer>
          <n-space justify="end">
            <n-button @click="cancelSource">取消</n-button>
          </n-space>
        </template>
      </n-card>
    </n-modal>

    <template #code>
      <CodeBlock file="src/main/features/security.ts" :code="securityCode" />
      <div style="height: 12px" />
      <CodeBlock file="src/main/features/desktopCapture.ts" :code="desktopCaptureCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.media-box {
  width: 320px;
  height: 200px;
  background: #000;
  border-radius: 6px;
  object-fit: contain;
}
.source-item {
  text-align: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}
.source-item:hover {
  background: var(--action-color);
}
.source-placeholder {
  width: 180px;
  height: 101px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
