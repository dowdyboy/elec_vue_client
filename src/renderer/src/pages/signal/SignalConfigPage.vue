<script setup lang="ts">
/**
 * SignalConfigPage（信号分析服务配置页，纯配置，不含图表）
 * 【职责】信源/处理/连接三类配置统一在此页维护，双源（local/remote）在此切换
 *  演示页不再持有任何处理/信源配置，仅做展示（theme/colorMap 等除外）
 *  配置保存后即时生效（运行中修改 FFT/窗等，前端组件自适应重置瀑布）
 *  端口约束：本地服务与内置远端Mock同端口互斥（OS 端口占用即互斥）；
 *  远程模式支持自定义 socket.io 后端地址，留空则连接同端口内置 Mock。
 */
import { ref, computed, onMounted } from 'vue'
import {
  NCard,
  NGrid,
  NGi,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSlider,
  NSwitch,
  NButton,
  NTag,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NRadioGroup,
  NRadio,
  useMessage
} from 'naive-ui'
import type { SignalAnalysisConfig } from '../../../../shared/signal'
import { useSignalAnalysis } from '../../../../renderer/src/composables/useSignalAnalysis'

const message = useMessage()
const sigStatus = useSignalAnalysis({ autoSubscribe: true })
const remoteConnected = sigStatus.remoteConnected
const remoteError = sigStatus.remoteError
sigStatus.onRemoteStatus((s) => {
  if (!s.connected && s.error) message.warning(`远程连接异常: ${s.error}`)
  void refreshAllStatus()
})

const LS_KEY = 'signal:configPage:v1'

// 连接（单端口共享）
const modeSelect = ref<'local' | 'remote'>('local')
const port = ref(8767)
// 自定义远程地址：留空 = 同端口内置 Mock
const remoteUrlInput = ref('')
const builtinMockUrl = computed(() => `http://127.0.0.1:${port.value}`)
const effectiveRemoteUrl = computed(() => remoteUrlInput.value.trim() || builtinMockUrl.value)
// 信源
const freq = ref(50)
const snr = ref(20)
const amplitude = ref(1)
const modType = ref<SignalAnalysisConfig['modType']>('sine')
const sampleRate = ref(4096)
const pointsPerFrame = ref(2048)
const samplesPerSymbol = ref(16)
const enabled = ref(true)
// 处理
const fftSize = ref(1024)
const windowType = ref<SignalAnalysisConfig['window']>('hann')
const dbScale = ref(true)
const overlap = ref(0.5)

const running = ref(false)
const mode = ref('none')
const curPort = ref(0)
const curRemoteUrl = ref('')
const effConfig = ref<SignalAnalysisConfig | null>(null)
const remoteMockRunning = ref(false)
const remoteMockPort = ref(0)

function saveLocal(): void {
  try {
    const payload = {
      modeSelect: modeSelect.value,
      port: port.value,
      remoteUrl: remoteUrlInput.value.trim(),
      freq: freq.value,
      snr: snr.value,
      modType: modType.value,
      sampleRate: sampleRate.value,
      pointsPerFrame: pointsPerFrame.value,
      samplesPerSymbol: samplesPerSymbol.value,
      enabled: enabled.value,
      fftSize: fftSize.value,
      window: windowType.value,
      dbScale: dbScale.value,
      overlap: overlap.value
    }
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch {
    void 0
  }
}

function loadLocal(): void {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as Record<string, unknown>
    if (p.modeSelect === 'local' || p.modeSelect === 'remote') modeSelect.value = p.modeSelect
    if (typeof p.port === 'number') port.value = p.port
    // remoteUrl：旧版本存完整地址（从中提取端口兼容），等于内置地址则视为留空
    if (typeof p.remoteUrl === 'string' && p.remoteUrl.trim()) {
      try {
        const u = new URL(p.remoteUrl.trim())
        if (u.port) port.value = Number(u.port)
        const host = u.hostname
        const isBuiltin =
          (host === '127.0.0.1' || host === 'localhost') && Number(u.port || '80') === port.value
        remoteUrlInput.value = isBuiltin ? '' : p.remoteUrl.trim()
      } catch {
        remoteUrlInput.value = ''
      }
    }
    if (typeof p.freq === 'number') freq.value = p.freq
    if (typeof p.snr === 'number') snr.value = p.snr
    if (typeof p.amplitude === 'number') amplitude.value = p.amplitude
    if (p.modType) modType.value = p.modType as SignalAnalysisConfig['modType']
    if (typeof p.sampleRate === 'number') sampleRate.value = p.sampleRate
    if (typeof p.pointsPerFrame === 'number') pointsPerFrame.value = p.pointsPerFrame
    if (typeof p.samplesPerSymbol === 'number') samplesPerSymbol.value = p.samplesPerSymbol
    if (typeof p.enabled === 'boolean') enabled.value = p.enabled
    if (typeof p.fftSize === 'number') fftSize.value = p.fftSize
    if (p.window) windowType.value = p.window as SignalAnalysisConfig['window']
    if (typeof p.dbScale === 'boolean') dbScale.value = p.dbScale
    if (typeof p.overlap === 'number') overlap.value = p.overlap
  } catch {
    void 0
  }
}

