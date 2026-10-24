<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  NCard,
  NSelect,
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NCheckbox,
  NSlider,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import {
  SpectrumChart,
  type ExportPayload,
  type SpectrumDetector,
  type SpectrumDots,
  type SpectrumLimitLine,
  type SpectrumMeta,
  type SpectrumTraceMode,
  type SpectrumTraceSpec,
  type SpectrumUnit,
  type SpectrumViewInfo,
  type Theme
} from '@components/signal'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'

const message = useMessage()
const chartRef = ref<InstanceType<typeof SpectrumChart> | null>(null)
const hasData = ref(false)

// ── 显示控制 ──
const themeKey = ref<Theme>('spectrum')
const tracesVal = ref<SpectrumTraceSpec[]>([{ mode: 'clear' }])
const averageCount = ref(16)
const persistenceVal = ref(0)
const lineWidthVal = ref(1)
const autoScale = ref(true)
const refLevel = ref(0)
const scaleDiv = ref(10)
const peakTrack = ref(false)
const paused = ref(false)
/** 迹线图例（实时/平均/最大保持）显示开关；默认开，位置已改为顶部居中 */
const legendOn = ref(true)
const unitVal = ref<SpectrumUnit>('dBFS')
const impedanceVal = ref<50 | 75>(50)
const vbwHz = ref(0)
const peakTableOn = ref(false)
const peakThreshold = ref<number | null>(null)
const peakExcursion = ref(6)
// ── 仪器化扩展 ──
const detectorVal = ref<SpectrumDetector>('minmax')
const dotsVal = ref<SpectrumDots>('auto')
const freqOffsetHzVal = ref(0)
const ampOffsetDbVal = ref(0)
const markerTableOn = ref(false)
const limitOn = ref(false)
const limitUpperDb = ref(-30)
const acprMainKhz = ref(0) // 0=默认（视窗 span/5）
const acprAdjKhz = ref(0)
const avgModeVal = ref<'power' | 'log'>('power')
const traceOffsetDb = ref(0)
const mathSel = ref<'off' | '2-1'>('off')
const memoryShown = ref(false)

const TRACE_ORDER: SpectrumTraceMode[] = ['clear', 'average', 'maxHold', 'minHold']
function hasMode(m: SpectrumTraceMode): boolean {
  return tracesVal.value.some((t) => t.mode === m && !t.math)
}
/** 基础清单 + 扩展（平均方式/偏移/运算迹线）→ traces prop */
function assembleTraces(base: SpectrumTraceSpec[]): SpectrumTraceSpec[] {
  const sorted = [...base]
    .filter((t) => !t.math)
    .sort((a, b) => TRACE_ORDER.indexOf(a.mode) - TRACE_ORDER.indexOf(b.mode))
  const out = sorted.map((t) => {
    const spec: SpectrumTraceSpec = { mode: t.mode }
    if (t.enabled !== undefined) spec.enabled = t.enabled
    if (t.mode === 'average') spec.avgMode = avgModeVal.value
    return spec
  })
  if (out.length > 0 && traceOffsetDb.value !== 0) out[0]!.offsetDb = traceOffsetDb.value
  if (mathSel.value === '2-1' && out.length >= 2) {
    out.push({ mode: 'clear', math: { op: 'subtract', a: 1, b: 0 } })
  }
  return out
}
function toggleMode(m: SpectrumTraceMode, on: boolean): void {
  const base = tracesVal.value.filter((t) => !t.math)
  if (!on) {
    const next = base.filter((t) => t.mode !== m)
    if (next.length === 0) return // 至少保留一条
    tracesVal.value = assembleTraces(next)
    return
  }
  if (base.some((t) => t.mode === m)) return
  tracesVal.value = assembleTraces([...base, { mode: m }])
}
watch([avgModeVal, traceOffsetDb, mathSel], () => {
  tracesVal.value = assembleTraces(tracesVal.value.filter((t) => !t.math))
})

const limitLines = computed<SpectrumLimitLine[]>(() => {
  if (!limitOn.value) return []
  return [
    {
      type: 'upper',
      label: '上限',
      points: [
        { bin: 0, level: limitUpperDb.value },
        { bin: 1e9, level: limitUpperDb.value }
      ]
    }
  ]
})

const peakTableOpts = computed(() => ({
  count: 6,
  thresholdDb: peakThreshold.value ?? undefined,
  excursionDb: peakExcursion.value
}))
const exportDir = ref<string>(localStorage.getItem('sig-spectrum-export-dir') ?? '')

