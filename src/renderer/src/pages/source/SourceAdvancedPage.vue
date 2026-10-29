<script setup lang="ts">
/**
 * SourceAdvancedPage（源连接高级配置）
 * 只管理本地/远程连接、端口、远端 Mock；源波形在 /source，FFT/窗在 /signal/analysis-config。
 */
import { onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NTag,
  useMessage
} from 'naive-ui'
import type { SignalAnalysisConfig } from '../../../../shared/signal'

const message = useMessage()
const modeSelect = ref<'local' | 'remote'>('local')
const port = ref(8767)
const remoteUrl = ref('')
const running = ref(false)
const mode = ref('none')
const runningPort = ref(0)
const runningRemoteUrl = ref('')
const remoteMockRunning = ref(false)
const remoteMockPort = ref(0)
const sourceLabel = ref('')
const loading = ref(false)

async function refresh(): Promise<void> {
  try {
    const st = (await window.api.signalAnalysis.getStatus()) as {
      running: boolean
      mode: string
      port: number
      remoteUrl?: string
      config?: SignalAnalysisConfig
    }
    running.value = st.running
    mode.value = st.mode
    runningPort.value = st.port || 0
    runningRemoteUrl.value = st.remoteUrl || ''
    if (st.config)
      sourceLabel.value = `${st.config.waveform}/${st.config.modType} @ ${st.config.freq} Hz`
  } catch {
    running.value = false
  }
  try {
    const rm = (await window.api.remoteMock.getStatus()) as { running: boolean; port: number }
    remoteMockRunning.value = rm.running
    remoteMockPort.value = rm.port || 0
  } catch {
    remoteMockRunning.value = false
  }
}

async function startLocal(): Promise<void> {
  loading.value = true
  try {
    const r = (await window.api.signalAnalysis.start({ mode: 'local', port: port.value })) as {
      ok: boolean
      error?: string
    }
    if (!r.ok) message.error(r.error || '本地分析启动失败')
    else message.success(`本地分析已启动 :${port.value}`)
    await refresh()
  } finally {
    loading.value = false
  }
}

async function startRemote(): Promise<void> {
  loading.value = true
  try {
    const url = remoteUrl.value.trim()
    if (!url) {
      message.error('请输入远程后端地址')
      return
    }
    const r = (await window.api.signalAnalysis.start({ mode: 'remote', remoteUrl: url })) as {
      ok: boolean
      error?: string
    }
    if (!r.ok) message.error(r.error || '远程连接失败')
    else message.success('远程分析服务已启动')
    await refresh()
  } finally {
    loading.value = false
  }
}

async function stop(): Promise<void> {
  await window.api.signalAnalysis.stop().catch(() => {})
  await refresh()
  message.success('已停止')
}

async function startRemoteMock(): Promise<void> {
  try {
    const st = (await window.api.signalAnalysis.getStatus()) as { config?: SignalAnalysisConfig }
    const r = (await window.api.remoteMock.start({
      port: port.value,
      config: st.config ?? {}
    })) as { ok: boolean; port?: number; error?: string }
    if (!r.ok) message.error(r.error || '远端 Mock 启动失败')
    else message.success(`远端 Mock 已启动 :${r.port ?? port.value}`)
    await refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

async function stopRemoteMock(): Promise<void> {
  await window.api.remoteMock.stop().catch(() => {})
  await refresh()
}

onMounted(refresh)
</script>

<template>
  <div style="padding: 16px; max-width: 820px">
    <NCard title="🔌 源 / 连接高级配置" :bordered="false">
      <template #header-extra>
        <NTag :type="running ? 'success' : 'default'" :bordered="false">
          {{ running ? `运行中 (${mode})` : '未运行' }}
        </NTag>
      </template>
      <NAlert type="info" :bordered="false" style="margin-bottom: 14px">
        源波形/载波/幅度在 <router-link to="/source">信号源工作台</router-link>；FFT/窗/重叠在
        <router-link to="/signal/analysis-config">分析配置</router-link>。本页只管本地/远程连接。
      </NAlert>
      <NAlert v-if="running" type="success" :bordered="false" style="margin-bottom: 14px">
        {{ runningPort ? `本地端口 ${runningPort}` : runningRemoteUrl }} · 源
        {{ sourceLabel || '—' }}
      </NAlert>

      <NForm label-placement="left" label-width="120" size="small">
        <NFormItem label="连接模式">
          <NRadioGroup v-model:value="modeSelect">
            <NRadio value="local">本地分析</NRadio>
            <NRadio value="remote">远程后端</NRadio>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="端口">
          <NInputNumber v-model:value="port" :min="1024" :max="65535" :disabled="running" />
        </NFormItem>
        <NFormItem label="远程地址">
          <NInput
            v-model:value="remoteUrl"
            placeholder="http://127.0.0.1:8767，留空使用同端口内置 Mock"
            :disabled="running || modeSelect !== 'remote'"
          />
        </NFormItem>
        <NFormItem>
          <div style="display: flex; gap: 8px">
            <NButton
              type="primary"
              size="small"
              :loading="loading"
              :disabled="running"
              @click="modeSelect === 'local' ? startLocal() : startRemote()"
            >
              启动
            </NButton>
            <NButton size="small" :disabled="!running" @click="stop">停止</NButton>
            <NButton size="small" @click="refresh">刷新</NButton>
          </div>
        </NFormItem>
      </NForm>

      <NDivider>远端 Mock（演示用）</NDivider>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <NTag :type="remoteMockRunning ? 'warning' : 'default'" :bordered="false">
          {{ remoteMockRunning ? `运行中 :${remoteMockPort}` : '未运行' }}
        </NTag>
        <NButton size="small" :disabled="remoteMockRunning" @click="startRemoteMock"
          >启动远端 Mock</NButton
        >
        <NButton size="small" :disabled="!remoteMockRunning" @click="stopRemoteMock">停止</NButton>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        远端 Mock 使用当前源配置；它只提供 socket.io 分析帧，不参与源工作台预览。
      </div>
    </NCard>
  </div>
</template>
