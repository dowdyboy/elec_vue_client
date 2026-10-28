/**
 * 最小显示预设：供调用方把组件当“纯显示”使用。
 *
 * 这些对象不是新的组件模式，只是把高级/分析功能显式关掉的 props 组合：
 * - IQ：不启用触发/包络/右键菜单
 * - 频谱：不自动量程、不显示信息栏/图例/峰值表/标记表、不跑 VBW/余辉/限制线
 * - 时频：不自动电平、不显示参数栏/右键菜单
 * - 星座：不传 analysis，组件只画点
 * - 功率-时间：不启用脉冲分析、不显示信息栏
 * - 眼图：不显示信息栏，保留轴/网格
 * - 持续谱：不显示信息栏，保留轴/色标/游标
 *
 * 用法：
 *   import { spectrumDisplayOnly } from '@components/signal'
 *   <SpectrumChart v-bind="spectrumDisplayOnly" :data="row" />
 *
 * 需要高级能力时，只需在预设之后覆盖对应 prop（后者优先）。
 */
import type {
  ConstellationProps,
  EyeDiagramProps,
  IqProps,
  PersistenceProps,
  PowerTimeProps,
  SpectrogramProps,
  SpectrumProps
} from './types'

export const iqDisplayOnly = {
  mode: 'line',
  trigger: { enabled: false },
  envelope: false,
  persistence: 0,
  contextMenu: false,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<IqProps>

export const spectrumDisplayOnly = {
  autoScale: false,
  refLevel: 0,
  scaleDiv: 10,
  showInfo: false,
  contextMenu: false,
  legend: false,
  peakTable: false,
  markerTable: false,
  peakTrack: false,
  limitLines: [],
  traceMode: 'clear',
  persistence: 0,
  vbw: 0,
  detector: 'minmax',
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<SpectrumProps>

export const spectrogramDisplayOnly = {
  autoLevel: false,
  dbMin: -120,
  dbMax: 0,
  showInfo: false,
  contextMenu: false,
  showColorbar: true,
  showCursor: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<SpectrogramProps>

export const constellationDisplayOnly = {
  showInfo: false,
  axis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<ConstellationProps>

export const powerTimeDisplayOnly = {
  showInfo: false,
  autoScale: true,
  follow: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<PowerTimeProps>

export const eyeDisplayOnly = {
  showInfo: false,
  autoScale: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  alpha: 0.55
} satisfies Partial<EyeDiagramProps>

export const persistenceDisplayOnly = {
  showInfo: false,
  showColorbar: true,
  showCursor: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
} satisfies Partial<PersistenceProps>
