<script setup lang="ts">
/**
 * SourceWorkbenchPage（信号源工作台）
 * - 源领域页面：波形/输出/损伤/播放，不包含 FFT/窗等分析配置
 * - 当前复用主进程 signalAnalysis 的本地源与 IQ 帧；后续 SourceEngine 迁移时保持本页参数契约
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInputNumber,
  NSelect,
  NSlider,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  useMessage
} from 'naive-ui'
import { IqChart, SpectrumChart } from '@components/signal'
import { useSignalAnalysis } from '../../composables/useSignalAnalysis'
import type { SourceFrame } from '../../../../shared/sourceEngine'
import type { SignalAnalysisConfig } from '../../../../shared/signal'
import {
  SOURCE_CATALOG,
  sourceKindMeta,
  sourceKindOf,
  sourceKindPatch,
  sourceSummary,
  type SourceKind
} from '../../../../shared/source'

const message = useMessage()
const analysis = useSignalAnalysis({ autoSubscribe: true })
const iqRef = ref<InstanceType<typeof IqChart> | null>(null)
const spectrumRef = ref<InstanceType<typeof SpectrumChart> | null>(null)

const running = ref(false)
const sourceMode = ref<'live' | 'playback'>('live')
const playbackLoaded = ref(false)
const playbackPaused = ref(false)
const playbackSpeed = ref(1)
const playbackTiming = ref<'fixed' | 'timestamp'>('fixed')
const playbackLoop = ref(true)
const playbackPath = ref('')
const playbackIndex = ref(0)
const playbackTotal = ref(0)
const playbackDurationMs = ref(0)
const playbackPositionMs = ref(0)
let analysisStartedHere = false
const kind = ref<SourceKind>('cw')
const outputMode = ref<'real' | 'complex'>('complex')
const carrierHz = ref(512)
const amplitude = ref(1)
const snrDb = ref(20)
const sampleRate = ref(4096)
const pointsPerFrame = ref(2048)
const samplesPerSymbol = ref(16)
const ofdmSubcarriers = ref(32)
const ofdmCpRatio = ref(0.25)
const modFreq = ref(50)
const amDepth = ref(0.5)
const fmDeviation = ref(200)
const pulsePeriod = ref(0.01)
const pulseDuty = ref(0.5)
const toneSpacing = ref(100)
const enabled = ref(true)
const frameCount = ref(0)
const recording = ref(false)
const recordFrames = ref(0)
const recordSamples = ref(0)
const recordDurationMs = ref(0)
const recordTruncated = ref(false)
const streamRecord = ref(false)
const recordBusy = ref(false)
let recordPoll: ReturnType<typeof setInterval> | null = null
const lastFrame = ref<{
  seq: number
  sampleRate?: number
  outputMode?: string
  waveform?: string
  centerFrequencyHz?: number
} | null>(null)

const meta = computed(() => sourceKindMeta(kind.value))
const summary = computed(() =>
  sourceSummary({
    ...configWith({ waveform: meta.value.waveform, modType: meta.value.modType ?? 'sine' }),
    outputMode: outputMode.value,
    freq: carrierHz.value,
    amplitude: amplitude.value,
    snr: snrDb.value,
    sampleRate: sampleRate.value,
    pointsPerFrame: pointsPerFrame.value
  } as SignalAnalysisConfig)
)
const isDigital = computed(() => meta.value.waveform === 'digital')

function configWith(patch: Partial<SignalAnalysisConfig>): Partial<SignalAnalysisConfig> {
  return {
    ...sourceKindPatch(kind.value),
    outputMode: outputMode.value,
    freq: carrierHz.value,
    amplitude: amplitude.value,
    snr: snrDb.value,
    sampleRate: sampleRate.value,
    pointsPerFrame: pointsPerFrame.value,
    samplesPerSymbol: samplesPerSymbol.value,
    ofdmSubcarriers: ofdmSubcarriers.value,
    ofdmCpRatio: ofdmCpRatio.value,
    modFreq: modFreq.value,
    amDepth: amDepth.value,
    fmDeviation: fmDeviation.value,
    pulsePeriod: pulsePeriod.value,
    pulseDuty: pulseDuty.value,
    toneSpacing: toneSpacing.value,
    enabled: enabled.value,
    ...patch
  }
}

function applyKind(): void {
  const m = meta.value
  if (m.waveform === 'digital') {
    // 数字源强制复数/独立 IQ 才能正确看星座；仍允许用户改回 real
    if (outputMode.value === 'real') outputMode.value = 'complex'
  }
}

function hydrate(c: Partial<SignalAnalysisConfig>): void {
  if (!c) return
  kind.value = sourceKindOf({
    waveform: c.waveform ?? 'cw',
    modType: c.modType ?? 'sine'
  })
  if (c.outputMode) outputMode.value = c.outputMode
  if (typeof c.freq === 'number') carrierHz.value = c.freq
  if (typeof c.amplitude === 'number') amplitude.value = c.amplitude
  if (typeof c.snr === 'number') snrDb.value = c.snr
  if (typeof c.sampleRate === 'number') sampleRate.value = c.sampleRate
  if (typeof c.pointsPerFrame === 'number') pointsPerFrame.value = c.pointsPerFrame
  if (typeof c.samplesPerSymbol === 'number') samplesPerSymbol.value = c.samplesPerSymbol
  if (typeof c.ofdmSubcarriers === 'number') ofdmSubcarriers.value = c.ofdmSubcarriers
  if (typeof c.ofdmCpRatio === 'number') ofdmCpRatio.value = c.ofdmCpRatio
  if (typeof c.modFreq === 'number') modFreq.value = c.modFreq
  if (typeof c.amDepth === 'number') amDepth.value = c.amDepth
  if (typeof c.fmDeviation === 'number') fmDeviation.value = c.fmDeviation
  if (typeof c.pulsePeriod === 'number') pulsePeriod.value = c.pulsePeriod
  if (typeof c.pulseDuty === 'number') pulseDuty.value = c.pulseDuty
  if (typeof c.toneSpacing === 'number') toneSpacing.value = c.toneSpacing
  if (typeof c.enabled === 'boolean') enabled.value = c.enabled
}

async function refreshStatus(sync = false): Promise<void> {
  const st = await window.api.source.getStatus()
  running.value = st.running
  sourceMode.value = (st as { mode?: 'live' | 'playback' }).mode ?? 'live'
  if (sync && st.config) hydrate(st.config as Partial<SignalAnalysisConfig>)
}

async function refreshPlaybackStatus(): Promise<void> {
  try {
    const p = await window.api.source.playbackStatus()
    if (!p) {
      playbackLoaded.value = false
      playbackIndex.value = 0
      playbackTotal.value = 0
      return
    }
    playbackLoaded.value = true
    playbackPaused.value = p.paused
    playbackSpeed.value = p.speed ?? 1
    playbackTiming.value = p.timing ?? 'fixed'
    playbackLoop.value = p.loop
    playbackIndex.value = p.index
    playbackTotal.value = p.total
    playbackDurationMs.value = p.durationMs ?? 0
    playbackPositionMs.value = p.positionMs ?? 0
  } catch {
    /* ignore */
  }
}

