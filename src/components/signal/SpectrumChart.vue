<script setup lang="ts">
/**
 * SpectrumChart（频谱仪，可复制，自带主题，高性能）
 * 输入：服务端算好的频谱 Float32Array（长度 = fftSize/2；dB 或线性由帧元数据 dbScale 决定）
 * 渲染：WebGL2 折线 + Canvas2D 轴层覆盖（频率轴 Hz/kHz/MHz、幅度轴 dB/线性），主线程仅 rAF
 * 功能：多迹线叠加（实时/平均/最大保持/最小保持任意组合+图例；迹线偏移/运算/内存）· 余辉 · 冻结 ·
 *       标记与 Δ 标记/标记表/marker→center·ref · 峰值搜索/下一峰/峰值跟踪/峰值表 · 检波器（正峰/负峰/采样/RMS/平均）+ 深缩放样本点 ·
 *       参考电平与 dB/格（可拖拽参考线）· 光标读数 · 框选/缩放/平移 · 视口撤销 · VBW 视频带宽 ·
 *       幅度单位（dBm/dBµV/dBmV/dBW）· 频率/校准偏移 · OBW/N dB/信道功率/ACPR/区间功率与密度/噪声标记 ·
 *       限制线通/失败判定 · 图内参数栏 · 导出 PNG/CSV（含全迹线）
 * 交互：滚轮=X 轴（频率）缩放（光标锚点）· Shift+滚轮=幅度缩放 · 拖拽=平移（左右频率/上下幅度）·
 *       双击=冻结⇆恢复 · Shift+框选放大（宽选缩放频率/高选缩放幅度）·
 *       悬停十字光标读数 · 右键菜单（标记/峰值/复位）
 */
import { ref, reactive, shallowRef, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import {
  createLineRenderer,
  withAlpha,
  hexToRgba,
  createFadeRenderer,
  createBlitRenderer,
  type FadeRenderer,
  type BlitRenderer,
  type LineRenderer
} from './core/gl'
import { createCanvasLineRenderer } from './core/canvasRenderer'
import { spectrumAdapters } from './core/adapters'
import {
  SpectrumTraceBuffer,
  SpectrumAutoRange,
  robustMinMax,
  zoomXWindow,
  zoomYWindow,
  findPeak,
  findPeaks,
  nextPeak,
  dbToUnit,
  unitLabel,
  VbwFilter,
  channelPowerDb,
  occupiedBandwidth,
  ndbBandwidth,
  decimateTrace,
  bandStats,
  acprBands,
  buildLimitArray,
  evaluateLimit,
  type Peak
} from './core/spectrum'
import {
  drawAxisOverlay,
  drawChip,
  drawPanel,
  niceTicks,
  niceStep,
  CHIP_H,
  type PlotRect
} from './core/axis'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { cssSize } from './core/css'
import type {
  ExportPayload,
  SpectrumBinRange,
  SpectrumCursorInfo,
  SpectrumDetector,
  SpectrumDots,
  SpectrumPeakTableOpts,
  SpectrumProps,
  SpectrumStats,
  SpectrumViewInfo,
  SpectrumVisibleData,
  SpectrumMeta,
  SpectrumTraceMode,
  SpectrumTraceSpec,
  SpectrumUnit,
  Theme
} from './core/types'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'

const props = withDefaults(defineProps<SpectrumProps>(), {
  theme: 'auto' as Theme,
  decimation: 'minmax',
  fpsLimit: 60,
  lineWidth: 1,
  autoScale: true,
  refLevel: 0,
  scaleDiv: 10,
  traceMode: 'clear',
  averageCount: 16,
  persistence: 0,
  peakTrack: false,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  unit: 'dBFS' as SpectrumUnit,
  impedance: 50 as const,
  showInfo: true,
  // Boolean prop 未传会被 Vue 转成 false：显式 true 才能让「仅传数据、不传元数据」的宿主按 dB 解析
  dbScale: true,
  detector: 'minmax' as SpectrumDetector,
  dots: 'auto' as SpectrumDots,
  freqOffsetHz: 0,
  ampOffsetDb: 0,
  markerTable: false,
  legend: true,
  paused: false,
  preserveDrawingBuffer: true,
  contextMenu: true
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'viewportChange', v: SpectrumViewInfo): void
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'update:span', span: number): void
  (e: 'update:autoScale', v: boolean): void
  (e: 'update:paused', v: boolean): void
  (e: 'update:refLevel', v: number): void
  (e: 'update:scaleDiv', v: number): void
  (e: 'update:traces', v: SpectrumTraceSpec[]): void
  (e: 'metaChange', m: SpectrumMeta): void
  (e: 'activeTraceChange', index: number): void
  (e: 'ready'): void
  (e: 'contextLost'): void
  (e: 'contextRestored'): void
  (e: 'contextmenu', p: { x: number; y: number; dataX: number; hitIdx: number }): void
  (e: 'cursorChange', p: SpectrumCursorInfo | null): void
  (e: 'errorDetail', p: { code: 'adapter' | 'webgl' | 'data' | 'export'; message: string }): void
}>()

/** 兼容旧 error(string)，同时提供带 code 的 errorDetail */
function reportError(code: 'adapter' | 'webgl' | 'data' | 'export', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

/** 组件文案：messages > locale 内置；labels 旧字段在调用处优先覆盖 */
function tr(key: ChartMessageKey, vars?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, vars)
}

/** 不依赖 Vite 的 DEV 判断（非 Vite 宿主也能安全运行） */
const IS_DEV = (() => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
})()

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let fadeRenderer: FadeRenderer | null = null
let blitRenderer: BlitRenderer | null = null
let gl: WebGL2RenderingContext | null = null
// Canvas2D 降级后端（WebGL2 不可用/显式 renderer:'canvas2d'）
let ctx2d: CanvasRenderingContext2D | null = null
let contextLost = false

