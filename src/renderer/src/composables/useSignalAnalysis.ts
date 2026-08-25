/**
 * useSignalAnalysis（轻量，演示用）
 * 订阅服务端分析帧（signal:analysis），按类型路由到 spectrum / spectrogram / iq 回调。
 * 组件只负责展示，不关心数据来自本地主进程还是远程后端。
 */
import { onUnmounted, ref, type Ref } from 'vue'
import type { AnalysisFrame, SignalAnalysisConfig } from '../../../shared/signal'

type FrameCb = (data: Float32Array, frame: AnalysisFrame) => void
type Unsubscribe = () => void

export interface SignalAnalysisStatus {
  running: boolean
  mode: 'local' | 'remote' | 'none'
  port: number
  remoteUrl?: string
  config: SignalAnalysisConfig
}

export interface RemoteLinkStatus {
  connected: boolean
  error?: string
  url?: string
}

export interface StartResult {
  started: boolean
  alreadyRunning: boolean
  mode: 'local' | 'remote' | 'none'
}

export interface UseSignalAnalysis {
  connected: Ref<boolean>
  source: Ref<'local' | 'remote' | 'none'>
  remoteConnected: Ref<boolean>
  remoteError: Ref<string>
  onSpectrum: (cb: FrameCb) => Unsubscribe
  onSpectrogram: (cb: FrameCb) => Unsubscribe
  onIq: (cb: FrameCb) => Unsubscribe
  onRemoteStatus: (cb: (s: RemoteLinkStatus) => void) => Unsubscribe
  start: (opts?: {
    mode?: 'local' | 'remote'
    port?: number
    remoteUrl?: string
  }) => Promise<StartResult>
  stop: () => Promise<void>
  setConfig: (patch: Partial<SignalAnalysisConfig>) => Promise<void>
  getStatus: () => Promise<SignalAnalysisStatus>
  ensureSubscription: () => void
  disconnect: () => void
}

export function useSignalAnalysis(
  opts: { autoConnect?: boolean; autoSubscribe?: boolean } = {}
): UseSignalAnalysis {
  const connected = ref(false)
  const source = ref<'local' | 'remote' | 'none'>('none')
  const remoteConnected = ref(false)
  const remoteError = ref('')
  const spectrumCbs = new Set<FrameCb>()
  const spectrogramCbs = new Set<FrameCb>()
  const iqCbs = new Set<FrameCb>()
  const remoteStatusCbs = new Set<(s: RemoteLinkStatus) => void>()
  // 仅当本实例以 remote 模式启动时才接管 connected/source，
  // 避免其他窗口的远程状态事件把本地会话（或未启动页面）串扰成 remote
  let expectRemote = false
  let disposeFrame: (() => void) | null = null
  let disposeStatus: (() => void) | null = null
  let lastEmptyWarnAt = 0

  function handleFrame(payload: unknown): void {
    const f = payload as AnalysisFrame
    if (!f || !f.data || !(f.data instanceof Float32Array)) {
      // 兼容：主进程已容错转 Float32Array，若此处仍失败则打印便于定位远端 payload 问题
      console.warn('[useSignalAnalysis] dropped frame: not Float32Array', payload)
      return
    }
    if (f.data.length === 0) {
      const now = Date.now()
      if (now - lastEmptyWarnAt > 5000) {
        lastEmptyWarnAt = now
        console.warn('[useSignalAnalysis] empty frame', f.type)
      }
    }
    if (f.type === 'spectrum') spectrumCbs.forEach((cb) => cb(f.data, f))
    else if (f.type === 'spectrogram') spectrogramCbs.forEach((cb) => cb(f.data, f))
    else if (f.type === 'iq') iqCbs.forEach((cb) => cb(f.data, f))
  }

  function handleRemoteStatus(s: RemoteLinkStatus): void {
    remoteConnected.value = s.connected
    remoteError.value = s.error ?? ''
    remoteStatusCbs.forEach((cb) => cb(s))
    if (s.connected && expectRemote) {
      connected.value = true
      source.value = 'remote'
    } else if (!s.connected && s.error) {
      console.warn('[useSignalAnalysis] remote status', s)
    }
  }

  function ensureSubscription(): void {
    if (!disposeFrame)
      disposeFrame = window.api.signalAnalysis.onFrame((p: unknown) => handleFrame(p))
    if (!disposeStatus && window.api.signalAnalysis.onStatus) {
      disposeStatus = window.api.signalAnalysis.onStatus((s: unknown) =>
        handleRemoteStatus(s as RemoteLinkStatus)
      )
    }
  }

  async function getStatus(): Promise<SignalAnalysisStatus> {
    const raw = (await window.api.signalAnalysis.getStatus().catch(() => null)) as
      (SignalAnalysisStatus & { remoteUrl?: string }) | null
    if (!raw) return { running: false, mode: 'none', port: 0, config: {} as SignalAnalysisConfig }
    return {
      running: raw.running,
      mode: raw.mode as SignalAnalysisStatus['mode'],
      port: raw.port,
      remoteUrl: (raw as unknown as { remoteUrl?: string }).remoteUrl,
      config: (raw.config as SignalAnalysisConfig) ?? ({} as SignalAnalysisConfig)
    }
  }

  async function start(o?: {
    mode?: 'local' | 'remote'
    port?: number
    remoteUrl?: string
  }): Promise<StartResult> {
    const st = await getStatus()
    if (!st.running) {
      const r = await window.api.signalAnalysis.start(o).catch(() => ({ ok: false }))
      if (!r.ok) return { started: false, alreadyRunning: false, mode: st.mode }
    }
    if (o?.mode === 'remote') expectRemote = true
    ensureSubscription()
    const st2 = await getStatus()
    connected.value = true
    source.value = st2.mode
    return { started: !st.running, alreadyRunning: st.running, mode: st2.mode }
  }

  async function stop(): Promise<void> {
    await window.api.signalAnalysis.stop().catch(() => {})
    expectRemote = false
    connected.value = false
    source.value = 'none'
  }

  async function setConfig(patch: Partial<SignalAnalysisConfig>): Promise<void> {
    await window.api.signalAnalysis.setConfig(patch).catch(() => {})
  }

  function disconnect(): void {
    disposeFrame?.()
    disposeFrame = null
    disposeStatus?.()
    disposeStatus = null
    spectrumCbs.clear()
    spectrogramCbs.clear()
    iqCbs.clear()
    remoteStatusCbs.clear()
    expectRemote = false
    connected.value = false
    source.value = 'none'
    remoteConnected.value = false
    remoteError.value = ''
  }

  // 默认仅订阅帧（不自启服务），服务启停由 SignalConfigPage 统一管控
  const shouldSubscribe = opts.autoSubscribe !== false && opts.autoConnect !== false
  if (shouldSubscribe) ensureSubscription()

  onUnmounted(() => disconnect())

  return {
    connected,
    source,
    remoteConnected,
    remoteError,
    onSpectrum: (cb) => {
      spectrumCbs.add(cb)
      return () => spectrumCbs.delete(cb)
    },
    onSpectrogram: (cb) => {
      spectrogramCbs.add(cb)
      return () => spectrogramCbs.delete(cb)
    },
    onIq: (cb) => {
      iqCbs.add(cb)
      return () => iqCbs.delete(cb)
    },
    onRemoteStatus: (cb) => {
      remoteStatusCbs.add(cb)
      return () => remoteStatusCbs.delete(cb)
    },
    start,
    stop,
    setConfig,
    getStatus,
    ensureSubscription,
    disconnect
  }
}
