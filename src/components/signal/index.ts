/**
 * 信号组件公共入口（推荐宿主从本文件导入，而不是逐个 SFC 深路径）
 *
 * ```ts
 * import { IqChart, SpectrumChart, iqAdapters, type IqProps } from '@/components/signal'
 * ```
 *
 * 也可以把默认导出作为 Vue 插件全局注册：
 * ```ts
 * import SignalCharts from '@/components/signal'
 * app.use(SignalCharts)
 * ```
 */
import type { App, Plugin } from 'vue'
import IqChart from './IqChart.vue'
import SpectrumChart from './SpectrumChart.vue'
import SpectrogramChart from './SpectrogramChart.vue'
import ConstellationChart from './ConstellationChart.vue'
import PowerTimeChart from './PowerTimeChart.vue'
import SignalQualityPanel from './SignalQualityPanel.vue'
import EyeDiagramChart from './EyeDiagramChart.vue'
import PersistenceSpectrumChart from './PersistenceSpectrumChart.vue'
import SmithChart from './SmithChart.vue'
import ApdCcdfChart from './ApdCcdfChart.vue'

export {
  IqChart,
  SpectrumChart,
  SpectrogramChart,
  ConstellationChart,
  PowerTimeChart,
  SignalQualityPanel,
  EyeDiagramChart,
  PersistenceSpectrumChart,
  SmithChart,
  ApdCcdfChart
}
export * from './core/types'
export type { PowerPulse, PulseAnalysis, PowerStats } from './core/power'
export type { EyeStats } from './core/eye'
export { EyeBuffer, computeEyeStats, cleanEyeTrace } from './core/eye'
export type { PersistenceStats, PersistenceMatrixInput } from './core/persistence'
export { PersistenceBuffer } from './core/persistence'
export type { SmithStats } from './core/smith'
export {
  computeSmithStats,
  gammaToImpedance,
  gammaToReturnLossDb,
  gammaToVswr,
  SMITH_REACTANCES,
  SMITH_RESISTANCES
} from './core/smith'
export { computeApdCcdf } from './core/apd'
export type { ApdOptions } from './core/apd'
export type { QualityItem, QualityMetricKey } from './core/quality'
export { evaluateSignalQuality } from './core/quality'
export { analyzePowerPulses, computePowerStats, cleanPowerValues } from './core/power'
export {
  iqAdapters,
  spectrumAdapters,
  constellationAdapters,
  createIqAdapter,
  createSpectrumAdapter,
  toFloat32Samples,
  fromArrayBuffer,
  fromBase64,
  tryAdapters
} from './core/adapters'
export type {
  AdapterDtype,
  AdapterEndian,
  IqAdapterOptions,
  SpectrumAdapterOptions
} from './core/adapters'
export { usePrefersDark } from './composables/usePrefersDark'
export { cssSize } from './core/css'
export { translate, zhCN, enUS } from './core/i18n'
export type { ChartLocale, ChartMessageKey, ChartMessages } from './core/i18n'
export {
  iqDisplayOnly,
  spectrumDisplayOnly,
  spectrogramDisplayOnly,
  constellationDisplayOnly,
  powerTimeDisplayOnly,
  eyeDisplayOnly,
  persistenceDisplayOnly,
  smithDisplayOnly,
  apdCcdfDisplayOnly
} from './core/presets'

/** 组件库版本（宿主可用于诊断/兼容判断；语义化版本按公共 API 变更维护） */
export const SIGNAL_CHARTS_VERSION = '2.4.1'

/** Vue 插件：app.use(SignalCharts) 后可用 <IqChart>/<SpectrumChart>/... */
export const SignalCharts: Plugin = {
  install(app: App): void {
    app.component('IqChart', IqChart)
    app.component('SpectrumChart', SpectrumChart)
    app.component('SpectrogramChart', SpectrogramChart)
    app.component('ConstellationChart', ConstellationChart)
    app.component('PowerTimeChart', PowerTimeChart)
    app.component('SignalQualityPanel', SignalQualityPanel)
    app.component('EyeDiagramChart', EyeDiagramChart)
    app.component('PersistenceSpectrumChart', PersistenceSpectrumChart)
    app.component('SmithChart', SmithChart)
    app.component('ApdCcdfChart', ApdCcdfChart)
  }
}

export default SignalCharts
