/**
 * 网络源共享契约（GNU Radio / 任意 TCP IQ 源）
 *
 * 设计边界：
 * - 本文件只做类型、校验与纯函数，不依赖 Electron/Node，渲染进程可安全导入；
 * - 主进程 TcpIqSource 按这里的配置解析字节流并产出 SourceFrame；
 * - 采样率语义：sampleRate 是线上全速，displaySampleRate 是显示/分析用（简单抽取），
 *   实际帧的 sampleRate 取「sampleRate / stride」，保证频率轴精确。
 */

/** 线上样本格式：cf32=complex float32，ci16=complex int16，ci8=complex int8 */
export type NetworkFormat = 'cf32' | 'ci16' | 'ci8'

export interface NetworkSourceConfig {
  /** GNU Radio / 任意 TCP 源地址（本机 127.0.0.1，远程填 LAN IP） */
  host: string
  port: number
  format: NetworkFormat
  /** 线上全速采样率（复数样本/秒） */
  sampleRate: number
  /** 源中心频率 Hz（只用于显示/分析，不改变流） */
  centerHz: number
  /** 显示/分析采样率（≤ sampleRate；简单抽取，正式频谱建议 GNU Radio 侧滤波抽取） */
  displaySampleRate: number
  /** 每帧复数样本数；0 = 自动（displaySampleRate / 60） */
  pointsPerFrame: number
  /** 双流：raw/full 包用于录制，显示抽取包用于展示（由桥按 ELIQ msgType 区分） */
  dualStream?: boolean
  /** 接收通道数：1=单通道，2=AD9361 双 RX（payload 按样本交错） */
  channels?: 1 | 2
  /** 独立录制端口；>0 时显示与 raw 走两条 TCP（recordHost 默认同 host） */
  recordPort?: number
  recordHost?: string
  recordFormat?: NetworkFormat
  /** raw 流采样率（仅用于录制启动前的兜底；帧头到达后以帧头为准） */
  recordSampleRate?: number
  /** 环形缓冲上限字节数（默认 32 MB） */
  maxBufferBytes?: number
  /** 断线自动重连（默认 true） */
  reconnect?: boolean
}

export interface NetworkSourceStatus {
  connected: boolean
  host: string
  port: number
  format: NetworkFormat
  /** 线上全速采样率 */
  wireSampleRate: number
  /** 实际显示采样率（wireSampleRate / stride） */
  displaySampleRate: number
  /** 实际每帧点数 */
  pointsPerFrame: number
  /** 最近一秒接收字节数 */
  bytesPerSecond: number
  /** 已产出帧数 */
  frames: number
  /** 已产出复数样本数（显示侧） */
  samples: number
  /** 是否收到 ELIQ 帧头（false=裸流） */
  framed: boolean
  /** 收到的帧头包数 */
  packets: number
  /** 显示抽取包数（msgType=4） */
  displayPackets: number
  /** raw/full 包数（msgType=1） */
  rawPackets: number
  /** 是否为双流（收到过 msgType=4，或配置 dualStream=true） */
  dualStream: boolean
  /** 是否独立双 TCP 端口（recordPort > 0） */
  splitStream: boolean
  /** 实际通道数（帧头 channels，或配置 channels） */
  channels: number
  /** 当前显示/分析选中的通道 */
  activeChannel: number
  /** 录制连接状态（独立端口模式） */
  recordConnected: boolean
  recordReconnects: number
  recordBytesPerSecond: number
  /** 录制流实际采样率/格式（raw/full 包） */
  recordSampleRate: number
  recordFormat: NetworkFormat
  /** 帧头 seq 检测到的丢包数 */
  droppedPackets: number
  /** 帧头携带的采样率（0=未收到帧头） */
  metadataSampleRate: number
  /** 帧头携带的中心频率（0=未收到帧头） */
  metadataCenterHz: number
  /** 因环形缓冲溢出丢弃的复数样本数 */
  droppedSamples: number
  /** 累计接收字节数 */
  receivedBytes: number
  /** 重连次数 */
  reconnects: number
  /** 最近一次错误（空串表示无） */
  lastError: string
  /** 连接建立时间（Unix ms；未连接为 0） */
  startedAt: number
}

export const NETWORK_FORMAT_BYTES: Record<NetworkFormat, number> = {
  cf32: 8,
  ci16: 4,
  ci8: 2
}

/** 每个复数样本的字节数 */
export function networkBytesPerSample(format: NetworkFormat): number {
  return NETWORK_FORMAT_BYTES[format]
}

/** 显示用名称（UI/日志） */
export function networkFormatLabel(format: NetworkFormat): string {
  if (format === 'cf32') return 'cf32（complex float32）'
  if (format === 'ci16') return 'ci16（complex int16）'
  return 'ci8（complex int8）'
}

/** 自动每帧点数：按 60fps 覆盖显示采样率 */
export function resolvePointsPerFrame(cfg: NetworkSourceConfig): number {
  if (cfg.pointsPerFrame > 0) {
    return Math.max(64, Math.min(65_536, Math.floor(cfg.pointsPerFrame)))
  }
  return Math.max(256, Math.min(65_536, Math.round(cfg.displaySampleRate / 60)))
}

