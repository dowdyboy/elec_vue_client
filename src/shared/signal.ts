/**
 * 信号分析共享契约（跨进程：main / preload / renderer 共用）
 * 【设计】信号处理（FFT / 窗 / dB / 重叠）全部在服务端完成，
 *        服务端统一输出三类「显示就绪」帧，渲染进程组件只负责高性能展示。
 */

export type WindowType = 'rect' | 'hann' | 'hamming' | 'blackman'
export type ColorMap = 'viridis' | 'turbo' | 'jet' | 'grayscale' | 'hot'
export type ModType = 'sine' | 'BPSK' | 'QPSK' | '16QAM'
/**
 * 源输出域：
 * - real：单路实数信号（真实信号源/DAC 输出）；IQ 捕获时 I=x、Q=0
 * - complex：复数 IQ 输出（矢量源/仿真）；I/Q 独立
 */
export type OutputMode = 'real' | 'complex'
/** 源波形/调制（digital 时使用 modType） */
export type SourceWaveform = 'cw' | 'am' | 'fm' | 'pulse' | 'twoTone' | 'noise' | 'digital'
/**
 * 频谱语义（分析域，与源输出域独立）：
 * - real：只取实信号 I 通道，输出单边谱 0~Fs/2（非 DC 幅度 ×2）
 * - complex：使用 I/Q，输出完整 N bin 复谱并 fftShift 到 -Fs/2~+Fs/2
 */
export type SpectrumMode = 'real' | 'complex'

/** 处理配置（全部在服务端；UI 配置页只改这里，组件不持有） */
export interface SignalAnalysisConfig {
  // ── 信号源 ──
  freq: number // Hz，相对采样率归一化频率
  snr: number // dB，AWGN 信噪比
  amplitude: number // 载波/波形幅度（线性峰值口径）
  modType: ModType // digital 波形下的调制方式
  outputMode: OutputMode // real=实数输出；complex=复 IQ 输出
  waveform: SourceWaveform // cw/am/fm/pulse/twoTone/noise/digital
  modFreq: number // Hz，AM/FM 内部调制频率
  amDepth: number // 0~1，AM 调制度
  fmDeviation: number // Hz，FM 峰值频偏
  pulsePeriod: number // s，脉冲周期
  pulseDuty: number // 0~1，脉冲占空比
  toneSpacing: number // Hz，双音间隔
  sampleRate: number
  pointsPerFrame: number
  samplesPerSymbol: number // 每个符号占用的采样点数
  enabled: boolean
  // ── 处理（FFT / 窗 / dB / 重叠）──
  fftSize: number
  window: WindowType
  dbScale: boolean
  overlap: number // 0~0.9，仅影响时频图行重叠
  spectrumMode: SpectrumMode // 分析域：单边实信号 / 完整复谱
  /** IQ 镜像/负频分量相对载波电平 dB（-120=关闭；仅 complex 输出有效） */
  imageDb: number
}

export type AnalysisFrameType = 'spectrum' | 'spectrogram' | 'iq'

/** 服务端 → 渲染进程的帧 */
export interface AnalysisFrame {
  type: AnalysisFrameType
  seq: number
  /**
   * spectrum / spectrogram：服务端算好的幅度 Float32Array
   *   - real：长度 = fftSize/2（单边 0~Fs/2）
   *   - complex：长度 = fftSize（完整复谱，通常 fftShift 到 -Fs/2~+Fs/2）
   *   - spectrum：按 cfg.dbScale 输出 dB 或线性幅度
   *   - spectrogram：恒为 dB 行（时频图着色口径固定 -120~0 dB）
   * iq：交织原始 IQ Float32Array [I0,Q0,I1,Q1...]（时域图直接绘制）
   */
  data: Float32Array
  fftSize?: number
  /** 采样率 Hz（频谱/IQ/时频均可携带；远程后端可省略，缺省回退组件 props） */
  sampleRate?: number
  /** 数据是否 dB 刻度（频谱按配置；时频恒为 true；远程后端可省略，缺省回退组件 props） */
  dbScale?: boolean
  /** 源输出域（IQ/频谱帧；远程可省略） */
  outputMode?: OutputMode
  /** 源载波频率 Hz（IQ/频谱帧；星座等需要下变频时使用） */
  carrierHz?: number
  /** 源波形（IQ/频谱帧；远程可省略） */
  waveform?: SourceWaveform
  /** 频谱语义（频谱/时频；远程可省略，缺省 real） */
  spectrumMode?: SpectrumMode
  /** 数据第 0 个 bin 的物理频率 Hz（real 通常 0；complex+fftShift 通常 -Fs/2） */
  freqStartHz?: number
  /** bin 宽 Hz（通常 sampleRate/fftSize；可显式提供给抽稀/非标准 FFT） */
  binHz?: number
  /** 复谱是否已 fftShift（仅 complex 有意义；默认 true） */
  fftShift?: boolean
  /** 时频行间时间步长秒（重叠 hop / sampleRate；仅 spectrogram） */
  timeStepSec?: number
  modType?: ModType
}