/** 背景清屏：GL 用 clear，Canvas2D 用 fillRect（设备像素空间） */
function clearBackground(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const bg = hexToRgba(th.value.bg)
  if (gl) {
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.fillStyle = th.value.bg
    ctx2d.fillRect(0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

/** 余辉淡出：GL 用全屏混合四边形，Canvas2D 用低 alpha 背景覆盖 */
function fadeBackground(alpha: number): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const bg = hexToRgba(th.value.bg)
  if (gl && fadeRenderer) {
    fadeRenderer.draw([bg[0], bg[1], bg[2], alpha])
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.globalAlpha = Math.min(1, Math.max(0, alpha))
    ctx2d.fillStyle = th.value.bg
    ctx2d.fillRect(0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

/** 尺寸重建后的冻结帧回填 */
function restoreSnapshot(): void {
  const canvas = canvasRef.value
  if (!canvas || !persistSnapshot) return
  if (blitRenderer && gl) {
    blitRenderer.draw(persistSnapshot)
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.drawImage(persistSnapshot, 0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

// ── 主题解析 ──
const prefersDark = usePrefersDark()
const th = computed(() => resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle }))
/** 迹线颜色：chartStyle.traceColor > lineColor（旧 API）> 主题预置 */
const traceColor = computed(() => {
  if (props.chartStyle?.traceColor) return props.chartStyle.traceColor
  if (props.lineColor) return props.lineColor
  return th.value.traceColor
})

// ── 布局常量（CSS px）──
const GUTTER_BOTTOM = 20
const PAD_X = 24
const MIN_SPAN = 8
const ZOOM_FACTOR = 1.2
const DIVISIONS = 5 // 纵轴格数（Ref 到底部）
const DATA_STALE_MS = 3000
const FADE_OUT_STEPS = 12
const FADE_OUT_ALPHA = 0.25

// ── 运行元数据（帧元数据 > props > 数据长度推导）──
let frameFftSize: number | undefined
let frameSampleRate: number | undefined
let frameDbScale: boolean | undefined
let curFftSize: number | undefined
let curSampleRate: number | undefined
let curDbScale = true
let bufferLen = 0

function binHz(): number | undefined {
  return curSampleRate && curFftSize ? curSampleRate / curFftSize : undefined
}

function metaInfo(): SpectrumMeta {
  return { sampleRate: curSampleRate, fftSize: curFftSize, binHz: binHz(), dbScale: curDbScale }
}

let fftMismatchWarned = false
function updateMeta(): void {
  const fft = frameFftSize ?? props.fftSize ?? (bufferLen > 0 ? bufferLen * 2 : undefined)
  const sr = frameSampleRate ?? props.sampleRate
  const db = frameDbScale ?? props.dbScale ?? true
  // 协议约定 bin 数 = fftSize/2；外部后端给错元数据会让频率轴整体缩放错，DEV 下提示一次。
  // （允许后端做抽稀，所以只告警不覆盖元数据）
  if (
    IS_DEV &&
    !fftMismatchWarned &&
    frameFftSize !== undefined &&
    bufferLen > 0 &&
    Math.round(frameFftSize / 2) !== bufferLen
  ) {
    fftMismatchWarned = true
    console.warn('[SpectrumChart] fftSize 元数据与数据长度不一致', {
      fftSize: frameFftSize,
      bins: bufferLen
    })
  }
  if (fft === curFftSize && sr === curSampleRate && db === curDbScale) return
  curFftSize = fft
  curSampleRate = sr
  curDbScale = db
  for (const t of traceInsts.value) t.buf.setDbScale(db) // 功率平均需随数据域同步
  emit('metaChange', metaInfo())
  schedule()
}

// ── 迹线管理（多迹线叠加；未传 traces 时回退 traceMode 单迹线，行为与旧版一致）──
interface TraceInst {
  mode: SpectrumTraceMode
  /** 图例显示名（宿主自定义；缺省按模式） */
  label?: string
  enabled: boolean
  color?: string
  /** 显示偏移 dB（仅绘制与该迹线读数；测量按原始数据） */
  offsetDb?: number
  /** 平均语义（仅 average 模式有效；默认 power 功率平均） */
  avgMode?: 'power' | 'log'
  /** 迹线运算（不占用自身缓冲；显示 a−b） */
  math?: { op: 'subtract'; a: number; b: number }
  buf: SpectrumTraceBuffer
}
const traceInsts = shallowRef<TraceInst[]>([])
/** 显式选择的活动迹线索引（标记/峰值/测量/导出作用对象） */
const activeTraceIdx = ref(0)
/** 内存迹线（参考叠加；灰色，不参与自动量程） */
const memoryOn = ref(false)
let memoryTrace: Float32Array | null = null

/**
 * 重建迹线实例列表。
 * 复用规则改为「按模式 + 是否运算迹线匹配」，而不是按数组下标：
 * 以前增删一条迹线会让另一条（如 maxHold/average）落到别的下标上被重建，历史累计被清空。
 */
function syncTraces(): void {
  const specs: SpectrumTraceSpec[] =
    props.traces && props.traces.length > 0 ? props.traces : [{ mode: props.traceMode }]
  const prev = traceInsts.value
  const used = new Set<TraceInst>()
  traceInsts.value = specs.map((s) => {
    const p = prev.find((x) => !used.has(x) && x.mode === s.mode && !!x.math === !!s.math)
    if (p) {
      used.add(p)
      p.enabled = s.enabled !== false
      p.label = s.label
      p.color = s.color
      p.offsetDb = s.offsetDb
      p.avgMode = s.avgMode
      p.math = s.math
      // 平均参数只对 average 迹线有意义；不要因为宿主调平均帧数重置 maxHold/minHold
      if (s.mode === 'average') {
        p.buf.setAverageCount(props.averageCount)
        p.buf.setAverageMode(s.avgMode ?? 'power')
      }
      p.buf.setDbScale(curDbScale)
      return p
    }
    const buf = new SpectrumTraceBuffer()
    buf.setMode(s.mode)
    if (s.mode === 'average') {
      buf.setAverageCount(props.averageCount)
      buf.setAverageMode(s.avgMode ?? 'power')
    }
    buf.setDbScale(curDbScale)
    return {
      mode: s.mode,
      label: s.label,
      enabled: s.enabled !== false,
      color: s.color,
      offsetDb: s.offsetDb,
      avgMode: s.avgMode,
      math: s.math,
      buf
    }
  })
}
syncTraces()

/** 让图例的 computed 重新求值（traceInsts 是 shallowRef，改实例字段不会触发） */
function refreshTraceList(): void {
  traceInsts.value = traceInsts.value.slice()
}

/** 迹线颜色：spec.color > 首条 style/lineColor/主色 > 主题调色板回绕 */
function traceColorAt(i: number, inst: TraceInst): string {
  if (inst.color) return inst.color
  if (i === 0) return traceColor.value
  const pal = th.value.tracePalette
  return pal[i % pal.length] ?? traceColor.value
}

/** 活动迹线实例（显式选择优先；否则首条启用非运算迹线；全禁用/全运算时回退） */
function resolvedActiveTrace(): TraceInst | null {
  const list = traceInsts.value
  const ai = list[activeTraceIdx.value]
  if (ai && ai.enabled && !ai.math) return ai
  return list.find((x) => x.enabled && !x.math) ?? list.find((x) => !x.math) ?? list[0] ?? null
}

/** 当前活动迹线索引（解析后） */
function activeTraceIndex(): number {
  const t = resolvedActiveTrace()
  return t ? traceInsts.value.indexOf(t) : -1
}

/** 设置活动迹线（图例 Alt+点击 / API） */
function setActiveTrace(i: number): void {
  if (i < 0 || i >= traceInsts.value.length) return
  activeTraceIdx.value = i
  emit('activeTraceChange', i)
  schedule()
}

/** 活动迹线数据（峰值/标记/测量/导出的作用对象） */
function activeTraceData(): Float32Array | null {
  const t = resolvedActiveTrace()
  return t ? t.buf.get() : null
}

/** 某个 bin 的原始电平（dB 统一口径；线性显示时先转 dB） */
function levelAtDb(bin: number): number | null {
  const data = activeTraceData()
  if (!data) return null
  const b = Math.min(data.length - 1, Math.max(0, Math.round(bin)))
  const raw = data[b] ?? 0
  return curDbScale ? raw : 20 * Math.log10(Math.max(raw, 1e-12))
}

/** 活动迹线显示偏移 dB（仅影响读数格式化） */
function activeTraceOffset(): number {
  return resolvedActiveTrace()?.offsetDb ?? 0
}

// ── 单位换算（仅显示格式化层；内部域始终 dB）──
function toUnit(v: number): number {
  return curDbScale ? dbToUnit(v + props.ampOffsetDb, props.unit, props.impedance) : v
}
function unitSuffix(): string {
  return curDbScale ? ` ${unitLabel(props.unit)}` : ''
}
/** 显示域频率（+频率偏移；仅显示格式化用，内部与 API 保持原始 Hz） */
function dispHz(hz: number): number {
  return hz + props.freqOffsetHz
}
/** 功率谱密度文本（dBm/Hz 口径，含校准偏移与单位换算） */
function densityText(v: number): string {
  if (!curDbScale) return `${fmtVal(v)}/Hz`
  return `${fmtVal(dbToUnit(v + props.ampOffsetDb, props.unit, props.impedance))} ${unitLabel(props.unit)}/Hz`
}

/**
 * 测量值的显示偏移：功率类测量统一用 dB 表达。
 * - dB 显示：直接加迹线显示偏移（dB）
 * - 线性显示：offsetDb 是幅度偏移，需在幅度域相加后再转 dB
 */
function offsetDisplayDb(vDb: number): number {
  if (curDbScale) return vDb + activeTraceOffset()
  const off = activeTraceOffset()
  return 20 * Math.log10(Math.max(Math.pow(10, vDb / 20) + off, 1e-12))
}
/** 测量电平文本（线性显示时测量仍是 dB，不带 dBFS/dBm 单位换算） */
function measLevelText(vDb: number): string {
  return curDbScale ? levelText(vDb) : `${fmtVal(vDb)} dB`
}
/** 测量密度文本 */
function measDensityText(vDbPerHz: number): string {
  return curDbScale ? densityText(vDbPerHz) : `${fmtVal(vDbPerHz)} dB/Hz`
}

// ── 迹线图例（多迹线时显示；点击开关，后台继续累计）──
// legend prop 可整体隐藏（顶部居中，避免遮挡左上角 Ref/Scale 等信息）
const legendShown = computed(
  () => props.legend !== false && !!props.traces && props.traces.length > 0
)
const traceLegend = computed(() =>
  traceInsts.value.map((t, i) => ({
    enabled: t.enabled,
    active: i === activeTraceIndex(),
    color: traceColorAt(i, t),
    label: t.math
      ? `T${t.math.a + 1}−T${t.math.b + 1}`
      : t.label
        ? t.mode === 'average'
          ? `${t.label}(${props.averageCount})`
          : t.label
        : t.mode === 'average'
          ? `${props.labels?.legend?.average ?? tr('spectrum.legendAverage')}(${props.averageCount})`
          : t.mode === 'maxHold'
            ? (props.labels?.legend?.maxHold ?? tr('spectrum.legendMaxHold'))
            : t.mode === 'minHold'
              ? (props.labels?.legend?.minHold ?? tr('spectrum.legendMinHold'))
              : (props.labels?.legend?.clear ?? tr('spectrum.legendClear'))
  }))
)
function toggleTrace(i: number, ev?: MouseEvent): void {
  const inst = traceInsts.value[i]
  if (!inst) return
  if (ev?.altKey) {
    // Alt+点击：设为活动迹线（标记/测量作用对象）
    setActiveTrace(i)
    return
  }
  inst.enabled = !inst.enabled
  // 同步图例（不依赖宿主是否绑定 v-model:traces）
  refreshTraceList()
  if (props.traces && props.traces.length > 0) {
    emit(
      'update:traces',
      props.traces.map((s, j) => (j === i ? { ...s, enabled: inst.enabled } : s))
    )
  }
  schedule()
}

// ── 数据接收 ──
const pausedUi = ref(props.paused)
let paused = props.paused
let lastFrameAt = 0
const dataStale = ref(false)
const vbwFilter = new VbwFilter()

let adapterErrored = false
function normalize(raw: unknown): Float32Array | null {
  const fn = props.adapter ?? spectrumAdapters.passthrough
  try {
    const v = fn(raw)
    if (v) return v
    return (
      spectrumAdapters.json(raw) ??
      spectrumAdapters.arrayBuffer(raw) ??
      spectrumAdapters.base64(raw)
    )
  } catch (e) {
    adapterErrored = true
    reportError('adapter', e instanceof Error ? e.message : String(e))
    return null
  }
}

function setMeta(m: Partial<SpectrumMeta>): void {
  if (m.fftSize !== undefined) frameFftSize = m.fftSize
  if (m.sampleRate !== undefined) frameSampleRate = m.sampleRate
  if (m.dbScale !== undefined) frameDbScale = m.dbScale
  updateMeta()
}

function appendData(raw: unknown, meta?: Partial<SpectrumMeta>): void {
  if (disposed) return
  if (meta) setMeta(meta)
  if (paused) return
  const n = normalize(raw)
  if (!n) {
    if (adapterErrored) {
      adapterErrored = false
      return
    }
    reportError('adapter', tr('common.adapterNull'))
    return
  }
  if (n.length === 0) return
  // VBW 视频滤波（比例模型：先滤波再累计，与真机一致）
  const now = performance.now()
  let frame = vbwFilter.apply(n, props.vbw, binHz())
  const prevLen = bufferLen
  bufferLen = frame.length
  // 先同步元数据（fft/dbScale），再做累计与自动量程，避免首帧按旧的 dB 口径计算
  updateMeta()
  // 真实硬件/解码异常可能产生 NaN/Inf：入口清洗（dB 填 floor，线性填 0），避免污染自动量程/GL
  let dirty = false
  for (let i = 0; i < frame.length; i++) {
    if (!Number.isFinite(frame[i]!)) {
      dirty = true
      break
    }
  }
  if (dirty) {
    const clean = frame.slice()
    const fill = curDbScale ? -120 : 0
    for (let i = 0; i < clean.length; i++) if (!Number.isFinite(clean[i]!)) clean[i] = fill
    frame = clean
  }
  if (prevLen !== frame.length) autoRange.resetTier() // 帧长变化（fftSize 调整）：重建档位但保留显示范围（不闪量程）
  for (const t of traceInsts.value) {
    if (t.math) continue // 运算迹线不占缓冲（绘制时实时计算）
    t.buf.push(frame) // 含隐藏迹线：后台累计，再开启即恢复最新
  }
  if (prevLen === 0) applySpanProp()
  if (props.peakTrack) refreshPeakTrack()
  updateAutoRange()
  lastFrameAt = now
  schedule()
}

function setData(raw: unknown): void {
  clear(false)
  appendData(raw)
}

function clear(needDraw = true): void {
  for (const t of traceInsts.value) t.buf.clear()
  vbwFilter.reset()
  markers = []
  markerDrag = -1
  bufferLen = 0
  lastFrameAt = 0
  dataStale.value = false
  autoRange.reset()
  clearMeasurements()
  if (needDraw) schedule()
}

function resetTraces(): void {
  clear()
}

function setPaused(v: boolean): void {
  if (paused === v) return
  paused = v
  pausedUi.value = v
  emit('update:paused', v)
  if (!v) lastFrameAt = performance.now()
  schedule()
}

// 受控 paused prop（v-model:paused）：宿主传值即生效；未传时组件自管
watch(
  () => props.paused,
  (v) => setPaused(v),
  { immediate: true }
)

// ── rAF 调度（统一 fpsLimit 节流 + 每帧画布尺寸校准）──
let raf = 0
let lastDrawAt = 0
// 离屏/销毁时暂停重绘：数据仍入缓冲，恢复可见后由 IntersectionObserver 触发一次
let visible = true
let disposed = false
let io: IntersectionObserver | null = null
let glChartResize: (() => void) | null = null
function schedule(): void {
  if (raf) return
  if (disposed || !visible) return
  if (typeof requestAnimationFrame === 'undefined') return
  raf = requestAnimationFrame((now) => {
    raf = 0
    glChartResize?.()
    const minInterval = 1000 / Math.max(1, props.fpsLimit) - 1
    if (now - lastDrawAt < minInterval) {
      schedule()
      return
    }
    lastDrawAt = now
    draw()
  })
}

// ── 视口状态 ──
// X 为 bin 索引域：[0, N-1]，频率换算 f = bin × (Fs/fftSize)；fullSpan=true 时始终铺满
const view = reactive({
  xMin: 0,
  xMax: 0,
  fullSpan: true,
  yAuto: props.autoScale
})
let manualRef = props.refLevel
let manualDiv = props.scaleDiv

/** 应用 span prop（bin 数；0/缺省=全带宽）；数据首帧到达后调用一次 */
function applySpanProp(): void {
  const v = props.span
  const n = bufferLen
  if (!n) return
  if (v === undefined || v === 0) {
    view.fullSpan = true
    return
  }
  if (v > 0) {
    if (v >= n - 1 - 1e-9) {
      // prop 回写（emitSpanChange）达到全带宽：保持全带宽锁定，避免丢 fullSpan 后可平移
      view.fullSpan = true
      return
    }
    const span = Math.min(Math.max(v, MIN_SPAN), Math.max(MIN_SPAN, n - 1))
    const center = view.fullSpan ? (n - 1) / 2 : (view.xMin + view.xMax) / 2
    view.fullSpan = false
    view.xMin = Math.max(0, center - span / 2)
    view.xMax = view.xMin + span
  }
}

watch(
  () => props.span,
  () => {
    applySpanProp()
    schedule()
    emitViewportChange()
  }
)

watch(
  () => props.viewport,
  (v) => {
    if (v) applyExternalViewport(v)
  },
  { immediate: true, deep: true }
)

function applyExternalViewport(v: NonNullable<SpectrumProps['viewport']>): void {
  if (v.autoScale !== undefined) {
    if (v.autoScale && !view.yAuto) resetYAuto()
    view.yAuto = v.autoScale
  }
  if (v.yMax !== undefined) {
    manualRef = v.yMax
    view.yAuto = false
    if (v.yMin !== undefined && curDbScale) {
      manualDiv = Math.max(0.1, (manualRef - v.yMin) / DIVISIONS)
    }
  }
  if (v.xMin !== undefined && v.xMax !== undefined && v.xMax > v.xMin) {
    view.fullSpan = false
    view.xMin = v.xMin
    view.xMax = v.xMax
  }
  schedule()
}

watch(
  () => props.autoScale,
  (v) => {
    if (v === view.yAuto) return
    if (v) resetYAuto()
    else seedManualFromAuto()
    view.yAuto = v
    schedule()
  }
)

// 内部切换到手动（Shift+滚轮/拖 Ref 线/框选/方向键）时同步回父组件（v-model:auto-scale）
watch(
  () => view.yAuto,
  (v) => emit('update:autoScale', v)
)

watch(
  () => props.refLevel,
  (v) => {
    if (v === undefined || v === manualRef) return
    manualRef = v
    view.yAuto = false
    schedule()
  }
)

watch(
  () => props.scaleDiv,
  (v) => {
    if (v === undefined || v === manualDiv) return
    manualDiv = Math.max(0.1, v)
    view.yAuto = false
    schedule()
  }
)

// 迹线模式/平均帧数/多迹线配置变化：重建实例 + 重绘
watch(
  () => [props.traceMode, props.averageCount, props.traces],
  () => {
    syncTraces()
    schedule()
  },
  { deep: true }
)

// 外观/语义 props：任一变化重绘（含冻结态）
watch(
  [
    () => props.lineWidth,
    () => props.persistence,
    () => props.axis,
    () => props.xAxis,
    () => props.grid,
    () => props.axisLabels,
    () => props.dbScale,
    () => props.sampleRate,
    () => props.fftSize,
    () => props.unit,
    () => props.impedance,
    () => props.vbw,
    () => props.showInfo,
    () => props.peakTable,
    () => props.peakTableOpts,
    () => props.markerTable,
    () => props.detector,
    () => props.dots,
    () => props.freqOffsetHz,
    () => props.ampOffsetDb,
    () => props.limitLines
  ],
  () => {
    updateMeta()
    schedule()
  },
  { deep: true }
)
watch([() => props.theme, () => props.chartStyle], () => schedule(), { deep: true })
watch(prefersDark, () => {
  if (props.theme === 'auto') schedule()
})

watch(
  () => props.peakTrack,
  (v) => {
    if (v) refreshPeakTrack()
    schedule()
  }
)

// ── 视口工具 ──
function resolveXRange(): { min: number; max: number } {
  const n = bufferLen
  if (n <= 1) return { min: 0, max: 1 }
  if (view.fullSpan) return { min: 0, max: n - 1 }
  const total = n - 1
  let min = Math.max(0, Math.min(view.xMin, total))
  let max = Math.min(total, view.xMax)
  if (max - min < MIN_SPAN) min = Math.max(0, max - MIN_SPAN)
  if (max <= min) {
    min = 0
    max = Math.min(total, MIN_SPAN)
  }
  return { min, max }
}

function setFrozenX(min: number, max: number): void {
  const total = Math.max(1, bufferLen - 1)
  const span = Math.max(MIN_SPAN, max - min)
  if (span >= total - 1e-9) {
    // 达到全带宽：吸附并锁定平移（键盘 ± / 框选缩到全宽同样走这里）
    view.fullSpan = true
    view.xMin = 0
    view.xMax = total
  } else {
    const lo = Math.max(0, Math.min(min, Math.max(0, total - span)))
    view.fullSpan = false
    view.xMin = lo
    view.xMax = lo + span
  }
  autoRange.resetShrink() // 视口变化后重新累计收窄驻留，避免误收档
  emitSpanChange()
}

let spanNotifyTimer: ReturnType<typeof setTimeout> | null = null
function emitSpanChange(immediate = false): void {
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
  const send = (): void => {
    spanNotifyTimer = null
    const xr = resolveXRange()
    emit('update:span', Math.max(MIN_SPAN, Math.round(xr.max - xr.min)))
  }
  if (immediate) send()
  else spanNotifyTimer = setTimeout(send, 150)
}

let refNotifyTimer: ReturnType<typeof setTimeout> | null = null
/** Ref/dB格 手势变更回写（update:refLevel / update:scaleDiv；滚轮防抖，手势结束立即） */
function emitRefChange(immediate = false): void {
  if (refNotifyTimer) {
    clearTimeout(refNotifyTimer)
    refNotifyTimer = null
  }
  const send = (): void => {
    refNotifyTimer = null
    emit('update:refLevel', Math.round(manualRef * 100) / 100)
    emit('update:scaleDiv', Math.round(manualDiv * 100) / 100)
  }
  if (immediate) send()
  else refNotifyTimer = setTimeout(send, 150)
}

// ── 自动/手动 Y 轴 ──
// 频谱专用自动量程：包络快攻慢释 + 档位滞回/收窄驻留 + 平滑显示，避免噪声导致的档位翻转抖动
const autoRange = new SpectrumAutoRange()
function resetYAuto(): void {
  autoRange.reset()
}
/** 从当前自动范围接管为手动（切换时不跳变） */
function seedManualFromAuto(): void {
  if (!lastView) return
  manualRef = lastView.yRange.max
  const span = lastView.yRange.max - lastView.yRange.min
  manualDiv = curDbScale ? Math.max(0.1, span / DIVISIONS) : manualDiv
}
function manualRange(): { min: number; max: number } {
  if (curDbScale) return { min: manualRef - DIVISIONS * manualDiv, max: manualRef }
  return { min: 0, max: manualRef > 0 ? manualRef : 1 }
}

/** 每帧数据更新时喂入可见区稳健极值（多迹线合并：峰值取全体最大，底部取全体最小） */
function updateAutoRange(): void {
  if (!view.yAuto) return
  const slice = visibleSlice()
  if (!slice) return
  let mn = Infinity
  let mx = -Infinity
  let any = false
  for (const t of traceInsts.value) {
    if (!t.enabled || t.math) continue
    const d = t.buf.get()
    if (!d) continue
    const mm = robustMinMax(d, slice.s, Math.min(slice.e, d.length))
    if (!mm) continue
    any = true
    const off = t.offsetDb ?? 0
    if (mm.min + off < mn) mn = mm.min + off
    if (mm.max + off > mx) mx = mm.max + off
  }
  if (any) autoRange.update(mn, mx, curDbScale)
}

function defaultYRange(): { min: number; max: number } {
  return curDbScale ? { min: -100, max: 0 } : { min: 0, max: 1 }
}

function resolveYRange(data: Float32Array | null): { min: number; max: number } {
  if (!view.yAuto) return manualRange()
  if (!data) return defaultYRange()
  return autoRange.display() ?? defaultYRange()
}

// ── 抽稀（核心 decimateTrace 检波器）与显示偏移副本 ──
/** 显示偏移副本（仅 offsetDb 非零时分配） */
function offsetArray(d: Float32Array, off: number): Float32Array {
  const out = new Float32Array(d.length)
  for (let i = 0; i < d.length; i++) out[i] = d[i]! + off
  return out
}

// ── 绘制 ──
let fadeOutFrames = 0
let persistSnapshot: HTMLCanvasElement | null = null
let needsRestore = false

function computePlot(canvas: HTMLCanvasElement): PlotRect {
  const dpr = window.devicePixelRatio || 1
  const wCss = canvas.width / dpr
  const hCss = canvas.height / dpr
  if (!props.axis) return { x: 0, y: 0, w: wCss, h: hCss }
  return {
    x: th.value.axisWidth,
    y: 0,
    w: Math.max(1, wCss - th.value.axisWidth),
    h: Math.max(1, hCss - GUTTER_BOTTOM)
  }
}

let lastView: {
  xRange: { min: number; max: number }
  yRange: { min: number; max: number }
  plot: PlotRect
  xFrac: number
  slice: { s: number; e: number }
} | null = null
let lastXrReal: { min: number; max: number } | null = null
let cursor: { px: number; py: number } | null = null
let hovered = false
const focused = ref(false)

// ── 标记 / 框选 / 菜单状态 ──
let markers: number[] = []
let markerDrag = -1
let markerMoved = false
const markerDownPx = { x: 0, y: 0 }
const MARKER_HIT_PX = 6
const menu = reactive({ show: false, x: 0, y: 0, hitIdx: -1, dataX: 0 })
let refDrag = false
let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !renderer || (!gl && !ctx2d) || contextLost) return
  const primary = activeTraceData()
  const n = primary ? primary.length : 0
  const xr = resolveXRange()
  const s = Math.max(0, Math.floor(xr.min))
  const e = Math.min(n, Math.ceil(xr.max) + 1)
  const len = Math.max(0, e - s)
  const yr = resolveYRange(primary)
  const plot = computePlot(canvas)
  const persist = Math.min(0.95, Math.max(0, props.persistence ?? 0))
  const fading = persist > 0 && (fadeRenderer !== null || ctx2d !== null)

  gl?.disable(gl.SCISSOR_TEST)
  // 数据流中断检测（冻结期间不计）
  const stale = !paused && lastFrameAt > 0 && performance.now() - lastFrameAt > DATA_STALE_MS
  if (dataStale.value !== stale) dataStale.value = stale

  if (needsRestore && persistSnapshot && (blitRenderer || ctx2d)) {
    restoreSnapshot()
    needsRestore = false
  }
  const viewChanged =
    !lastView ||
    !lastXrReal ||
    xr.min !== lastXrReal.min ||
    xr.max !== lastXrReal.max ||
    yr.min !== lastView.yRange.min ||
    yr.max !== lastView.yRange.max
  lastXrReal = { min: xr.min, max: xr.max }

  // 余辉语义：实时采集每帧淡出合成；冻结且视口未变 → 缓冲冻结（像素级静止）；
  // 冻结中视口变化 → 旧迹线 12 帧平滑淡出后由新视口重绘
  if (fading && !paused) {
    fadeOutFrames = 0
    persistSnapshot = null
    needsRestore = false
    fadeBackground(1 - persist)
  } else if (fading && paused) {
    if (viewChanged) {
      fadeOutFrames = FADE_OUT_STEPS
      persistSnapshot = null
    }
    if (fadeOutFrames > 0) {
      fadeBackground(FADE_OUT_ALPHA)
      fadeOutFrames--
      if (fadeOutFrames === 0) {
        clearBackground()
      }
    }
  } else {
    clearBackground()
  }

  if (!primary || len <= 0) {
    lastView = null
    clearOverlay()
    return
  }

  const effPad = Math.min(PAD_X, plot.w * 0.08)
  const xFrac = effPad / plot.w
  const kS = 1 - 2 * xFrac
  const spanX = Math.max(1e-9, xr.max - xr.min)
  const padData = (xFrac * spanX) / kS
  const xrView = { min: xr.min - padData, max: xr.max + padData }
  lastView = { xRange: xrView, yRange: yr, plot, xFrac, slice: { s, e } }

  const target = Math.max(1, Math.floor(plot.w))
  const opaque = fading && paused && !viewChanged && fadeOutFrames === 0
  // 多迹线叠加：逐条取数（含运算迹线）→ 检波抽稀 → 逐条绘制（共享视口/量程）
  traceInsts.value.forEach((t, ti) => {
    if (!t.enabled) return
    let d: Float32Array | null = null
    if (t.math) {
      const aa = traceInsts.value[t.math.a]?.buf.get()
      const bb = traceInsts.value[t.math.b]?.buf.get()
      if (aa && bb) {
        const n = Math.min(aa.length, bb.length)
        const diff = new Float32Array(n)
        for (let i = 0; i < n; i++) diff[i] = aa[i]! - bb[i]!
        d = diff
      }
    } else {
      d = t.buf.get()
    }
    if (!d) return
    if (t.offsetDb) d = offsetArray(d, t.offsetDb)
    const ee = Math.min(d.length, e)
    if (ee - s <= 0) return
    const dec = props.decimation
      ? decimateTrace(d, s, ee, target, props.detector, curDbScale)
      : d.subarray(s, ee)
    if (dec.length === 0) return
    const nIdx = Math.max(1, dec.length - 1)
    const vpX = { xMin: (-xFrac * nIdx) / kS, xMax: nIdx + (xFrac * nIdx) / kS }
    renderer!.setData(dec)
    renderer!.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(traceColorAt(ti, t), opaque ? 1 : th.value.traceAlpha),
      false,
      plot,
      opaque,
      0,
      Math.max(1, props.lineWidth || 1)
    )
  })

  // 内存迹线（参考叠加；灰色细线，不参与自动量程）
  if (memoryOn.value && memoryTrace) {
    const md = memoryTrace
    const mee = Math.min(md.length, e)
    if (mee - s > 0) {
      const mdec = props.decimation
        ? decimateTrace(md, s, mee, target, props.detector, curDbScale)
        : md.subarray(s, mee)
      if (mdec.length > 1) {
        const mIdx = Math.max(1, mdec.length - 1)
        renderer!.setData(mdec)
        renderer!.draw(
          {
            xMin: (-xFrac * mIdx) / kS,
            xMax: mIdx + (xFrac * mIdx) / kS,
            yMin: yr.min,
            yMax: yr.max
          },
          withAlpha(th.value.text, 0.55),
          false,
          plot,
          opaque,
          0,
          1
        )
      }
    }
  }
  drawOverlay(xrView, yr, plot)

  if (fading && paused && !viewChanged && fadeOutFrames === 0) {
    if (
      !persistSnapshot ||
      persistSnapshot.width !== canvas.width ||
      persistSnapshot.height !== canvas.height
    ) {
      const snap = document.createElement('canvas')
      snap.width = canvas.width
      snap.height = canvas.height
      snap.getContext('2d')?.drawImage(canvas, 0, 0)
      persistSnapshot = snap
    }
  }
}

function clearOverlay(): void {
  const ov = overlayRef.value
  if (!ov) return
  ov.getContext('2d')?.clearRect(0, 0, ov.width, ov.height)
}

// ── 数值格式（频率/幅度）──
function trimZeros(v: number, step: number): string {
  const dec = Math.min(6, Math.max(0, Math.ceil(-Math.log10(Math.max(Math.abs(step), 1e-12)))))
  const s = v.toFixed(dec)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
function unitScale(stepHz: number): number {
  const a = Math.abs(stepHz)
  return a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1
}
function unitName(stepHz: number): string {
  const a = Math.abs(stepHz)
  return a >= 1e6 ? 'MHz' : a >= 1e3 ? 'kHz' : 'Hz'
}
function fmtFreqStep(hz: number, stepHz: number): string {
  return `${trimZeros(hz / unitScale(stepHz), stepHz / unitScale(stepHz))} ${unitName(stepHz)}`
}
/** 频率读数（小数位随 bin 宽自适应） */
function fmtFreq(hz: number): string {
  const step = binHz() ?? 1
  return `${trimZeros(hz, step)} ${unitName(step)}`
}
function buildFreqTicks(
  min: number,
  max: number
): { values: number[]; labels: string[] } | undefined {
  const bHz = binHz()
  if (!bHz || !(max > min)) return undefined
  const off = props.freqOffsetHz
  const ticks = niceTicks(min * bHz + off, max * bHz + off, 6)
  if (!ticks.length) return undefined
  const stepHz = ticks.length > 1 ? ticks[1]! - ticks[0]! : ((max - min) * bHz) / 6
  return {
    values: ticks.map((f) => (f - off) / bHz),
    labels: ticks.map((f) => fmtFreqStep(f, stepHz))
  }
}
function yDecimals(): number {
  if (!lastView) return 2
  const step = niceStep(lastView.yRange.max - lastView.yRange.min, DIVISIONS)
  return Math.min(6, Math.max(1, Math.ceil(-Math.log10(Math.max(step, 1e-9))) + 1))
}
function fmtVal(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
}
function levelText(v: number): string {
  return curDbScale ? `${fmtVal(toUnit(v))}${unitSuffix()}` : fmtVal(v)
}

// ── 坐标轴覆盖层 ──
let overlaySizeWarned = false

/** 参考电平（Ref）线在屏上的 y 坐标（CSS px）；无视图返回 NaN */
function refLineY(): number {
  if (!lastView) return Number.NaN
  const { plot, yRange } = lastView
  const ys = yRange.max - yRange.min
  return ys > 1e-9 ? plot.y + plot.h - ((manualRef - yRange.min) / ys) * plot.h : plot.y
}

/** 深缩放样本点：可见样本间隔 >3px 时显示（dots:auto）；逐迹线按色绘制 */
function drawSampleDots(ctx: CanvasRenderingContext2D, plot: PlotRect): void {
  if (props.dots === 'off' || !lastView) return
  const slice = lastView.slice
  const count = slice.e - slice.s
  if (count <= 0) return
  const spacing = plot.w / count
  if (props.dots === 'auto' && spacing < 3) return
  if (spacing < 0.8) return
  const { xRange, yRange } = lastView
  const xs = xRange.max - xRange.min
  const ys = yRange.max - yRange.min
  if (!(xs > 1e-9) || !(ys > 1e-9)) return
  traceInsts.value.forEach((t, ti) => {
    if (!t.enabled || t.math) return
    const d = t.buf.get()
    if (!d) return
    const off = t.offsetDb ?? 0
    const e = Math.min(slice.e, d.length)
    ctx.save()
    ctx.fillStyle = traceColorAt(ti, t)
    ctx.globalAlpha = 0.95
    ctx.beginPath()
    for (let i = slice.s; i < e; i++) {
      const v = d[i]! + off
      if (v < yRange.min || v > yRange.max) continue
      const px = plot.x + ((i - xRange.min) / xs) * plot.w
      const py = plot.y + plot.h - ((v - yRange.min) / ys) * plot.h
      ctx.moveTo(px + 2, py)
      ctx.arc(px, py, 2, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.restore()
  })
}

function drawOverlay(
  xv: { min: number; max: number },
  yr: { min: number; max: number },
  plot: PlotRect
): void {
  const ov = overlayRef.value
  if (!ov || !props.axis) return
  const glC = canvasRef.value
  if (glC && (ov.width !== glC.width || ov.height !== glC.height)) {
    if (IS_DEV && !overlaySizeWarned) {
      overlaySizeWarned = true
      console.warn('[SpectrumChart] overlay 尺寸与 GL 画布不一致，已自动同步', {
        overlay: [ov.width, ov.height],
        gl: [glC.width, glC.height]
      })
    }
    ov.width = glC.width
    ov.height = glC.height
  }
  const ctx = ov.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ov.width, ov.height)
  const rect = ov.getBoundingClientRect()
  const refW = ov.clientWidth || rect.width
  const refH = ov.clientHeight || rect.height
  const sx = ov.width / Math.max(1, refW)
  const sy = ov.height / Math.max(1, refH)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  const t = th.value
  const bHz = binHz()
  const xTicksOverride = buildFreqTicks(xv.min, xv.max)

  drawAxisOverlay(ctx, {
    plot,
    xMin: xv.min,
    xMax: xv.max,
    yMin: yr.min,
    yMax: yr.max,
    showX: props.xAxis !== false,
    showGrid: props.grid !== false,
    frame: false,
    // 手动 dB 模式按「Ref + 5 格」建模，刻度目标取 6（5 个间隔）才能让网格与 dB/div 对齐；
    // 自动量程/线性模式仍用 7，保证覆盖范围（旧实现固定 7，dB/div=2 时会画出 10 格）
    yTickCount: view.yAuto || !curDbScale ? 7 : DIVISIONS + 1,
    xTicksOverride,
    yTickFormat: (v: number) => toUnit(v).toFixed(yDecimals()),
    theme: {
      text: t.text,
      grid: t.grid,
      axisLine: t.border,
      plotBg: t.plotBg,
      border: t.border,
      zeroLine: t.zeroLine,
      labelChipBg: t.labelChipBg
    }
  })

  // ── 轴单位标题 ──
  if (props.axisLabels !== false) {
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    // 旋转标题：顶端锚定、文字向下延伸（对齐轴带顶部），避免中心锚定导致上半被画布裁掉
    ctx.translate(plot.x + 10, plot.y + 8)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'right' // 旋转后 right 方向 = 屏幕向下
    ctx.textBaseline = 'middle'
    ctx.fillText(
      props.labels?.y ??
        (curDbScale
          ? tr('spectrum.axisYDb', { unit: unitLabel(props.unit) })
          : tr('spectrum.axisY')),
      0,
      0
    )
    ctx.restore()
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(
      props.labels?.x ?? (bHz ? tr('spectrum.axisX') : 'bin'),
      plot.x + plot.w - 6,
      plot.y + plot.h - 6
    )
    ctx.restore()
  }

  // ── 深缩放样本点（dots）──
  drawSampleDots(ctx, plot)

  // ── 峰值表行数据（提前算高度，供信息栏/标记读数面板避让）──
  const peakRows = props.peakTable ? computePeaks() : []
  const peakTableH = peakRows.length > 0 ? peakRows.length * 14 + 6 : 0

  // ── 图内参数栏（四角仪器风：Ref/Scale · Center/Span · RBW/VBW）──
  if (props.showInfo !== false) {
    ctx.save()
    ctx.font = '10px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.6
    // 左上：Ref/Scale（下移避开图例，右移避开旋转轴标题）
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const infoTop = plot.y + 4 + (legendShown.value ? 22 : 0) + (pausedUi.value ? 24 : 0)
    const refInfo = view.yAuto
      ? tr('common.auto')
      : curDbScale
        ? `Ref ${toUnit(manualRef).toFixed(1)}${unitSuffix()} · ${manualDiv} dB/div`
        : `Ref ${toUnit(manualRef).toFixed(2)}${tr('common.linear')}`
    ctx.fillText(refInfo, plot.x + 20, infoTop)
    // 右上：Center/Span（下移避开峰值表面板）
    if (bHz && lastXrReal) {
      const center = ((lastXrReal.min + lastXrReal.max) / 2) * bHz + props.freqOffsetHz
      const span = (lastXrReal.max - lastXrReal.min) * bHz
      ctx.textAlign = 'right'
      ctx.fillText(
        `Center ${fmtFreq(center)} · Span ${fmtFreq(span)}`,
        plot.x + plot.w - 6,
        infoTop + (peakTableH > 0 ? peakTableH + 6 : 0)
      )
    }
    // 左下：RBW/VBW
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    const infoParts: string[] = []
    if (bHz) infoParts.push(`RBW ${fmtFreq(bHz)}`)
    if (props.vbw && props.vbw > 0) {
      const vbwActive = bHz !== undefined && props.vbw < bHz
      infoParts.push(`VBW ${fmtFreq(props.vbw)}${vbwActive ? '' : ` (${tr('common.off')})`}`)
    }
    if (infoParts.length) ctx.fillText(infoParts.join(' · '), plot.x + 6, plot.y + plot.h - 4)
    ctx.restore()
  }

  // ── 峰值表面板（右上）──
  if (peakRows.length > 0) {
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    const lines = peakRows.map((p, i) => {
      const fTxt = bHz ? fmtFreq(dispHz(p.bin * bHz)) : `bin ${p.bin}`
      return `${i + 1}  ${fTxt}  ${levelText(p.value + activeTraceOffset())}`
    })
    let wMax = 0
    for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
    const padX = 8
    const lineH = 14
    const bw = Math.ceil(wMax) + padX * 2 + 12
    const bh = lines.length * lineH + 6
    const bx = plot.x + plot.w - 8 - bw
    const byC = plot.y + 8
    drawPanel(ctx, bx, byC, bw, bh, t.labelChipBg)
    ctx.fillStyle = t.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    lines.forEach((ln, li) => ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2))
  }

  // ── 参考电平虚线（手动 dB 模式；仅悬停热区或拖拽中显示，避免常驻遮挡/困惑）──
  if (!view.yAuto && curDbScale) {
    const ly = refLineY()
    const reveal = refDrag || (cursor !== null && Math.abs(cursor.py - ly) <= 6)
    if (reveal && ly >= plot.y - 2 && ly <= plot.y + plot.h + 2) {
      ctx.save()
      ctx.strokeStyle = t.crosshair
      ctx.setLineDash([6, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plot.x, Math.round(ly) + 0.5)
      ctx.lineTo(plot.x + plot.w, Math.round(ly) + 0.5)
      ctx.stroke()
      ctx.restore()
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lvY = Math.min(
        Math.max(Math.round(ly) - CHIP_H / 2, plot.y + 2),
        plot.y + plot.h - CHIP_H - 2
      )
      drawChip(
        ctx,
        plot.x + plot.w - 76,
        lvY,
        `Ref ${toUnit(manualRef).toFixed(yDecimals())}`,
        t.labelChipBg,
        t.text
      )
    }
  }

  // ── Shift+框选矩形 ──
  if (boxSel) {
    const bx = Math.min(boxSel.x0, boxSel.x1)
    const by = Math.min(boxSel.y0, boxSel.y1)
    const bw = Math.abs(boxSel.x1 - boxSel.x0)
    const bh = Math.abs(boxSel.y1 - boxSel.y0)
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.fillStyle = t.crosshair
    ctx.fillRect(bx, by, bw, bh)
    ctx.globalAlpha = 1
    ctx.strokeStyle = t.crosshair
    ctx.setLineDash([4, 3])
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
    ctx.restore()
  }

  // ── 测量叠加（OBW / N dB 边界与结果芯片；信道功率/区间功率/ACPR）──
  if (measObw || measNdb || measChp !== null || measBand || measAcpr) {
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 图例占据顶部居中区域时，测量芯片栈整体下移，避免被图例背景盖住
    const measTop = plot.y + (legendShown.value ? 22 : 0)
    const drawMeasBand = (lo: number, hi: number): void => {
      const x0 = markerPx(lo)
      const x1 = markerPx(hi)
      if (!isFinite(x0) || !isFinite(x1)) return
      const xa = Math.min(x0, x1)
      const xb = Math.max(x0, x1)
      ctx.save()
      ctx.globalAlpha = 0.1
      ctx.fillStyle = t.crosshair
      ctx.fillRect(xa, plot.y, xb - xa, plot.h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = t.crosshair
      ctx.setLineDash([5, 3])
      ctx.beginPath()
      ctx.moveTo(Math.round(xa) + 0.5, plot.y)
      ctx.lineTo(Math.round(xa) + 0.5, plot.y + plot.h)
      ctx.moveTo(Math.round(xb) + 0.5, plot.y)
      ctx.lineTo(Math.round(xb) + 0.5, plot.y + plot.h)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
    const measChip = (lo: number, hi: number, text: string, yOff: number): void => {
      const x0 = markerPx(lo)
      const x1 = markerPx(hi)
      if (!isFinite(x0) || !isFinite(x1)) return
      drawChip(
        ctx,
        (Math.min(x0, x1) + Math.max(x0, x1)) / 2,
        measTop + yOff,
        text,
        t.labelChipBg,
        t.text,
        'center',
        {
          min: plot.x,
          max: plot.x + plot.w
        }
      )
    }
    if (measObw) {
      drawMeasBand(measObw.lo, measObw.hi)
      measChip(measObw.lo, measObw.hi, `OBW ${fmtFreq(measObw.obwHz)}`, 22)
    }
    if (measNdb) {
      drawMeasBand(measNdb.lo, measNdb.hi)
      measChip(
        measNdb.lo,
        measNdb.hi,
        `${measNdb.nDb}dB BW ${fmtFreq(measNdb.widthHz)} · ${tr('common.peak')} ${measLevelText(offsetDisplayDb(measNdb.peakValue))}`,
        42
      )
    }
    if (measChp !== null) {
      drawChip(
        ctx,
        plot.x + plot.w / 2,
        measTop + 62,
        `ChP ${measLevelText(offsetDisplayDb(measChp))}`,
        t.labelChipBg,
        t.text,
        'center',
        {
          min: plot.x,
          max: plot.x + plot.w
        }
      )
    }
    if (measBand) {
      drawMeasBand(measBand.lo, measBand.hi)
      measChip(
        measBand.lo,
        measBand.hi,
        `P ${measLevelText(offsetDisplayDb(measBand.powerDb))} · ${measDensityText(offsetDisplayDb(measBand.densityDbPerHz))}`,
        82
      )
    }
    if (measAcpr) {
      drawMeasBand(measAcpr.lowLo, measAcpr.lowHi)
      drawMeasBand(measAcpr.upLo, measAcpr.upHi)
      drawMeasBand(measAcpr.mainLo, measAcpr.mainHi)
      const acprLo = measAcpr.lowerDb - measAcpr.mainDb
      const acprUp = measAcpr.upperDb - measAcpr.mainDb
      drawChip(
        ctx,
        plot.x + plot.w / 2,
        measTop + 102,
        `ACPR L ${acprLo.toFixed(1)} · U ${acprUp.toFixed(1)} dBc`,
        t.labelChipBg,
        t.text,
        'center',
        { min: plot.x, max: plot.x + plot.w }
      )
    }
  }

  // ── 限制线（折线 + 超限区间 + 判定芯片）──
  const limArrs = limitArrays()
  if (limArrs.length > 0 && lastView) {
    const xrL = lastView.xRange
    const ysr = lastView.yRange
    const xsL = xrL.max - xrL.min
    const ysL = ysr.max - ysr.min
    const sliceL = lastView.slice
    const limColor = t.darkLike ? '#ff6b6b' : '#d32f2f'
    const toPxXL = (bin: number): number =>
      plot.x + ((bin - xrL.min) / Math.max(1e-9, xsL)) * plot.w
    const toPxYL = (v: number): number =>
      plot.y + plot.h - ((v - ysr.min) / Math.max(1e-9, ysL)) * plot.h
    const limData = activeTraceData()
    // 采样步长：每像素最多一个点（避免大窗逐 bin 绘制开销）
    const stepL = Math.max(1, Math.ceil((sliceL.e - sliceL.s) / Math.max(1, plot.w)))
    for (const { arr, type } of limArrs) {
      ctx.save()
      ctx.strokeStyle = limColor
      ctx.lineWidth = 1.5
      ctx.beginPath()
      let first = true
      for (let i = sliceL.s; i < sliceL.e; i += stepL) {
        const lv = arr[i]
        if (lv === undefined) continue
        const px = toPxXL(i)
        const py = toPxYL(lv)
        if (first) {
          ctx.moveTo(px, py)
          first = false
        } else {
          ctx.lineTo(px, py)
        }
      }
      ctx.stroke()
      ctx.restore()
      // 超限区间（活动迹线）
      if (limData) {
        let runStart = -1
        for (let i = sliceL.s; i <= sliceL.e; i++) {
          const v = i < sliceL.e ? limData[i] : undefined
          const bad =
            v !== undefined && arr[i] !== undefined
              ? type === 'upper'
                ? v > arr[i]!
                : v < arr[i]!
              : false
          if (bad && runStart < 0) runStart = i
          if (!bad && runStart >= 0) {
            const x0 = toPxXL(runStart)
            const x1 = toPxXL(i)
            ctx.save()
            ctx.globalAlpha = 0.18
            ctx.fillStyle = limColor
            ctx.fillRect(x0, plot.y, Math.max(1, x1 - x0), plot.h)
            ctx.restore()
            runStart = -1
          }
        }
      }
    }
    const res = getLimitResult()
    if (res) {
      // 左上信息栏下方（避开顶部中央的"数据流中断"角标与居中的测量芯片栈）
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const txt = res.pass
        ? tr('spectrum.limitPass')
        : tr('spectrum.limitFail', { n: res.violations })
      const bg = res.pass ? 'rgba(24,160,88,0.85)' : 'rgba(208,48,80,0.9)'
      const limTop = plot.y + 4 + (legendShown.value ? 22 : 0) + (pausedUi.value ? 24 : 0) + 18
      drawChip(ctx, plot.x + 20, limTop, txt, bg, '#ffffff', 'left', {
        min: plot.x,
        max: plot.x + plot.w
      })
    }
  }

  // ── 标记（垂直虚线 + 芯片 + 读数面板）──
  if (markers.length > 0) {
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const data = activeTraceData()
    const readAt = (binF: number): string => {
      if (!data) return ''
      const b = Math.round(binF)
      if (b < 0 || b >= data.length) return ''
      const fTxt = bHz ? fmtFreq(dispHz(b * bHz)) : `bin ${b}`
      return `${fTxt} · ${levelText(data[b]! + activeTraceOffset())}`
    }
    const lines: string[] = []
    markers.forEach((m, i) => {
      const px = markerPx(m)
      let txt = `M${i + 1}  ${readAt(m)}`
      if (noiseMarkerIdx === i && bHz) {
        const rawDb = levelAtDb(m)
        if (rawDb !== null)
          txt += ` · ${measDensityText(offsetDisplayDb(rawDb) - 10 * Math.log10(bHz))}`
      }
      lines.push(txt)
      if (!lastView || px < lastView.plot.x - 0.5 || px > lastView.plot.x + lastView.plot.w + 0.5)
        return
      const pxc = Math.round(px) + 0.5
      ctx.save()
      ctx.strokeStyle = t.crosshair
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(pxc, lastView.plot.y)
      ctx.lineTo(pxc, lastView.plot.y + lastView.plot.h)
      ctx.stroke()
      ctx.restore()
      drawChip(ctx, pxc, lastView.plot.y + 2, `M${i + 1}`, t.labelChipBg, t.text, 'center', {
        min: lastView.plot.x,
        max: lastView.plot.x + lastView.plot.w
      })
    })
    if (markers.length === 2) {
      const a = markers[0]!
      const b = markers[1]!
      const dBin = Math.abs(b - a)
      if (bHz) lines.push(`Δf  ${fmtFreq(dBin * bHz)}`)
      if (data) {
        const va = data[Math.min(data.length - 1, Math.max(0, Math.round(a)))] ?? 0
        const vb = data[Math.min(data.length - 1, Math.max(0, Math.round(b)))] ?? 0
        lines.push(`ΔL  ${fmtVal(vb - va)}${curDbScale ? ' dB' : ''}`)
      }
    }
    if (lines.length > 0) {
      const byC = plot.y + 8 + (peakTableH > 0 ? peakTableH + 6 : 0)
      const padX = 8
      const lineH = 14
      if (props.markerTable) {
        // 标记表：列 # / 频率 / 电平（+Δ 行；噪声标记行含密度）
        const rows: string[][] = markers.map((m, i) => {
          const b = Math.min((data?.length ?? 1) - 1, Math.max(0, Math.round(m)))
          const fTxt = bHz ? fmtFreq(dispHz(b * bHz)) : `bin ${b}`
          const lv = data ? levelText(data[b]! + activeTraceOffset()) : '—'
          const rawDb = noiseMarkerIdx === i && bHz ? levelAtDb(m) : null
          const nz =
            rawDb !== null ? measDensityText(offsetDisplayDb(rawDb) - 10 * Math.log10(bHz!)) : ''
          return [`M${i + 1}`, fTxt, nz ? `${lv} · ${nz}` : lv]
        })
        if (markers.length === 2 && data && bHz) {
          const a = markers[0]!
          const b = markers[1]!
          const dBin = Math.abs(b - a)
          const va = data[Math.min(data.length - 1, Math.max(0, Math.round(a)))] ?? 0
          const vb = data[Math.min(data.length - 1, Math.max(0, Math.round(b)))] ?? 0
          rows.push([
            'Δ1−2',
            fmtFreq(dBin * bHz),
            `${fmtVal(vb - va)}${curDbScale ? ` ${unitLabel(props.unit)}` : ''}`
          ])
        }
        const colW = [0, 0, 0]
        for (const r of rows)
          for (let c = 0; c < 3; c++) colW[c] = Math.max(colW[c]!, ctx.measureText(r[c]!).width)
        const colGap = 12
        const bw = Math.ceil(colW[0]! + colW[1]! + colW[2]!) + colGap * 2 + padX * 2
        const bh = rows.length * lineH + 6
        const bx = plot.x + plot.w - 8 - bw
        drawPanel(ctx, bx, byC, bw, bh, t.labelChipBg)
        ctx.fillStyle = t.text
        ctx.textAlign = 'left'
        rows.forEach((r, ri) => {
          let x = bx + padX
          for (let c = 0; c < 3; c++) {
            ctx.fillText(r[c]!, x, byC + 3 + lineH * ri + lineH / 2)
            x += colW[c]! + colGap
          }
        })
      } else {
        // 紧凑读数条
        ctx.textAlign = 'left'
        let wMax = 0
        for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
        const bw = Math.ceil(wMax) + padX * 2
        const bh = lines.length * lineH + 6
        const bx = plot.x + plot.w - 8 - bw
        drawPanel(ctx, bx, byC, bw, bh, t.labelChipBg)
        ctx.fillStyle = t.text
        lines.forEach((ln, li) => ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2))
      }
    }
  }

  // ── 十字光标与读数 ──
  if (!cursor) return
  const cxp = Math.round(cursor.px) + 0.5
  const cyp = Math.round(cursor.py) + 0.5
  ctx.save()
  ctx.strokeStyle = t.crosshair
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cxp, plot.y)
  ctx.lineTo(cxp, plot.y + plot.h)
  ctx.moveTo(plot.x, cyp)
  ctx.lineTo(plot.x + plot.w, cyp)
  ctx.stroke()
  ctx.restore()

  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chipBg = t.labelChipBg
  const dispBin = pxToBin(cursor.px)
  const xText = bHz ? fmtFreq(dispHz(dispBin * bHz)) : String(Math.round(dispBin))
  drawChip(ctx, cxp, plot.y + plot.h + 3, xText, chipBg, t.text, 'center', {
    min: plot.x,
    max: plot.x + plot.w
  })
  const yText = toUnit(pyToDataY(cursor.py)).toFixed(yDecimals())
  const yChipY = Math.min(Math.max(cyp - CHIP_H / 2, plot.y + 2), plot.y + plot.h - CHIP_H - 2)
  drawChip(ctx, 2, yChipY, yText, chipBg, t.text)

  const smp = sampleAt(cursor.px)
  if (!smp) return
  const idxLine = bHz ? `#${smp.bin} · ${fmtFreq(dispHz(smp.bin * bHz))}` : `#${smp.bin}`
  const lines = [idxLine, levelText(smp.value + activeTraceOffset())]
  ctx.textAlign = 'left'
  let wMax = 0
  for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
  const padX = 8
  const lineH = 14
  const bw = Math.ceil(wMax) + padX * 2
  const bh = lines.length * lineH + 6
  let bx = cursor.px + 14
  const byC = Math.min(cursor.py + 14, plot.y + plot.h - bh - 4)
  if (bx + bw > plot.x + plot.w) bx = cursor.px - 14 - bw
  drawPanel(ctx, bx, byC, bw, bh, chipBg)
  ctx.fillStyle = t.text
  lines.forEach((ln, li) => ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2))
}

// ── 交互：坐标换算 ──
function clientToPlot(evt: MouseEvent): { px: number; py: number } | null {
  const canvas = canvasRef.value
  if (!canvas || !lastView) return null
  const r = canvas.getBoundingClientRect()
  return { px: evt.clientX - r.left, py: evt.clientY - r.top }
}
function pxToBin(px: number): number {
  const { xRange, plot } = lastView!
  return xRange.min + ((px - plot.x) / plot.w) * (xRange.max - xRange.min)
}
function pyToDataY(py: number): number {
  const { yRange, plot } = lastView!
  return yRange.min + (1 - (py - plot.y) / plot.h) * (yRange.max - yRange.min)
}
function unpadX(min: number, max: number, frac: number): { min: number; max: number } {
  const p = frac * (max - min)
  return { min: min + p, max: max - p }
}
function markerPx(bin: number): number {
  if (!lastView) return Number.NaN
  const { plot, xRange } = lastView
  return plot.x + ((bin - xRange.min) / (xRange.max - xRange.min)) * plot.w
}
function markerHit(px: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const mx = markerPx(markers[i]!)
    if (lastView && Math.abs(mx - px) <= MARKER_HIT_PX) return i
  }
  return -1
}
const MAX_MARKERS = 6
function addMarkerAt(bin: number): void {
  if (markers.length >= MAX_MARKERS) {
    schedule()
    return // 标记已满（真机标记数固定）
  }
  markers.push(Math.max(0, Math.min(bufferLen - 1, bin)))
  schedule()
}

/** 程序化添加标记（宿主 API）；标记已满返回 false */
function addMarker(bin: number): boolean {
  if (!Number.isFinite(bin) || markers.length >= MAX_MARKERS) return false
  const maxBin = Math.max(0, bufferLen - 1)
  markers.push(Math.max(0, Math.min(maxBin, bin)))
  schedule()
  return true
}
/** 程序化设置标记列表（最多 6 个，超出截断） */
function setMarkers(bins: number[]): void {
  const maxBin = Math.max(0, bufferLen - 1)
  markers = bins
    .filter((v) => Number.isFinite(v))
    .slice(0, MAX_MARKERS)
    .map((v) => Math.max(0, Math.min(maxBin, v)))
  markerDrag = -1
  schedule()
}
/** 删除第 i 个标记 */
function removeMarker(i: number): boolean {
  if (!Number.isInteger(i) || i < 0 || i >= markers.length) return false
  markers.splice(i, 1)
  markerDrag = -1
  schedule()
  return true
}

/** 距给定 bin 最近的标记索引（无标记返回 -1） */
function nearestMarkerIdx(bin: number): number {
  let best = -1
  let bestD = Infinity
  markers.forEach((m, i) => {
    const d = Math.abs(m - bin)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** 标记 → 中心（保持当前窗宽；默认标记 0） */
function markerToCenter(i = 0): boolean {
  const m = markers[i]
  if (m === undefined) return false
  const xr = resolveXRange()
  const span = xr.max - xr.min
  setFrozenX(m - span / 2, m + span / 2)
  commitViewState()
  schedule()
  emitViewportChange(true)
  return true
}

/** 标记 → 参考电平（取活动迹线在标记处的电平；默认标记 0） */
function markerToRef(i = 0): boolean {
  const m = markers[i]
  if (m === undefined) return false
  const data = activeTraceData()
  if (!data) return false
  const b = Math.min(data.length - 1, Math.max(0, Math.round(m)))
  manualRef = data[b]! + activeTraceOffset()
  view.yAuto = false
  schedule()
  emitRefChange(true)
  return true
}
/** 光标处最近 bin 采样（活动迹线）；越出当前数据域返回 null */
function sampleAt(px: number): { bin: number; value: number } | null {
  const data = activeTraceData()
  if (!data || !lastView) return null
  const binF = pxToBin(px)
  const b = Math.round(binF)
  if (b < 0 || b >= data.length) return null
  return { bin: b, value: data[b]! }
}

function updateCursor(evt: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || !lastView) {
    if (cursor !== null) {
      cursor = null
      emit('cursorChange', null)
      schedule()
    }
    if (canvas && canvas.style.cursor) canvas.style.cursor = ''
    return
  }
  const r = canvas.getBoundingClientRect()
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  const { plot } = lastView
  const inside = px >= plot.x && px <= plot.x + plot.w && py >= plot.y && py <= plot.y + plot.h
  const next = inside ? { px, py } : null
  const changed =
    (next === null) !== (cursor === null) ||
    (next !== null && cursor !== null && (next.px !== cursor.px || next.py !== cursor.py))
  const wasNull = cursor === null
  cursor = next
  // 参考电平线热区（手动 dB 模式）：光标提示可拖拽；线本体也只在该热区/拖拽时显示
  const nearRef = next !== null && !view.yAuto && curDbScale && Math.abs(next.py - refLineY()) <= 6
  const cursorCss = nearRef ? 'ns-resize' : ''
  if (canvas.style.cursor !== cursorCss) canvas.style.cursor = cursorCss
  if (changed) {
    const bin = cursor ? Math.round(pxToBin(cursor.px)) : null
    const level = bin === null ? null : levelAtDb(bin)
    if (cursor && bin !== null && level !== null) {
      const b = binHz()
      emit('cursorChange', {
        px: cursor.px,
        py: cursor.py,
        bin,
        freqHz: b ? bin * b : undefined,
        levelDb: level,
        dbScale: curDbScale
      })
    } else if (!wasNull) {
      emit('cursorChange', null)
    }
    schedule()
  }
}

// ── 滚轮：X 缩放（光标锚点）/ Shift：幅度缩放 ──
function onWheel(evt: WheelEvent): void {
  if (!lastView) return
  evt.preventDefault()
  const p = clientToPlot(evt)
  if (!p) return
  const factor = evt.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  if (evt.shiftKey) {
    if (view.yAuto) {
      seedManualFromAuto()
      view.yAuto = false
    }
    if (curDbScale) {
      // 幅度缩放：光标锚定（与 X 轴一致），结果写回 Ref/dB格 手动模型
      const anchor = pyToDataY(p.py)
      const w = zoomYWindow(lastView.yRange.min, lastView.yRange.max, anchor, factor, 2.5, 250)
      manualRef = w.max
      manualDiv = (w.max - w.min) / DIVISIONS
    } else {
      // 线性：纵轴底恒为 0，保持顶部缩放（无法同时保持光标数值与屏位）
      manualRef = Math.min(1e9, Math.max(1e-9, (manualRef > 0 ? manualRef : 1) * factor))
    }
  } else {
    // X 轴缩放：以真实窗口计算（不含显示留白），锚点保持屏上相对位置；
    // 缩放到全带宽时吸附并锁定平移（避免留白参与换算导致永远差一截）
    const anchor = pxToBin(p.px)
    const total = Math.max(1, bufferLen - 1)
    const real = lastXrReal ?? { min: 0, max: total }
    const win = zoomXWindow(real.min, real.max, anchor, factor, total, MIN_SPAN)
    if (win.full) {
      view.fullSpan = true
      view.xMin = 0
      view.xMax = total
      autoRange.resetShrink()
      emitSpanChange()
    } else {
      setFrozenX(win.min, win.max)
    }
  }
  commitViewState()
  schedule()
  emitViewportChange()
  emitRefChange()
}

// ── 拖拽平移 ──
// 按下时快照（X 像素→bin，Y 像素→幅度）；changed 标记本次手势是否产生实际变更（点击不写历史）
interface DragCtx {
  px: number
  py: number
  plotW: number
  plotH: number
  xMin: number
  xMax: number
  xFrac: number
  ySpan: number
  ref: number
  yAuto: boolean
  fullSpan: boolean
  changed: boolean
}
let dragCtx: DragCtx | null = null
// 触摸双指缩放：两指距离变化映射为 X 窗宽，中心保持起始中点
const touchPts = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; span: number; centerBin: number } | null = null
function startPinch(): void {
  if (!lastView || touchPts.size !== 2 || bufferLen <= 0) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const cx = (a.x + b.x) / 2
  pinch = {
    dist,
    span: view.fullSpan
      ? Math.max(MIN_SPAN, bufferLen - 1)
      : Math.max(MIN_SPAN, view.xMax - view.xMin),
    centerBin: pxToBin(cx)
  }
  dragCtx = null
  refDrag = false
  boxSel = null
}
function updatePinch(): void {
  if (!pinch || touchPts.size !== 2 || !lastView || bufferLen <= 0) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const maxSpan = Math.max(MIN_SPAN, bufferLen - 1)
  const span = Math.min(Math.max(MIN_SPAN, (pinch.span * pinch.dist) / dist), maxSpan)
  const lo = Math.min(Math.max(0, pinch.centerBin - span / 2), Math.max(0, maxSpan - span))
  view.fullSpan = false
  view.xMin = lo
  view.xMax = lo + span
  schedule()
}

function onPointerDown(evt: PointerEvent): void {
  if (!lastView || evt.button !== 0) return
  menu.show = false
  if (evt.pointerType === 'touch') {
    ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (touchPts.size === 2) startPinch()
    return
  }
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  if (evt.altKey) {
    const hit = markerHit(p.px)
    if (hit >= 0) {
      markerDrag = hit
      markerMoved = false
      markerDownPx.x = p.px
      markerDownPx.y = p.py
    } else {
      addMarkerAt(pxToBin(p.px))
    }
    schedule()
    return
  }
  if (evt.shiftKey) {
    boxSel = { x0: p.px, y0: p.py, x1: p.px, y1: p.py }
    return
  }
  if (!view.yAuto && curDbScale && Math.abs(refLineY() - p.py) <= 6) {
    refDrag = true
    schedule()
    return
  }
  // 全带宽：X 无平移空间，但仍进入拖拽以支持纵向 Y 平移
  dragCtx = {
    px: p.px,
    py: p.py,
    plotW: lastView.plot.w,
    plotH: lastView.plot.h,
    xMin: lastView.xRange.min,
    xMax: lastView.xRange.max,
    xFrac: lastView.xFrac,
    ySpan: lastView.yRange.max - lastView.yRange.min,
    ref: manualRef,
    yAuto: view.yAuto,
    fullSpan: view.fullSpan,
    changed: false
  }
}

function onPointerMove(evt: PointerEvent): void {
  if (evt.pointerType === 'touch' && touchPts.has(evt.pointerId)) {
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (pinch && touchPts.size === 2) {
      updatePinch()
      return
    }
  }
  updateCursor(evt)
  if (refDrag) {
    const p = clientToPlot(evt)
    if (!p) return
    manualRef = pyToDataY(p.py)
    view.yAuto = false
    schedule()
    return
  }
  if (markerDrag >= 0) {
    const p = clientToPlot(evt)
    if (!p || !lastView) return
    if (!markerMoved && Math.abs(p.px - markerDownPx.x) + Math.abs(p.py - markerDownPx.y) > 4) {
      markerMoved = true
    }
    if (markerMoved && markers[markerDrag] !== undefined) {
      markers[markerDrag] = Math.max(0, Math.min(bufferLen - 1, pxToBin(p.px)))
    }
    schedule()
    return
  }
  if (boxSel) {
    const p = clientToPlot(evt)
    if (!p) return
    boxSel.x1 = p.px
    boxSel.y1 = p.py
    schedule()
    return
  }
  if (!dragCtx) return
  const p = clientToPlot(evt)
  if (!p) return
  const dx = p.px - dragCtx.px
  const dy = p.py - dragCtx.py
  // X 平移（全带宽无平移空间，跳过）
  if (!dragCtx.fullSpan && dx !== 0) {
    const dBin = -(dx * (dragCtx.xMax - dragCtx.xMin)) / dragCtx.plotW
    const rw = unpadX(dragCtx.xMin + dBin, dragCtx.xMax + dBin, dragCtx.xFrac)
    setFrozenX(rw.min, rw.max)
    dragCtx.changed = true
  }
  // Y 平移：纵向 >2px 退出自动量程（按当前显示范围落位手动模型，避免跳变），再按快照平移
  if (dragCtx.yAuto && Math.abs(dy) > 2) {
    seedManualFromAuto()
    dragCtx.ref = manualRef
    dragCtx.yAuto = false
    view.yAuto = false
  }
  if (!dragCtx.yAuto && dy !== 0) {
    const dyData = (dy * dragCtx.ySpan) / dragCtx.plotH
    manualRef = dragCtx.ref + dyData
    if (!curDbScale && manualRef <= 0) manualRef = 1e-9
    dragCtx.changed = true
  }
  schedule()
}

/** 框选放大：宽 ≥8px 缩放频率、高 ≥8px 缩放幅度（扁平/细长框只缩放对应轴，两向都过小才忽略） */
function finishBoxZoom(): void {
  if (!boxSel || !lastView) return
  const { x0, y0, x1, y1 } = boxSel
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  if (dx < 8 && dy < 8) return
  if (dx >= 8) {
    const rw = unpadX(pxToBin(Math.min(x0, x1)), pxToBin(Math.max(x0, x1)), lastView.xFrac)
    setFrozenX(rw.min, rw.max)
  }
  if (dy >= 8) {
    const yHi = pyToDataY(Math.min(y0, y1))
    const yLo = pyToDataY(Math.max(y0, y1))
    if (yHi - yLo > 1e-9) {
      manualRef = yHi
      if (curDbScale) manualDiv = Math.max(0.1, (yHi - yLo) / DIVISIONS)
      view.yAuto = false
    }
  }
  commitViewState()
  emitRefChange(true)
}

function onPointerUp(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (pinch && touchPts.size < 2) {
      pinch = null
      commitViewState()
      emitViewportChange(true)
    }
    return
  }
  if (refDrag) {
    refDrag = false
    commitViewState()
    schedule()
    emitViewportChange(true)
    emitRefChange(true)
    return
  }
  if (markerDrag >= 0) {
    if (!markerMoved) markers.splice(markerDrag, 1)
    markerDrag = -1
    schedule()
    return
  }
  if (boxSel) {
    finishBoxZoom()
    boxSel = null
    schedule()
    emitViewportChange(true)
    return
  }
  if (!dragCtx) return
  const changed = dragCtx.changed
  dragCtx = null
  if (!changed) return
  commitViewState()
  emitViewportChange(true)
  emitRefChange(true)
}

function onPointerCancel(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (touchPts.size < 2) pinch = null
    return
  }
  if (refDrag) refDrag = false
  if (boxSel) boxSel = null
  if (markerDrag >= 0) markerDrag = -1
  dragCtx = null
  schedule()
}

function onPointerEnter(): void {
  hovered = true
}
function onPointerLeave(): void {
  hovered = false
  const canvas = canvasRef.value
  if (canvas && canvas.style.cursor) canvas.style.cursor = ''
  if (cursor !== null) {
    cursor = null
    emit('cursorChange', null)
    schedule()
  }
}

// ── 右键菜单 ──
function onContextMenu(evt: MouseEvent): void {
  evt.preventDefault()
  const root = rootRef.value
  if (!root || !lastView) return
  const rr = root.getBoundingClientRect()
  const px = evt.clientX - rr.left
  const py = evt.clientY - rr.top
  menu.x = Math.min(Math.max(4, px), Math.max(4, rr.width - 175))
  menu.y = Math.min(Math.max(4, py), Math.max(4, rr.height - 170))
  menu.hitIdx = markerHit(px)
  menu.dataX = pxToBin(px)
  emit('contextmenu', { x: px, y: py, dataX: menu.dataX, hitIdx: menu.hitIdx })
  if (props.contextMenu === false) return
  menu.show = true
  schedule()
}

function menuAction(
  act:
    'add' | 'remove' | 'clear' | 'peak' | 'reset' | 'toCenter' | 'toRef' | 'band' | 'noise' | 'acpr'
): void {
  menu.show = false
  if (act === 'add') addMarkerAt(menu.dataX)
  else if (act === 'remove' && menu.hitIdx >= 0) markers.splice(menu.hitIdx, 1)
  else if (act === 'clear') markers = []
  else if (act === 'peak') peakSearch()
  else if (act === 'reset') zoomReset()
  else if (act === 'toCenter') markerToCenter(nearestMarkerIdx(menu.dataX))
  else if (act === 'toRef') markerToRef(nearestMarkerIdx(menu.dataX))
  else if (act === 'band') bandPower()
  else if (act === 'noise') markerNoise(Math.max(0, nearestMarkerIdx(menu.dataX)))
  else if (act === 'acpr') measureACPR()
  schedule()
}

// ── 键盘微调 ──
function onKeyDown(evt: KeyboardEvent): void {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return
  if (!hovered && !focused.value) return
  const t = evt.target as HTMLElement | null
  if (
    t &&
    (t.isContentEditable ||
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT')
  )
    return
  if (evt.key === ' ') {
    // 空格 = 冻结⇆恢复（Run/Stop 习惯）
    evt.preventDefault()
    setPaused(!paused)
    return
  }
  if (evt.key === 'z' || evt.key === 'Z') {
    evt.preventDefault()
    if (evt.shiftKey) redoView()
    else undoView()
    return
  }
  if (!lastView) return
  const xr = resolveXRange()
  const span = xr.max - xr.min
  const commit = (fn: () => void): void => {
    fn()
    commitViewState()
    schedule()
    emitViewportChange(true)
    emitRefChange(true)
  }
  switch (evt.key) {
    case 'ArrowLeft':
      evt.preventDefault()
      commit(() => setFrozenX(xr.min - span * 0.1, xr.max - span * 0.1))
      break
    case 'ArrowRight':
      evt.preventDefault()
      commit(() => setFrozenX(xr.min + span * 0.1, xr.max + span * 0.1))
      break
    case 'ArrowUp':
      evt.preventDefault()
      commit(() => {
        if (view.yAuto) seedManualFromAuto()
        view.yAuto = false
        manualRef += manualDiv
      })
      break
    case 'ArrowDown':
      evt.preventDefault()
      commit(() => {
        if (view.yAuto) seedManualFromAuto()
        view.yAuto = false
        manualRef -= manualDiv
      })
      break
    case '+':
    case '=':
      evt.preventDefault()
      commit(() => {
        const c = (xr.min + xr.max) / 2
        const s2 = Math.max(MIN_SPAN, span / ZOOM_FACTOR)
        setFrozenX(c - s2 / 2, c + s2 / 2)
      })
      break
    case '-':
    case '_':
      evt.preventDefault()
      commit(() => {
        const c = (xr.min + xr.max) / 2
        const s2 = Math.min(Math.max(MIN_SPAN, bufferLen - 1), span * ZOOM_FACTOR)
        setFrozenX(c - s2 / 2, c + s2 / 2)
      })
      break
  }
}

// ── 双击：冻结 ⇆ 恢复（全带宽复位移至右键菜单「复位」）──
function onDblClick(): void {
  setPaused(!paused)
}

// ── 视口复位与通知 ──
function zoomReset(notify = true): void {
  view.fullSpan = true
  view.yAuto = true
  markers = []
  markerDrag = -1
  menu.show = false
  resetYAuto()
  clearViewHistory()
  clearMeasurements()
  schedule()
  emitSpanChange(notify)
  if (notify) emitViewportChange(true)
}

let viewportNotifyTimer: ReturnType<typeof setTimeout> | null = null
function emitViewportChange(immediate = false): void {
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
  if (immediate) {
    doEmitViewportChange()
    return
  }
  viewportNotifyTimer = setTimeout(doEmitViewportChange, 150)
}
function doEmitViewportChange(): void {
  emit('viewportChange', viewInfo())
}

// ── 缩放历史（Z 撤销 / Shift+Z 重做）──
interface ViewState {
  fullSpan: boolean
  xMin: number
  xMax: number
  yAuto: boolean
  ref: number
  div: number
}
const viewHistory: ViewState[] = []
let viewHistoryPos = -1
const VIEW_HISTORY_MAX = 30

function captureView(): ViewState {
  const xr = resolveXRange()
  return {
    fullSpan: view.fullSpan,
    xMin: xr.min,
    xMax: xr.max,
    yAuto: view.yAuto,
    ref: manualRef,
    div: manualDiv
  }
}
function commitViewState(): void {
  viewHistory.length = viewHistoryPos + 1
  viewHistory.push(captureView())
  if (viewHistory.length > VIEW_HISTORY_MAX) viewHistory.shift()
  viewHistoryPos = viewHistory.length - 1
}
function clearViewHistory(): void {
  viewHistory.length = 0
  viewHistoryPos = -1
  commitViewState()
}
function applyViewState(s: ViewState): void {
  view.fullSpan = s.fullSpan
  view.xMin = s.xMin
  view.xMax = s.xMax
  view.yAuto = s.yAuto
  manualRef = s.ref
  manualDiv = s.div
  resetYAuto()
  schedule()
  emitViewportChange(true)
}
function undoView(): void {
  if (viewHistoryPos <= 0) return
  viewHistoryPos--
  applyViewState(viewHistory[viewHistoryPos]!)
}
function redoView(): void {
  if (viewHistoryPos >= viewHistory.length - 1) return
  viewHistoryPos++
  applyViewState(viewHistory[viewHistoryPos]!)
}

// ── 峰值搜索 / 峰值跟踪 ──
function visibleSlice(): { data: Float32Array; s: number; e: number } | null {
  const data = activeTraceData()
  if (!data || bufferLen <= 1) return null
  const xr = resolveXRange()
  const s = Math.max(0, Math.floor(xr.min))
  const e = Math.min(data.length, Math.ceil(xr.max) + 1)
  if (e <= s) return null
  return { data, s, e }
}
/**
 * 测量用切片：功率类测量（OBW/N dB/信道功率/区间功率/ACPR/噪声密度）统一按 dB 计算。
 * 线性显示模式下 trace 里是幅度值，这里先转 dB，避免把线性幅度当 dB 代入 10^(v/10)。
 */
function measureSlice(): { data: Float32Array; s: number; e: number } | null {
  const slice = visibleSlice()
  if (!slice) return null
  if (curDbScale) return slice
  const out = new Float32Array(slice.data.length)
  for (let i = 0; i < out.length; i++) {
    out[i] = 20 * Math.log10(Math.max(slice.data[i] ?? 0, 1e-12))
  }
  return { data: out, s: slice.s, e: slice.e }
}
function peakExcursion(): number {
  return curDbScale ? 6 : 0.1
}
function peakThreshold(): number {
  if (!view.yAuto && lastView) return lastView.yRange.min + (curDbScale ? 3 : 0.02)
  return -Infinity
}
function applyPeakMarker(p: Peak): void {
  if (markers.length === 0) markers.push(p.bin)
  else markers[0] = p.bin
}
function peakSearch(): void {
  const slice = visibleSlice()
  if (!slice) return
  const p = findPeak(slice.data, slice.s, slice.e)
  if (p) applyPeakMarker(p)
  schedule()
}
function searchNextPeak(): void {
  const slice = visibleSlice()
  if (!slice) return
  const th = peakThreshold()
  const peaks = findPeaks(slice.data, slice.s, slice.e, {
    threshold: isFinite(th) ? th : undefined,
    excursion: peakExcursion()
  })
  if (peaks.length === 0) return
  let cur: Peak | null = null
  if (markers.length > 0) {
    const b = Math.round(markers[0]!)
    if (b >= 0 && b < slice.data.length) cur = { bin: b, value: slice.data[b]! }
  }
  const next = cur ? nextPeak(peaks, cur, peakExcursion()) : peaks[0]!
  if (next) applyPeakMarker(next)
  schedule()
}
function refreshPeakTrack(): void {
  const slice = visibleSlice()
  if (!slice) return
  const p = findPeak(slice.data, slice.s, slice.e)
  if (p) applyPeakMarker(p)
}
function clearMarkers(): void {
  markers = []
  markerDrag = -1
  schedule()
}

// ── 峰值表（作用于活动迹线；getPeaks 供宿主导出）──
// 注意：计算与 UI 解耦——getPeaks() 不要求 peakTable 开启，只有绘制由 peakTable 控制
function computePeaks(opts?: SpectrumPeakTableOpts): Peak[] {
  const slice = visibleSlice()
  if (!slice) return []
  const o = opts ?? props.peakTableOpts ?? {}
  const peaks = findPeaks(slice.data, slice.s, slice.e, {
    threshold: o.thresholdDb,
    excursion: o.excursionDb ?? 6
  })
  return peaks.slice(0, Math.max(1, o.count ?? 6))
}
function getPeaks(opts?: SpectrumPeakTableOpts): Peak[] {
  return computePeaks(opts)
}

// ── 频谱测量（OBW / N dB 带宽 / 信道功率；叠加绘制于 drawOverlay）──
// 只存原始值（bin/Hz/dB），文本在绘制时按当前单位/格式化即时生成（切单位/调量程不失效）
interface MeasObw {
  lo: number
  hi: number
  obwHz: number
  totalDb: number
}
interface MeasNdb {
  lo: number
  hi: number
  widthHz: number
  nDb: number
  peakValue: number
}
let measObw: MeasObw | null = null
let measNdb: MeasNdb | null = null
let measChp: number | null = null
/** M1–M2 区间功率/密度 */
let measBand: { lo: number; hi: number; powerDb: number; densityDbPerHz: number } | null = null
/** 噪声标记（读数追加 dBm/Hz） */
let noiseMarkerIdx = -1
/** ACPR 三信道 */
let measAcpr: {
  mainLo: number
  mainHi: number
  lowLo: number
  lowHi: number
  upLo: number
  upHi: number
  mainDb: number
  lowerDb: number
  upperDb: number
} | null = null

function clearMeasurements(): void {
  measObw = null
  measNdb = null
  measChp = null
  measBand = null
  measAcpr = null
  noiseMarkerIdx = -1
  schedule()
}

/**
 * 解析测量区间：显式 bin 区间优先，否则当前可见窗。
 * 返回的 data 始终是活动迹线的全量数据（线性显示时已转 dB），s/e 为待测区间。
 */
function resolveMeasureRange(range?: SpectrumBinRange): {
  data: Float32Array
  s: number
  e: number
} | null {
  const slice = measureSlice()
  if (!slice) return null
  const n = slice.data.length
  if (range && (typeof range.loBin === 'number' || typeof range.hiBin === 'number')) {
    let lo = Math.floor(range.loBin ?? 0)
    let hi = Math.ceil(range.hiBin ?? n - 1)
    lo = Math.min(Math.max(0, lo), n - 1)
    hi = Math.min(Math.max(0, hi), n - 1)
    if (hi < lo) [lo, hi] = [hi, lo]
    return { data: slice.data, s: lo, e: hi + 1 }
  }
  return slice
}

/** 区间功率/密度：显式 lo/hi 优先，否则 M1–M2 标记 */
function bandPower(
  loArg?: number,
  hiArg?: number
): {
  powerDb: number
  densityDbPerHz: number
  fLowHz: number
  fHighHz: number
} | null {
  let lo: number
  let hi: number
  if (typeof loArg === 'number' && typeof hiArg === 'number') {
    lo = Math.min(loArg, hiArg)
    hi = Math.max(loArg, hiArg)
  } else {
    if (markers.length < 2) return null
    lo = Math.min(markers[0]!, markers[1]!)
    hi = Math.max(markers[0]!, markers[1]!)
  }
  const slice = measureSlice()
  const bHz = binHz()
  if (!slice || !bHz) return null
  const maxBin = Math.max(0, slice.data.length - 1)
  lo = Math.min(Math.max(0, Math.floor(lo)), maxBin)
  hi = Math.min(Math.max(lo, Math.ceil(hi)), maxBin)
  const r = bandStats(slice.data, lo, hi + 1, bHz)
  if (!r) return null
  measBand = { lo, hi, powerDb: r.powerDb, densityDbPerHz: r.densityDbPerHz }
  schedule()
  return { ...r, fLowHz: lo * bHz, fHighHz: hi * bHz }
}

/** 噪声标记：在某标记处追加 dB/Hz 读数（默认 M1；线性显示时先转 dB） */
function markerNoise(i = 0): { levelDb: number; densityDbPerHz: number } | null {
  const m = markers[i]
  const data = activeTraceData()
  const bHz = binHz()
  if (m === undefined || !data || !bHz) return null
  const b = Math.min(data.length - 1, Math.max(0, Math.round(m)))
  const raw = data[b] ?? 0
  const levelDb = curDbScale ? raw : 20 * Math.log10(Math.max(raw, 1e-12))
  noiseMarkerIdx = i
  schedule()
  return { levelDb, densityDbPerHz: levelDb - 10 * Math.log10(bHz) }
}

/** ACPR 邻道功率比：主信道以 M1（无标记则峰值）为中心；默认主/邻带宽 = 视窗 span/5 */
function measureACPR(opts: { mainBwHz?: number; adjBwHz?: number } = {}): {
  mainDb: number
  lowerDb: number
  upperDb: number
  acprLowerDb: number
  acprUpperDb: number
} | null {
  const slice = measureSlice()
  const bHz = binHz()
  if (!slice || !bHz) return null
  const spanBins = slice.e - slice.s
  const mainBw = opts.mainBwHz ?? (spanBins * bHz) / 5
  const adjBw = opts.adjBwHz ?? mainBw
  const mainHalf = Math.max(1, Math.round(mainBw / bHz / 2))
  const adjHalf = Math.max(1, Math.round(adjBw / bHz / 2))
  const center =
    markers.length > 0
      ? Math.round(markers[0]!)
      : (findPeak(slice.data, slice.s, slice.e)?.bin ?? Math.round((slice.s + slice.e) / 2))
  const r = acprBands(slice.data, slice.s, slice.e, center, mainHalf, adjHalf)
  if (!r) return null
  measAcpr = {
    mainLo: center - mainHalf,
    mainHi: center + mainHalf,
    // 邻道半带宽 → 全宽 2·adjHalf（与 acprBands 的积分区间一致）
    lowLo: center - mainHalf - 2 * adjHalf,
    lowHi: center - mainHalf - 1,
    upLo: center + mainHalf + 1,
    upHi: center + mainHalf + 2 * adjHalf,
    ...r
  }
  schedule()
  return {
    mainDb: r.mainDb,
    lowerDb: r.lowerDb,
    upperDb: r.upperDb,
    acprLowerDb: r.lowerDb - r.mainDb,
    acprUpperDb: r.upperDb - r.mainDb
  }
}

/** 限制线 → 全 bin 数组（freqHz 优先，无法换算的顶点跳过） */
function limitArrays(): Array<{ arr: Float32Array; type: 'upper' | 'lower' }> {
  const lines = props.limitLines
  const bHz = binHz()
  if (!lines || lines.length === 0 || bufferLen < 1) return []
  const out: Array<{ arr: Float32Array; type: 'upper' | 'lower' }> = []
  for (const line of lines) {
    const pts: Array<{ bin: number; level: number }> = []
    for (const p of line.points) {
      const bin = p.bin ?? (p.freqHz !== undefined && bHz ? p.freqHz / bHz : undefined)
      if (bin === undefined) continue
      pts.push({ bin, level: p.level })
    }
    const arr = buildLimitArray(pts, bufferLen)
    if (arr) out.push({ arr, type: line.type ?? 'upper' })
  }
  return out
}

/** 限制线判定结果（活动迹线 + 当前视窗）：pass/violations/worstMarginDb */
function getLimitResult(): { pass: boolean; violations: number; worstMarginDb: number } | null {
  const slice = visibleSlice()
  if (!slice) return null
  const arrs = limitArrays()
  if (arrs.length === 0) return null
  let pass = true
  let violations = 0
  let worst = Infinity
  for (const { arr, type } of arrs) {
    const r = evaluateLimit(slice.data, slice.s, slice.e, arr, type)
    if (!r) continue
    pass = pass && r.pass
    violations += r.violations
    if (r.worstMarginDb < worst) worst = r.worstMarginDb
  }
  return { pass, violations, worstMarginDb: worst === Infinity ? 0 : worst }
}

function measureOBW(
  pct = 0.99,
  range?: SpectrumBinRange
): { fLowHz: number; fHighHz: number; obwHz: number; totalDb: number } | null {
  const slice = resolveMeasureRange(range)
  const bHz = binHz()
  if (!slice || !bHz) return null
  const r = occupiedBandwidth(slice.data, slice.s, slice.e, pct)
  if (!r) return null
  const obwHz = (r.hiBin - r.loBin) * bHz
  measObw = { lo: r.loBin, hi: r.hiBin, obwHz, totalDb: r.totalDb }
  schedule()
  return { fLowHz: r.loBin * bHz, fHighHz: r.hiBin * bHz, obwHz, totalDb: r.totalDb }
}

function measureNdB(
  nDb = 3,
  opts: { smooth?: number; hold?: number; loBin?: number; hiBin?: number } = {
    smooth: 3,
    hold: 3
  }
): { fLowHz: number; fHighHz: number; widthHz: number; centerHz: number } | null {
  const slice = resolveMeasureRange({ loBin: opts.loBin, hiBin: opts.hiBin })
  const bHz = binHz()
  if (!slice || !bHz) return null
  const r = ndbBandwidth(slice.data, slice.s, slice.e, nDb, {
    smooth: opts.smooth ?? 3,
    hold: opts.hold ?? 3
  })
  if (!r) return null
  const widthHz = (r.hiBin - r.loBin) * bHz
  measNdb = { lo: r.loBin, hi: r.hiBin, widthHz, nDb, peakValue: r.peakValue }
  schedule()
  return { fLowHz: r.loBin * bHz, fHighHz: r.hiBin * bHz, widthHz, centerHz: r.peakBin * bHz }
}

function measureChannelPower(range?: SpectrumBinRange): { powerDb: number } | null {
  const slice = resolveMeasureRange(range)
  if (!slice) return null
  const p = channelPowerDb(slice.data, slice.s, slice.e)
  if (p === null) return null
  measChp = p
  schedule()
  return { powerDb: p }
}

/** 当前可见窗口活动迹线数据（拷贝；原始 dB/线性域） */
function getVisibleData(): SpectrumVisibleData | null {
  const slice = visibleSlice()
  if (!slice) return null
  return { data: slice.data.slice(slice.s, slice.e), startBin: slice.s, endBin: slice.e - 1 }
}

/** 运行统计（宿主诊断/性能面板） */
function getStats(): SpectrumStats {
  return {
    bins: bufferLen,
    fftSize: curFftSize,
    sampleRate: curSampleRate,
    dbScale: curDbScale,
    paused,
    traceCount: traceInsts.value.length,
    markerCount: markers.length
  }
}

// ── 导出 ──
function compositeCanvas(): HTMLCanvasElement {
  draw()
  const glC = canvasRef.value
  const ov = overlayRef.value
  const out = document.createElement('canvas')
  if (!glC || !ov) return out
  out.width = glC.width
  out.height = glC.height
  const ctx = out.getContext('2d')
  if (!ctx) return out
  // 按输出尺寸显式缩放两层：backing 尺寸一致时等价 1:1；漂移时仍保证完整对齐
  ctx.drawImage(glC, 0, 0, out.width, out.height)
  ctx.drawImage(ov, 0, 0, out.width, out.height)
  return out
}

function pngFilename(): string {
  return `spectrum-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
}
function exportPNG(): void {
  deliverExport({
    kind: 'png',
    filename: pngFilename(),
    dataUrl: compositeCanvas().toDataURL('image/png')
  })
}

/** 异步 PNG 导出：toBlob 不阻塞主线程，宿主 exportHandler 可直接持久化 blob */
async function exportPNGAsync(): Promise<void> {
  const filename = pngFilename()
  const out = compositeCanvas()
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) {
    reportError('export', tr('common.pngEncodeFailed'))
    return
  }
  deliverExport({ kind: 'png', filename, blob })
}

function exportCSV(opts?: { allTraces?: boolean }): void {
  const slice = visibleSlice()
  if (!slice) return
  const { data, s, e } = slice
  const bHz = binHz()
  const parts: string[] = []
  if (opts?.allTraces) {
    const cols = traceInsts.value.filter((t) => t.enabled && !t.math && t.buf.get())
    // 关键：每个迹线的 get() 只取一次。average 模式 get() 会新建整条 Float32Array，
    // 旧实现把它放在行循环里 → O(rows × traces × bins) 次分配，大 FFT 导出会卡死
    const colsData = cols.map((t) => t.buf.get()!)
    const names = cols.map((t, ci) => `t${ci + 1}_${t.mode}`)
    parts.push(`${bHz ? 'freq_hz' : 'bin'},${names.join(',')}`)
    for (let i = s; i < e; i++) {
      const row = [bHz ? (i * bHz).toFixed(6) : String(i)]
      for (const d of colsData) row.push(d[i] !== undefined ? String(d[i]) : '')
      parts.push(row.join(','))
    }
  } else {
    parts.push(bHz ? 'freq_hz,level' : 'bin,level')
    for (let i = s; i < e; i++) {
      parts.push(bHz ? `${(i * bHz).toFixed(6)},${data[i]}` : `${i},${data[i]}`)
    }
  }
  const filename = `spectrum-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  deliverExport({ kind: 'csv', filename, text: parts.join('\n') })
}

function deliverExport(p: ExportPayload): void {
  const handler = props.exportHandler
  if (handler) {
    Promise.resolve(handler(p)).catch((e: unknown) =>
      reportError('export', e instanceof Error ? e.message : String(e))
    )
  } else {
    const a = document.createElement('a')
    if (p.kind === 'png') {
      if (p.dataUrl) {
        a.href = p.dataUrl
      } else if (p.blob) {
        a.href = URL.createObjectURL(p.blob)
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      } else {
        reportError('export', tr('common.pngMissing'))
        return
      }
    } else {
      const blob = new Blob([p.text ?? ''], { type: 'text/csv;charset=utf-8' })
      a.href = URL.createObjectURL(blob)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    a.download = p.filename
    a.click()
  }
  emit('exported', { kind: p.kind, filename: p.filename })
}

// ── 迹线内存（参考线）──
/** 活动迹线快照存入内存并显示 */
function saveTraceToMemory(): boolean {
  const d = activeTraceData()
  if (!d) return false
  memoryTrace = d.slice()
  memoryOn.value = true
  schedule()
  return true
}
/** 显示/隐藏内存迹线 */
function showMemory(v: boolean): void {
  memoryOn.value = v
  schedule()
}
/** 清除内存迹线 */
function clearMemory(): void {
  memoryTrace = null
  memoryOn.value = false
  schedule()
}

// ── 视图信息 ──
function viewInfo(): SpectrumViewInfo {
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : manualRange()
  const bHz = binHz()
  const info: SpectrumViewInfo = {
    xMin: xr.min,
    xMax: xr.max,
    yMin: yr.min,
    yMax: yr.max,
    yAuto: view.yAuto
  }
  if (bHz) {
    info.freqMin = xr.min * bHz
    info.freqMax = xr.max * bHz
    info.centerHz = ((xr.min + xr.max) / 2) * bHz
    info.spanHz = (xr.max - xr.min) * bHz
  }
  return info
}

function setViewport(v: Partial<NonNullable<SpectrumProps['viewport']>>): void {
  applyExternalViewport(v as NonNullable<SpectrumProps['viewport']>)
}

// ── 生命周期 ──
function setupRenderers(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  if (gl) {
    renderer = createLineRenderer(canvas, gl)
    fadeRenderer = createFadeRenderer(gl)
    blitRenderer = createBlitRenderer(gl)
  } else if (ctx2d) {
    renderer = createCanvasLineRenderer(canvas)
    fadeRenderer = null
    blitRenderer = null
  }
  needsRestore = false
}

function drawUnsupported(msg: string): void {
  const ov = overlayRef.value
  if (!ov) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  const rect = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, rect.width)
  const sy = ov.height / Math.max(1, rect.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.font = '13px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = th.value.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(msg, rect.width / 2, rect.height / 2)
}

function onContextLost(evt: Event): void {
  evt.preventDefault()
  contextLost = true
  emit('contextLost')
}

function onContextRestored(): void {
  contextLost = false
  setupRenderers()
  emit('contextRestored')
  schedule()
}

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: (w, h) => {
    const ov = overlayRef.value
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w
      ov.height = h
    }
    if (!gl && !ctx2d) {
      drawUnsupported(tr('spectrum.webglUnsupported'))
      return
    }
    if (persistSnapshot) needsRestore = true
  },
  onDraw: schedule
})
glChartResize = glChart.resize

onMounted(async () => {
  await nextTick()
  window.addEventListener('keydown', onKeyDown)
  const canvas = canvasRef.value
  if (!canvas) return
  const backend = props.renderer ?? 'auto'
  // preserveDrawingBuffer：余辉淡出/合成快照需要保留绘图缓冲；无余辉需求可传 false 降低拷贝开销
  if (backend !== 'canvas2d') {
    gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: props.preserveDrawingBuffer !== false
    }) as WebGL2RenderingContext | null
  }
  if (!gl && backend !== 'webgl2') {
    ctx2d = canvas.getContext('2d')
  }
  if (!gl && !ctx2d) {
    reportError('webgl', tr('spectrum.webglUnsupported'))
    drawUnsupported(tr('spectrum.webglUnsupported'))
    return
  }
  if (gl) {
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
  }
  setupRenderers()
  clearViewHistory() // 建立初始视口基线（Z 撤销可回到初始全带宽）
  updateMeta()
  if (props.data !== undefined) setData(props.data)
  draw()
  emit('ready')
  // 离屏暂停：不可见时不再触发重绘（数据仍入缓冲），重新可见时补一帧
  if (typeof IntersectionObserver !== 'undefined' && rootRef.value) {
    io = new IntersectionObserver(
      (entries) => {
        const next = entries[entries.length - 1]?.isIntersecting ?? true
        if (next === visible) return
        visible = next
        if (visible) schedule()
      },
      { threshold: 0 }
    )
    io.observe(rootRef.value)
  }
})

