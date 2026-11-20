<script setup lang="ts">
/**
 * NetworkSourcePage（网络源 / GNU Radio）
 * - 原始 IQ：TCP ci16/cf32/ci8 → 主进程 TcpIqSource → SourceFrame
 * - 连接成功后自动启动本地分析消费者，/signal/* 页面即可直接出图
 * - 本页只负责连接参数、链路状态与 IQ/频谱预览；录制/回放走源服务既有能力
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import { IqChart, SpectrumChart } from '@components/signal'
import type { SourceFrame } from '../../../../shared/sourceEngine'
import type {
  NetworkFormat,
  NetworkSourceConfig,
  NetworkSourceStatus
} from '../../../../shared/sourceNetwork'
import { networkBytesPerSample, networkFormatLabel } from '../../../../shared/sourceNetwork'
import { buildSourcePreviewSpectrum } from '../../../../shared/sourcePreview'
import type { LocalGnuRadioSettings, LocalGnuRadioStatus } from '../../../../shared/localGnuRadio'

const message = useMessage()
const iqRef = ref<InstanceType<typeof IqChart> | null>(null)
const spectrumRef = ref<InstanceType<typeof SpectrumChart> | null>(null)
const iq0Ref = ref<InstanceType<typeof IqChart> | null>(null)
const iq1Ref = ref<InstanceType<typeof IqChart> | null>(null)
const spectrum0Ref = ref<InstanceType<typeof SpectrumChart> | null>(null)
const spectrum1Ref = ref<InstanceType<typeof SpectrumChart> | null>(null)

const host = ref('127.0.0.1')
const port = ref<number | null>(5000)
const format = ref<NetworkFormat>('ci16')
const wireRate = ref<number | null>(2_000_000)
const centerHz = ref<number | null>(0)
const displayRate = ref<number | null>(2_000_000)
const pointsPerFrame = ref<number | null>(0)
const reconnect = ref(true)
const dualStream = ref(false)
const recordPort = ref<number | null>(0)
const channels = ref<1 | 2>(1)
const activeChannel = ref(0)

const busy = ref(false)
const connected = ref(false)
const status = ref<NetworkSourceStatus | null>(null)
const frameCount = ref(0)
const lastError = ref('')

/** 与主进程 SourceRecordStatusInfo / playbackStatus 对齐的最小类型（避免跨层导入 preload 实现） */
interface RecordStatusInfo {
  recording: boolean
  frames: number
  samples: number
  durationMs: number
  truncated: boolean
  mode: 'memory' | 'stream' | 'raw'
  channels?: number
  archiveDir?: string
  archivedFiles?: number
  archivedBytes?: number
  archiveIndexPath?: string
  diskFreeBytes?: number
  lowDisk?: boolean
  hasUnexported: boolean
}
interface PlaybackStatusInfo {
  playing: boolean
  paused: boolean
  index: number
  total: number
  loop: boolean
  speed: number
  timing: 'fixed' | 'timestamp'
  durationMs: number
  positionMs: number
  channel?: number
}

const recording = ref(false)
const streamMode = ref(false)
const rawArchive = ref(false)
const recordBusy = ref(false)
const recStatus = ref<RecordStatusInfo | null>(null)
const playbackStatus = ref<PlaybackStatusInfo | null>(null)
const playbackChannel = ref<0 | 1>(0)
const playbackFullRate = ref(false)

// ── 本机 GNU Radio 一键启动（Python/脚本/端口均可配置）──
const localPython = ref('')
const localScriptDir = ref('')
const localScriptName = ref('tone_pipeline.py')
const localSampleRate = ref<number | null>(100000)
const localToneFreq = ref<number | null>(10000)
const localCenterHz = ref<number | null>(0)
const localFormat = ref<NetworkFormat>('ci16')
const localTcpPort = ref<number | null>(0)
const localDual = ref(false)
const localDisplayRate = ref<number | null>(100000)
const localRecordPort = ref<number | null>(0)
const localChannels = ref<1 | 2>(1)
const localBusy = ref(false)
const localStarted = ref(false)
const localStatus = ref<LocalGnuRadioStatus | null>(null)
const localDefaults = ref<{
  detectedPython: string
  scriptExists: boolean
  pythonExists: boolean
} | null>(null)

let disposeFrame: (() => void) | null = null
let disposeDualFrame: (() => void) | null = null
let previewMode: 1 | 2 | null = null
let dualFrameCount0 = 0
let dualFrameCount1 = 0
let poll: ReturnType<typeof setInterval> | null = null
let unmounted = false
let analysisStarted = false

const formatOptions: Array<{ label: string; value: NetworkFormat }> = [
  { label: networkFormatLabel('ci16'), value: 'ci16' },
  { label: networkFormatLabel('cf32'), value: 'cf32' },
  { label: networkFormatLabel('ci8'), value: 'ci8' }
]

