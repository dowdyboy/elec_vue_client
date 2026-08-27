/**
 * 信号分析共享契约（跨进程：main / preload / renderer 共用）
 * 【设计】信号处理（FFT / 窗 / dB / 重叠）全部在服务端完成，
 *        服务端统一输出三类「显示就绪」帧，渲染进程组件只负责高性能展示。
 */

export type WindowType = 'rect' | 'hann' | 'hamming' | 'blackman'
export type ColorMap = 'viridis' | 'jet' | 'grayscale' | 'hot'
export type ModType = 'sine' | 'BPSK' | 'QPSK' | '16QAM'

/** 处理配置（全部在服务端；UI 配置页只改这里，组件不持有） */
export interface SignalAnalysisConfig {
  // ── 信号源 ──
  freq: number // Hz，相对采样率归一化频率
  snr: number // dB，噪声强度
  amplitude: number // 载波幅度（sine 峰幅值），触发/包络测试可调
  modType: ModType
  sampleRate: number
  pointsPerFrame: number
  samplesPerSymbol: number // 每个符号占用的采样点数
  enabled: boolean
  // ── 处理（FFT / 窗 / dB / 重叠）──
  fftSize: number
  window: WindowType
  dbScale: boolean
  overlap: number // 0~0.9，仅影响时频图行重叠
}

export type AnalysisFrameType = 'spectrum' | 'spectrogram' | 'iq'

/** 服务端 → 渲染进程的帧 */
export interface AnalysisFrame {
  type: AnalysisFrameType
  seq: number
  /**
   * spectrum / spectrogram：服务端算好的 dB 幅度 Float32Array（长度 = fftSize/2）
   * iq：交织原始 IQ Float32Array [I0,Q0,I1,Q1...]（时域图直接绘制）
   */
  data: Float32Array
  fftSize?: number
  modType?: ModType
}

/** 远程后端（socket.io）事件协议：外部后端 emit('signal:analysis', { type, seq, fftSize, buffer })
 *  buffer 为 Float32Array 的二进制（Length = fftSize/2 或交织 IQ）
 *  type 取 FRAME_TYPE_CODE 的数值；Electron 端（RemoteAnalysisSource）据此解析
 */
export const FRAME_TYPE_CODE: Record<AnalysisFrameType, number> = {
  spectrum: 0,
  spectrogram: 1,
  iq: 2
}
export const FRAME_TYPE_BY_CODE: AnalysisFrameType[] = ['spectrum', 'spectrogram', 'iq']

export function defaultAnalysisConfig(): SignalAnalysisConfig {
  return {
    freq: 50,
    snr: 20,
    amplitude: 1,
    modType: 'sine',
    sampleRate: 4096,
    pointsPerFrame: 2048,
    samplesPerSymbol: 16,
    enabled: true,
    fftSize: 1024,
    window: 'hann',
    dbScale: true,
    overlap: 0.5
  }
}

// ── 配置校验（IPC / socket.io 双面共用：非法键剔除，非法值拒绝）──

export interface ConfigPatchResult {
  ok: boolean
  /** 校验通过后的干净补丁（仅含合法键） */
  value?: Partial<SignalAnalysisConfig>
  error?: string
}

const MOD_TYPES: readonly string[] = ['sine', 'BPSK', 'QPSK', '16QAM']
const WINDOW_TYPES: readonly string[] = ['rect', 'hann', 'hamming', 'blackman']

export function sanitizeConfigPatch(patch: unknown): ConfigPatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    return { ok: false, error: '配置必须为对象' }
  const src = patch as Record<string, unknown>
  const out: Partial<SignalAnalysisConfig> = {}
  const errors: string[] = []
  const num = (k: string): number | null =>
    typeof src[k] === 'number' && Number.isFinite(src[k]) ? (src[k] as number) : null
  const int = (k: string): number | null => {
    const v = num(k)
    return v === null ? null : Math.trunc(v)
  }

  if ('freq' in src) {
    const freq = num('freq')
    const srInPatch = num('sampleRate')
    if (freq === null || freq <= 0) errors.push('freq 必须为正数')
    else if (srInPatch !== null && srInPatch > 0 && freq >= srInPatch / 2)
      errors.push(`freq(${freq}) 须小于 sampleRate/2(${srInPatch / 2})`)
    else out.freq = freq
  }
  if ('snr' in src) {
    const snr = num('snr')
    if (snr === null || snr < 0 || snr > 100) errors.push('snr 须为 0~100 的数')
    else out.snr = snr
  }
  if ('amplitude' in src) {
    const amp = num('amplitude')
    if (amp === null || amp <= 0 || amp > 10) errors.push('amplitude 须为 0~10 的数')
    else out.amplitude = amp
  }
  if ('modType' in src) {
    if (typeof src.modType === 'string' && MOD_TYPES.includes(src.modType))
      out.modType = src.modType as ModType
    else errors.push(`modType 非法（须为 ${MOD_TYPES.join('/')}）`)
  }
  if ('sampleRate' in src) {
    const sr = int('sampleRate')
    if (sr === null || sr < 256 || sr > 4_194_304) errors.push('sampleRate 须为 256~4194304 的整数')
    else out.sampleRate = sr
  }
  if ('pointsPerFrame' in src) {
    const n = int('pointsPerFrame')
    if (n === null || n < 64 || n > 65_536) errors.push('pointsPerFrame 须为 64~65536 的整数')
    else out.pointsPerFrame = n
  }
  if ('samplesPerSymbol' in src) {
    const n = int('samplesPerSymbol')
    if (n === null || n < 1 || n > 1024) errors.push('samplesPerSymbol 须为 1~1024 的整数')
    else out.samplesPerSymbol = n
  }
  if ('enabled' in src) {
    if (typeof src.enabled === 'boolean') out.enabled = src.enabled
    else errors.push('enabled 须为布尔')
  }
  if ('fftSize' in src) {
    const n = int('fftSize')
    if (n === null || n < 64 || n > 65_536 || (n & (n - 1)) !== 0)
      errors.push('fftSize 须为 64~65536 内的 2 的幂')
    else out.fftSize = n
  }
  if ('window' in src) {
    if (typeof src.window === 'string' && WINDOW_TYPES.includes(src.window))
      out.window = src.window as WindowType
    else errors.push(`window 非法（须为 ${WINDOW_TYPES.join('/')}）`)
  }
  if ('dbScale' in src) {
    if (typeof src.dbScale === 'boolean') out.dbScale = src.dbScale
    else errors.push('dbScale 须为布尔')
  }
  if ('overlap' in src) {
    const o = num('overlap')
    if (o === null || o < 0 || o > 0.9) errors.push('overlap 须为 0~0.9 的数')
    else out.overlap = o
  }

  if (errors.length > 0) return { ok: false, error: errors.join('; ') }
  return { ok: true, value: out }
}
