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

export { IqChart, SpectrumChart, SpectrogramChart, ConstellationChart }
export * from './core/types'
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

/** 组件库版本（宿主可用于诊断/兼容判断；语义化版本按公共 API 变更维护） */
export const SIGNAL_CHARTS_VERSION = '1.1.0'

/** Vue 插件：app.use(SignalCharts) 后可用 <IqChart>/<SpectrumChart>/... */
export const SignalCharts: Plugin = {
  install(app: App): void {
    app.component('IqChart', IqChart)
    app.component('SpectrumChart', SpectrumChart)
    app.component('SpectrogramChart', SpectrogramChart)
    app.component('ConstellationChart', ConstellationChart)
  }
}

export default SignalCharts