const wireRateNum = computed(() => Number(wireRate.value ?? 0))
const displayRateNum = computed(() => Number(displayRate.value ?? 0))
const linkMBps = computed(() => (wireRateNum.value * networkBytesPerSample(format.value)) / 1e6)
const effectiveDisplayRate = computed(() => {
  if (wireRateNum.value <= 0 || displayRateNum.value <= 0) return 0
  const stride = Math.max(1, Math.round(wireRateNum.value / displayRateNum.value))
  return wireRateNum.value / stride
})
const autoPoints = computed(() =>
  Math.max(256, Math.min(65_536, Math.round((displayRateNum.value || 1) / 60)))
)
const pointsHint = computed(() => {
  const configured = Number(pointsPerFrame.value ?? 0)
  return configured > 0 ? configured : autoPoints.value
})
const budgetWarning = computed(() => {
  const local = host.value === '127.0.0.1' || host.value.toLowerCase() === 'localhost'
  return !local && linkMBps.value > 80
})
const statusTagType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (connected.value) return 'success'
  if (lastError.value || status.value?.lastError) return 'error'
  return 'default'
})
const mockCommand = computed(() => {
  const dual = dualStream.value
    ? ` --dual --display-sample-rate ${displayRateNum.value || wireRateNum.value}`
    : ''
  const ch = channels.value === 2 ? ' --channels 2 --freq2 15000' : ''
  return `node scripts/gnuradio-mock-tcp.mjs --port ${port.value ?? 5000} --format ${format.value} --sample-rate ${wireRateNum.value} --freq 10000 --framed${dual}${ch}`
})

function formatBytesPerSecond(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} GB/s`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} MB/s`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} KB/s`
  return `${Math.round(bps)} B/s`
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${Math.round(n)} B`
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : '0'
}

async function refreshStatus(): Promise<void> {
  try {
    const s = await window.api.source.networkStatus()
    status.value = s
    connected.value = !!s?.connected
    if (s) activeChannel.value = s.activeChannel ?? 0
    if (s?.lastError) lastError.value = s.lastError
    if (connected.value) subscribePreview()
  } catch {
    // 主进程未就绪/窗口销毁竞态：保留上一状态
  }
}

async function refreshRecordStatus(): Promise<void> {
  try {
    const s = await window.api.source.recordStatus()
    recStatus.value = s
    recording.value = s.recording
  } catch {
    // 忽略
  }
}

async function refreshPlaybackStatus(): Promise<void> {
  try {
    playbackStatus.value = await window.api.source.playbackStatus()
  } catch {
    // 忽略
  }
}

function localSettings(): LocalGnuRadioSettings {
  return {
    pythonPath: localPython.value.trim(),
    scriptDir: localScriptDir.value.trim(),
    scriptName: localScriptName.value.trim() || 'tone_pipeline.py',
    sampleRate: Number(localSampleRate.value ?? 0),
    centerHz: Number(localCenterHz.value ?? 0),
    format: localFormat.value,
    toneFreq: Number(localToneFreq.value ?? 0),
    dualStream: localDual.value,
    displaySampleRate: Number(localDisplayRate.value ?? 0),
    channels: localChannels.value,
    tcpPort: Number(localTcpPort.value ?? 0),
    recordPort: Number(localRecordPort.value ?? 0)
  }
}

async function loadLocalDefaults(): Promise<void> {
  try {
    const d = await window.api.source.localDefaults()
    localDefaults.value = {
      detectedPython: d.detectedPython,
      scriptExists: d.scriptExists,
      pythonExists: d.pythonExists
    }
    localPython.value = d.settings.pythonPath || d.detectedPython
    localScriptDir.value = d.settings.scriptDir
    localScriptName.value = d.settings.scriptName
    localSampleRate.value = d.settings.sampleRate
    localToneFreq.value = d.settings.toneFreq
    localCenterHz.value = d.settings.centerHz
    localFormat.value = d.settings.format
    localTcpPort.value = d.settings.tcpPort
    localDual.value = d.settings.dualStream
    localDisplayRate.value = d.settings.displaySampleRate
    localRecordPort.value = d.settings.recordPort
    localChannels.value = d.settings.channels
    localStatus.value = await window.api.source.localStatus()
    localStarted.value = localStatus.value.running
  } catch {
    // 主进程未就绪：保留空值，用户可手填
  }
}

async function refreshLocalStatus(): Promise<void> {
  try {
    const s = await window.api.source.localStatus()
    localStatus.value = s
    localStarted.value = s.running
  } catch {
    // 忽略
  }
}