async function refreshRemoteMockStatus(): Promise<void> {
  try {
    const st = (await window.api.remoteMock.getStatus()) as { running: boolean; port: number }
    remoteMockRunning.value = st.running
    remoteMockPort.value = st.port || 0
  } catch {
    remoteMockRunning.value = false
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const st = (await window.api.signalAnalysis.getStatus()) as {
      running: boolean
      mode: string
      port: number
      remoteUrl?: string
      config: unknown
    }
    running.value = st.running
    mode.value = st.mode
    curPort.value = st.port || 0
    curRemoteUrl.value = st.remoteUrl || ''
    if (st.mode === 'local' || st.mode === 'remote')
      modeSelect.value = st.mode as 'local' | 'remote'
    if (st.port) port.value = st.port
    if (st.config) {
      const c = st.config as Partial<SignalAnalysisConfig>
      if (typeof c.freq === 'number') freq.value = c.freq
      if (typeof c.snr === 'number') snr.value = c.snr
      if (typeof c.amplitude === 'number') amplitude.value = c.amplitude
      if (c.modType) modType.value = c.modType
      if (typeof c.sampleRate === 'number') sampleRate.value = c.sampleRate
      if (typeof c.pointsPerFrame === 'number') pointsPerFrame.value = c.pointsPerFrame
      if (typeof c.samplesPerSymbol === 'number') samplesPerSymbol.value = c.samplesPerSymbol
      if (typeof c.enabled === 'boolean') enabled.value = c.enabled
      if (typeof c.fftSize === 'number') fftSize.value = c.fftSize
      if (c.window) windowType.value = c.window
      if (typeof c.dbScale === 'boolean') dbScale.value = c.dbScale
      if (typeof c.overlap === 'number') overlap.value = c.overlap
      effConfig.value = c as SignalAnalysisConfig
    }
  } catch {
    running.value = false
  }
}

async function refreshAllStatus(): Promise<void> {
  await Promise.all([refreshStatus(), refreshRemoteMockStatus()])
}