async function loadPlayback(): Promise<void> {
  try {
    const r = (await window.api.source.loadPlayback()) as {
      ok: boolean
      path?: string
      canceled?: boolean
      error?: string
    }
    if (r.canceled) return
    if (!r.ok) {
      message.error(r.error || '回放加载失败')
      return
    }
    playbackPath.value = r.path ?? ''
    await refreshStatus()
    await refreshPlaybackStatus()
    message.success('开始回放录制')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function stopPlayback(): Promise<void> {
  await window.api.source.stopPlayback().catch(() => {})
  await refreshStatus()
  await refreshPlaybackStatus()
  message.success('回放已停止')
}

async function togglePlaybackPause(): Promise<void> {
  if (playbackPaused.value) await window.api.source.resumePlayback().catch(() => {})
  else await window.api.source.pausePlayback().catch(() => {})
  await refreshPlaybackStatus()
}

async function stepPlayback(): Promise<void> {
  await window.api.source.stepPlayback().catch(() => {})
  await refreshPlaybackStatus()
}

async function onPlaybackSpeed(): Promise<void> {
  await window.api.source.setPlaybackSpeed(playbackSpeed.value).catch(() => {})
  await refreshPlaybackStatus()
}

async function onPlaybackTiming(): Promise<void> {
  await window.api.source.setPlaybackTiming(playbackTiming.value).catch(() => {})
  await refreshPlaybackStatus()
}

async function onPlaybackLoop(): Promise<void> {
  await window.api.source.setPlaybackLoop(playbackLoop.value).catch(() => {})
  await refreshPlaybackStatus()
}

async function onSeekPlayback(index: number): Promise<void> {
  await window.api.source.seekPlayback(index).catch(() => {})
  await refreshPlaybackStatus()
}

async function applyConfig(): Promise<boolean> {
  const r = (await window.api.source.setConfig(
    configWith({}) as unknown as Record<string, unknown>
  )) as { ok: boolean; error?: string }
  if (!r.ok) {
    message.error(r.error || '源参数下发失败')
    return false
  }
  return true
}

async function startSource(): Promise<void> {
  if (!(await applyConfig())) return
  const r = (await window.api.source.start()) as { ok: boolean; error?: string }
  if (!r.ok) {
    message.error(r.error || '源启动失败')
    await refreshStatus()
    return
  }
  // 源启动后顺带启动本地分析消费者，分析 UI 页面才能收到 signal:analysis 帧。
  // 已运行（例如高级配置页）则保持原状态。
  const ar = (await window.api.signalAnalysis.start({ mode: 'local' }).catch(() => null)) as {
    ok?: boolean
    error?: string
  } | null
  analysisStartedHere = !!ar?.ok
  if (!ar?.ok && ar?.error && !ar.error.includes('已运行')) {
    message.warning(`源已启动，但分析消费者未启动：${ar.error}`)
  } else {
    message.success('信号源已启动')
  }
  await refreshStatus()
}

async function stopSource(): Promise<void> {
  if (analysisStartedHere) {
    await window.api.signalAnalysis.stop().catch(() => {})
    analysisStartedHere = false
  }
  if (recording.value) {
    await window.api.source.recordStop().catch(() => {})
    recording.value = false
  }
  await window.api.source.stop()
  await refreshStatus()
  await refreshRecordStatus()
  message.success('信号源已停止')
}

async function refreshRecordStatus(): Promise<void> {
  try {
    const st = (await window.api.source.recordStatus()) as {
      recording: boolean
      frames: number
      samples: number
      durationMs: number
      truncated: boolean
    }
    recording.value = st.recording
    recordFrames.value = st.frames
    recordSamples.value = st.samples
    recordDurationMs.value = st.durationMs
    recordTruncated.value = st.truncated
  } catch {
    /* ignore */
  }
}

async function toggleRecord(): Promise<void> {
  if (recording.value) {
    await window.api.source.recordStop().catch(() => {})
    recording.value = false
    await refreshRecordStatus()
    return
  }
  if (!running.value) {
    message.warning('请先启动源再录制')
    return
  }
  await window.api.source.recordStart(streamRecord.value).catch(() => {})
  await refreshRecordStatus()
  message.success(streamRecord.value ? '开始流式录制源帧' : '开始录制源帧')
}

async function exportRecord(): Promise<void> {
  if (recordFrames.value === 0) {
    message.warning('当前没有录制数据')
    return
  }
  recordBusy.value = true
  try {
    const r = (await window.api.source.recordExport()) as {
      ok: boolean
      path?: string
      metaPath?: string
      canceled?: boolean
      error?: string
    }
    if (r.canceled) return
    if (!r.ok) {
      message.error(r.error || '导出失败')
      return
    }
    message.success(`已导出 ${r.path}（元数据 ${r.metaPath}）`)
  } finally {
    recordBusy.value = false
    await refreshRecordStatus()
  }
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

async function applyAndNotify(): Promise<void> {
  if (await applyConfig()) message.success('源参数已下发')
}
async function triggerOnce(): Promise<void> {
  const r = (await window.api.source.trigger()) as { ok: boolean }
  if (r.ok) message.info('已触发一帧')
  else message.warning('当前源不支持单帧触发')
}

let disposeSourceFrame: (() => void) | null = null

onMounted(async () => {
  await refreshStatus(true)
  await refreshRecordStatus()
  await refreshPlaybackStatus()
  recordPoll = setInterval(() => {
    void refreshRecordStatus()
    void refreshPlaybackStatus()
  }, 1000)
  disposeSourceFrame = window.api.source.onFrame((frame: SourceFrame) => {
    frameCount.value++
    lastFrame.value = {
      seq: frame.seq,
      sampleRate: frame.sampleRate,
      outputMode: frame.outputMode,
      waveform: frame.waveform,
      centerFrequencyHz: frame.centerFrequencyHz
    }
    iqRef.value?.appendData(frame.data, {
      sampleRate: frame.sampleRate ?? sampleRate.value
    })
  })
  analysis.onSpectrum((data, frame) => {
    spectrumRef.value?.appendData(data, {
      fftSize: frame.fftSize,
      sampleRate: frame.sampleRate,
      dbScale: frame.dbScale,
      spectrumMode: frame.spectrumMode,
      freqStartHz: frame.freqStartHz,
      binHz: frame.binHz,
      fftShift: frame.fftShift
    })
  })
})
onUnmounted(() => {
  disposeSourceFrame?.()
  disposeSourceFrame = null
  if (recordPoll) clearInterval(recordPoll)
  recordPoll = null
})
</script>

<template>
  <div class="source-page">
    <div class="source-head">
      <div>
        <h2>信号源工作台</h2>
        <p>源类型、输出与损伤；分析 UI 组件不在这里配置 FFT/窗。</p>
      </div>
      <div class="source-status">
        <NTag :type="running ? 'success' : 'default'" :bordered="false">
          {{ running ? '运行中' : '未运行' }}
        </NTag>
        <NTag v-if="sourceMode === 'playback'" type="warning" :bordered="false">回放</NTag>
        <NTag :bordered="false">{{ frameCount }} 帧</NTag>
        <NButton size="small" @click="loadPlayback">回放录制</NButton>
        <NButton v-if="sourceMode === 'playback'" size="small" @click="togglePlaybackPause">
          {{ playbackPaused ? '继续' : '暂停' }}
        </NButton>
        <NButton
          v-if="sourceMode === 'playback' && playbackPaused"
          size="small"
          @click="stepPlayback"
          >单步</NButton
        >
        <NButton v-if="sourceMode === 'playback'" size="small" @click="stopPlayback">
          停止回放
        </NButton>
        <NButton size="small" :type="recording ? 'error' : 'default'" @click="toggleRecord">
          {{ recording ? '停止录制' : '录制' }}
        </NButton>
        <label class="stream-label">
          流式
          <NSwitch v-model:value="streamRecord" size="small" :disabled="recording" />
        </label>
        <NButton
          size="small"
          :disabled="recordFrames === 0 || recordBusy"
          :loading="recordBusy"
          @click="exportRecord"
          >导出</NButton
        >
      </div>
    </div>
    <div v-if="sourceMode === 'playback' || recording || recordFrames > 0" class="record-bar">
      <NTag v-if="sourceMode === 'playback'" type="warning" size="small" :bordered="false">
        回放 {{ playbackIndex }}/{{ playbackTotal }}{{ playbackPaused ? ' · 暂停' : '' }}
      </NTag>
      <NSlider
        v-if="sourceMode === 'playback'"
        :value="playbackIndex"
        :min="0"
        :max="Math.max(0, playbackTotal - 1)"
        :step="1"
        style="width: 180px"
        @update:value="onSeekPlayback"
      />
      <span v-if="sourceMode === 'playback'" class="playback-time">
        {{ (playbackPositionMs / 1000).toFixed(1) }}s /
        {{ (playbackDurationMs / 1000).toFixed(1) }}s
      </span>
      <NSelect
        v-if="sourceMode === 'playback'"
        v-model:value="playbackSpeed"
        size="tiny"
        :options="[
          { label: '0.5x', value: 0.5 },
          { label: '1x', value: 1 },
          { label: '2x', value: 2 },
          { label: '4x', value: 4 }
        ]"
        style="width: 80px"
        @update:value="onPlaybackSpeed"
      />
      <NSelect
        v-if="sourceMode === 'playback'"
        v-model:value="playbackTiming"
        size="tiny"
        :options="[
          { label: '固定 60fps', value: 'fixed' },
          { label: '按时间戳', value: 'timestamp' }
        ]"
        style="width: 116px"
        @update:value="onPlaybackTiming"
      />
      <label v-if="sourceMode === 'playback'" class="loop-label">
        循环
        <NSwitch v-model:value="playbackLoop" size="small" @update:value="onPlaybackLoop" />
      </label>
      <span v-if="playbackPath" class="playback-path">{{ playbackPath }}</span>
      <NTag v-if="recording" type="error" size="small" :bordered="false">● 录制中</NTag>
      <span
        >{{ recordFrames }} 帧 / {{ recordSamples }} 样本 /
        {{ formatDuration(recordDurationMs) }}</span
      >
      <span v-if="recordTruncated" class="record-warn">已达录制上限，后续帧未记录</span>
    </div>

    <NGrid :cols="24" :x-gap="16">
      <NGi :span="9">
        <NCard size="small" title="源类型">
          <NSelect
            v-model:value="kind"
            :options="SOURCE_CATALOG.map((s) => ({ label: s.label, value: s.id }))"
            @update:value="applyKind"
          />
          <div class="source-desc">{{ meta.description }}</div>
          <div class="scenario-row">
            <span class="scenario-label">推荐分析</span>
            <router-link
              v-for="a in meta.analysis"
              :key="a.path"
              :to="a.path"
              class="scenario-chip"
              >{{ a.label }}</router-link
            >
          </div>
          <NDivider />
          <NForm label-placement="left" label-width="112" size="small">
            <NFormItem label="输出模式">
              <NSelect
                v-model:value="outputMode"
                :options="[
                  { label: 'complex 复 IQ', value: 'complex' },
                  { label: 'real 实信号', value: 'real' }
                ]"
              />
            </NFormItem>
            <NFormItem label="载波频率 (Hz)">
              <NInputNumber v-model:value="carrierHz" :min="1" :max="sampleRate / 2 - 1" />
            </NFormItem>
            <NFormItem label="幅度">
              <NSlider v-model:value="amplitude" :min="0.01" :max="5" :step="0.01" />
            </NFormItem>
            <NFormItem label="AWGN SNR (dB)">
              <NSlider v-model:value="snrDb" :min="0" :max="80" :step="1" />
            </NFormItem>
            <NFormItem label="采样率">
              <NSelect
                v-model:value="sampleRate"
                :options="
                  [2048, 4096, 8192, 16384, 32768].map((v) => ({ label: String(v), value: v }))
                "
              />
            </NFormItem>
            <NFormItem label="每帧点数">
              <NInputNumber v-model:value="pointsPerFrame" :min="64" :max="65536" :step="256" />
            </NFormItem>
            <NFormItem v-if="isDigital" label="每符号采样">
              <NInputNumber v-model:value="samplesPerSymbol" :min="2" :max="256" />
            </NFormItem>
            <NFormItem label="输出/推送">
              <NSwitch v-model:value="enabled" />
            </NFormItem>
          </NForm>
        </NCard>

        <NCard size="small" title="调制/波形参数" style="margin-top: 12px">
          <NForm label-placement="left" label-width="112" size="small">
            <template v-if="isDigital">
              <NFormItem label="数字调制">
                <NTag>{{ meta.modType }}</NTag>
              </NFormItem>
            </template>
            <template v-else>
              <NFormItem v-if="kind === 'am'" label="调制频率 (Hz)">
                <NInputNumber v-model:value="modFreq" :min="1" :max="10000" />
              </NFormItem>
              <NFormItem v-if="kind === 'am'" label="调制度">
                <NSlider v-model:value="amDepth" :min="0" :max="1" :step="0.01" />
              </NFormItem>
              <NFormItem v-if="kind === 'fm'" label="调制频率 (Hz)">
                <NInputNumber v-model:value="modFreq" :min="1" :max="10000" />
              </NFormItem>
              <NFormItem v-if="kind === 'fm'" label="峰值频偏 (Hz)">
                <NInputNumber v-model:value="fmDeviation" :min="0" :max="10000" />
              </NFormItem>
              <NFormItem v-if="kind === 'pulse'" label="脉冲周期 (s)">
                <NInputNumber v-model:value="pulsePeriod" :min="0.0001" :max="1" :step="0.0001" />
              </NFormItem>
              <NFormItem v-if="kind === 'pulse'" label="占空比">
                <NSlider v-model:value="pulseDuty" :min="0.01" :max="0.99" :step="0.01" />
              </NFormItem>
              <NFormItem v-if="kind === 'twoTone'" label="双音间隔 (Hz)">
                <NInputNumber v-model:value="toneSpacing" :min="1" :max="10000" />
              </NFormItem>
              <NFormItem v-if="kind === 'ofdm'" label="有效子载波">
                <NSelect
                  v-model:value="ofdmSubcarriers"
                  :options="[8, 16, 24, 32, 40, 52].map((v) => ({ label: String(v), value: v }))"
                  style="width: 120px"
                />
              </NFormItem>
              <NFormItem v-if="kind === 'ofdm'" label="CP 比例">
                <NSlider
                  v-model:value="ofdmCpRatio"
                  :min="0"
                  :max="0.5"
                  :step="0.05"
                  style="width: 180px"
                />
                <span style="margin-left: 8px; color: #888"
                  >{{ (ofdmCpRatio * 100).toFixed(0) }}%</span
                >
              </NFormItem>
            </template>
            <NFormItem label="源能力">
              <div class="cap-tags">
                <NTag v-for="m in meta.capabilities.outputModes" :key="m" size="small">{{
                  m
                }}</NTag>
                <NTag v-if="meta.capabilities.supportsDigital" size="small" type="info"
                  >digital</NTag
                >
                <NTag v-if="meta.capabilities.usesSamplesPerSymbol" size="small" type="info"
                  >sps</NTag
                >
              </div>
            </NFormItem>
          </NForm>
        </NCard>
      </NGi>

      <NGi :span="15">
        <NCard size="small" title="预览 / 播放">
          <template #header-extra>
            <div class="actions">
              <NButton size="small" type="primary" :disabled="running" @click="startSource">
                启动
              </NButton>
              <NButton size="small" :disabled="!running" @click="stopSource">停止</NButton>
              <NButton size="small" :disabled="!running" @click="applyAndNotify">应用</NButton>
              <NButton size="small" :disabled="!running" @click="triggerOnce">单帧</NButton>
            </div>
          </template>
          <NAlert v-if="!running" type="info" :bordered="false" style="margin-bottom: 10px">
            启动后由本地源持续推送 IQ，同时启动本地分析消费者；可在 IQ/频谱预览间切换。
          </NAlert>
          <NAlert v-else type="success" :bordered="false" style="margin-bottom: 10px">
            {{ summary.label }} · {{ summary.outputMode }} · {{ summary.sampleRate }} Sa/s · 每帧
            {{ summary.pointsPerFrame }} 点
          </NAlert>
          <NTabs type="line" size="small" animated>
            <NTabPane name="iq" tab="IQ 时域">
              <IqChart
                ref="iqRef"
                :height="380"
                :sample-rate="sampleRate"
                :trigger="{ enabled: false }"
                theme="spectrum"
              />
            </NTabPane>
            <NTabPane name="spectrum" tab="频谱">
              <SpectrumChart ref="spectrumRef" :height="380" theme="spectrum" />
            </NTabPane>
          </NTabs>
          <div class="frame-meta">
            <span v-if="lastFrame">
              最近帧 #{{ lastFrame.seq }} · {{ lastFrame.outputMode }} · {{ lastFrame.waveform }} ·
              {{ lastFrame.centerFrequencyHz }} Hz
            </span>
            <span v-else>等待源帧…</span>
            <span class="meta-links">
              <router-link to="/signal/analysis-config">分析配置 →</router-link>
              <router-link to="/source/advanced">源/连接高级配置 →</router-link>
            </span>
          </div>
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>