let cleanupDone = false
/** 释放监听/渲染器/rAF（宿主手动销毁时也可调用；重复调用幂等） */
function dispose(): void {
  if (cleanupDone) return
  cleanupDone = true
  disposed = true
  io?.disconnect()
  io = null
  touchPts.clear()
  pinch = null
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
  const canvas = canvasRef.value
  canvas?.removeEventListener('webglcontextlost', onContextLost)
  canvas?.removeEventListener('webglcontextrestored', onContextRestored)
  renderer?.dispose()
  fadeRenderer?.dispose()
  blitRenderer?.dispose()
  renderer = null
  fadeRenderer = null
  blitRenderer = null
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
  if (refNotifyTimer) {
    clearTimeout(refNotifyTimer)
    refNotifyTimer = null
  }
}
onUnmounted(dispose)

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)

defineExpose({
  appendData,
  setData,
  setMeta,
  clear,
  resetTraces,
  setPaused,
  setViewport,
  getView: viewInfo,
  getMeta: metaInfo,
  zoomReset,
  peakSearch,
  nextPeak: searchNextPeak,
  clearMarkers,
  addMarker,
  setMarkers,
  removeMarker,
  getPeaks,
  getMarkers: () => markers.slice(),
  getVisibleData,
  getStats,
  setActiveTrace,
  markerToCenter,
  markerToRef,
  bandPower,
  markerNoise,
  measureOBW,
  measureNdB,
  measureChannelPower,
  measureACPR,
  clearMeasurements,
  getLimitResult,
  saveTraceToMemory,
  showMemory,
  clearMemory,
  exportPNG,
  exportPNGAsync,
  exportCSV,
  resize: () => {
    glChartResize?.()
    schedule()
  },
  redraw: () => schedule(),
  dispose
})
</script>