async function startLocal(): Promise<void> {
  if (localBusy.value) return
  localBusy.value = true
  try {
    const r = await window.api.source.localStart(localSettings())
    localStatus.value = r.status ?? null
    if (!r.ok) {
      message.error(r.error || '本机 GNU Radio 启动失败')
      return
    }
    if (!r.status) return
    localStarted.value = true
    // 启动脚本返回的端口/格式/采样率直接回填连接参数
    host.value = '127.0.0.1'
    port.value = r.status.port
    format.value = r.status.format
    wireRate.value = r.status.sampleRate
    const useDual = r.status.dual
    if (localDual.value && !useDual) {
      message.warning('脚本未返回 dual=true，本次按单流连接')
      localDual.value = false
    }
    dualStream.value = useDual
    recordPort.value = r.status.recordPort > 0 ? r.status.recordPort : 0
    channels.value = r.status.channels === 2 ? 2 : 1
    activeChannel.value = 0
    displayRate.value = useDual
      ? Math.min(
          r.status.sampleRate,
          Math.max(
            1000,
            r.status.displaySampleRate || Number(localDisplayRate.value ?? r.status.sampleRate)
          )
        )
      : r.status.sampleRate
    centerHz.value = Number(localCenterHz.value ?? 0)
    await connect()
    message.success(`本机 GNU Radio 已启动（端口 ${r.status.port}）`)
  } finally {
    localBusy.value = false
  }
}

async function stopLocal(): Promise<void> {
  try {
    const r = await window.api.source.localStop()
    localStatus.value = r.status ?? null
  } catch {
    // 忽略
  }
  localStarted.value = false
}

async function startRecord(): Promise<void> {
  recordBusy.value = true
  try {
    const r = await window.api.source.recordStart(connected.value ? false : streamMode.value, {
      rawArchive: rawArchive.value
    })
    if (!r.ok) {
      if (r.needsConfirm) message.warning('存在未导出的录制，请先导出或到信号源工作台处理')
      else message.error('录制启动失败')
      return
    }
    recording.value = true
    await refreshRecordStatus()
    message.success(connected.value ? '开始全速 raw 录制' : '开始录制')
  } finally {
    recordBusy.value = false
  }
}

async function stopRecord(): Promise<void> {
  recordBusy.value = true
  try {
    await window.api.source.recordStop()
    recording.value = false
    await refreshRecordStatus()
    message.success('录制已停止')
  } finally {
    recordBusy.value = false
  }
}

async function exportRecord(): Promise<void> {
  recordBusy.value = true
  try {
    const r = await window.api.source.recordExport()
    if (r.ok) message.success(`已导出 ${r.path ?? ''}`)
    else if (!r.canceled) message.error(r.error || '导出失败')
    await refreshRecordStatus()
  } finally {
    recordBusy.value = false
  }
}

async function loadPlayback(): Promise<void> {
  recordBusy.value = true
  try {
    const r = await window.api.source.loadPlayback()
    if (!r.ok) {
      if (!r.canceled) message.error(r.error || '载入录制失败')
      return
    }
    await window.api.source.startPlayback()
    await refreshPlaybackStatus()
    await refreshStatus()
    message.success(`开始回放 ${r.path ?? ''}`)
  } finally {
    recordBusy.value = false
  }
}

async function stopPlayback(): Promise<void> {
  await window.api.source.stopPlayback().catch(() => {})
  await refreshPlaybackStatus()
}

async function loadRawPlayback(): Promise<void> {
  recordBusy.value = true
  try {
    const r = await window.api.source.loadRawPlayback(undefined, {
      channel: playbackChannel.value,
      fullRate: playbackFullRate.value
    })
    if (!r.ok) {
      if (r.needsConfirm) message.warning('存在未导出的录制，请先导出')
      else if (!r.canceled) message.error(r.error || '载入 raw 录制失败')
      return
    }
    await refreshPlaybackStatus()
    await refreshStatus()
    message.success(`开始 raw 回放 ${r.path ?? ''}`)
  } finally {
    recordBusy.value = false
  }
}

async function loadArchivePlayback(): Promise<void> {
  recordBusy.value = true
  try {
    const r = await window.api.source.loadArchivePlayback(undefined, {
      channel: playbackChannel.value,
      fullRate: playbackFullRate.value
    })
    if (!r.ok) {
      if (r.needsConfirm) message.warning('存在未导出的录制，请先导出')
      else if (!r.canceled) message.error(r.error || '载入滚动归档失败')
      return
    }
    await refreshPlaybackStatus()
    await refreshStatus()
    message.success(`开始归档回放 ${r.path ?? ''}`)
  } finally {
    recordBusy.value = false
  }
}