// ── 元数据 / 视口显示 ──
const meta = ref<SpectrumMeta>({ dbScale: true })
const viewInfo = ref<SpectrumViewInfo | null>(null)
const spanBins = ref(0) // 0=全带宽

const binHz = computed(() => meta.value.binHz)
const freqBaseHz = computed(() => meta.value.freqStartHz ?? 0)
const sampleRateTxt = computed(() => (meta.value.sampleRate ? `${meta.value.sampleRate} Hz` : '—'))
const fftTxt = computed(() => (meta.value.fftSize ? String(meta.value.fftSize) : '—'))
const rbwTxt = computed(() => (binHz.value ? fmtHz(binHz.value) : '—'))
const spanTxt = computed(() =>
  viewInfo.value?.spanHz !== undefined ? fmtHz(viewInfo.value.spanHz) : '—'
)
const centerTxt = computed(() =>
  viewInfo.value?.centerHz !== undefined ? fmtHz(viewInfo.value.centerHz) : '—'
)
const spanKHz = computed({
  get: () =>
    binHz.value && spanBins.value ? +((spanBins.value * binHz.value) / 1000).toFixed(6) : null,
  set: (v: number | null) => {
    if (v === null || !binHz.value) return
    spanBins.value = Math.max(8, Math.round((v * 1000) / binHz.value))
  }
})

/** 视窗跨度（bin 数；视口信息缺省时回退 spanBins） */
function currentSpanBins(): number {
  const v = viewInfo.value
  if (v) return Math.max(8, v.xMax - v.xMin)
  return Math.max(8, spanBins.value || 0)
}
function applyViewCenter(hz: number): void {
  if (!binHz.value) return
  const span = currentSpanBins()
  const c = (hz - freqBaseHz.value) / binHz.value
  chartRef.value?.setViewport({ xMin: c - span / 2, xMax: c + span / 2 })
}
function applyViewEdge(edge: 'start' | 'stop', hz: number): void {
  if (!binHz.value) return
  const span = currentSpanBins()
  const b = (hz - freqBaseHz.value) / binHz.value
  if (edge === 'start') chartRef.value?.setViewport({ xMin: b, xMax: b + span })
  else chartRef.value?.setViewport({ xMin: b - span, xMax: b })
}
/** Center/Start/Stop（kHz；显示域含频率偏移，写回时扣除） */
const centerKHz = computed({
  get: () => {
    const v = viewInfo.value
    if (v?.centerHz === undefined) return null
    return +((v.centerHz + freqOffsetHzVal.value) / 1000).toFixed(6)
  },
  set: (val: number | null) => {
    if (val === null) return
    applyViewCenter(val * 1000 - freqOffsetHzVal.value)
  }
})
const startKHz = computed({
  get: () => {
    const v = viewInfo.value
    if (v?.freqMin === undefined) return null
    return +((v.freqMin + freqOffsetHzVal.value) / 1000).toFixed(6)
  },
  set: (val: number | null) => {
    if (val === null) return
    applyViewEdge('start', val * 1000 - freqOffsetHzVal.value)
  }
})
const stopKHz = computed({
  get: () => {
    const v = viewInfo.value
    if (v?.freqMax === undefined) return null
    return +((v.freqMax + freqOffsetHzVal.value) / 1000).toFixed(6)
  },
  set: (val: number | null) => {
    if (val === null) return
    applyViewEdge('stop', val * 1000 - freqOffsetHzVal.value)
  }
})

const traceModeTxt = computed(() => {
  const names = tracesVal.value.map((t) =>
    t.mode === 'average'
      ? `平均(${averageCount.value})`
      : t.mode === 'maxHold'
        ? '最大保持'
        : t.mode === 'minHold'
          ? '最小保持'
          : '实时'
  )
  return names.join(' + ') || '—'
})
const refTxt = computed(() =>
  autoScale.value ? '自动' : `${refLevel.value} dB · ${scaleDiv.value} dB/div`
)