/** 远程后端（socket.io）事件协议：外部后端 emit('signal:analysis', { type, seq, fftSize, buffer })
 *  buffer 为 Float32Array 的二进制（real 长度 = fftSize/2；complex 长度 = fftSize；IQ 为交织）
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
    // 载波默认高于符号率（当前默认 256 Bd），使 BPSK/QPSK 等调制主瓣完整居中、不被 DC 截断
    freq: 512,
    snr: 20,
    amplitude: 1,
    modType: 'sine',
    outputMode: 'real',
    waveform: 'cw',
    modFreq: 50,
    amDepth: 0.5,
    fmDeviation: 200,
    pulsePeriod: 0.01,
    pulseDuty: 0.5,
    toneSpacing: 100,
    sampleRate: 4096,
    pointsPerFrame: 2048,
    samplesPerSymbol: 16,
    enabled: true,
    fftSize: 1024,
    window: 'hann',
    dbScale: true,
    overlap: 0.5,
    spectrumMode: 'real',
    imageDb: -120
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
const OUTPUT_MODES: readonly string[] = ['real', 'complex']
const WAVEFORMS: readonly string[] = ['cw', 'am', 'fm', 'pulse', 'twoTone', 'noise', 'digital']

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
  if ('outputMode' in src) {
    if (typeof src.outputMode === 'string' && OUTPUT_MODES.includes(src.outputMode))
      out.outputMode = src.outputMode as OutputMode
    else errors.push('outputMode 须为 real 或 complex')
  }
  if ('waveform' in src) {
    if (typeof src.waveform === 'string' && WAVEFORMS.includes(src.waveform))
      out.waveform = src.waveform as SourceWaveform
    else errors.push(`waveform 非法（须为 ${WAVEFORMS.join('/')}）`)
  }
  if ('modFreq' in src) {
    const v = num('modFreq')
    if (v === null || v <= 0 || v > 1_000_000) errors.push('modFreq 须为 0~1e6 Hz')
    else out.modFreq = v
  }
  if ('amDepth' in src) {
    const v = num('amDepth')
    if (v === null || v < 0 || v > 1) errors.push('amDepth 须为 0~1')
    else out.amDepth = v
  }
  if ('fmDeviation' in src) {
    const v = num('fmDeviation')
    if (v === null || v < 0 || v > 1_000_000) errors.push('fmDeviation 须为 0~1e6 Hz')
    else out.fmDeviation = v
  }
  if ('pulsePeriod' in src) {
    const v = num('pulsePeriod')
    if (v === null || v < 1e-6 || v > 10) errors.push('pulsePeriod 须为 1e-6~10 s')
    else out.pulsePeriod = v
  }
  if ('pulseDuty' in src) {
    const v = num('pulseDuty')
    if (v === null || v < 0 || v > 1) errors.push('pulseDuty 须为 0~1')
    else out.pulseDuty = v
  }
  if ('toneSpacing' in src) {
    const v = num('toneSpacing')
    if (v === null || v < 0 || v > 1_000_000) errors.push('toneSpacing 须为 0~1e6 Hz')
    else out.toneSpacing = v
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
  if ('spectrumMode' in src) {
    if (src.spectrumMode === 'real' || src.spectrumMode === 'complex')
      out.spectrumMode = src.spectrumMode
    else errors.push('spectrumMode 须为 real 或 complex')
  }
  if ('imageDb' in src) {
    const v = num('imageDb')
    if (v === null || v < -120 || v > 0) errors.push('imageDb 须为 -120~0 的数')
    else out.imageDb = v
  }

  if (errors.length > 0) return { ok: false, error: errors.join('; ') }
  return { ok: true, value: out }
}