/** 抽取步长（≥1）：wireSampleRate / displaySampleRate 四舍五入 */
export function resolveDecimation(cfg: NetworkSourceConfig): number {
  if (!(cfg.sampleRate > 0) || !(cfg.displaySampleRate > 0)) return 1
  return Math.max(1, Math.round(cfg.sampleRate / cfg.displaySampleRate))
}

/** 实际显示采样率（与 resolveDecimation 对应） */
export function resolveDisplaySampleRate(cfg: NetworkSourceConfig): number {
  return cfg.sampleRate / resolveDecimation(cfg)
}

export interface NetworkConfigResult {
  ok: boolean
  value?: NetworkSourceConfig
  error?: string
}

/** 校验任意 IPC / 页面输入 → 规范化配置（非法值拒绝，缺省值补齐） */
export function sanitizeNetworkConfig(raw: unknown): NetworkConfigResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: '网络源配置必须为对象' }
  const src = raw as Record<string, unknown>

  const host = typeof src.host === 'string' ? src.host.trim() : ''
  if (!host || host.length > 255) return { ok: false, error: 'host 不能为空且长度 ≤255' }
  if (host.includes('://')) return { ok: false, error: 'host 只填主机名/IP，不要带协议前缀' }

  const port = typeof src.port === 'number' ? Math.trunc(src.port) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return { ok: false, error: 'port 须为 1~65535 的整数' }

  const format = src.format
  if (format !== 'cf32' && format !== 'ci16' && format !== 'ci8')
    return { ok: false, error: 'format 须为 cf32 / ci16 / ci8' }

  const sampleRate = typeof src.sampleRate === 'number' ? Math.trunc(src.sampleRate) : NaN
  if (!Number.isFinite(sampleRate) || sampleRate < 1_000 || sampleRate > 200_000_000)
    return { ok: false, error: 'sampleRate 须为 1000~200000000 的整数' }

  const channels: 1 | 2 = src.channels === 2 ? 2 : 1

  const centerHz = typeof src.centerHz === 'number' ? src.centerHz : 0
  if (!Number.isFinite(centerHz) || Math.abs(centerHz) > 1e12)
    return { ok: false, error: 'centerHz 非法' }

  const displayRaw = typeof src.displaySampleRate === 'number' ? src.displaySampleRate : sampleRate
  const displaySampleRate = Math.trunc(displayRaw)
  if (
    !Number.isFinite(displaySampleRate) ||
    displaySampleRate < 1000 ||
    displaySampleRate > sampleRate
  )
    return { ok: false, error: 'displaySampleRate 须为 1000~sampleRate 的整数' }

  const pointsRaw = typeof src.pointsPerFrame === 'number' ? Math.trunc(src.pointsPerFrame) : 0
  if (!Number.isFinite(pointsRaw) || pointsRaw < 0 || pointsRaw > 65_536)
    return { ok: false, error: 'pointsPerFrame 须为 0~65536（0=自动）' }

  const dualStream = src.dualStream === true

  const recordPortRaw = typeof src.recordPort === 'number' ? Math.trunc(src.recordPort) : 0
  if (!Number.isInteger(recordPortRaw) || recordPortRaw < 0 || recordPortRaw > 65_535)
    return { ok: false, error: 'recordPort 须为 0~65535 的整数（0=与显示同端口）' }
  if (recordPortRaw > 0 && recordPortRaw === port)
    return { ok: false, error: 'recordPort 不能与显示 port 相同' }
  const recordHostRaw = typeof src.recordHost === 'string' ? src.recordHost.trim() : ''
  const recordHost = recordHostRaw || host
  if (recordHost.length > 255 || recordHost.includes('://'))
    return { ok: false, error: 'recordHost 非法' }
  const recordFormat =
    src.recordFormat === 'cf32' || src.recordFormat === 'ci16' || src.recordFormat === 'ci8'
      ? src.recordFormat
      : format
  const recordSampleRateRaw =
    typeof src.recordSampleRate === 'number' ? Math.trunc(src.recordSampleRate) : 0
  if (
    recordSampleRateRaw !== 0 &&
    (!Number.isFinite(recordSampleRateRaw) ||
      recordSampleRateRaw < 1_000 ||
      recordSampleRateRaw > 200_000_000)
  )
    return { ok: false, error: 'recordSampleRate 须为 0 或 1000~200000000' }

  const maxBufferRaw =
    typeof src.maxBufferBytes === 'number' ? Math.trunc(src.maxBufferBytes) : 32 * 1024 * 1024
  if (
    !Number.isFinite(maxBufferRaw) ||
    maxBufferRaw < 1 * 1024 * 1024 ||
    maxBufferRaw > 1024 * 1024 * 1024
  )
    return { ok: false, error: 'maxBufferBytes 须为 1MB~1GB' }

  const reconnect = src.reconnect === undefined ? true : src.reconnect === true

  return {
    ok: true,
    value: {
      host,
      port,
      format,
      sampleRate,
      channels,
      centerHz,
      displaySampleRate,
      pointsPerFrame: pointsRaw,
      dualStream,
      recordPort: recordPortRaw,
      recordHost,
      recordFormat,
      recordSampleRate: recordSampleRateRaw,
      maxBufferBytes: maxBufferRaw,
      reconnect
    }
  }
}
