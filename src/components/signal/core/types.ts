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
  /** 波形不透明度 0~1（默认 0.85） */
  traceAlpha?: number
  /** 左侧刻度带宽 CSS px（最小 40，默认 56；固定宽度不随数据抖动） */
  axisWidth?: number
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
export interface IqProps extends ChartBaseProps {
  mode?: 'line' | 'dots'
  lineWidth?: number
  colors?: [string, string] // [I 颜色, Q 颜色]；未传时取主题预置，style.traceI/Q 可再覆盖
  /** 外观覆盖项，优先级：style > colors > 主题预置 */
  style?: ChartStyle
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