async function applyConfig(): Promise<void> {
  try {
    const r = (await window.api.signalAnalysis.setConfig({
      freq: freq.value,
      snr: snr.value,
      amplitude: amplitude.value,
      modType: modType.value,
      sampleRate: sampleRate.value,
      pointsPerFrame: pointsPerFrame.value,
      samplesPerSymbol: samplesPerSymbol.value,
      enabled: enabled.value,
      fftSize: fftSize.value,
      window: windowType.value,
      dbScale: dbScale.value,
      overlap: overlap.value
    } as unknown as Record<string, unknown>)) as { ok: boolean; error?: string }
    // 同步更新远端Mock的配置（若远端Mock正在运行，需重启才生效，此处仅更新内存并提示）
    try {
      if (remoteMockRunning.value) {
        // 远端Mock的配置通过下次 restart 时的 start 参数传入，此处不单独 patch
      }
    } catch {
      void 0
    }
    saveLocal()
    if (r.ok) {
      message.success('已保存，配置即时生效')
      await refreshAllStatus()
    } else {
      message.error((r as unknown as { error?: string }).error || '应用失败')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function startLocal(): Promise<void> {
  if (remoteMockRunning.value) {
    message.error(`端口 ${port.value} 已被远端Mock占用，请先停止远端Mock`)
    return
  }
  const r = (await window.api.signalAnalysis.start({ mode: 'local', port: port.value })) as {
    ok: boolean
    mode?: string
    port?: number
    error?: string
  }
  saveLocal()
  if (!r.ok) message.error(r.error || '启动失败')
  else message.success(`本地已启动 :${r.port}`)
  await refreshAllStatus()
}

/** 判断地址是否指向本机同端口（即内置 Mock） */
function isBuiltinMockUrl(u: string): boolean {
  try {
    const parsed = new URL(u)
    const host = parsed.hostname
    return (
      (host === '127.0.0.1' || host === 'localhost') && Number(parsed.port || '80') === port.value
    )
  } catch {
    return false
  }
}

async function startRemote(): Promise<void> {
  const url = effectiveRemoteUrl.value
  saveLocal()
  if (!isBuiltinMockUrl(url)) {
    // 直连外部 socket.io 后端
    const r = (await window.api.signalAnalysis.start({ mode: 'remote', remoteUrl: url })) as {
      ok: boolean
      mode?: string
      error?: string
    }
    if (!r.ok) message.error(r.error || '远程连接失败')
    else message.success(`远程已启动 ${url}`)
    await refreshAllStatus()
    return
  }

  // 内置 Mock 一键流程：同端口起 Mock → 远程客户端回连
  if (running.value && mode.value === 'local') {
    message.error(`端口 ${port.value} 已被本地占用，请先停止本地服务`)
    return
  }
  // 1) 起内置远端Mock（同端口）
  const cfgPatch = {
    freq: freq.value,
    snr: snr.value,
    amplitude: amplitude.value,
    modType: modType.value,
    sampleRate: sampleRate.value,
    pointsPerFrame: pointsPerFrame.value,
    samplesPerSymbol: samplesPerSymbol.value,
    enabled: enabled.value,
    fftSize: fftSize.value,
    window: windowType.value,
    dbScale: dbScale.value,
    overlap: overlap.value
  }
  // 同步持久化配置，供远端客户端连接时下发
  try {
    await window.api.signalAnalysis.setConfig(cfgPatch as unknown as Record<string, unknown>)
  } catch {
    void 0
  }
  const rm = (await window.api.remoteMock.start({ port: port.value, config: cfgPatch })) as {
    ok: boolean
    port?: number
    error?: string
  }
  if (!rm.ok) {
    // 可能是端口被本地占用（EADDRINUSE）或已运行
    message.error(rm.error || '远端Mock启动失败')
    await refreshAllStatus()
    return
  }
  // 小延时等待远端Mock监听就绪
  await new Promise((res) => setTimeout(res, 300))
  // 2) 起远端客户端，连向同端口的内置Mock
  const r = (await window.api.signalAnalysis.start({ mode: 'remote', remoteUrl: url })) as {
    ok: boolean
    mode?: string
    error?: string
  }
  if (!r.ok) {
    message.error(r.error || '远端连接失败，已回滚远端Mock')
    // 回滚：停止远端Mock
    try {
      await window.api.remoteMock.stop()
    } catch {
      void 0
    }
  } else {
    message.success(`远端已启动 ${url} (内置Mock :${port.value})`)
  }
  await refreshAllStatus()
}

async function startServer(): Promise<void> {
  try {
    if (modeSelect.value === 'remote') await startRemote()
    else await startLocal()
  } catch (e) {
    await refreshAllStatus()
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function restartServer(): Promise<void> {
  try {
    // 互斥：先停所有（主进程 stop 已等待端口释放），刷新状态后再启动
    if (running.value) await window.api.signalAnalysis.stop()
    if (remoteMockRunning.value) await window.api.remoteMock.stop()
    await refreshAllStatus()
    await startServer()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function stopServer(): Promise<void> {
  try {
    // 停止信号服务与远端Mock（若有）
    if (running.value) await window.api.signalAnalysis.stop()
    if (remoteMockRunning.value) await window.api.remoteMock.stop()
    message.success('已停止')
    await refreshAllStatus()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function triggerOnce(): Promise<void> {
  try {
    const r = (await window.api.signalAnalysis.trigger()) as { ok: boolean }
    if (r.ok) message.info('已触发单帧')
    else message.error('触发失败')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

onMounted(() => {
  loadLocal()
  void refreshAllStatus()
})
</script>

<template>
  <div style="padding: 16px; max-width: 880px">
    <NCard title="🛠 信号分析服务配置" :bordered="false">
      <template #header-extra>
        <div style="display: flex; gap: 8px; align-items: center">
          <NTag v-if="running" type="success" :bordered="false">
            运行中 {{ mode === 'local' ? `:${curPort}` : curRemoteUrl }} ({{ mode }})
          </NTag>
          <NTag v-else-if="remoteMockRunning" type="warning" :bordered="false">
            远端Mock运行中 :{{ remoteMockPort }}
          </NTag>
          <NTag v-else type="default" :bordered="false">未运行</NTag>
          <template v-if="mode === 'remote' && running">
            <NTag v-if="remoteConnected" type="success" :bordered="false">远程已连接</NTag>
            <NTag v-else-if="remoteError" type="error" :bordered="false" :title="remoteError"
              >连接失败</NTag
            >
            <NTag v-else type="warning" :bordered="false">连接中…</NTag>
          </template>
        </div>
      </template>

      <NForm label-placement="left" :label-width="110">
        <NGrid :cols="2" :x-gap="24" :y-gap="12">
          <NGi :span="2">
            <NFormItem label="运行模式">
              <NRadioGroup v-model:value="modeSelect">
                <NRadio value="local">本地计算（演示）</NRadio>
                <NRadio value="remote" style="margin-left: 16px">远程后端（内置Mock）</NRadio>
              </NRadioGroup>
              <span style="margin-left: 12px; color: #888; font-size: 12px">
                本地与内置Mock同端口（{{ port }}）互斥；远程可连内置 Mock 或外部后端
              </span>
            </NFormItem>
          </NGi>
          <NGi :span="2">
            <NFormItem label="服务端口">
              <NInputNumber v-model:value="port" :min="1" :max="65535" style="width: 200px" />
              <span style="margin-left: 12px; color: #888; font-size: 12px">
                {{
                  modeSelect === 'remote'
                    ? `内置 Mock 将监听 http://127.0.0.1:${port}`
                    : '本地将监听此端口'
                }}
              </span>
            </NFormItem>
          </NGi>
          <NGi v-if="modeSelect === 'remote'" :span="2">
            <NFormItem label="远端地址">
              <NInput
                v-model:value="remoteUrlInput"
                :placeholder="`${builtinMockUrl}（留空=内置Mock同端口）`"
                style="width: 320px"
              />
              <span style="margin-left: 12px; color: #888; font-size: 12px">
                留空自动连接同端口内置 Mock；也可填外部 socket.io 后端地址
              </span>
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="调制方式">
              <NSelect
                v-model:value="modType"
                :options="[
                  { label: 'Sine', value: 'sine' },
                  { label: 'BPSK', value: 'BPSK' },
                  { label: 'QPSK', value: 'QPSK' },
                  { label: '16QAM', value: '16QAM' }
                ]"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="频率 (Hz)">
              <NSlider v-model:value="freq" :min="1" :max="500" />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="信噪比 (dB)">
              <NSlider v-model:value="snr" :min="0" :max="60" />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="幅度">
              <NSlider v-model:value="amplitude" :min="0.1" :max="5" :step="0.1" />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="采样率">
              <NSelect
                v-model:value="sampleRate"
                :options="[1024, 2048, 4096, 8192].map((v) => ({ label: String(v), value: v }))"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="每帧点数">
              <NInputNumber
                v-model:value="pointsPerFrame"
                :min="256"
                :max="8192"
                :step="256"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="每符号采样数">
              <NInputNumber
                v-model:value="samplesPerSymbol"
                :min="1"
                :max="64"
                :step="1"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="FFT 大小">
              <NSelect
                v-model:value="fftSize"
                :options="
                  [256, 512, 1024, 2048, 4096, 8192].map((v) => ({ label: String(v), value: v }))
                "
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="窗函数">
              <NSelect
                v-model:value="windowType"
                :options="[
                  { label: 'hann', value: 'hann' },
                  { label: 'hamming', value: 'hamming' },
                  { label: 'blackman', value: 'blackman' },
                  { label: 'rect', value: 'rect' }
                ]"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="重叠">
              <NSelect
                v-model:value="overlap"
                :options="[0, 0.25, 0.5, 0.75, 0.9].map((v) => ({ label: String(v), value: v }))"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="dB 缩放">
              <NSwitch v-model:value="dbScale" />
            </NFormItem>
          </NGi>
          <NGi :span="2">
            <NFormItem label="启用推送">
              <NSwitch v-model:value="enabled" />
              <span style="margin-left: 12px; color: #888; font-size: 12px">
                关闭后定时器不再自动推送，但仍可用「触发单帧」手动推一帧
              </span>
            </NFormItem>
          </NGi>
        </NGrid>
      </NForm>

      <NDivider style="margin: 12px 0" />

      <div style="display: flex; gap: 12px; flex-wrap: wrap">
        <NButton type="primary" @click="applyConfig">应用配置</NButton>
        <NButton type="info" :disabled="running || remoteMockRunning" @click="startServer"
          >启动服务</NButton
        >
        <NButton type="warning" @click="restartServer">重启服务</NButton>
        <NButton type="error" :disabled="!running && !remoteMockRunning" @click="stopServer"
          >停止服务</NButton
        >
        <NButton @click="triggerOnce">触发单帧</NButton>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        配置保存后<span style="font-weight: 600">即时生效</span>（运行中修改
        FFT/窗等会自动重置瀑布图）；已通过 localStorage 持久化。本地与远端内置Mock同端口互斥。
        <span v-if="mode === 'remote' && running && remoteError" style="color: #d03050">
          · 远程错误: {{ remoteError }}</span
        >
        <span
          v-if="mode === 'remote' && running && !remoteConnected && !remoteError"
          style="color: #f0a020"
        >
          · 正在连接 {{ curRemoteUrl }}…</span
        >
        <span v-if="remoteMockRunning" style="color: #18a058">
          · 远端Mock运行中 :{{ remoteMockPort }}</span
        >
      </div>
    </NCard>

    <NCard title="当前生效配置" :bordered="false" style="margin-top: 16px">
      <NDescriptions bordered :column="2" size="small">
        <NDescriptionsItem label="运行状态">{{
          running ? '运行中' : remoteMockRunning ? '远端Mock运行中' : '未运行'
        }}</NDescriptionsItem>
        <NDescriptionsItem label="模式">{{
          mode !== 'none' ? mode : modeSelect
        }}</NDescriptionsItem>
        <NDescriptionsItem label="端口">{{ curPort || remoteMockPort || port }}</NDescriptionsItem>
        <NDescriptionsItem label="远端地址">{{
          curRemoteUrl || effectiveRemoteUrl
        }}</NDescriptionsItem>
        <NDescriptionsItem label="调制方式">{{ effConfig?.modType ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="频率">{{ effConfig?.freq ?? '-' }} Hz</NDescriptionsItem>
        <NDescriptionsItem label="信噪比">{{ effConfig?.snr ?? '-' }} dB</NDescriptionsItem>
        <NDescriptionsItem label="幅度">{{ effConfig?.amplitude ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="采样率">{{ effConfig?.sampleRate ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="每帧点数">{{
          effConfig?.pointsPerFrame ?? '-'
        }}</NDescriptionsItem>
        <NDescriptionsItem label="每符号采样数">{{
          effConfig?.samplesPerSymbol ?? '-'
        }}</NDescriptionsItem>
        <NDescriptionsItem label="FFT 大小">{{ effConfig?.fftSize ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="窗函数">{{ effConfig?.window ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="重叠">{{ effConfig?.overlap ?? '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="dB 缩放">{{
          effConfig?.dbScale ? '是' : '否'
        }}</NDescriptionsItem>
        <NDescriptionsItem label="启用推送">{{
          effConfig?.enabled ? '是' : '否'
        }}</NDescriptionsItem>
      </NDescriptions>
    </NCard>
  </div>
</template>