function fmtHz(hz: number): string {
  const a = Math.abs(hz)
  if (a >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`
  if (a >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`
  return `${hz.toFixed(2)} Hz`
}

// ── 数据订阅 ──
const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onSpectrum((data, frame) => {
  chartRef.value?.appendData(data, {
    sampleRate: frame.sampleRate,
    fftSize: frame.fftSize,
    dbScale: frame.dbScale,
    spectrumMode: frame.spectrumMode,
    freqStartHz: frame.freqStartHz,
    binHz: frame.binHz,
    fftShift: frame.fftShift
  })
  hasData.value = true
})

function onMetaChange(m: SpectrumMeta): void {
  meta.value = m
}
function onViewportChange(v: SpectrumViewInfo): void {
  viewInfo.value = v
}

// ── 操作 ──
function onPeakSearch(): void {
  chartRef.value?.peakSearch()
}
function onNextPeak(): void {
  chartRef.value?.nextPeak()
}
function onClearMarkers(): void {
  chartRef.value?.clearMarkers()
}
function onFullBand(): void {
  spanBins.value = 0
}
function onTogglePause(): void {
  paused.value = !paused.value
  chartRef.value?.setPaused(paused.value)
  message.info(paused.value ? '已冻结（不再合并新帧）' : '已恢复实时更新')
}
function onClear(): void {
  chartRef.value?.clear()
  hasData.value = false
  message.success('已清空迹线')
}

// ── 测量（OBW / N dB 带宽 / 信道功率）──
function onMeasureOBW(): void {
  const r = chartRef.value?.measureOBW()
  if (r) message.info(`OBW(99%) = ${fmtHz(r.obwHz)} · 总功率 ${r.totalDb.toFixed(1)} dB`)
  else message.warning('无法测量（无数据或采样率未知）')
}
function onMeasureNdB(): void {
  const r = chartRef.value?.measureNdB(3)
  if (r) message.info(`3dB 带宽 = ${fmtHz(r.widthHz)} · 中心 ${fmtHz(r.centerHz)}`)
  else message.warning('无法测量（无数据或采样率未知）')
}
function onMeasureChP(): void {
  const r = chartRef.value?.measureChannelPower()
  if (r) message.info(`信道功率 = ${r.powerDb.toFixed(2)} dB（当前视窗内）`)
  else message.warning('无法测量（无数据）')
}
function onClearMeas(): void {
  chartRef.value?.clearMeasurements()
}
function onExportPeaks(): void {
  const peaks = chartRef.value?.getPeaks() ?? []
  if (peaks.length === 0) {
    message.warning('当前无峰值（确认峰值表已开启且有数据）')
    return
  }
  const bHz = binHz.value
  const lines = [bHz ? 'freq_hz,level_db' : 'bin,level_db']
  for (const p of peaks)
    lines.push(bHz ? `${(p.bin * bHz).toFixed(3)},${p.value}` : `${p.bin},${p.value}`)
  handleExport({
    kind: 'csv',
    filename: `spectrum-peaks-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    text: lines.join('\n')
  })
}

// ── 区间/噪声标记 / ACPR / 迹线内存 ──
function onBandPower(): void {
  const r = chartRef.value?.bandPower()
  if (r)
    message.info(
      `区间功率 ${r.powerDb.toFixed(2)} dB · 密度 ${r.densityDbPerHz.toFixed(1)} dB/Hz（${fmtHz(r.fLowHz)} ~ ${fmtHz(r.fHighHz)}）`
    )
  else message.warning('需先用 Alt+点击添加 ≥2 个标记')
}
function onMarkerNoise(): void {
  const r = chartRef.value?.markerNoise(0)
  if (r) message.info(`M1 噪声密度 = ${r.densityDbPerHz.toFixed(1)} dB/Hz`)
  else message.warning('需先添加标记且已知采样率')
}
function onMeasureACPR(): void {
  const r = chartRef.value?.measureACPR({
    mainBwHz: acprMainKhz.value > 0 ? acprMainKhz.value * 1000 : undefined,
    adjBwHz: acprAdjKhz.value > 0 ? acprAdjKhz.value * 1000 : undefined
  })
  if (r) message.info(`ACPR  L ${r.acprLowerDb.toFixed(1)} · U ${r.acprUpperDb.toFixed(1)} dBc`)
  else message.warning('无法测量（无数据或采样率未知）')
}
function onExportAllCsv(): void {
  chartRef.value?.exportCSV({ allTraces: true })
}
function onSaveMemory(): void {
  if (chartRef.value?.saveTraceToMemory()) {
    memoryShown.value = true
    message.success('活动迹线已存入内存（灰色参考线）')
  } else {
    message.warning('无数据可存')
  }
}
function onShowMemory(v: boolean): void {
  memoryShown.value = v
  chartRef.value?.showMemory(v)
}
function onClearMemory(): void {
  memoryShown.value = false
  chartRef.value?.clearMemory()
}

// ── 导出 ──
function onPickExportDir(): void {
  window.api.dialog.openDirectory('选择导出目录').then((dir) => {
    if (dir) exportDir.value = dir as string
  })
}
function updateExportDir(v: string): void {
  exportDir.value = v
  if (v) localStorage.setItem('sig-spectrum-export-dir', v)
  else localStorage.removeItem('sig-spectrum-export-dir')
}
async function handleExport(p: ExportPayload): Promise<void> {
  if (!exportDir.value) {
    const a = document.createElement('a')
    if (p.kind === 'png' && p.dataUrl) {
      a.href = p.dataUrl
    } else {
      const blob = new Blob([p.text ?? ''], { type: 'text/csv;charset=utf-8' })
      a.href = URL.createObjectURL(blob)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    a.download = p.filename
    a.click()
    return
  }
  const full = (await window.api.fs.joinPath(exportDir.value, p.filename)) as string
  if (p.kind === 'png' && p.dataUrl) {
    await window.api.fs.writeFileBase64(full, p.dataUrl.split(',')[1] ?? '')
  } else if (p.kind === 'csv' && p.text !== undefined) {
    await window.api.fs.writeFile(full, p.text)
  }
  message.success(`已保存：${full}`)
}
function onExported(p: { kind: 'png' | 'csv'; filename: string }): void {
  if (!exportDir.value) message.success(`已导出：${p.filename}`)
}

async function onStopStream(): Promise<void> {
  try {
    await window.api.signalAnalysis.stop()
    await window.api.remoteMock.stop()
    message.success('已停止推流（组件保持挂载，可观察中断角标）')
  } catch (e) {
    message.error(`停止失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

const detectorOptions = [
  { label: '双极值(minmax)', value: 'minmax' },
  { label: '正峰', value: 'posPeak' },
  { label: '负峰', value: 'negPeak' },
  { label: '采样', value: 'sample' },
  { label: 'RMS 功率', value: 'rms' },
  { label: '对数平均', value: 'average' }
]
const dotsOptions = [
  { label: '自动', value: 'auto' },
  { label: '强制', value: 'on' },
  { label: '关闭', value: 'off' }
]

// ── 预设保存/恢复（localStorage + JSON 导入导出）──
interface PresetConfig {
  themeKey: Theme
  tracesVal: SpectrumTraceSpec[]
  averageCount: number
  persistenceVal: number
  lineWidthVal: number
  autoScale: boolean
  refLevel: number
  scaleDiv: number
  peakTrack: boolean
  unitVal: SpectrumUnit
  impedanceVal: 50 | 75
  vbwHz: number
  peakTableOn: boolean
  peakThreshold: number | null
  peakExcursion: number
  detectorVal: SpectrumDetector
  dotsVal: SpectrumDots
  freqOffsetHzVal: number
  ampOffsetDbVal: number
  markerTableOn: boolean
  limitOn: boolean
  limitUpperDb: number
  avgModeVal: 'power' | 'log'
  traceOffsetDb: number
  mathSel: 'off' | '2-1'
  legendOn: boolean
}
const PRESET_KEY = 'sig-spectrum-presets-v1'
function readPresets(): Record<string, PresetConfig> {
  try {
    const raw = localStorage.getItem(PRESET_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PresetConfig>) : {}
  } catch {
    return {}
  }
}
const presetsAll = ref<Record<string, PresetConfig>>(readPresets())
const presetName = ref('')
const presetSel = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)
const presetOptions = computed(() =>
  Object.keys(presetsAll.value).map((k) => ({ label: k, value: k }))
)
function capturePreset(): PresetConfig {
  return {
    themeKey: themeKey.value,
    tracesVal: tracesVal.value.map((t) => ({ ...t })),
    averageCount: averageCount.value,
    persistenceVal: persistenceVal.value,
    lineWidthVal: lineWidthVal.value,
    autoScale: autoScale.value,
    refLevel: refLevel.value,
    scaleDiv: scaleDiv.value,
    peakTrack: peakTrack.value,
    unitVal: unitVal.value,
    impedanceVal: impedanceVal.value,
    vbwHz: vbwHz.value,
    peakTableOn: peakTableOn.value,
    peakThreshold: peakThreshold.value,
    peakExcursion: peakExcursion.value,
    detectorVal: detectorVal.value,
    dotsVal: dotsVal.value,
    freqOffsetHzVal: freqOffsetHzVal.value,
    ampOffsetDbVal: ampOffsetDbVal.value,
    markerTableOn: markerTableOn.value,
    limitOn: limitOn.value,
    limitUpperDb: limitUpperDb.value,
    avgModeVal: avgModeVal.value,
    traceOffsetDb: traceOffsetDb.value,
    mathSel: mathSel.value,
    legendOn: legendOn.value
  }
}
function applyPreset(p: PresetConfig): void {
  if (p.themeKey) themeKey.value = p.themeKey
  if (Array.isArray(p.tracesVal)) tracesVal.value = p.tracesVal.map((t) => ({ ...t }))
  if (typeof p.averageCount === 'number') averageCount.value = p.averageCount
  if (typeof p.persistenceVal === 'number') persistenceVal.value = p.persistenceVal
  if (typeof p.lineWidthVal === 'number') lineWidthVal.value = p.lineWidthVal
  if (typeof p.autoScale === 'boolean') autoScale.value = p.autoScale
  if (typeof p.refLevel === 'number') refLevel.value = p.refLevel
  if (typeof p.scaleDiv === 'number') scaleDiv.value = p.scaleDiv
  if (typeof p.peakTrack === 'boolean') peakTrack.value = p.peakTrack
  if (p.unitVal) unitVal.value = p.unitVal
  if (p.impedanceVal) impedanceVal.value = p.impedanceVal
  if (typeof p.vbwHz === 'number') vbwHz.value = p.vbwHz
  if (typeof p.peakTableOn === 'boolean') peakTableOn.value = p.peakTableOn
  if (p.peakThreshold !== undefined) peakThreshold.value = p.peakThreshold
  if (typeof p.peakExcursion === 'number') peakExcursion.value = p.peakExcursion
  if (p.detectorVal) detectorVal.value = p.detectorVal
  if (p.dotsVal) dotsVal.value = p.dotsVal
  if (typeof p.freqOffsetHzVal === 'number') freqOffsetHzVal.value = p.freqOffsetHzVal
  if (typeof p.ampOffsetDbVal === 'number') ampOffsetDbVal.value = p.ampOffsetDbVal
  if (typeof p.markerTableOn === 'boolean') markerTableOn.value = p.markerTableOn
  if (typeof p.limitOn === 'boolean') limitOn.value = p.limitOn
  if (typeof p.limitUpperDb === 'number') limitUpperDb.value = p.limitUpperDb
  if (p.avgModeVal) avgModeVal.value = p.avgModeVal
  if (typeof p.traceOffsetDb === 'number') traceOffsetDb.value = p.traceOffsetDb
  if (p.mathSel) mathSel.value = p.mathSel
  if (typeof p.legendOn === 'boolean') legendOn.value = p.legendOn
}
function persistPresets(): void {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presetsAll.value))
}
function savePreset(): void {
  const name = presetName.value.trim()
  if (!name) {
    message.warning('请先输入预设名称')
    return
  }
  presetsAll.value = { ...presetsAll.value, [name]: capturePreset() }
  persistPresets()
  presetSel.value = name
  message.success(`预设「${name}」已保存`)
}
function loadPreset(name: string | null): void {
  if (!name) return
  const p = presetsAll.value[name]
  if (!p) return
  applyPreset(p)
  message.success(`已调出预设「${name}」`)
}
function deletePreset(): void {
  const name = presetSel.value
  if (!name) return
  const next = { ...presetsAll.value }
  delete next[name]
  presetsAll.value = next
  persistPresets()
  presetSel.value = null
  message.info(`已删除预设「${name}」`)
}
function exportPresets(): void {
  const name = presetSel.value
  const payload =
    name && presetsAll.value[name] ? { [name]: presetsAll.value[name] } : presetsAll.value
  const json = JSON.stringify(payload, null, 2)
  if (exportDir.value) {
    void window.api.fs
      .joinPath(exportDir.value, `sig-spectrum-preset-${Date.now()}.json`)
      .then((full) => window.api.fs.writeFile(full as string, json))
      .then(() => message.success('预设已导出到导出目录'))
      .catch((e: unknown) =>
        message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`)
      )
  } else {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = `sig-spectrum-presets-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
}
function triggerImport(): void {
  importInputRef.value?.click()
}
function onImportFile(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result)) as Record<string, PresetConfig>
      let n = 0
      const next = { ...presetsAll.value }
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          next[k] = v as PresetConfig
          n++
        }
      }
      presetsAll.value = next
      persistPresets()
      message.success(`已导入 ${n} 个预设`)
    } catch {
      message.error('导入失败：JSON 解析错误')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

onMounted(() => {
  updateExportDir(exportDir.value)
})
</script>

<template>
  <div style="padding: 16px">
    <NCard title="📶 频谱仪（Spectrum Analyzer）" style="margin-bottom: 16px" size="small">
      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px">
        <span>主题</span>
        <NSelect
          v-model:value="themeKey"
          size="small"
          :options="[
            { label: 'spectrum（黑底黄迹）', value: 'spectrum' },
            { label: 'dark', value: 'dark' },
            { label: 'light', value: 'light' },
            { label: 'auto（跟随系统）', value: 'auto' }
          ]"
          style="width: 180px"
        />
        <span>迹线</span>
        <NCheckbox
          :checked="hasMode('clear')"
          size="small"
          @update:checked="(v: boolean) => toggleMode('clear', v)"
          >实时</NCheckbox
        >
        <NCheckbox
          :checked="hasMode('average')"
          size="small"
          @update:checked="(v: boolean) => toggleMode('average', v)"
          >平均</NCheckbox
        >
        <NCheckbox
          :checked="hasMode('maxHold')"
          size="small"
          @update:checked="(v: boolean) => toggleMode('maxHold', v)"
          >最大保持</NCheckbox
        >
        <NCheckbox
          :checked="hasMode('minHold')"
          size="small"
          @update:checked="(v: boolean) => toggleMode('minHold', v)"
          >最小保持</NCheckbox
        >
        <NCheckbox v-model:checked="legendOn" size="small">图例</NCheckbox>
        <span v-if="hasMode('average')">帧数</span>
        <NInputNumber
          v-if="hasMode('average')"
          v-model:value="averageCount"
          size="small"
          :min="1"
          :max="1024"
          :show-button="false"
          style="width: 64px"
        />
        <span>余辉</span>
        <NSlider
          v-model:value="persistenceVal"
          :min="0"
          :max="0.95"
          :step="0.05"
          :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
          style="width: 110px"
        />
        <span>线宽</span>
        <NInputNumber
          v-model:value="lineWidthVal"
          size="small"
          :min="1"
          :max="8"
          :show-button="false"
          style="width: 64px"
        />
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>幅度</span>
        <NSwitch v-model:value="autoScale" size="small" />
        <span style="color: #888">自动缩放</span>
        <span>Ref</span>
        <NInputNumber
          v-model:value="refLevel"
          size="small"
          :step="10"
          :show-button="false"
          :disabled="autoScale"
          style="width: 80px"
        />
        <span>dB / 格</span>
        <NSelect
          v-model:value="scaleDiv"
          size="small"
          :disabled="autoScale"
          :options="[1, 2, 5, 10, 20].map((v) => ({ label: String(v), value: v }))"
          style="width: 72px"
        />
        <span>Span (kHz)</span>
        <NInputNumber
          v-model:value="spanKHz"
          size="small"
          :min="0"
          :step="1"
          :show-button="false"
          :disabled="!binHz"
          style="width: 100px"
        />
        <NButton size="tiny" @click="onFullBand">全带宽</NButton>
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>Center(kHz)</span>
        <NInputNumber
          v-model:value="centerKHz"
          size="small"
          :show-button="false"
          :disabled="!binHz"
          style="width: 112px"
        />
        <span>Start</span>
        <NInputNumber
          v-model:value="startKHz"
          size="small"
          :show-button="false"
          :disabled="!binHz"
          style="width: 112px"
        />
        <span>Stop</span>
        <NInputNumber
          v-model:value="stopKHz"
          size="small"
          :show-button="false"
          :disabled="!binHz"
          style="width: 112px"
        />
        <span>频率偏移(Hz)</span>
        <NInputNumber
          v-model:value="freqOffsetHzVal"
          size="small"
          :step="1000"
          :show-button="false"
          style="width: 104px"
        />
        <span>校准偏移(dB)</span>
        <NInputNumber
          v-model:value="ampOffsetDbVal"
          size="small"
          :step="1"
          :show-button="false"
          style="width: 82px"
        />
        <span>检波器</span>
        <NSelect
          v-model:value="detectorVal"
          size="small"
          :options="detectorOptions"
          style="width: 126px"
        />
        <span>样本点</span>
        <NSelect v-model:value="dotsVal" size="small" :options="dotsOptions" style="width: 86px" />
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>平均方式</span>
        <NSelect
          v-model:value="avgModeVal"
          size="small"
          :options="[
            { label: '功率(RMS)', value: 'power' },
            { label: '对数', value: 'log' }
          ]"
          style="width: 104px"
        />
        <span>迹线偏移(dB)</span>
        <NInputNumber
          v-model:value="traceOffsetDb"
          size="small"
          :step="1"
          :show-button="false"
          style="width: 82px"
        />
        <span>运算</span>
        <NSelect
          v-model:value="mathSel"
          size="small"
          :options="[
            { label: '关', value: 'off' },
            { label: 'T2−T1', value: '2-1' }
          ]"
          style="width: 86px"
        />
        <NCheckbox v-model:checked="limitOn" size="small">限制线</NCheckbox>
        <template v-if="limitOn">
          <span>上限(dBm)</span>
          <NInputNumber
            v-model:value="limitUpperDb"
            size="small"
            :step="5"
            :show-button="false"
            style="width: 82px"
          />
        </template>
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>标记</span>
        <NButton size="tiny" @click="onPeakSearch">峰值搜索</NButton>
        <NButton size="tiny" @click="onNextPeak">下一峰</NButton>
        <NButton size="tiny" @click="onClearMarkers">清标记</NButton>
        <NCheckbox v-model:checked="peakTrack" size="small">峰值跟踪</NCheckbox>
        <NCheckbox v-model:checked="markerTableOn" size="small">标记表</NCheckbox>
        <NButton size="tiny" :type="paused ? 'warning' : 'default'" @click="onTogglePause">
          {{ paused ? '恢复' : '冻结' }}
        </NButton>
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>单位</span>
        <NSelect
          v-model:value="unitVal"
          size="small"
          :options="[
            { label: 'dBFS', value: 'dBFS' },
            { label: 'dBm', value: 'dBm' },
            { label: 'dBµV', value: 'dBuV' },
            { label: 'dBmV', value: 'dBmV' },
            { label: 'dBW', value: 'dBW' }
          ]"
          style="width: 90px"
        />
        <span>阻抗</span>
        <NSelect
          v-model:value="impedanceVal"
          size="small"
          :options="[
            { label: '50Ω', value: 50 },
            { label: '75Ω', value: 75 }
          ]"
          style="width: 76px"
        />
        <span>VBW(Hz, 需&lt;RBW)</span>
        <NInputNumber
          v-model:value="vbwHz"
          size="small"
          :min="0"
          :show-button="false"
          placeholder="0=关"
          style="width: 88px"
        />
        <NCheckbox v-model:checked="peakTableOn" size="small">峰值表</NCheckbox>
        <template v-if="peakTableOn">
          <span>门限</span>
          <NInputNumber
            v-model:value="peakThreshold"
            size="small"
            :show-button="false"
            placeholder="无"
            style="width: 66px"
          />
          <span>exc</span>
          <NInputNumber
            v-model:value="peakExcursion"
            size="small"
            :min="0"
            :show-button="false"
            style="width: 56px"
          />
          <NButton size="tiny" @click="onExportPeaks">导出峰值</NButton>
        </template>
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>测量</span>
        <NButton size="tiny" @click="onMeasureOBW">OBW 99%</NButton>
        <NButton size="tiny" @click="onMeasureNdB">3dB 带宽</NButton>
        <NButton size="tiny" @click="onMeasureChP">信道功率</NButton>
        <NButton size="tiny" @click="onBandPower">区间功率</NButton>
        <NButton size="tiny" @click="onMarkerNoise">噪声标记</NButton>
        <NButton size="tiny" @click="onMeasureACPR">ACPR</NButton>
        <span>主带/邻带(kHz)</span>
        <NInputNumber
          v-model:value="acprMainKhz"
          size="small"
          :min="0"
          :show-button="false"
          placeholder="0=自动"
          style="width: 82px"
        />
        <NInputNumber
          v-model:value="acprAdjKhz"
          size="small"
          :min="0"
          :show-button="false"
          placeholder="0=自动"
          style="width: 82px"
        />
        <NButton size="tiny" @click="onClearMeas">清除测量</NButton>
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>导出目录</span>
        <NInput
          :value="exportDir"
          readonly
          placeholder="默认下载目录"
          size="small"
          style="width: 190px"
        />
        <NButton size="tiny" @click="onPickExportDir">选择…</NButton>
        <NButton size="tiny" @click="chartRef?.exportPNG()">截图 PNG</NButton>
        <NButton size="tiny" @click="chartRef?.exportCSV()">导出 CSV</NButton>
        <NButton size="tiny" @click="onExportAllCsv">CSV(全迹线)</NButton>
        <NButton size="tiny" @click="onStopStream">停止推流</NButton>
        <NButton size="tiny" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待服务端（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <span>内存迹线</span>
        <NButton size="tiny" @click="onSaveMemory">存</NButton>
        <NCheckbox :checked="memoryShown" size="small" @update:checked="onShowMemory"
          >显示</NCheckbox
        >
        <NButton size="tiny" @click="onClearMemory">清除</NButton>
        <span style="margin-left: 8px">预设</span>
        <NInput
          v-model:value="presetName"
          size="small"
          placeholder="预设名称"
          style="width: 120px"
        />
        <NButton size="tiny" @click="savePreset">保存</NButton>
        <NSelect
          v-model:value="presetSel"
          size="small"
          :options="presetOptions"
          placeholder="调出预设"
          style="width: 150px"
          @update:value="loadPreset"
        />
        <NButton size="tiny" @click="deletePreset">删除</NButton>
        <NButton size="tiny" @click="exportPresets">导出 JSON</NButton>
        <NButton size="tiny" @click="triggerImport">导入 JSON</NButton>
        <input
          ref="importInputRef"
          type="file"
          accept="application/json"
          style="display: none"
          @change="onImportFile"
        />
      </div>

      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          margin-top: 8px;
        "
      >
        <NTag size="small" :bordered="false">采样率 {{ sampleRateTxt }}</NTag>
        <NTag size="small" :bordered="false">FFT {{ fftTxt }}</NTag>
        <NTag size="small" :bordered="false">RBW≈ {{ rbwTxt }}</NTag>
        <NTag size="small" :bordered="false">
          {{ meta.spectrumMode === 'complex' ? '复谱 -Fs/2~+Fs/2' : '单边 0~Fs/2' }}
        </NTag>
        <NTag size="small" :bordered="false">Span {{ spanTxt }}</NTag>
        <NTag size="small" :bordered="false">Center {{ centerTxt }}</NTag>
        <NTag size="small" :bordered="false">迹线 {{ traceModeTxt }}</NTag>
        <NTag size="small" :bordered="false">Ref {{ refTxt }}</NTag>
        <NTag size="small" :bordered="false">
          {{ meta.dbScale ? 'dB' : '线性幅度' }}
        </NTag>
      </div>

      <div style="margin-top: 8px; font-size: 12px; color: #888">
        交互：滚轮=频率缩放（光标锚点）· Shift+滚轮=幅度缩放（光标锚点）·
        拖拽=平移（左右频率/上下幅度）· Shift+框选放大（宽选频率/高选幅度）· 双击/空格=冻结⇆恢复 ·
        Alt+点击=添加标记（点标记即清除，上限 6）/ 拖拽微调 ·
        右键菜单=标记/峰值/标记→中心·参考/区间功率/ 噪声标记/ACPR/复位（Z/Shift+Z 撤销重做）·
        图例点击开关迹线（Alt+点击设活动迹线，标记与测量作用于它）· 悬停十字光标读数 ·
        手动模式下鼠标移至顶部显示 Ref 虚线，可拖拽调参考电平。VBW 需小于 RBW 才有
        平滑效果（0=关）；3dB 带宽对噪声/调制信号建议先开 VBW 或平均迹线再测（默认已带抗噪平滑）。
        检波器影响抽稀显示；频率/校准偏移仅作用于显示读数；限制线开关后按上限电平判定 PASS/FAIL。
      </div>
      <div style="margin-top: 4px; font-size: 12px; color: #888">
        FFT/窗/dB 处理全部在服务端完成；组件只做轨迹累计（实时/平均/最大最小保持）与高性能展示。
      </div>
    </NCard>

    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <SpectrumChart
          ref="chartRef"
          v-model:span="spanBins"
          v-model:auto-scale="autoScale"
          v-model:ref-level="refLevel"
          v-model:scale-div="scaleDiv"
          v-model:traces="tracesVal"
          v-model:paused="paused"
          :theme="themeKey"
          :legend="legendOn"
          :average-count="averageCount"
          :persistence="persistenceVal"
          :line-width="lineWidthVal"
          :peak-track="peakTrack"
          :unit="unitVal"
          :impedance="impedanceVal"
          :vbw="vbwHz > 0 ? vbwHz : undefined"
          :peak-table="peakTableOn"
          :peak-table-opts="peakTableOpts"
          :marker-table="markerTableOn"
          :detector="detectorVal"
          :dots="dotsVal"
          :freq-offset-hz="freqOffsetHzVal"
          :amp-offset-db="ampOffsetDbVal"
          :limit-lines="limitLines"
          :height="420"
          :export-handler="handleExport"
          @meta-change="onMetaChange"
          @viewport-change="onViewportChange"
          @exported="onExported"
          @error="(m: string) => message.error(m)"
        />
        <NEmpty
          v-if="!hasData"
          description="暂无数据，请至“Mock 配置”页启动服务…"
          style="
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: color-mix(in srgb, var(--n-color) 92%, transparent);
            margin: 0;
          "
        />
      </div>
    </NCard>
  </div>
</template>