function subscribePreview(force = false): void {
  if (unmounted) return
  const mode: 1 | 2 = channels.value === 2 ? 2 : 1
  if (!force && previewMode === mode && (mode === 1 ? disposeFrame : disposeDualFrame)) return
  disposePreview()
  previewMode = mode
  if (mode === 2) {
    disposeDualFrame = window.api.source.onDualFrame((frame: SourceFrame) => {
      const ch = frame.channel === 1 ? 1 : 0
      const iq = ch === 0 ? iq0Ref.value : iq1Ref.value
      iq?.appendData(frame.data, { sampleRate: frame.sampleRate })
      const count = ch === 0 ? ++dualFrameCount0 : ++dualFrameCount1
      // 每个通道独立降频做预览 FFT
      if (count % 2 !== 0) return
      const preview = buildSourcePreviewSpectrum(frame, { spectrumMode: 'complex' })
      if (!preview) return
      const spectrum = ch === 0 ? spectrum0Ref.value : spectrum1Ref.value
      spectrum?.appendData(preview.data, {
        fftSize: preview.fftSize,
        sampleRate: preview.sampleRate,
        dbScale: preview.dbScale,
        spectrumMode: preview.spectrumMode,
        freqStartHz: preview.freqStartHz,
        binHz: preview.binHz,
        fftShift: preview.fftShift
      })
    })
    return
  }
  disposeFrame = window.api.source.onFrame((frame: SourceFrame) => {
    frameCount.value++
    iqRef.value?.appendData(frame.data, { sampleRate: frame.sampleRate })
    // 预览 FFT 每两帧算一次，避免 60fps 下做无谓的重复 FFT
    if (frameCount.value % 2 !== 0) return
    const preview = buildSourcePreviewSpectrum(frame, { spectrumMode: 'complex' })
    if (!preview) return
    spectrumRef.value?.appendData(preview.data, {
      fftSize: preview.fftSize,
      sampleRate: preview.sampleRate,
      dbScale: preview.dbScale,
      spectrumMode: preview.spectrumMode,
      freqStartHz: preview.freqStartHz,
      binHz: preview.binHz,
      fftShift: preview.fftShift
    })
  })
}

function disposePreview(): void {
  disposeFrame?.()
  disposeFrame = null
  disposeDualFrame?.()
  disposeDualFrame = null
  previewMode = null
  dualFrameCount0 = 0
  dualFrameCount1 = 0
}

