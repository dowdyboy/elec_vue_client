/**
 * 信号组件共享类型（轻量化，可独立拷贝，零外部依赖）
 * 每个组件的 Normalized 类型不同，但 Adapter 统一为 (raw:unknown)=>T|null
 */

// ── 通用 ──
export type RawInput = unknown

/** 内联定义（拷贝即用：不依赖 src/shared） */
export type WindowType = 'rect' | 'hann' | 'hamming' | 'blackman'
export type ColorMap = 'viridis' | 'jet' | 'grayscale' | 'hot'

export interface Viewport {
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  autoScale?: boolean
}

export type Theme = 'light' | 'dark' | 'auto' | 'spectrum'

/**
 * 外观覆盖项（全部可选，仅覆盖传入字段；对任何主题预置生效）
 * 频谱仪经典配色可直接用 theme:'spectrum'，再按需微调
 */
export interface ChartStyle {
  /** 组件/画布背景色（GL 清屏 + 容器底色） */
  bg?: string
  /** 绘图区（栅格区）底色 */
  plotBg?: string
  /** 网格线颜色 */
  grid?: string
  /** 绘图区边框/轴线颜色 */
  border?: string
  /** 刻度文字颜色 */
  text?: string
  /** y=0 零基准虚线颜色 */
  zeroLine?: string
  /** Y 刻度芯片底色 */
  labelChipBg?: string
  /** I 迹线颜色 */
  traceI?: string
  /** Q 迹线颜色 */
  traceQ?: string
  /** 幅度包络迹线颜色（envelope 启用时） */
  envColor?: string
  /** 波形不透明度 0~1（默认 0.85） */
  traceAlpha?: number
  /** 左侧刻度带宽 CSS px（最小 40，默认 56；固定宽度不随数据抖动） */
  axisWidth?: number
  /** 十字光标线颜色（悬停读数功能） */
  crosshair?: string
}

export interface ChartBaseProps {
  width?: number
  height?: number
  theme?: Theme
  decimation?: 'minmax' | 'lttb' | false
  fpsLimit?: number
  viewport?: Viewport
}

// ── IQ ──
export interface IqData {
  i: Float32Array
  q: Float32Array
}
export type IqNormalized = IqData | Float32Array // Float32Array 为交织 [I0,Q0,I1,Q1...]
export type IqAdapter = (raw: RawInput) => IqNormalized | null
/** 导出载荷：配置 exportHandler 时组件不再自行触发浏览器下载，改交宿主持久化 */
export interface ExportPayload {
  kind: 'png' | 'csv'
  filename: string
  /** png：dataURL（含 data:image/png;base64, 前缀） */
  dataUrl?: string
  /** csv：UTF-8 文本 */
  text?: string
}

export interface IqProps extends ChartBaseProps {
  mode?: 'line' | 'dots'
  lineWidth?: number
  colors?: [string, string] // [I 颜色, Q 颜色]；未传时取主题预置，style.traceI/Q 可再覆盖
  /** 外观覆盖项，优先级：style > colors > 主题预置 */
  style?: ChartStyle
  /** 采样率 Hz：>0 时 X 轴与十字光标读数切换为时间单位（内部视口仍以样本索引为单位，不受影响） */
  sampleRate?: number
  /** 启用幅度包络通道 √(I²+Q²)（第三条叠加迹线，基于金字塔 env 聚合，大窗仍 O(块数)） */
  envelope?: boolean
  /** 余辉强度 0~0.95（0=关闭）：>0 时旧帧按 (1-强度) 逐帧衰减，形成数字荧光拖影 */
  persistence?: number
  /** follow 模式默认视口窗宽（样本数，≥16，默认 4096）；缩放后作为复位基准，运行时修改实时生效 */
  span?: number
  /**
   * 导出交付回调：提供后 PNG/CSV 完全交由宿主持久化（组件不再内置浏览器下载，
   * 含未配置目录等场景的回退也由宿主负责）；未提供时组件回退 <a download> 行为
   */
  exportHandler?: (p: ExportPayload) => void | Promise<void>
  adapter?: IqAdapter
  data?: RawInput | IqNormalized
  /** 坐标轴与刻度槽（默认开启；关闭后回退纯曲线满幅模式） */
  axis?: boolean
  /** 底部 X 轴（样本索引）刻度，axis 开启时生效 */
  xAxis?: boolean
  /** 网格线，axis 开启时生效 */
  grid?: boolean
}

/** IqChart 视口信息（viewportChange 事件载荷 / getView() 返回值） */
export interface IqViewInfo {
  /** 是否跟随最新数据 */
  follow: boolean
  /** Y 轴是否自动缩放 */
  yAuto: boolean
  /** 可见窗（绝对样本索引） */
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

// ── 频谱 ──
// 组件只吃服务端算好的「dB 幅度谱」Float32Array（长度 = fftSize/2）
export type SpectrumInput = Float32Array
export type SpectrumAdapter = (raw: RawInput) => SpectrumInput | null
export interface SpectrumProps extends ChartBaseProps {
  /** 显示用线色（处理已由服务端完成） */
  lineColor?: string
  adapter?: SpectrumAdapter
  data?: RawInput | SpectrumInput
}

// ── 时频（瀑布）──
// 组件只吃服务端算好的「dB 行」Float32Array（长度 = fftSize/2），自行累计成瀑布
export type SpectrogramInput = Float32Array
export type SpectrogramAdapter = (raw: RawInput) => SpectrogramInput | null
export interface SpectrogramProps extends ChartBaseProps {
  colorMap?: ColorMap
  timeSpan?: number // 显示时间跨度（行数），默认 128
  adapter?: SpectrogramAdapter
  data?: RawInput | SpectrogramInput
}

// ── 星座 ──
export type ConstellationNormalized = IqData | Float32Array
export type ConstellationAdapter = (raw: RawInput) => ConstellationNormalized | null
export interface ConstellationProps extends ChartBaseProps {
  pointSize?: number
  alpha?: number
  adapter?: ConstellationAdapter
  data?: RawInput | ConstellationNormalized
}

// ── 内部 ──
export type DecimationMode = NonNullable<ChartBaseProps['decimation']>