<style scoped>
.source-page {
  padding: 16px;
  max-width: 1380px;
}
.source-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.source-head h2 {
  margin: 0;
  font-size: 20px;
}
.source-head p {
  margin: 4px 0 0;
  color: var(--n-text-color-3, #888);
  font-size: 13px;
}
.source-status {
  display: flex;
  gap: 8px;
  align-items: center;
}
.record-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.08);
  font-size: 12px;
  color: #888;
}
.record-warn {
  color: #e6a23c;
}
.playback-path {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #4fc3f7;
}
.loop-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #888;
}
.stream-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #888;
}
.playback-time {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
}
.source-desc {
  margin-top: 8px;
  font-size: 12px;
  color: #888;
}
.scenario-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.scenario-label {
  font-size: 12px;
  color: #888;
}
.scenario-chip {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(79, 195, 247, 0.1);
  color: #4fc3f7;
  font-size: 12px;
  text-decoration: none;
}
.scenario-chip:hover {
  background: rgba(79, 195, 247, 0.2);
}
.actions {
  display: flex;
  gap: 8px;
}
.cap-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.frame-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: #888;
  font-size: 12px;
}
.frame-meta a {
  color: #4fc3f7;
  text-decoration: none;
}
.meta-links {
  display: flex;
  gap: 12px;
}
</style>