async function ensureAnalysis(): Promise<void> {
  try {
    const st = await window.api.signalAnalysis.getStatus()
    if (st.running) return
    const r = await window.api.signalAnalysis.start({ mode: 'local' })
    if (r.ok) {
      analysisStarted = true
      return
    }
    if (!String(r.error ?? '').includes('已运行'))
      message.warning(`本地分析未启动：${r.error ?? '未知错误'}`)
  } catch (e) {
    message.warning(`本地分析未启动：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function connect(): Promise<void> {
  if (busy.value) return
  const wire = Number(wireRate.value ?? 0)
  const display = Number(displayRate.value ?? 0)
  if (display > wire) {
    message.error('显示采样率不能大于线上采样率')
    return
  }
  const recPort = Number(recordPort.value ?? 0)
  if (recPort > 0 && recPort === Number(port.value ?? 0)) {
    message.error('录制端口不能等于显示端口')
    return
  }
  const cfg: NetworkSourceConfig = {
    host: host.value.trim(),
    port: Number(port.value ?? 0),
    format: format.value,
    sampleRate: wire,
    centerHz: Number(centerHz.value ?? 0),
    displaySampleRate: display,
    channels: channels.value,
    pointsPerFrame: Number(pointsPerFrame.value ?? 0),
    dualStream: dualStream.value || recPort > 0,
    recordPort: recPort > 0 ? recPort : 0,
    recordHost: host.value.trim(),
    recordFormat: format.value,
    recordSampleRate: wire,
    reconnect: reconnect.value
  }
  busy.value = true
  lastError.value = ''
  try {
    const r = await window.api.source.startNetwork(cfg)
    if (!r.ok) {
      lastError.value = r.error ?? '连接失败'
      message.error(lastError.value)
      return
    }
    status.value = r.status ?? null
    activeChannel.value = r.status?.activeChannel ?? 0
    connected.value = true
    frameCount.value = 0
    if (unmounted) return
    subscribePreview(true)
    await ensureAnalysis()
    message.success('网络源已连接')
  } catch (e) {
    lastError.value = e instanceof Error ? e.message : String(e)
    message.error(lastError.value)
  } finally {
    busy.value = false
  }
}

async function selectChannel(ch: number): Promise<void> {
  const r = await window.api.source.setActiveChannel(ch)
  if (r.ok) {
    activeChannel.value = ch
    if (r.status) status.value = r.status
  }
}

async function disconnect(): Promise<void> {
  if (recStatus.value?.mode === 'raw' && recStatus.value.hasUnexported) {
    message.warning('raw 录制尚未导出：请先点「导出」，再断开网络源')
    return
  }
  try {
    await window.api.source.stopNetwork()
  } catch {
    // 忽略：窗口/服务可能已销毁
  }
  connected.value = false
  status.value = null
  activeChannel.value = 0
  disposePreview()
  if (analysisStarted) {
    analysisStarted = false
    await window.api.signalAnalysis.stop().catch(() => {})
  }
  if (localStarted.value) await stopLocal()
  message.success('已断开网络源')
}

function syncDisplayRate(): void {
  displayRate.value = wireRate.value
}

async function copyMockCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(mockCommand.value)
    message.success('已复制 Mock 启动命令')
  } catch {
    message.warning(mockCommand.value)
  }
}

onMounted(async () => {
  await loadLocalDefaults()
  await refreshStatus()
  await refreshRecordStatus()
  await refreshPlaybackStatus()
  if (connected.value) await ensureAnalysis()
  poll = setInterval(() => {
    void refreshStatus()
    void refreshRecordStatus()
    void refreshPlaybackStatus()
    void refreshLocalStatus()
  }, 1000)
})

onUnmounted(() => {
  unmounted = true
  disposePreview()
  if (poll) clearInterval(poll)
  poll = null
})
</script>

<template>
  <div class="network-page">
    <div class="page-head">
      <div>
        <h2>🛰️ 网络源（GNU Radio）</h2>
        <p class="sub">
          通过 TCP 接收 GNU Radio 的原始
          IQ（ci16/cf32/ci8），在本机/远程均可；连接后自动启动本地分析， 可直接打开
          IQ/频谱/时频/星座等页面。本页不改变组件库，只新增源后端。
        </p>
      </div>
      <NSpace align="center">
        <NTag :type="statusTagType" :bordered="false">
          {{ connected ? '已连接' : '未连接' }}
        </NTag>
        <NButton size="small" :disabled="!connected" @click="disconnect">断开</NButton>
      </NSpace>
    </div>

    <NGrid :cols="24" :x-gap="16" :y-gap="16">
      <NGi :span="14">
        <NCard title="连接参数" size="small">
          <NForm label-placement="left" label-width="118" size="small">
            <NGrid :cols="2" :x-gap="12">
              <NGi>
                <NFormItem label="主机">
                  <NInput v-model:value="host" placeholder="127.0.0.1 或 LAN IP" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="端口">
                  <NInputNumber v-model:value="port" :min="1" :max="65535" style="width: 100%" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="样本格式">
                  <NSelect v-model:value="format" :options="formatOptions" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="RX 通道数">
                  <NSelect
                    v-model:value="channels"
                    :disabled="connected"
                    :options="[
                      { label: '1（单通道）', value: 1 },
                      { label: '2（AD9361 RX0/RX1）', value: 2 }
                    ]"
                  />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="线上采样率">
                  <NInputNumber
                    v-model:value="wireRate"
                    :min="1000"
                    :max="200000000"
                    :step="1000"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="中心频率 Hz">
                  <NInputNumber v-model:value="centerHz" style="width: 100%" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="显示采样率">
                  <NInputNumber
                    v-model:value="displayRate"
                    :min="1000"
                    :max="200000000"
                    :step="1000"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="每帧点数">
                  <NInputNumber
                    v-model:value="pointsPerFrame"
                    :min="0"
                    :max="65536"
                    :step="256"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="断线重连">
                  <NSwitch v-model:value="reconnect" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="双流">
                  <NSwitch v-model:value="dualStream" />
                </NFormItem>
              </NGi>
              <NGi>
                <NFormItem label="录制端口">
                  <NInputNumber
                    v-model:value="recordPort"
                    :min="0"
                    :max="65535"
                    :precision="0"
                    style="width: 100%"
                  />
                </NFormItem>
              </NGi>
            </NGrid>
            <NSpace>
              <NButton type="primary" :loading="busy" :disabled="connected" @click="connect">
                连接
              </NButton>
              <NButton :disabled="!connected" @click="disconnect">断开</NButton>
              <NButton quaternary @click="syncDisplayRate">显示 = 全速</NButton>
            </NSpace>
            <p class="hint">
              每帧 0 = 自动（显示采样率 / 60）：当前自动 {{ autoPoints }} 点，实际每帧
              {{ pointsHint }} 点，实际显示率 {{ effectiveDisplayRate.toFixed(0) }} S/s。
              双流时桥会发 raw(full) + 显示抽取两路，应用只对显示包做 FFT/展示；
              单流时应用按显示率简单抽取。正式频谱建议让 GNU Radio 侧滤波抽取后再发。
            </p>
          </NForm>
        </NCard>
      </NGi>

      <NGi :span="10">
        <NCard title="链路状态" size="small">
          <div class="stat-row">
            <span>连接</span>
            <NTag size="small" :type="connected ? 'success' : 'default'" :bordered="false">
              {{ connected ? `${status?.host ?? host}:${status?.port ?? port}` : '未连接' }}
            </NTag>
          </div>
          <div class="stat-row">
            <span>线上 / 显示</span>
            <b
              >{{ formatNumber(status?.wireSampleRate ?? wireRateNum) }} /
              {{ formatNumber(status?.displaySampleRate ?? effectiveDisplayRate) }} S/s</b
            >
          </div>
          <div class="stat-row">
            <span>接收速率</span>
            <b>{{ formatBytesPerSecond(status?.bytesPerSecond ?? 0) }}</b>
          </div>
          <div class="stat-row">
            <span>帧 / 样本</span>
            <b
              >{{ formatNumber(status?.frames ?? 0) }} / {{ formatNumber(status?.samples ?? 0) }}</b
            >
          </div>
          <div class="stat-row">
            <span>模式</span>
            <b>{{
              status?.splitStream ? '独立双端口' : status?.dualStream ? '单端口双流' : '单流'
            }}</b>
          </div>
          <div v-if="status?.splitStream" class="stat-row">
            <span>录制连接</span>
            <b
              >{{ status?.recordConnected ? '已连接' : '未连接' }} /
              {{ formatBytesPerSecond(status?.recordBytesPerSecond ?? 0) }}</b
            >
          </div>
          <div class="stat-row">
            <span>raw / 显示包</span>
            <b
              >{{ formatNumber(status?.rawPackets ?? 0) }} /
              {{ formatNumber(status?.displayPackets ?? 0) }}</b
            >
          </div>
          <div v-if="(status?.channels ?? 1) > 1" class="stat-row">
            <span>RX 通道</span>
            <b>
              <NButton
                size="tiny"
                :type="activeChannel === 0 ? 'primary' : 'default'"
                @click="selectChannel(0)"
                >RX0</NButton
              >
              <NButton
                size="tiny"
                :type="activeChannel === 1 ? 'primary' : 'default'"
                @click="selectChannel(1)"
                >RX1</NButton
              >
            </b>
          </div>
          <div v-if="status?.dualStream" class="stat-row">
            <span>录制流</span>
            <b
              >{{ formatNumber(status?.recordSampleRate ?? 0) }} S/s
              {{ status?.recordFormat ?? '' }}</b
            >
          </div>
          <div class="stat-row">
            <span>帧头 / 包</span>
            <b>{{ status?.framed ? 'ELIQ' : '裸流' }} / {{ formatNumber(status?.packets ?? 0) }}</b>
          </div>
          <div v-if="status?.framed" class="stat-row">
            <span>帧头元数据</span>
            <b
              >{{ formatNumber(status?.metadataSampleRate ?? 0) }} S/s @
              {{ formatNumber(status?.metadataCenterHz ?? 0) }} Hz</b
            >
          </div>
          <div class="stat-row">
            <span>seq 丢包 / 缓冲丢样本</span>
            <b
              >{{ formatNumber(status?.droppedPackets ?? 0) }} /
              {{ formatNumber(status?.droppedSamples ?? 0) }}</b
            >
          </div>
          <div class="stat-row">
            <span>重连</span>
            <b>{{ formatNumber(status?.reconnects ?? 0) }}</b>
          </div>
          <div class="stat-row">
            <span>缓冲</span>
            <b>{{ status?.pointsPerFrame ?? pointsHint }} 点/帧</b>
          </div>
          <NAlert
            v-if="lastError || status?.lastError"
            type="error"
            :bordered="false"
            style="margin-top: 10px"
          >
            {{ lastError || status?.lastError }}
          </NAlert>
          <p class="hint">
            本机延迟低、可全速；远程 1 GbE 约 118 MB/s 上限，高采样率请让 GNU Radio 抽取或改用 10
            GbE。
          </p>
        </NCard>
      </NGi>
    </NGrid>

    <NAlert v-if="budgetWarning" type="warning" :bordered="false" style="margin-top: 12px">
      当前链路约 {{ linkMBps.toFixed(1) }} MB/s，超过 1 GbE 的可靠范围（约 80 MB/s）。
      远程高采样率建议：GNU Radio 侧先滤波抽取再发显示流，全速数据在本机落盘后传文件。
    </NAlert>

    <NCard title="本机 GNU Radio（Python / conda，一键启动）" size="small" style="margin-top: 16px">
      <NAlert type="info" :bordered="false" style="margin-bottom: 12px">
        不绑定具体环境：Python 路径、脚本目录、脚本名都可改，配置保存在应用 userData。 默认脚本
        <code>tone_pipeline.py</code> 会启动 flowgraph + ZMQ→TCP 桥并打印
        <code>READY {"port":…}</code>；其他脚本只要接受
        <code>--tcp-port/--format/--sample-rate/--freq/--center-hz</code> 并打印 READY 即可。
      </NAlert>
      <NGrid :cols="2" :x-gap="12">
        <NGi>
          <NFormItem label="Python 路径" label-placement="left" label-width="110" size="small">
            <NInput v-model:value="localPython" placeholder="D:\...\radioconda\python.exe" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="脚本目录" label-placement="left" label-width="110" size="small">
            <NInput v-model:value="localScriptDir" placeholder="tools/gnuradio" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="脚本名" label-placement="left" label-width="110" size="small">
            <NInput v-model:value="localScriptName" placeholder="tone_pipeline.py" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="TCP 端口" label-placement="left" label-width="110" size="small">
            <NInputNumber v-model:value="localTcpPort" :min="0" :max="65535" style="width: 100%" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="录制端口" label-placement="left" label-width="110" size="small">
            <NInputNumber
              v-model:value="localRecordPort"
              :min="0"
              :max="65535"
              style="width: 100%"
            />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="采样率" label-placement="left" label-width="110" size="small">
            <NInputNumber
              v-model:value="localSampleRate"
              :min="1000"
              :max="200000000"
              :step="1000"
              style="width: 100%"
            />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="单音频率" label-placement="left" label-width="110" size="small">
            <NInputNumber v-model:value="localToneFreq" :min="0" style="width: 100%" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="中心频率" label-placement="left" label-width="110" size="small">
            <NInputNumber v-model:value="localCenterHz" style="width: 100%" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="格式" label-placement="left" label-width="110" size="small">
            <NSelect v-model:value="localFormat" :options="formatOptions" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="RX 通道数" label-placement="left" label-width="110" size="small">
            <NSelect
              v-model:value="localChannels"
              :options="[
                { label: '1（单通道）', value: 1 },
                { label: '2（AD9361 RX0/RX1）', value: 2 }
              ]"
            />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="双流" label-placement="left" label-width="110" size="small">
            <NSwitch v-model:value="localDual" />
          </NFormItem>
        </NGi>
        <NGi>
          <NFormItem label="显示采样率" label-placement="left" label-width="110" size="small">
            <NInputNumber
              v-model:value="localDisplayRate"
              :min="1000"
              :max="200000000"
              :step="1000"
              style="width: 100%"
            />
          </NFormItem>
        </NGi>
      </NGrid>
      <NSpace align="center">
        <NButton
          type="primary"
          :loading="localBusy"
          :disabled="localStatus?.running"
          @click="startLocal"
        >
          启动并连接
        </NButton>
        <NButton :disabled="!localStatus?.running" @click="stopLocal">停止本机</NButton>
        <NButton quaternary @click="loadLocalDefaults">重新检测</NButton>
        <NTag v-if="localStatus?.running" type="success" size="small" :bordered="false">
          运行中 :{{ localStatus?.port }}
        </NTag>
        <NTag v-else type="default" size="small" :bordered="false">未运行</NTag>
      </NSpace>
      <p v-if="localDefaults && !localDefaults.pythonExists" class="hint">
        自动探测没有找到 Python；请填 radioconda/miniconda 环境里的 python.exe。
      </p>
      <NAlert v-if="localStatus?.lastError" type="error" :bordered="false" style="margin-top: 10px">
        {{ localStatus.lastError }}
      </NAlert>
      <pre class="cmd log">{{ (localStatus?.log ?? []).join('\n') || '（暂无日志）' }}</pre>
    </NCard>

    <NCard title="录制 / 回放" size="small" style="margin-top: 16px">
      <NGrid :cols="24" :x-gap="16">
        <NGi :span="13">
          <div class="section-title">录制（网络源：全速 raw；模拟源：SourceRecorder）</div>
          <p v-if="connected" class="hint">
            当前网络源录制会把 ci16/cf32/ci8 原始 payload 直接写盘（不做 Float32 转换），
            「流式落盘」开关对网络源无效。
          </p>
          <NSpace align="center">
            <NSwitch v-model:value="streamMode" size="small" :disabled="connected" />
            <span class="hint">流式落盘（长录制）</span>
            <NCheckbox v-model:checked="rawArchive" size="small" :disabled="!connected"
              >滚动归档</NCheckbox
            >
            <NButton
              size="small"
              type="primary"
              :loading="recordBusy"
              :disabled="recording"
              @click="startRecord"
              >开始录制</NButton
            >
            <NButton size="small" :disabled="!recording" @click="stopRecord">停止</NButton>
            <NButton
              size="small"
              :disabled="!recStatus || recStatus.frames === 0"
              @click="exportRecord"
              >导出</NButton
            >
          </NSpace>
          <p class="hint">
            帧 {{ recStatus?.frames ?? 0 }} / 样本 {{ formatNumber(recStatus?.samples ?? 0) }} /
            时长 {{ ((recStatus?.durationMs ?? 0) / 1000).toFixed(1) }}s
            {{ recStatus?.truncated ? '（已达上限截断）' : '' }}
            {{
              recStatus?.mode === 'stream'
                ? '（流式）'
                : recStatus?.mode === 'raw'
                  ? '（全速 raw）'
                  : '（内存）'
            }}
          </p>
          <p v-if="recStatus?.archiveDir" class="hint">
            归档：{{ recStatus.archivedFiles ?? 0 }} 段 /
            {{ formatBytes(recStatus.archivedBytes ?? 0) }} → {{ recStatus.archiveDir }}
            <span v-if="recStatus.lowDisk" style="color: #d03050">⚠ 磁盘剩余低</span>
            <span v-else-if="recStatus.diskFreeBytes">
              （剩余 {{ formatBytes(recStatus.diskFreeBytes) }}）
            </span>
          </p>
        </NGi>
        <NGi :span="11">
          <div class="section-title">回放（源服务既有 .f32 + .json）</div>
          <NSpace align="center">
            <NButton size="small" :loading="recordBusy" @click="loadPlayback"
              >载入录制并回放</NButton
            >
            <NButton size="small" :loading="recordBusy" @click="loadRawPlayback"
              >载入 raw 回放</NButton
            >
            <NButton size="small" :loading="recordBusy" @click="loadArchivePlayback"
              >载入归档回放</NButton
            >
            <NSelect
              v-model:value="playbackChannel"
              size="small"
              style="width: 128px"
              :options="[
                { label: 'raw RX0', value: 0 },
                { label: 'raw RX1', value: 1 }
              ]"
            />
            <NCheckbox v-model:checked="playbackFullRate" size="small">全速</NCheckbox>
            <NButton size="small" :disabled="!playbackStatus?.playing" @click="stopPlayback"
              >停止回放</NButton
            >
          </NSpace>
          <p class="hint">
            回放 {{ playbackStatus?.index ?? 0 }}/{{ playbackStatus?.total ?? 0 }}，
            {{ ((playbackStatus?.positionMs ?? 0) / 1000).toFixed(1) }}s /
            {{ ((playbackStatus?.durationMs ?? 0) / 1000).toFixed(1) }}s
            {{ playbackStatus?.paused ? '（已暂停）' : '' }}
            {{ playbackStatus?.channel !== undefined ? ` · RX${playbackStatus.channel}` : '' }}
          </p>
        </NGi>
      </NGrid>
    </NCard>

    <template v-if="channels === 2">
      <NGrid :cols="24" :x-gap="16" :y-gap="16" style="margin-top: 16px">
        <NGi :span="12">
          <NCard title="RX0 IQ 预览" size="small">
            <IqChart ref="iq0Ref" :height="200" :max-points="200000" />
          </NCard>
        </NGi>
        <NGi :span="12">
          <NCard title="RX1 IQ 预览" size="small">
            <IqChart ref="iq1Ref" :height="200" :max-points="200000" />
          </NCard>
        </NGi>
      </NGrid>
      <NGrid :cols="24" :x-gap="16" :y-gap="16" style="margin-top: 16px">
        <NGi :span="12">
          <NCard title="RX0 频谱预览" size="small">
            <SpectrumChart ref="spectrum0Ref" :height="200" :fft-size="1024" />
          </NCard>
        </NGi>
        <NGi :span="12">
          <NCard title="RX1 频谱预览" size="small">
            <SpectrumChart ref="spectrum1Ref" :height="200" :fft-size="1024" />
          </NCard>
        </NGi>
      </NGrid>
      <p class="hint" style="margin-top: 8px">
        双通道并排预览独立于 RX0/RX1 选择；右侧图表/分析仍只使用当前选中通道。
      </p>
    </template>
    <NGrid v-else :cols="24" :x-gap="16" :y-gap="16" style="margin-top: 16px">
      <NGi :span="12">
        <NCard title="IQ 预览" size="small">
          <IqChart ref="iqRef" :height="220" :max-points="200000" />
          <p class="hint">仅显示网络源推送的 IQ；完整分析请到 /signal/iq。</p>
        </NCard>
      </NGi>
      <NGi :span="12">
        <NCard title="频谱预览" size="small">
          <SpectrumChart ref="spectrumRef" :height="220" :fft-size="1024" />
          <p class="hint">
            固定 Hann + 1024 点，不受「分析配置」影响；完整频谱到 /signal/spectrum。
          </p>
        </NCard>
      </NGi>
    </NGrid>

    <NCard title="快速开始" size="small" style="margin-top: 16px">
      <NDivider title-placement="left">没有 GNU Radio 时：Mock 服务</NDivider>
      <p class="hint">
        另开终端运行下面的命令，再点上方「连接」即可看到 10 kHz 单音（ci16 2 MSPS）：
      </p>
      <pre class="cmd">{{ mockCommand }}</pre>
      <NButton size="small" secondary @click="copyMockCommand">复制命令</NButton>
      <NDivider title-placement="left">GNU Radio 侧（Windows radioconda）</NDivider>
      <pre class="cmd">
conda activate radioconda
# 一键：flowgraph + ZMQ→TCP 桥
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --sample-rate 100000 --freq 10000
# 双流：--sample-rate 120000 --display-sample-rate 60000 --dual
# 独立端口：--record-port 5001 --sample-rate 120000 --display-sample-rate 60000
# 双通道：--channels 2 --freq2 15000
# 或分开：tone_zmq_sink.py + zmq_to_tcp.py，见 tools/gnuradio/README.md</pre>
      <p class="hint">
        GNU Radio 3.10.12 的 gr-blocks 没有 tcp_sink，所以走 ZMQ + 桥；详见
        <code>tools/gnuradio/README.md</code> 与 <code>docs/SRC-02</code>。
      </p>
      <p class="hint">
        详细 flowgraph、录制/回放、速率预算与排错见仓库
        <code>docs/SRC-02-GNU Radio 接入.md</code>。
      </p>
    </NCard>
  </div>
</template>

<style scoped>
.network-page {
  padding: 16px;
  max-width: 1320px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.page-head h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.sub {
  margin: 0;
  color: var(--text-color-2);
  font-size: 13px;
  line-height: 1.6;
}
.hint {
  margin: 8px 0 0;
  color: var(--text-color-2);
  font-size: 12px;
  line-height: 1.6;
}
.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border-color);
  font-size: 13px;
}
.stat-row:last-of-type {
  border-bottom: none;
}
.cmd {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-toolbar-bg);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.log {
  max-height: 180px;
  overflow: auto;
}
</style>
