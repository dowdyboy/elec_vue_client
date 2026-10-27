/**
 * 信号组件共享类型（轻量化，可独立拷贝，零外部依赖）
 * 每个组件的 Normalized 类型不同，但 Adapter 统一为 (raw:unknown)=>T|null
 */

// ── 通用 ──
export type RawInput = unknown

/** 内联定义（拷贝即用：不依赖 src/shared） */
export type WindowType = 'rect' | 'hann' | 'hamming' | 'blackman'
export type ColorMap = 'viridis' | 'turbo' | 'jet' | 'grayscale' | 'hot'

export interface Viewport {
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  autoScale?: boolean
}

import type { ChartLocale, ChartMessages } from './i18n'

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
  /** 触发覆盖层强调色（电平虚线/触发三角/Lv 文字/右上触发角标文字） */
  triggerColor?: string
  /** 单迹线图表（频谱等）主迹线颜色 */
  traceColor?: string
  /** 多迹线调色板（频谱；按迹线序号回绕，覆盖主题预置） */
  tracePalette?: string[]
}

/** 宿主可覆盖的界面文案（默认中文）；未传字段用默认值，便于英文/多语言宿主 */
export interface ChartLabels {
  /** Y 轴标题（默认「幅度」） */
  y?: string
  /** X 轴标题（默认「频率」/「样本」/「时间」） */
  x?: string
  /** 暂停/冻结角标（IQ 默认「已暂停跟随 · 双击恢复」；频谱默认「已冻结 · 点击恢复」） */
  paused?: string
  /** 数据流中断角标（默认「数据流中断」） */
  stale?: string
  /** 画布无障碍标签（默认「IQ 时域图」/「频谱图」/「时频图」） */
  aria?: string
  /** 星座图 I/Q 轴标题（默认 I / Q） */
  i?: string
  q?: string
  /** 迹线图例文案（频谱多迹线） */
  legend?: {
    clear?: string
    average?: string
    maxHold?: string
    minHold?: string
  }
}

export interface ChartBaseProps {
  /** 宽度：数字按 px，字符串原样（如 '100%'） */
  width?: number | string
  /** 高度：数字按 px，字符串原样（如 '100%'）；未传时各组件有默认高度 */
  height?: number | string
  theme?: Theme
  decimation?: 'minmax' | 'lttb' | false
  fpsLimit?: number
  viewport?: Viewport
  /** WebGL 上下文是否保留绘图缓冲（余辉/导出需要；默认 true。不需要余辉可设 false 降低拷贝开销） */
  preserveDrawingBuffer?: boolean
  /** 渲染后端：auto=优先 WebGL2、不可用回退 Canvas2D；webgl2=强制；canvas2d=强制 2D（默认 auto） */
  renderer?: 'auto' | 'webgl2' | 'canvas2d'
  /** 界面语言：默认 zh-CN；'en-US' 切换内置英文 */
  locale?: ChartLocale
  /** 按 key 覆盖任意文案（优先级高于 locale；labels 的最高优先级保持不变） */
  messages?: ChartMessages
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
  /** png：Blob（exportPNGAsync / 宿主可直接持久化，避免主线程转 base64） */
  blob?: Blob
  /** csv：UTF-8 文本 */
  text?: string
}