<template>
  <div
    ref="rootRef"
    class="sig-spectrum"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    tabindex="0"
    role="application"
    :aria-label="props.labels?.aria ?? tr('spectrum.aria')"
    :style="{
      width: cssSize(props.width, '100%'),
      height: cssSize(props.height, '260px'),
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg,
      '--sig-text': th.text,
      '--sig-border': th.border
    }"
    @focus="focused = true"
    @blur="focused = false"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @contextmenu.prevent="onContextMenu"
    @dblclick="onDblClick"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <!-- 宿主自定义叠加层（标注/告警框等） -->
    <div class="sig-host-overlay"><slot name="overlay" /></div>
    <div v-if="legendShown" class="sig-legend">
      <div
        v-for="(t, i) in traceLegend"
        :key="i"
        class="sig-legend-item"
        :class="{ 'is-off': !t.enabled, 'is-active': t.active }"
        :title="t.active ? tr('spectrum.legendActiveTitle') : tr('spectrum.legendInactiveTitle')"
        @click="toggleTrace(i, $event)"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-legend-swatch" :style="{ background: t.color }" />
        <span>{{ t.label }}</span>
      </div>
    </div>
    <div
      v-if="pausedUi"
      class="sig-frozen-badge"
      :style="{ top: legendShown ? '30px' : '8px' }"
      :title="tr('spectrum.pausedTitle')"
      @click="setPaused(false)"
      @pointerdown.stop
      @dblclick.stop
    >
      {{ props.labels?.paused ?? tr('spectrum.paused') }}
    </div>
    <div
      v-if="dataStale"
      class="sig-stale-badge"
      :style="{ top: legendShown ? '32px' : '8px' }"
      :title="tr('common.staleTitle')"
    >
      {{ props.labels?.stale ?? tr('common.stale') }}
    </div>
    <div
      v-if="menu.show"
      class="sig-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <div class="sig-menu-item" @click.stop="menuAction('add')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrum.menuAdd') }}
      </div>
      <div
        v-if="menu.hitIdx >= 0"
        class="sig-menu-item"
        @click.stop="menuAction('remove')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('spectrum.menuRemove') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('clear')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrum.menuClear') }}
      </div>
      <div class="sig-menu-sep" />
      <div class="sig-menu-item" @click.stop="menuAction('peak')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrum.menuPeak') }}
      </div>
      <div
        v-if="markers.length > 0"
        class="sig-menu-item"
        @click.stop="menuAction('toCenter')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('spectrum.menuToCenter') }}
      </div>
      <div
        v-if="markers.length > 0"
        class="sig-menu-item"
        @click.stop="menuAction('toRef')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('spectrum.menuToRef') }}
      </div>
      <div
        v-if="markers.length >= 2"
        class="sig-menu-item"
        @click.stop="menuAction('band')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('spectrum.menuBand') }}
      </div>
      <div
        v-if="markers.length > 0"
        class="sig-menu-item"
        @click.stop="menuAction('noise')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('spectrum.menuNoise') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('acpr')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrum.menuAcpr') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('reset')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrum.menuReset') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sig-spectrum {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--sig-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sig-bg, #fff);
  user-select: none;
  touch-action: none;
}
.sig-spectrum:focus-visible {
  outline: 1px solid var(--sig-border);
  outline-offset: -1px;
}
.sig-dark {
  --sig-bg: #0f1115;
  --sig-border: #2a2e39;
  --sig-text: #c9d1d9;
}
.sig-light {
  --sig-bg: #ffffff;
  --sig-border: #e6e8eb;
  --sig-text: #1f2328;
}
.sig-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.sig-overlay {
  position: absolute;
  inset: 0;
  /* canvas 为 replaced element：absolute+inset:0 不会拉伸它；显式 100% 才能与 GL 画布同盒 */
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.sig-host-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.sig-frozen-badge {
  position: absolute;
  left: 10px;
  top: 8px;
  font-size: 11px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  cursor: pointer;
  z-index: 2;
}
.sig-legend {
  position: absolute;
  /* 顶部居中：不再压住左上角 Ref/Scale 参数栏与竖排轴标题 */
  left: 50%;
  top: 6px;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  z-index: 2;
  font-size: 11px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 72%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  user-select: none;
  white-space: nowrap;
}
.sig-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.sig-legend-item.is-off {
  opacity: 0.4;
}
.sig-legend-item.is-active {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sig-legend-swatch {
  display: inline-block;
  width: 10px;
  height: 3px;
  border-radius: 2px;
}
.sig-stale-badge {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  font-size: 11px;
  color: #f08c00;
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  z-index: 2;
  pointer-events: none;
}
.sig-menu {
  position: absolute;
  z-index: 5;
  min-width: 150px;
  padding: 4px 0;
  background: color-mix(in srgb, var(--sig-bg) 96%, transparent);
  border: 1px solid var(--sig-border);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  font-size: 12px;
  color: var(--sig-text);
  user-select: none;
}
.sig-menu-item {
  padding: 5px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.sig-menu-item:hover {
  background: color-mix(in srgb, var(--sig-border) 40%, transparent);
}
.sig-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--sig-border);
}
</style>