export interface IqProps extends ChartBaseProps {
  mode?: 'line' | 'dots'
  lineWidth?: number
  colors?: [string, string] // [I 颜色, Q 颜色]；未传时取主题预置，chartStyle.traceI/Q 可再覆盖
  /** 外观覆盖项，优先级：chartStyle > colors > 主题预置 */
  chartStyle?: ChartStyle
  /** 可覆盖的界面文案（轴标题/角标等；默认中文） */
  labels?: ChartLabels
  /** 采样率 Hz：>0 时 X 轴与十字光标读数切换为时间单位（内部视口仍以样本索引为单位，不受影响） */
  sampleRate?: number
  /** 启用幅度包络通道 √(I²+Q²)（第三条叠加迹线，基于金字塔 env 聚合，大窗仍 O(块数)） */
  envelope?: boolean
  /** 余辉强度 0~0.95（0=关闭）：>0 时旧帧按 (1-强度) 逐帧衰减，形成数字荧光拖影 */
  persistence?: number
  /** 触发显示配置：启用后进入触发对齐模式（独立于跟随/暂停） */
  trigger?: {
    enabled: boolean
    /** 触发通道，默认 'i' */
    source?: 'i' | 'q'
    /** 边沿，默认 'rising' */
    edge?: 'rising' | 'falling'
    /** 电平阈值，默认 0 */
    level?: number
    /** 模式，默认 'auto' */
    mode?: 'auto' | 'normal' | 'single'
    /** 触发点屏幕位置比例 0~1（窗口起点在其左侧的比例），默认 0.25 */
    preTrigger?: number
    /** auto 模式触发失联超时（ms，默认 500）：超过该时长无新触发 → 回退自由滚动（free-run）防死屏 */
    autoTimeout?: number
  }
  /** follow 模式默认视口窗宽（样本数，≥16，默认 4096）；缩放后作为复位基准，运行时修改实时生效 */
  span?: number
  /**
   * 受控跟随开关（可选）：传入后由宿主控制；组件内部缩放/暂停会发 update:follow，
   * 配合 v-model:follow 使用。未传时组件自管。
   */
  follow?: boolean
  /** 环形缓冲上限（样本数，默认 2,000,000，挂载时生效）；多实例/低内存场景可调小 */
  maxPoints?: number
  /** 是否显示内置右键菜单（默认 true；设 false 后仍会 emit contextmenu，由宿主自绘） */
  contextMenu?: boolean
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
  /** 轴单位标题（左上「幅度」/右下「时间·样本」），默认开启；false 关闭 */
  axisLabels?: boolean
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

/** IqChart 运行统计（getStats()） */
export interface IqStats {
  /** 当前缓冲样本数 */
  length: number
  /** 已淘汰的最老样本数（绝对索引偏移） */
  dropped: number
  /** 绝对样本总数 = dropped + length */
  total: number
  /** 环形缓冲上限 */
  maxPoints: number
  follow: boolean
  span: number
  sampleRate?: number
}

/** IqChart 光标读数（cursorChange 事件载荷；移出绘图区为 null） */
export interface IqCursorInfo {
  px: number
  py: number
  /** 绝对样本索引 */
  dataX: number
  i: number
  q: number
}

/** IqChart 可见窗口原始数据（getVisibleData()，返回拷贝） */
export interface IqVisibleData {
  i: Float32Array
  q: Float32Array
  /** 起始绝对样本索引 */
  startIndex: number
}

/** IqChart appendData/setData 的帧元数据（可选） */
export interface IqFrameMeta {
  /** 采样率 Hz：传后组件时间轴/读数立即使用该值（优先于 sampleRate prop） */
  sampleRate?: number
}

// ── 频谱 ──
// 组件只吃服务端算好的「dB 幅度谱」Float32Array（长度 = fftSize/2）
export type SpectrumInput = Float32Array
export type SpectrumAdapter = (raw: RawInput) => SpectrumInput | null

/** 频谱迹线模式：clear=实时 / average=视频平均（最近 N 帧）/ maxHold=最大保持 / minHold=最小保持 */
export type SpectrumTraceMode = 'clear' | 'average' | 'maxHold' | 'minHold'

/** 多迹线配置项（traces prop；缺省色取主题 tracePalette，索引越界回绕） */
export interface SpectrumTraceSpec {
  mode: SpectrumTraceMode
  /** 图例显示名（缺省按模式显示「实时/平均(N)/最大保持/最小保持」；宿主可传 "TX1"/"REF" 等） */
  label?: string
  /** 缺省 true；false 时隐藏（仍在后台累计，再开启即恢复最新状态） */
  enabled?: boolean
  /** 覆盖该迹线颜色（优先级：本字段 > style.traceColor(首条) > 主题 tracePalette） */
  color?: string
  /** 显示偏移 dB（仅绘制与该迹线读数芯片；测量按原始数据，见文档） */
  offsetDb?: number
  /** average 模式的平均语义：power=功率(RMS)平均（默认，真机口径）/ log=对数平均 */
  avgMode?: 'power' | 'log'
  /** 迹线运算（不占用自身缓冲）：显示 a−b（按迹线索引；dB 域相减）；参与排序的活动迹线/自动量程将跳过运算迹线 */
  math?: { op: 'subtract'; a: number; b: number }
}

/** 频谱检波器（抽稀时每像素桶取值方式）：minmax=双极值（默认）/ posPeak 正峰 / negPeak 负峰 / sample 采样 / rms 功率平均 / average 对数平均 */
export type SpectrumDetector = 'minmax' | 'posPeak' | 'negPeak' | 'sample' | 'rms' | 'average'

/** 深缩放样本点显示：auto=可见样本间隔 >3px 时自动 / on 强制 / off 关闭 */
export type SpectrumDots = 'auto' | 'on' | 'off'

/** 限制线顶点（freqHz 与 bin 二者其一；同时给出时优先 freqHz） */
export interface SpectrumLimitPoint {
  freqHz?: number
  bin?: number
  level: number
}

/** 限制线（折线线性插值到全 bin；type 默认 upper） */
export interface SpectrumLimitLine {
  points: SpectrumLimitPoint[]
  type?: 'upper' | 'lower'
  label?: string
}

/** 频谱/时频语义：real=实信号单边 0~Fs/2；complex=完整复谱（通常 -Fs/2~+Fs/2） */
export type SpectrumMode = 'real' | 'complex'

/** 频谱幅度显示单位（内部数据为归一化 dB：0 dB = 满量程复单音；dBm 等为宿主自行校准后的口径） */
export type SpectrumUnit = 'dBFS' | 'dBm' | 'dBuV' | 'dBmV' | 'dBW'

/** 峰值表面板参数（findPeaks 的可视化封装） */
export interface SpectrumPeakTableOpts {
  /** 列出峰值个数（默认 6） */
  count?: number
  /** 绝对门限（dB 域；低于忽略，缺省无门限） */
  thresholdDb?: number
  /** 回落门限 dB（默认 6） */
  excursionDb?: number
}

export interface SpectrumProps extends ChartBaseProps {
  /** 显示用线色（旧 API；优先级低于 chartStyle.traceColor，未覆盖时取主题预置） */
  lineColor?: string
  /** 外观覆盖项（优先级：chartStyle > lineColor > 主题预置） */
  chartStyle?: ChartStyle
  /** 可覆盖的界面文案（轴标题/角标/图例等；默认中文） */
  labels?: ChartLabels
  /** 折线宽度（CSS px；>1 时 ribbon 几何展开） */
  lineWidth?: number
  /** 采样率 Hz（帧元数据优先；与 fftSize 一起换算频率轴，缺省时 X 轴为 bin 索引） */
  sampleRate?: number
  /** FFT 大小（帧元数据优先；缺省用数据长度 ×2） */
  fftSize?: number
  /** 数据单位（帧元数据优先）：true=dB（默认）/ false=线性幅度 */
  dbScale?: boolean
  /** 频谱语义（帧元数据优先；默认 real=单边实信号） */
  spectrumMode?: SpectrumMode
  /** 第 0 个 bin 的物理频率 Hz（real 通常 0；complex+fftShift 通常 -Fs/2） */
  freqStartHz?: number
  /** bin 宽 Hz（缺省 sampleRate/fftSize） */
  binHz?: number
  /** 复谱数据是否已 fftShift（仅 complex；默认 true） */
  fftShift?: boolean
  /** 手动纵轴参考电平 dB（autoScale=false 时生效；默认 0） */
  refLevel?: number
  /** 纵轴 dB/格（autoScale=false 时生效；默认 10） */
  scaleDiv?: number
  /** 纵轴自动缩放（默认 true） */
  autoScale?: boolean
  /** 冻结/暂停（受控，支持 v-model:paused）：true 时不再合并新帧；也可调用 setPaused() */
  paused?: boolean
  /** 迹线模式（默认 clear） */
  traceMode?: SpectrumTraceMode
  /** average 模式平均帧数（1~1024，默认 16） */
  averageCount?: number
  /** 余辉强度 0~0.95（0=关闭） */
  persistence?: number
  /** 显示窗宽（bin 数；缺省/0=全带宽；≥8） */
  span?: number
  /** 峰值跟踪：每帧自动把标记 1 移到可见跨度最大点 */
  peakTrack?: boolean
  /** 坐标轴与刻度槽（默认开启；关闭后回退纯曲线满幅模式） */
  axis?: boolean
  /** 底部 X 轴（频率/bin）刻度，axis 开启时生效 */
  xAxis?: boolean
  /** 网格线，axis 开启时生效 */
  grid?: boolean
  /** 轴单位标题（默认开启） */
  axisLabels?: boolean
  /** 多迹线配置（提供且非空时生效，覆盖 traceMode 单迹线路径；v-model:traces 可同步图例开关） */
  traces?: SpectrumTraceSpec[]
  /** 迹线图例（实时/平均/最大保持/最小保持）是否显示；默认 true。图例固定在顶部居中 */
  legend?: boolean
  /** 是否显示内置右键菜单（默认 true；设 false 后仍会 emit contextmenu，由宿主自绘） */
  contextMenu?: boolean
  /** 幅度显示单位（默认 dBFS；仅影响显示格式化，内部数据为归一化 dB） */
  unit?: SpectrumUnit
  /** 阻抗（dBµV/dBmV 换算用；默认 50） */
  impedance?: 50 | 75
  /** 视频带宽 VBW Hz（0/缺省=关；比例模型 α=1−VBW/RBW，VBW≥RBW 视为关。先滤波再做平均/保持） */
  vbw?: number
  /** 图内参数栏（四角：Ref/Scale、Center/Span、RBW/VBW；默认开启） */
  showInfo?: boolean
  /** 峰值表面板（默认关闭） */
  peakTable?: boolean
  /** 峰值表参数 */
  peakTableOpts?: SpectrumPeakTableOpts
  /** 标记表（右侧面板：序号/频率/电平 + Δ 行；默认关闭时用紧凑读数条） */
  markerTable?: boolean
  /** 检波器（默认 minmax 双极值，行为与旧版一致） */
  detector?: SpectrumDetector
  /** 深缩放样本点显示（默认 auto） */
  dots?: SpectrumDots
  /** 频率偏移 Hz（仅显示层：刻度/读数/信息栏；API 返回值仍为原始 Hz） */
  freqOffsetHz?: number
  /** 幅度校准偏移 dB（仅显示层：轴刻度/读数/测量芯片；测量 API 返回值仍为原始 dB） */
  ampOffsetDb?: number
  /** 限制线（上下限折线 + 通/失败判定，判定基于活动迹线） */
  limitLines?: SpectrumLimitLine[]
  /** 导出交付回调：提供后 PNG/CSV 交由宿主持久化（同 IqChart） */
  exportHandler?: (p: ExportPayload) => void | Promise<void>
  adapter?: SpectrumAdapter
  data?: RawInput | SpectrumInput
}

/** 频谱测量/峰值 API 的显式 bin 区间（缺省用当前可见窗） */
export interface SpectrumBinRange {
  loBin?: number
  hiBin?: number
}

/** SpectrumChart 运行统计（getStats()） */
export interface SpectrumStats {
  bins: number
  fftSize?: number
  sampleRate?: number
  dbScale: boolean
  paused: boolean
  traceCount: number
  markerCount: number
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** SpectrumChart 光标读数（cursorChange 事件载荷；移出绘图区为 null） */
export interface SpectrumCursorInfo {
  px: number
  py: number
  bin: number
  /** 频率（有 sampleRate/fftSize 时） */
  freqHz?: number
  /** 原始 dB 值（线性显示时已转 dB） */
  levelDb: number
  dbScale: boolean
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** SpectrumChart 可见窗口活动迹线数据（getVisibleData()，返回拷贝） */
export interface SpectrumVisibleData {
  /** 活动迹线原始数据（dB 或线性，随 dbScale） */
  data: Float32Array
  startBin: number
  endBin: number
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** SpectrumChart getView() 返回值 / viewportChange 事件载荷 */
export interface SpectrumViewInfo {
  /** 可见窗（bin 索引域） */
  xMin: number
  xMax: number
  /** 纵轴（dB 或线性幅度） */
  yMin: number
  yMax: number
  /** 纵轴是否自动缩放 */
  yAuto: boolean
  /** 频率域换算（sampleRate/fftSize 未知时为 undefined） */
  freqMin?: number
  freqMax?: number
  centerHz?: number
  spanHz?: number
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** 频谱运行元数据（帧元数据优先，缺省由 props 推导） */
export interface SpectrumMeta {
  sampleRate?: number
  fftSize?: number
  /** bin 宽 Hz = sampleRate/fftSize（未知时 undefined） */
  binHz?: number
  /** 数据单位：true=dB / false=线性幅度 */
  dbScale: boolean
  spectrumMode?: SpectrumMode
  /** 数据第 0 个 bin 的物理频率 Hz */
  freqStartHz?: number
  /** 复谱是否已 fftShift（仅 complex） */
  fftShift?: boolean
}

// ── 时频（瀑布）──
// 组件只吃服务端算好的「dB 行」Float32Array（长度 = fftSize/2），自行累计成瀑布
export type SpectrogramInput = Float32Array
export type SpectrogramAdapter = (raw: RawInput) => SpectrogramInput | null

/** 时频行元数据（帧元数据优先；缺省回退 props） */
export interface SpectrogramMeta {
  sampleRate?: number
  fftSize?: number
  /** 时频行恒为 dB；保留字段用于兼容 */
  dbScale?: boolean
  /** 频谱语义：real=单边；complex=完整复谱（带符号频率） */
  spectrumMode?: SpectrumMode
  /** 数据第 0 个 bin 的物理频率 Hz */
  freqStartHz?: number
  /** bin 宽 Hz */
  binHz?: number
  /** 复谱是否已 fftShift（仅 complex） */
  fftShift?: boolean
  /** 行时间戳（ms）；用于时间轴/游标读数，缺省用工整的行步长 */
  timestamp?: number
  /** 服务端行序号（可选） */
  seq?: number
  /** 行间时间步长秒（重叠 hop/sampleRate；缺省由 fftSize/sampleRate 推导） */
  timeStepSec?: number
}

export interface SpectrogramLevelRange {
  min: number
  max: number
}

export interface SpectrogramProps extends ChartBaseProps {
  colorMap?: ColorMap
  /** 外观覆盖（主题色/字体芯片等） */
  chartStyle?: ChartStyle
  /** 可覆盖文案（轴/色标/aria 等） */
  labels?: ChartLabels
  /** 显示行数（时间窗），默认 256 */
  timeSpan?: number
  /** 环形缓冲容量（默认 = max(timeSpan, 256)） */
  maxRows?: number
  /** 采样率 Hz（帧元数据优先） */
  sampleRate?: number
  /** FFT 大小（帧元数据优先；缺省由行宽和频谱模式推导） */
  fftSize?: number
  /** 频谱语义（帧元数据优先；默认 real） */
  spectrumMode?: SpectrumMode
  /** 第 0 个 bin 的物理频率 Hz（real 通常 0；complex 通常 -Fs/2） */
  freqStartHz?: number
  /** bin 宽 Hz（缺省 sampleRate/fftSize） */
  binHz?: number
  /** 复谱是否已 fftShift（仅 complex；默认 true） */
  fftShift?: boolean
  /** 频率显示偏移 Hz（仅显示层） */
  freqOffsetHz?: number
  /** 行间时间步长秒（帧元数据优先；缺省由 fftSize/sampleRate 推导） */
  timeStepSec?: number
  /** 手动电平下限 dB（默认 -120；autoLevel 时忽略） */
  dbMin?: number
  /** 手动电平上限 dB（默认 0；autoLevel 时忽略） */
  dbMax?: number
  /** 自动电平范围（默认 false，固定 -120~0 dBFS） */
  autoLevel?: boolean
  /** 色阶 gamma（0.2~3，默认 1；>1 提亮低电平） */
  gamma?: number
  /** 数据/纹理缩放插值：nearest（默认，保留 bin/行边界）或 linear */
  interpolation?: 'nearest' | 'linear'
  /** 冻结最新画面（数据仍入环形缓冲；支持 v-model:paused） */
  paused?: boolean
  /** 右侧色标（默认 true） */
  showColorbar?: boolean
  /** 左上参数栏（默认 true） */
  showInfo?: boolean
  /** 十字光标读数（默认 true） */
  showCursor?: boolean
  /** 内置右键菜单（默认 true；false 时仍 emit contextmenu） */
  contextMenu?: boolean
  /** 电平显示单位（仅显示层，默认 dBFS） */
  unit?: string
  /** 幅度校准偏移 dB（仅显示层） */
  ampOffsetDb?: number
  /** 坐标轴（默认 true） */
  axis?: boolean
  /** X 轴刻度（频率） */
  xAxis?: boolean
  /** 网格 */
  grid?: boolean
  /** 轴/色标标题 */
  axisLabels?: boolean
  /** PNG/CSV 交由宿主交付 */
  exportHandler?: (p: ExportPayload) => void | Promise<void>
  adapter?: SpectrogramAdapter
  data?: RawInput | SpectrogramInput
}

/** 时频游标读数（cursorChange 事件；移出绘图区为 null） */
export interface SpectrogramCursorInfo {
  /** 行龄：0=最新行 */
  rowAge: number
  bin: number
  /** 频率（有 sampleRate/fftSize 时） */
  freqHz?: number
  /** 相对最新行的时间（秒，负值；有 timeStep 时） */
  timeSec?: number
  /** dB 原始值（未加 ampOffsetDb） */
  levelDb: number
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** 时频运行统计 */
export interface SpectrogramStats {
  rows: number
  capacity: number
  cols: number
  fftSize?: number
  sampleRate?: number
  timeStepSec?: number
  dbMin: number
  dbMax: number
  paused: boolean
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

/** 时频可见数据（getVisibleData()，newest→oldest 拷贝） */
export interface SpectrogramVisibleData {
  rows: Float32Array[]
  cols: number
  newestSeq: number
  fftSize?: number
  sampleRate?: number
  timeStepSec?: number
  freqOffsetHz: number
  spectrumMode?: SpectrumMode
  freqStartHz?: number
  binHz?: number
}

// ── 功率-时间 / 零扫宽 ──
export interface PowerTimeAnalysisConfig {
  enabled?: boolean
  /** 脉冲门限（dB，和输入单位一致） */
  thresholdDb?: number
  /** 滞回（dB） */
  hysteresisDb?: number
  /** 最小脉宽（秒）；0 表示不过滤 */
  minWidthSec?: number
  /** 最多保留的脉冲数，默认 512 */
  maxPulses?: number
}

export interface PowerTimeNormalized {
  values: Float32Array
  timeStepSec?: number
  sampleRate?: number
  startTimeSec?: number
}
export type PowerTimeAdapter = (raw: RawInput) => PowerTimeNormalized | null

export interface PowerTimeProps extends ChartBaseProps {
  data?: RawInput | PowerTimeNormalized
  adapter?: PowerTimeAdapter
  /** 功率单位（仅显示层，如 dBm/dBFS） */
  unit?: string
  /** 采样率 Hz；优先级低于 timeStepSec */
  sampleRate?: number
  /** 每点时间步长秒；缺省 1/sampleRate，再缺省 1 */
  timeStepSec?: number
  /** 第一个点的绝对时间秒 */
  startTimeSec?: number
  /** 自动 Y 量程（默认 true；false 时用 yMin/yMax） */
  autoScale?: boolean
  yMin?: number
  yMax?: number
  mode?: 'line' | 'dots'
  lineWidth?: number
  showInfo?: boolean
  follow?: boolean
  /** 时间窗显示点数（默认 4096） */
  span?: number
  /** 环形缓冲上限（默认 500k） */
  maxPoints?: number
  /** 仅显示用的门限线（dB）；不触发脉冲分析 */
  thresholdDb?: number
  /** 可选脉冲分析；不传即纯显示 */
  analysis?: PowerTimeAnalysisConfig
  /** 坐标轴/网格（默认开启） */
  axis?: boolean
  xAxis?: boolean
  grid?: boolean
  axisLabels?: boolean
  chartStyle?: ChartStyle
  labels?: ChartLabels
}

// ── 信号质量面板（纯指标显示） ──
export interface SignalQualityMetrics {
  evmPercent?: number
  merDb?: number
  snrDb?: number
  carrierOffsetHz?: number
  symbolRateErrorPpm?: number
  paprDb?: number
  iqGainImbalanceDb?: number
  iqPhaseImbalanceDeg?: number
  powerDbm?: number
  peakPowerDbm?: number
  frequencyHz?: number
  pulseWidthSec?: number
  dutyCycle?: number
}

export interface SignalQualityThresholds {
  evmPercentMax?: number
  merDbMin?: number
  snrDbMin?: number
  carrierOffsetHzMax?: number
  symbolRateErrorPpmMax?: number
  paprDbMax?: number
  iqGainImbalanceDbMax?: number
  iqPhaseImbalanceDegMax?: number
  powerDbmMin?: number
  powerDbmMax?: number
}

export type SignalQualityState = 'pass' | 'fail' | 'warn' | 'unknown'

export interface SignalQualityPanelProps {
  metrics?: SignalQualityMetrics
  thresholds?: SignalQualityThresholds
  title?: string
  /** 紧凑模式：更小卡片间距 */
  compact?: boolean
  /** 是否显示总体 Pass/Fail */
  showPassFail?: boolean
  labels?: ChartLabels
  locale?: ChartLocale
  messages?: ChartMessages
}

// ── 眼图 ──
export interface EyeInput {
  traces: Float32Array[]
  spanSymbols?: number
  samplesPerSymbol?: number
}
export type EyeAdapter = (raw: RawInput) => Float32Array[] | EyeInput | null

export interface EyeDiagramProps extends ChartBaseProps {
  data?: RawInput | Float32Array[] | EyeInput
  adapter?: EyeAdapter
  /** 眼图横向 UI 数，默认 2 */
  spanSymbols?: number
  /** 每符号采样数（仅用于 UI 标注/抖动换算） */
  samplesPerSymbol?: number
  /** 最多保留轨迹数，默认 500 */
  maxTraces?: number
  /** 轨迹透明度 0~1 */
  alpha?: number
  lineWidth?: number
  autoScale?: boolean
  yMin?: number
  yMax?: number
  showInfo?: boolean
  axis?: boolean
  xAxis?: boolean
  grid?: boolean
  axisLabels?: boolean
  chartStyle?: ChartStyle
  labels?: ChartLabels
}

// ── 星座 ──
export type ConstellationNormalized = IqData | Float32Array
export type ConstellationAdapter = (raw: RawInput) => ConstellationNormalized | null
export type ConstellationModulation = 'BPSK' | 'QPSK' | '16QAM'
/**
 * 星座分析仪配置（可选）：
 * - 不传 analysis：组件保持纯显示，只画调用方给的点，不做 NCO/符号同步/EVM
 * - 传入：组件对原始 IQ 做中心频率下变频、载波恢复、符号定时、判决点和 EVM/MER
 * - 所有字段都有安全默认；只传 analysis:{} 也能按 QPSK 默认分析
 */
export interface ConstellationAnalysisConfig {
  modulation?: ConstellationModulation
  /** 原始 IQ 采样率；必填 */
  sampleRate?: number
  /** 分析仪中心频率（下变频）；缺省 0=基带 */
  centerFrequencyHz?: number
  /** 已知残余频偏（Hz）；autoCarrier 会叠加估计值 */
  frequencyOffsetHz?: number
  /** 已知相位偏移（deg） */
  phaseOffsetDeg?: number
  /** 符号率；与 samplesPerSymbol 二选一 */
  symbolRateHz?: number
  /** 每符号采样数；与 symbolRateHz 二选一 */
  samplesPerSymbol?: number
  /** 自动估计残余载波频偏（BPSK/QPSK/16QAM：判决点 EVM 搜索；需中心频率大致对准） */
  autoCarrier?: boolean
  /** 自动搜索符号定时相位（按 EVM 最小） */
  autoSymbolTiming?: boolean
  /** 用于估计的符号数（默认 4096） */
  estimatorSymbols?: number
}
export interface ConstellationProps extends ChartBaseProps {
  pointSize?: number
  alpha?: number
  /**
   * 星座分析仪配置。缺省=纯显示路径：
   * appendData 的 IQ 被原样展示，不启用载波/符号/EVM 分析。
   */
  analysis?: ConstellationAnalysisConfig
  /** 外观覆盖项，优先级：chartStyle > 主题预置 */
  chartStyle?: ChartStyle
  /** 可覆盖的界面文案（I/Q 轴标题等） */
  labels?: ChartLabels
  /** 坐标轴/网格（默认开启；关闭后为满幅点云） */
  axis?: boolean
  /** 网格线（axis 开启时生效） */
  grid?: boolean
  /** 轴单位标题 I/Q（默认开启） */
  axisLabels?: boolean
  /** 图内信息（点数/自动量程等，默认开启） */
  showInfo?: boolean
  /** 环形缓冲上限（点数，默认 500,000） */
  maxPoints?: number
  /** 单帧最多绘制点数（默认 WebGL 150k / Canvas2D 30k；抽点渲染，不丢缓冲） */
  maxRenderPoints?: number
  /** 导出交付回调：提供后 PNG/CSV 交由宿主持久化（同 IQ/频谱） */
  exportHandler?: (p: ExportPayload) => void | Promise<void>
  adapter?: ConstellationAdapter
  data?: RawInput | ConstellationNormalized
}

export interface ConstellationViewInfo {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  autoScale: boolean
}

export interface ConstellationStats {
  /** 缓冲内总点数 */
  points: number
  /** 实际绘制点数（抽点后） */
  renderPoints: number
  iMin: number
  iMax: number
  qMin: number
  qMax: number
  iRms: number
  qRms: number
  /** E[I²+Q²]（归一化功率） */
  power: number
  /** 10·log10(power)，0 dBFS = 单位复幅度 */
  powerDbfs: number
  /** 最大 |I+jQ| */
  peak: number
}

export interface ConstellationAnalysisStats {
  /** 是否已产生过有效判决点 */
  measured: boolean
  modulation: ConstellationModulation
  /** 当前符号率/每符号采样数（分析仪设置） */
  symbolRateHz: number
  samplesPerSymbol: number
  /** 自动估计/手动叠加后的残余频偏 */
  carrierOffsetHz: number
  /** 自动搜索/手动的定时相位（采样点） */
  symbolTimingOffset: number
  /** 参与统计的符号数（最近一段） */
  symbolCount: number
  /** 归一化 EVM（0..1） */
  evmRms: number
  evmPercent: number
  /** MER = -20log10(EVM)，EVM=0 时 Inf 限制为 120dB */
  merDb: number
  magnitudeErrorRms: number
  phaseErrorRmsDeg: number
  iqGainImbalanceDb: number
  iqPhaseImbalanceDeg: number
}

// ── 内部 ──
export type DecimationMode = NonNullable<ChartBaseProps['decimation']>
