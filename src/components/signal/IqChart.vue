<script setup lang="ts">
/**
 * IqChart（可复制，零依赖，自带主题，高性能）
 * 复用：拷本文件 + core/* + composables/useGlChart.ts 到他项目即可
 * 数据：经 adapter 自转 RawInput → IqNormalized（见 core/adapters.ts）
 * 渲染：WebGL2 折线 + Canvas2D 轴层覆盖，主线程仅 rAF
 * 交互：滚轮=X 轴缩放（光标锚点）· Shift+滚轮=Y 轴缩放 · 拖拽=平移 · 双击/角标=复位跟随
 * 外观：theme 预置（light/dark/auto/spectrum 频谱仪黑底黄迹）+ style 字段级覆盖
 */
import { ref, reactive, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
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
import { iqAdapters } from './core/adapters'
import {
  drawAxisOverlay,
  drawChip,
  drawPanel,
  niceTicks,
  niceStep,
  CHIP_H,
  type PlotRect
} from './core/axis'
import { MinMaxPyramid, type RangeStats } from './core/pyramid'
import { YAutoScaler } from './core/yauto'
import { resolveTheme } from './core/theme'
import type { ExportPayload, IqProps, IqNormalized, IqViewInfo, Theme } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<IqProps>(), {
  theme: 'auto' as Theme,
  decimation: 'minmax',
  fpsLimit: 60,
  mode: 'line',
  lineWidth: 1,
  span: 4096,
  viewport: undefined,
  adapter: undefined,
  data: undefined,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'viewportChange', v: IqViewInfo): void
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'update:span', span: number): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let rendererQ: LineRenderer | null = null
let rendererEnv: LineRenderer | null = null
let fadeRenderer: FadeRenderer | null = null
let blitRenderer: BlitRenderer | null = null
// 余辉渐隐过渡：视口变化（缩放/平移）时旧余辉按此步数平滑淡出（约 0.2s），避免生硬瞬间清屏。
// 旧拖影与旧视口绑定，新映射下必然错位——淡出后由新视口数据重绘
const FADE_OUT_STEPS = 12
const FADE_OUT_ALPHA = 0.25
let fadeOutFrames = 0
// 冻结态 GL 缓冲快照：画布被重建（窗口尺寸变化，如按 Alt 弹出菜单栏）后贴图回填，
// 余辉像素不会随 canvas.width 重置而丢失
let persistSnapshot: HTMLCanvasElement | null = null
let needsRestore = false

// ── 数据流中断反馈（跟随态下超过阈值无新数据 → 顶部角标提示）──
const DATA_STALE_MS = 3000
let lastDataAt = 0 // 最近一次实际接收数据的时间戳（performance.now）
const dataStale = ref(false)
// 单 canvas 双 program 也可，此处双 renderer 简化（Q 用第二 canvas 叠加或同一 GL 分两 draw）
// 为拷贝轻量：复用同一 canvas，绘制 I 后再绘制 Q（同一 GL 上下文分两次 draw）
let gl: WebGL2RenderingContext | null = null

// 主题解析：style 覆盖 > colors 迹线对 > 预置；spectrum 为固定观感不随系统切换
const prefersDark = computed(
  () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
)
const th = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { colors: props.colors, style: props.style })
)

// ── 布局常量（CSS px）──
const GUTTER_BOTTOM = 20 // 底部 X 刻度槽；左侧刻度带宽由主题 axisWidth 提供（默认 56）
const PAD_X = 24 // 波形左右内缩留白：避免满幅波形的左/右边缘贴住绘图区形成「信号墙」
const MIN_SPAN = 16 // 最小可见样本数
const DEFAULT_SPAN = 4096 // follow 模式默认窗宽（须明显大于单帧点数）
const ZOOM_FACTOR = 1.2 // 每次滚轮缩放系数

// ── 数据缓冲（线性增长 + 环形丢老，保留最近 MAX_POINTS）──
const MAX_POINTS = 2_000_000
let iBuf = new Float32Array(0)
let qBuf = new Float32Array(0)
let dataLen = 0
// 已丢弃的最老样本数：绝对索引 = dropped + 缓冲下标。
// 视口用绝对索引表达，冻结视图不受环形丢数据影响
let dropped = 0
// 极值金字塔：区间极值/按桶抽稀 O(块数) 替代每帧全量扫描；结构变化后需整树重建
const pyr = new MinMaxPyramid(MAX_POINTS)
let pyrDirty = true
function totalAbs(): number {
  return dropped + dataLen
}

function ensureCapacity(n: number): void {
  if (iBuf.length >= n) return
  const next = Math.min(MAX_POINTS, Math.max(n, iBuf.length ? iBuf.length * 2 : 4096))
  const ni = new Float32Array(next)
  const nq = new Float32Array(next)
  ni.set(iBuf.subarray(0, dataLen))
  nq.set(qBuf.subarray(0, dataLen))
  iBuf = ni
  qBuf = nq
  pyrDirty = true // 数据拷贝到新缓冲，金字塔需重建
}

/** 环形丢老：保留最近 keep 条，累计 dropped；数据搬移后需重建金字塔 */
function compact(keep: number): void {
  dropped += dataLen - keep
  iBuf.copyWithin(0, dataLen - keep, dataLen)
  qBuf.copyWithin(0, dataLen - keep, dataLen)
  dataLen = keep
  pyrDirty = true
}

function normalize(raw: unknown): IqNormalized | null {
  const fn = props.adapter ?? iqAdapters.passthrough
  try {
    const v = fn(raw)
    if (!v) {
      // 尝试兜底：多适配器
      const fallback =
        iqAdapters.jsonInterleaved(raw) ?? iqAdapters.arrayBuffer(raw) ?? iqAdapters.base64(raw)
      return fallback
    }
    return v
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e))
    return null
  }
}

function pushNormalized(n: IqNormalized): void {
  // 完全暂停：冻结（非跟随）期间在入口丢弃新帧——
  // 缓冲零增长、环形淘汰永不发生，冻结窗内容像素级静止；恢复跟随（zoomReset）后自动继续接收
  if (!view.follow) return
  const prevLen = dataLen
  if (n instanceof Float32Array) {
    // 交织 [I0,Q0,I1,Q1...]
    const pairs = Math.floor(n.length / 2)
    ensureCapacity(dataLen + pairs)
    for (let k = 0; k < pairs; k++) {
      if (dataLen >= MAX_POINTS) compact(Math.floor(MAX_POINTS * 0.9))
      iBuf[dataLen] = n[2 * k]
      qBuf[dataLen] = n[2 * k + 1]
      dataLen++
    }
  } else {
    const len = Math.min(n.i.length, n.q.length)
    ensureCapacity(dataLen + len)
    for (let k = 0; k < len; k++) {
      if (dataLen >= MAX_POINTS) compact(Math.floor(MAX_POINTS * 0.9))
      iBuf[dataLen] = n.i[k]
      qBuf[dataLen] = n.q[k]
      dataLen++
    }
  }
  // 维护金字塔：结构变化（扩容/淘汰）整树重建，否则增量更新受影响块
  if (pyrDirty) {
    pyr.rebuild(iBuf, qBuf, dataLen)
    pyrDirty = false
  } else {
    pyr.appendRange(iBuf, qBuf, prevLen, dataLen)
  }
  lastDataAt = performance.now() // 实际入缓冲才刷新（暂停态丢弃的帧不计）
  schedule()
}

// ── 视口状态机 ──
// follow=true：窗口吸附最新数据；任何缩放/平移后 follow=false（冻结），数据从视图下方流过
const view = reactive({
  follow: true,
  span: Math.max(MIN_SPAN, props.span), // 当前窗宽（样本数），follow 与缩放共用；初值/复位取 props.span
  xMin: 0, // 冻结时的绝对索引范围
  xMax: DEFAULT_SPAN,
  yAuto: true,
  yMin: -1,
  yMax: 1
})

// 调用方运行时修改窗宽：跟随状态下立即生效并重绘
watch(
  () => props.span,
  (v) => {
    if (v === undefined) return
    view.span = Math.max(MIN_SPAN, v)
    if (view.follow) schedule()
  }
)

// 迹线可见性：点击图例切换；隐藏的通道不参与绘制与 Y 轴自适应统计
const traceVisible = reactive({ i: true, q: true, env: true })

function applyExternalViewport(v: NonNullable<IqProps['viewport']>): void {
  if (v.autoScale !== undefined) {
    // 外部切回自动缩放时丢弃旧平滑状态，避免从历史范围缓慢滑入
    if (v.autoScale && !view.yAuto) resetYAuto()
    view.yAuto = v.autoScale
  }
  if (v.yMin !== undefined) view.yMin = v.yMin
  if (v.yMax !== undefined) view.yMax = v.yMax
  if (v.xMin !== undefined && v.xMax !== undefined && v.xMax > v.xMin) {
    view.xMin = v.xMin
    view.xMax = v.xMax
    view.span = Math.max(MIN_SPAN, v.xMax - v.xMin)
    view.follow = false
  }
  schedule()
}
watch(
  () => props.viewport,
  (v) => {
    if (v) applyExternalViewport(v)
  },
  { immediate: true, deep: true }
)

// 外观配置变化：重绘（静态数据下也能立即看到切换效果）
watch([() => props.theme, () => props.style], () => schedule(), { deep: true })
// 余辉强度变化：立即重绘（暂停态下拖滑块也能实时看到拖影变化）
watch(
  () => props.persistence,
  () => schedule()
)

/** 冻结 X 视口并钳制到可保留范围 [dropped, total]，保持窗宽 */
function setFrozenX(min: number, max: number): void {
  const total = totalAbs()
  const span = Math.max(MIN_SPAN, max - min)
  min = Math.min(Math.max(min, dropped), Math.max(dropped, total - span))
  view.follow = false
  view.span = span
  view.xMin = min
  view.xMax = min + span
  emitSpanChange()
}

let spanNotifyTimer: ReturnType<typeof setTimeout> | null = null
/** 窗宽变化反馈（v-model:span 双向）：节流上报当前视口窗宽 */
function emitSpanChange(immediate = false): void {
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
  const send = (): void => {
    spanNotifyTimer = null
    emit('update:span', Math.max(MIN_SPAN, Math.round(view.span)))
  }
  if (immediate) send()
  else spanNotifyTimer = setTimeout(send, 150)
}

function resolveXRange(): { min: number; max: number } {
  const total = totalAbs()
  if (view.follow) {
    const span = Math.min(view.span, Math.max(MIN_SPAN, total))
    return { min: Math.max(dropped, total - span), max: total }
  }
  let min = Math.max(dropped, view.xMin)
  let max = Math.min(total, view.xMax)
  if (max - min < MIN_SPAN) min = Math.max(dropped, max - MIN_SPAN)
  if (max <= min) {
    // 环形淘汰已吞掉冻结窗：锚定最老可用数据，保持「已暂停」语义（绝不自动跳回最新）
    // 后续每次淘汰会让该窗口随淘汰前沿步进——有限历史下的必然，但永不恢复实时跟随
    const span = Math.max(MIN_SPAN, Math.min(view.span, total - dropped))
    min = dropped
    max = Math.min(total, dropped + span)
  }
  return { min, max }
}

// ── 自动 Y 轴平滑（即时扩张 / 慢速收缩）──
// 流式数据下逐帧精确自适应会导致刻度值与网格行每帧跳动；见 core/yauto.ts
const yAuto = new YAutoScaler()

/** 可见窗口真实极值（尊重图例显隐通道）；无效返回 null */
function computeVisibleMM(s: number, e: number): { min: number; max: number } | null {
  if (e <= s) return null
  const mm = pyr.query(iBuf, qBuf, s, e)
  if (!mm) return null
  let mn = Infinity
  let mx = -Infinity
  if (traceVisible.i) {
    if (mm.minI < mn) mn = mm.minI
    if (mm.maxI > mx) mx = mm.maxI
  }
  if (traceVisible.q) {
    if (mm.minQ < mn) mn = mm.minQ
    if (mm.maxQ > mx) mx = mm.maxQ
  }
  if (traceVisible.env) {
    if (mm.envMin < mn) mn = mm.envMin
    if (mm.envMax > mx) mx = mm.envMax
  }
  if (!isFinite(mn)) return null
  return { min: mn, max: mx }
}

/** 重置自动 Y 轴平滑状态（清空数据/切换 yAuto 等），下一帧直接吸附目标 */
function resetYAuto(): void {
  yAuto.reset()
}

function resolveYRange(s: number, e: number): { min: number; max: number } {
  if (!view.yAuto) return { min: view.yMin, max: view.yMax }
  const mm = computeVisibleMM(s, e)
  if (!mm) return { min: -1, max: 1 }
  return yAuto.resolve(mm.min, mm.max)
}

// 绘图区（CSS px）：左侧固定刻度带 + 底部 X 刻度槽；Y 芯片+竖直轴线钉在组件最左，与绘图区间留空隙
function computePlot(canvas: HTMLCanvasElement): PlotRect {
  const dpr = window.devicePixelRatio || 1
  const wCss = canvas.width / dpr
  const hCss = canvas.height / dpr
  if (!props.axis) return { x: 0, y: 0, w: wCss, h: hCss }
  // 左带固定宽度不随数据变化 → 无逐帧抖动；波形与刻度区彻底分离
  return {
    x: th.value.axisWidth,
    y: 0,
    w: Math.max(1, wCss - th.value.axisWidth),
    h: Math.max(1, hCss - GUTTER_BOTTOM)
  }
}

// 上一帧视口缓存：交互时光标坐标 ↔ 数据坐标换算依据。
// xRange 为「显示域」：真实窗口两侧外扩 xFrac 比例后的范围（与屏幕波形一一对应）
let lastView: {
  xRange: { min: number; max: number }
  yRange: { min: number; max: number }
  plot: PlotRect
  /** 波形水平留白比例（每侧），显示域 ↔ 真实窗口换算用 */
  xFrac: number
  /** 当前帧缓冲切片 [s,e)（缓冲下标），供十字光标采样读数 */
  slice: { s: number; e: number }
} | null = null
// 上一帧真实窗口（不带留白外扩）；供余辉「视口是否变化」判断（与显示域 lastView.xRange 区分）
let lastXrReal: { min: number; max: number } | null = null

// 十字光标状态：绘图区内悬停位置；null=不显示
let cursor: { px: number; py: number } | null = null

// Shift+拖拽框选状态：像素坐标矩形；null=未框选
let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null

// ── 测量标记 ──
// Alt+点击空白：添加标记；Alt+点击标记：清除该标记（按下无拖动判定）；Alt+按住标记拖拽：微调位置。
// 右键菜单：在此处标记 / 清除该标记 / 清除全部标记 / 暂停-恢复刷新。
// 刷新（跟随）状态下不允许标记与拖拽平移，仅滚轮/框选缩放（缩放即进入暂停态）。
// 标记锚定绝对样本索引（缩放/平移保持数据位置），clear/恢复刷新时清空
let markers: number[] = []
let markerDrag = -1 // 正在拖拽的标记下标；-1=无
let markerMoved = false // 拖拽位移超阈值（区分「点击清除」与「拖拽微调」）
const markerDownPx = { x: 0, y: 0 }
const MARKER_HIT_PX = 6

// 右键菜单状态
const menu = reactive({ show: false, x: 0, y: 0, hitIdx: -1, dataX: 0 })

/** 标记绝对索引 → 当前显示域像素 x */
function markerPx(c: number): number {
  if (!lastView) return Number.NaN
  const { plot, xRange } = lastView
  return plot.x + ((c - xRange.min) / (xRange.max - xRange.min)) * plot.w
}
/** 命中检测：返回像素 x 处命中的标记下标；-1=未命中 */
function markerHit(px: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const mx = markerPx(markers[i]!)
    if (lastView && Math.abs(mx - px) <= MARKER_HIT_PX) return i
  }
  return -1
}
/** 添加标记（刷新状态下禁止）；位置取整到采样点 */
function addMarkerAt(dispX: number): void {
  if (view.follow) return
  markers.push(Math.round(dispX))
  schedule()
}

/** 右键菜单：按点击位置与命中状态构建动作集 */
function onContextMenu(evt: MouseEvent): void {
  evt.preventDefault()
  const root = rootRef.value
  if (!root || !lastView) return
  const rr = root.getBoundingClientRect()
  const px = evt.clientX - rr.left
  const py = evt.clientY - rr.top
  menu.x = Math.min(Math.max(4, px), Math.max(4, rr.width - 175))
  menu.y = Math.min(Math.max(4, py), Math.max(4, rr.height - 150))
  menu.hitIdx = markerHit(px)
  menu.dataX = pxToDataX(px)
  menu.show = true
  schedule()
}

function menuAction(act: 'add' | 'remove' | 'clear' | 'toggle'): void {
  menu.show = false
  if (act === 'add') {
    addMarkerAt(menu.dataX)
  } else if (act === 'remove' && menu.hitIdx >= 0) {
    markers.splice(menu.hitIdx, 1)
  } else if (act === 'clear') {
    markers = []
  } else if (act === 'toggle') {
    onDblClick()
  }
  schedule()
}

let raf = 0
function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !gl || !renderer) return
  const xr = resolveXRange()
  // 绝对索引 → 缓冲下标
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = Math.max(0, e - s)
  // 先解析最终 Y 范围（决定网格/零线与刻度芯片位置）
  const yr = len > 0 ? resolveYRange(s, e) : { min: -1, max: 1 }
  const plot = computePlot(canvas)
  // 背景（全画布；先关 scissor；颜色由主题 bg 驱动）。
  // 余辉语义：
  // - 流式跟随：每帧淡出合成（旧迹线逐帧衰减、持续累积）
  // - 暂停且视口未变：不淡出不清理 → 绘图缓冲冻结，余辉停留在暂停瞬间（不随重绘衰减）
  // - 暂停后缩放/平移（视口已变）：旧内容与新视口错位 → 清屏重绘
  gl.disable(gl.SCISSOR_TEST)
  const bgRgb = hexToRgba(th.value.bg)
  const persist = Math.min(0.95, Math.max(0, props.persistence ?? 0))
  const fading = persist > 0 && fadeRenderer !== null
  // 画布被重建（窗口尺寸变化等）后：先用冻结态快照回填，余辉像素不丢失
  if (needsRestore && persistSnapshot && blitRenderer) {
    blitRenderer.draw(persistSnapshot)
    needsRestore = false
  }
  // 视口比较用「真实窗」与「上一帧真实窗」（lastView.xRange 是带留白外扩的显示域，不可直接比较）
  const viewChanged =
    !lastView ||
    !lastXrReal ||
    xr.min !== lastXrReal.min ||
    xr.max !== lastXrReal.max ||
    yr.min !== lastView.yRange.min ||
    yr.max !== lastView.yRange.max
  lastXrReal = { min: xr.min, max: xr.max }
  const fade = (a: number): void => fadeRenderer!.draw([bgRgb[0], bgRgb[1], bgRgb[2], a])
  if (fading && view.follow) {
    fadeOutFrames = 0
    persistSnapshot = null // 跟随态快照无意义，回填需求作废
    needsRestore = false
    fade(1 - persist)
  } else if (fading && !view.follow) {
    // 暂停态：视口未变 → 缓冲冻结（余辉保留）；视口变化 → 旧余辉快速渐隐而非瞬间清屏
    if (viewChanged) {
      fadeOutFrames = FADE_OUT_STEPS
      persistSnapshot = null // 旧视口快照作废，渐隐完成后重建
    }
    if (fadeOutFrames > 0) {
      fade(FADE_OUT_ALPHA)
      fadeOutFrames--
      if (fadeOutFrames === 0) {
        gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    }
  } else {
    gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  if (len <= 0) {
    // 无数据：强制完全清屏（余辉残影不保留）
    fadeOutFrames = 0
    gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    lastView = null
    clearOverlay()
    if (dataStale.value) dataStale.value = false
    return
  }
  // 数据流中断检测（仅跟随态；状态变化才更新 ref，避免每帧触发渲染）
  const stale = view.follow && lastDataAt > 0 && performance.now() - lastDataAt > DATA_STALE_MS
  if (dataStale.value !== stale) dataStale.value = stale
  // 波形水平内缩留白：视窗两侧外扩等效 PAD_X 像素再映射到全宽绘图区
  // （轴线/网格不动，与 Y 轴纵向余量同一思路；首末采样点落在 f 与 1-f 像素分数处）
  const effPad = Math.min(PAD_X, plot.w * 0.08)
  const xFrac = effPad / plot.w
  const kS = 1 - 2 * xFrac
  const spanX = Math.max(1e-9, xr.max - xr.min)
  const padData = (xFrac * spanX) / kS
  const xrView = { min: xr.min - padData, max: xr.max + padData }
  lastView = { xRange: xrView, yRange: yr, plot, xFrac, slice: { s, e } }
  const targetPoints = Math.max(1, Math.floor(plot.w))
  // 抽稀：窗口小于像素宽时直接用原始切片；否则走极值金字塔按桶 minmax（保持原索引顺序）
  let iDec: Float32Array
  let qDec: Float32Array
  if (!props.decimation || len <= targetPoints) {
    iDec = iBuf.subarray(s, e)
    qDec = qBuf.subarray(s, e)
  } else {
    iDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 0)
    qDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 1)
  }
  // 抽稀索引空间同变换：idx=0 / idx=N-1 对齐 f 与 1-f 像素分数（与采样值域严格一致）
  const nIdx = Math.max(1, iDec.length - 1)
  const vpX = { xMin: (-xFrac * nIdx) / kS, xMax: nIdx + (xFrac * nIdx) / kS }
  // 冻结稳定态：迹线不透明直写（幂等重绘）——半透明混合重复叠加会逐次变亮（Alt 循环下可见）
  const opaque = fading && !view.follow && !viewChanged && fadeOutFrames === 0
  // mode:'dots' 时间域散点；点径随 lineWidth
  const pt = props.mode === 'dots' ? Math.max(1, Math.round(2 * (props.lineWidth || 1))) : 0
  // 绘制 I（背景已自绘，不再清屏；限制在绘图区；微透明让网格透出）
  if (traceVisible.i) {
    renderer.setData(iDec)
    renderer.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceI, opaque ? 1 : th.value.traceAlpha),
      false,
      plot,
      opaque,
      pt
    )
  }
  // 绘制 Q（叠加，不再清空）
  if (traceVisible.q && rendererQ) {
    rendererQ.setData(qDec)
    rendererQ.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceQ, opaque ? 1 : th.value.traceAlpha),
      false,
      plot,
      opaque,
      pt
    )
  }
  // 绘制幅度包络 √(I²+Q²)（第三条叠加迹线；金字塔 env 聚合，大窗仍 O(块数)）
  if (props.envelope && traceVisible.env && rendererEnv) {
    let envDec: Float32Array
    if (!props.decimation || len <= targetPoints) {
      envDec = new Float32Array(len)
      for (let k = 0; k < len; k++) envDec[k] = Math.hypot(iBuf[s + k] ?? 0, qBuf[s + k] ?? 0)
    } else {
      envDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 2)
    }
    rendererEnv.setData(envDec)
    rendererEnv.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.envColor, opaque ? 1 : th.value.traceAlpha * 0.8),
      false,
      plot,
      opaque
    )
  }
  drawOverlay(xrView, yr, plot)
  // 冻结态 + 余辉：记录 GL 缓冲快照（画布重建后可回填恢复余辉像素）
  if (fading && !view.follow && !viewChanged && fadeOutFrames === 0) {
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

// ── 坐标轴覆盖层 ──
function drawOverlay(
  xv: { min: number; max: number },
  yr: { min: number; max: number },
  plot: PlotRect
): void {
  const ov = overlayRef.value
  if (!ov || !props.axis) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ov.width, ov.height)
  // 真实比例映射：背板设备像素 ÷ 元素当前 CSS 实测尺寸。
  // 不信任全局 DPR 缓存——页面缩放/系统非整数缩放/监听时序差下，
  // overlay 全部绘制仍与鼠标位置严格贴合（修复「越远越偏」的比例错位）
  const rect = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, rect.width)
  const sy = ov.height / Math.max(1, rect.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  const t = th.value
  // X 轴时间单位（sampleRate > 0）：刻度值仍为样本索引域，标签换算为时间
  const rate = props.sampleRate
  const timeOn = !!rate && rate > 0
  const tStep = timeOn ? (xv.max - xv.min) / (rate as number) / 6 : 0
  const xTicksOverride = buildTimeTicks(xv.min, xv.max)
  drawAxisOverlay(ctx, {
    plot,
    xMin: xv.min,
    xMax: xv.max,
    yMin: yr.min,
    yMax: yr.max,
    showX: props.xAxis !== false,
    showGrid: props.grid !== false,
    frame: false,
    xTicksOverride,
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

  // ── 轴单位标题（半透明浮于绘图区角部，不占布局；props.axisLabels 控制显隐）──
  if (props.axisLabels !== false) {
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    // Y：竖排「幅度」于绘图区左上角
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(plot.x + 8, plot.y + 12)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('幅度', 0, 0)
    ctx.restore()
    // X：单位于绘图区右下角（时间/样本随 sampleRate）
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(timeOn ? '时间' : '样本', plot.x + plot.w - 6, plot.y + plot.h - 6)
    ctx.restore()
  }

  // ── Shift+拖拽 框选矩形（松手放大到该区域）──
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

  // ── 窗口自动测量（暂停态；Vpp/均值/RMS，仅显示可见通道）──
  if (!view.follow) {
    const st = windowStats()
    if (st) {
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const fmt3 = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
      const lines = [`窗口 ${st.count} 样本`]
      if (traceVisible.i) {
        lines.push(
          `I  Vpp ${(st.maxI - st.minI).toFixed(yDecimals())}  均值 ${fmt3(st.meanI)}  RMS ${st.rmsI.toFixed(yDecimals())}`
        )
      }
      if (traceVisible.q) {
        lines.push(
          `Q  Vpp ${(st.maxQ - st.minQ).toFixed(yDecimals())}  均值 ${fmt3(st.meanQ)}  RMS ${st.rmsQ.toFixed(yDecimals())}`
        )
      }
      let wMax = 0
      for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
      const padX = 8
      const lineH = 14
      const bw = Math.ceil(wMax) + padX * 2
      const bh = lines.length * lineH + 6
      const bx = plot.x + 8
      const byC = plot.y + 34 // 暂停角标下方
      drawPanel(ctx, bx, byC, bw, bh, t.labelChipBg)
      ctx.fillStyle = t.text
      lines.forEach((ln, li) => ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2))
    }
  }

  // ── 测量标记（锚定样本索引，随缩放平移保持数据位置；数量不限）──
  if (markers.length > 0) {
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chipBg2 = t.labelChipBg
    const readAt = (c: number): string | null => {
      const local = c - dropped
      if (local < 0 || local >= dataLen) return null
      return `I ${fmtValIqAdaptive(iBuf[local] ?? 0)} Q ${fmtValIqAdaptive(qBuf[local] ?? 0)}`
    }
    const markerLines: string[] = []
    markers.forEach((c, i) => {
      if (!lastView) return
      const pl = lastView.plot
      const px = markerPx(c)
      if (px < pl.x - 0.5 || px > pl.x + pl.w + 0.5) return
      const pxc = Math.round(px) + 0.5
      ctx.save()
      ctx.strokeStyle = t.crosshair
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(pxc, pl.y)
      ctx.lineTo(pxc, pl.y + pl.h)
      ctx.stroke()
      ctx.restore()
      drawChip(ctx, pxc, pl.y + 2, `M${i + 1}`, chipBg2, t.text, 'center', {
        min: pl.x,
        max: pl.x + pl.w
      })
      const local = c - dropped
      const tTxt = timeOn ? ` · ${fmtTime(c / (rate as number), tStep)}` : ''
      markerLines.push(
        local >= 0 && local < dataLen
          ? `M${i + 1}  #${c}${tTxt}  ${readAt(c)}`
          : `M${i + 1}  #${c}${tTxt}`
      )
    })
    // 恰好两个标记时附加 Δ 测量（样本/时间/频率）
    if (markers.length === 2) {
      const sorted = [...markers].sort((x, y) => x - y)
      const dSamples = Math.abs(sorted[1]! - sorted[0]!)
      markerLines.push(`Δ ${dSamples} 样本`)
      if (timeOn && dSamples > 0) {
        const dt = dSamples / (rate as number)
        markerLines.push(`Δt ${fmtTime(dt, tStep)}`)
        markerLines.push(`1/Δt ${fmtFreq(1 / dt)}`)
      }
    }
    if (markerLines.length > 0) {
      ctx.textAlign = 'left'
      let wMax = 0
      for (const ln of markerLines) wMax = Math.max(wMax, ctx.measureText(ln).width)
      const padX = 8
      const lineH = 14
      const bw = Math.ceil(wMax) + padX * 2
      const bh = markerLines.length * lineH + 6
      const bx = plot.x + plot.w - 8 - bw // 右上角，避开左上角标
      const byC = plot.y + 40 // 图例下方
      drawPanel(ctx, bx, byC, bw, bh, chipBg2)
      ctx.fillStyle = t.text
      markerLines.forEach((ln, li) => {
        ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2)
      })
    }
  }

  // ── 十字光标与读数（悬停；跟随/暂停均可用）──
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

  // 轴缘读数芯片：X 值贴底部刻度槽、Y 值贴左带（与 Y 刻度芯片同款样式）
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chipBg = t.labelChipBg
  const dispX = pxToDataX(cursor.px)
  const xText = timeOn ? fmtTime(dispX / (rate as number), tStep) : String(Math.round(dispX))
  drawChip(ctx, cxp, plot.y + plot.h + 3, xText, chipBg, t.text, 'center', {
    min: plot.x,
    max: plot.x + plot.w
  })
  const yText = pyToDataY(cursor.py).toFixed(yDecimals())
  const yChipY = Math.min(Math.max(cyp - CHIP_H / 2, plot.y + 2), plot.y + plot.h - CHIP_H - 2)
  drawChip(ctx, 2, yChipY, yText, chipBg, t.text)

  // 浮动读数框：样本索引 + 最近采样点实际 I/Q 值（贴近右/下边缘时自动翻转避让）
  const smp = sampleAt(cursor.px)
  if (!smp) return
  const fmtVal = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
  const idxLine = timeOn
    ? `#${smp.idx} · ${fmtTime(dispX / (rate as number), tStep)}`
    : `#${smp.idx}`
  const lines = [idxLine]
  if (traceVisible.i) lines.push(`I ${fmtVal(smp.i)}`)
  if (traceVisible.q) lines.push(`Q ${fmtVal(smp.q)}`)
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
  lines.forEach((ln, li) => {
    ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2)
  })
}
function clearOverlay(): void {
  const ov = overlayRef.value
  if (!ov) return
  ov.getContext('2d')?.clearRect(0, 0, ov.width, ov.height)
}

useGlChart(canvasRef, {
  fpsLimit: props.fpsLimit,
  onResize: (w, h) => {
    // 覆盖层与 GL canvas 尺寸同步（device px）
    const ov = overlayRef.value
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w
      ov.height = h
    }
    // 画布被重建（缓冲已清空）：冻结态存在快照时标记回填，下一帧恢复余辉
    if (persistSnapshot) needsRestore = true
  },
  onDraw: draw
})

// ── 交互：光标 ↔ 数据坐标换算 ──
function clientToPlot(evt: MouseEvent): { px: number; py: number } | null {
  const canvas = canvasRef.value
  if (!canvas || !lastView) return null
  const r = canvas.getBoundingClientRect()
  return { px: evt.clientX - r.left, py: evt.clientY - r.top }
}
function pxToDataX(px: number): number {
  const { xRange, plot } = lastView!
  return xRange.min + ((px - plot.x) / plot.w) * (xRange.max - xRange.min)
}
function pyToDataY(py: number): number {
  const { yRange, plot } = lastView!
  return yRange.min + (1 - (py - plot.y) / plot.h) * (yRange.max - yRange.min)
}
/** 显示域窗口 → 真实窗口：去掉两侧波形留白外扩（与 draw() 的外扩互逆） */
function unpadX(min: number, max: number, frac: number): { min: number; max: number } {
  const p = frac * (max - min)
  return { min: min + p, max: max - p }
}
/** 光标处最近采样点读取；显示域坐标越出当前缓冲切片时返回 null */
function sampleAt(px: number): { idx: number; i: number; q: number } | null {
  if (!lastView || dataLen === 0) return null
  const absIdx = Math.round(pxToDataX(px))
  const local = absIdx - dropped
  const { s, e } = lastView.slice
  if (local < s || local >= e) return null
  return { idx: absIdx, i: iBuf[local] ?? 0, q: qBuf[local] ?? 0 }
}

// ── 窗口自动测量（暂停态）──
let statsKey = ''
let statsCache: RangeStats | null = null
/** 暂停态计算可见窗口统计（Vpp/均值/RMS，金字塔 O(块数)）；按窗口切片缓存；跟随态返回 null */
function windowStats(): RangeStats | null {
  if (!lastView || view.follow) return null
  const { s, e } = lastView.slice
  const key = `${s}:${e}`
  if (statsKey === key) return statsCache
  statsKey = key
  statsCache = pyr.queryStats(iBuf, qBuf, s, e)
  return statsCache
}

// ── X 轴时间单位（sampleRate > 0 时启用）──
/** 数值按步长量级取小数并去掉尾随 0 */
function trimZeros(v: number, step: number): string {
  const dec = Math.min(4, Math.max(0, Math.ceil(-Math.log10(Math.max(step, 1e-12)))))
  const s = v.toFixed(dec)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
/** 秒 → 自适应时间文本（µs/ms/s），小数位随刻度步长量级 */
function fmtTime(seconds: number, stepSeconds: number): string {
  const a = Math.abs(seconds)
  if (a >= 1) return `${trimZeros(seconds, stepSeconds)} s`
  if (a >= 1e-3) return `${trimZeros(seconds * 1e3, stepSeconds * 1e3)} ms`
  return `${trimZeros(seconds * 1e6, stepSeconds * 1e6)} µs`
}
/** 依据采样率构建时间刻度：值仍为样本索引域（供网格定位），labels 为时间文本 */
function buildTimeTicks(
  min: number,
  max: number
): { values: number[]; labels: string[] } | undefined {
  const rate = props.sampleRate
  if (!rate || rate <= 0 || !(max > min)) return undefined
  const times = niceTicks(min / rate, max / rate, 6)
  if (!times.length) return undefined
  const stepT = times.length > 1 ? times[1]! - times[0]! : Math.max((max - min) / rate / 6, 1e-9)
  return {
    values: times.map((t) => t * rate),
    labels: times.map((t) => fmtTime(t, stepT))
  }
}
/** Hz → 自适应频率文本（Hz/kHz/MHz） */
function fmtFreq(hz: number): string {
  if (!isFinite(hz) || hz <= 0) return '—'
  if (hz >= 1e6) return `${trimZeros(hz / 1e6, 1e-3)} MHz`
  if (hz >= 1e3) return `${trimZeros(hz / 1e3, 1e-3)} kHz`
  return `${trimZeros(hz, 1e-3)} Hz`
}
/** 读数小数位自适应：随 Y 轴 V/div 档位（步长量级）自动定精度，钳制 2~6 位 */
function yDecimals(): number {
  if (!lastView) return 3
  const step = niceStep(lastView.yRange.max - lastView.yRange.min, 5)
  return Math.min(6, Math.max(2, Math.ceil(-Math.log10(Math.max(step, 1e-9))) + 2))
}
/** 带符号自适应小数位（精度随 V/div 档位） */
function fmtValIqAdaptive(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
}

// ── 缩放历史栈（Z 撤销 / Shift+Z 重做）──
interface ViewState {
  follow: boolean
  span: number
  xMin: number
  xMax: number
  yAuto: boolean
  yMin: number
  yMax: number
}
const viewHistory: ViewState[] = []
let viewHistoryPos = -1
const VIEW_HISTORY_MAX = 30

function captureView(): ViewState {
  const xr = resolveXRange()
  return {
    follow: view.follow,
    span: view.span,
    xMin: xr.min,
    xMax: xr.max,
    yAuto: view.yAuto,
    yMin: view.yMin,
    yMax: view.yMax
  }
}
/** 视口变更后提交当前状态（截断 redo 尾部，容量封顶） */
function commitViewState(): void {
  viewHistory.length = viewHistoryPos + 1
  viewHistory.push(captureView())
  if (viewHistory.length > VIEW_HISTORY_MAX) viewHistory.shift()
  viewHistoryPos = viewHistory.length - 1
}
function clearViewHistory(): void {
  viewHistory.length = 0
  viewHistoryPos = -1
  commitViewState() // 记录新基线
}
function applyViewState(s: ViewState): void {
  view.follow = s.follow
  view.span = s.span
  view.yAuto = s.yAuto
  view.yMin = s.yMin
  view.yMax = s.yMax
  if (!s.follow) {
    view.xMin = s.xMin
    view.xMax = s.xMax
  }
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

// ── 键盘微调（暂停态）：←→ X 平移 / ↑↓ Y 平移 / +− X 缩放 / Z 撤销 / Shift+Z 重做 ──
function panView(dx: number): void {
  const xr = resolveXRange()
  const span = xr.max - xr.min
  setFrozenX(xr.min + dx * span, xr.max + dx * span)
  schedule()
  emitViewportChange(true)
}
function panViewY(dy: number): void {
  const r = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  view.yAuto = false
  const d = dy * (r.max - r.min)
  view.yMin = r.min + d
  view.yMax = r.max + d
  resetYAuto()
  schedule()
  emitViewportChange(true)
}
function zoomViewX(factor: number): void {
  const xr = resolveXRange()
  const span = Math.min(
    Math.max((xr.max - xr.min) * factor, MIN_SPAN),
    Math.max(totalAbs(), MIN_SPAN)
  )
  const c = (xr.min + xr.max) / 2
  setFrozenX(c - span / 2, c + span / 2)
  schedule()
  emitViewportChange(true)
}
function onKeyDown(evt: KeyboardEvent): void {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return
  if (evt.key === 'z' || evt.key === 'Z') {
    if (evt.shiftKey) redoView()
    else undoView()
    return
  }
  if (view.follow) return // 跟随态不允许视口微调
  if (!lastView) return
  const commit = (fn: () => void): void => {
    fn()
    commitViewState()
  }
  switch (evt.key) {
    case 'ArrowLeft':
      commit(() => panView(-0.1))
      break
    case 'ArrowRight':
      commit(() => panView(0.1))
      break
    case 'ArrowUp':
      commit(() => panViewY(0.1))
      break
    case 'ArrowDown':
      commit(() => panViewY(-0.1))
      break
    case '+':
    case '=':
      commit(() => zoomViewX(1 / 1.2))
      break
    case '-':
    case '_':
      commit(() => zoomViewX(1.2))
      break
  }
}

// ── 十字光标 ──
function updateCursor(evt: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || !lastView) {
    if (cursor !== null) {
      cursor = null
      schedule()
    }
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
  cursor = next
  if (changed) schedule()
}
function onPointerLeave(): void {
  if (cursor !== null) {
    cursor = null
    schedule()
  }
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
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  emit('viewportChange', {
    follow: view.follow,
    yAuto: view.yAuto,
    xMin: xr.min,
    xMax: xr.max,
    yMin: yr.min,
    yMax: yr.max
  })
}

function onWheel(evt: WheelEvent): void {
  if (!lastView) return
  evt.preventDefault()
  const p = clientToPlot(evt)
  if (!p) return
  const factor = evt.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  if (evt.shiftKey) {
    // Y 轴缩放：锚定光标处数据值
    const anchor = pyToDataY(p.py)
    const { yRange } = lastView
    const min = anchor + (yRange.min - anchor) * factor
    const max = anchor + (yRange.max - anchor) * factor
    if (!(max - min > 1e-6)) return
    view.yAuto = false
    view.yMin = min
    view.yMax = max
  } else {
    // X 轴缩放：锚定光标处绝对索引（光标左右两侧比例保持不变）；显示域计算后去留白回真实窗口
    const anchor = pxToDataX(p.px)
    const { xRange, xFrac } = lastView
    const limit = Math.max(totalAbs(), MIN_SPAN)
    const span = Math.min(Math.max((xRange.max - xRange.min) * factor, MIN_SPAN), limit)
    const leftSpan = (anchor - xRange.min) * factor
    const rw = unpadX(anchor - leftSpan, anchor - leftSpan + span, xFrac)
    setFrozenX(rw.min, rw.max)
  }
  commitViewState() // 缩放历史（Z 可逐级撤销）
  schedule()
  emitViewportChange()
}

// 拖拽平移上下文（dragStart 时冻结的基准；xMin/xMax 为显示域）
interface DragCtx {
  px: number
  py: number
  plotW: number
  plotH: number
  xMin: number
  xMax: number
  xFrac: number
  yMin: number
  yMax: number
  yAuto: boolean
}
let dragCtx: DragCtx | null = null

function onPointerDown(evt: PointerEvent): void {
  if (!lastView || evt.button !== 0) return
  menu.show = false // 任意按下先收起右键菜单
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  // Alt+点击：空白处添加标记；命中标记则进入「按下-拖拽/松手清除」流程。
  // 刷新（跟随）状态下不允许标记
  if (evt.altKey) {
    if (view.follow) return
    const hit = markerHit(p.px)
    if (hit >= 0) {
      markerDrag = hit
      markerMoved = false
      markerDownPx.x = p.px
      markerDownPx.y = p.py
    } else {
      addMarkerAt(pxToDataX(p.px))
    }
    schedule()
    return
  }
  // Shift+拖拽：框选放大（缩放类操作，刷新状态下允许，松手即进入暂停态）
  if (evt.shiftKey) {
    boxSel = { x0: p.px, y0: p.py, x1: p.px, y1: p.py }
    return
  }
  // 刷新（跟随）状态下禁止拖拽平移：始终展示最新数据
  if (view.follow) return
  dragCtx = {
    px: p.px,
    py: p.py,
    plotW: lastView.plot.w,
    plotH: lastView.plot.h,
    xMin: lastView.xRange.min,
    xMax: lastView.xRange.max,
    xFrac: lastView.xFrac,
    yMin: lastView.yRange.min,
    yMax: lastView.yRange.max,
    yAuto: view.yAuto
  }
}

/** 框选放大：像素矩形 → 数据域窗口（X 去留白回真实窗口；Y 直接映射）；矩形过小则忽略 */
function finishBoxZoom(): void {
  if (!boxSel || !lastView) return
  const { x0, y0, x1, y1 } = boxSel
  if (Math.abs(x1 - x0) < 8 || Math.abs(y1 - y0) < 8) return
  const rw = unpadX(pxToDataX(Math.min(x0, x1)), pxToDataX(Math.max(x0, x1)), lastView.xFrac)
  setFrozenX(rw.min, rw.max)
  const yHi = pyToDataY(Math.min(y0, y1))
  const yLo = pyToDataY(Math.max(y0, y1))
  if (yHi - yLo > 1e-9) {
    view.yAuto = false
    view.yMin = yLo
    view.yMax = yHi
    resetYAuto()
  }
  commitViewState() // 框选缩放入历史（Z 可回退）
}

function onPointerMove(evt: PointerEvent): void {
  updateCursor(evt)
  if (markerDrag >= 0) {
    const p = clientToPlot(evt)
    if (!p || !lastView) return
    // 位移超阈值视为拖拽（否则松手时按「Alt+点击标记=清除」处理）
    if (!markerMoved && Math.abs(p.px - markerDownPx.x) + Math.abs(p.py - markerDownPx.y) > 4) {
      markerMoved = true
    }
    if (markerMoved && markers[markerDrag] !== undefined) {
      markers[markerDrag] = Math.round(pxToDataX(p.px))
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
  // X 平移：像素位移 → 样本位移（显示域换算后去留白回真实窗口；拖左看更老数据）
  const dsamp = -(dx * (dragCtx.xMax - dragCtx.xMin)) / dragCtx.plotW
  const rw = unpadX(dragCtx.xMin + dsamp, dragCtx.xMax + dsamp, dragCtx.xFrac)
  setFrozenX(rw.min, rw.max)
  // Y 平移：纵向拖动自动退出 autoScale
  if (!dragCtx.yAuto || Math.abs(dy) > 2) {
    if (dragCtx.yAuto) {
      dragCtx.yAuto = false
      view.yAuto = false
    }
    const dyData = (dy * (dragCtx.yMax - dragCtx.yMin)) / dragCtx.plotH
    view.yMin = dragCtx.yMin + dyData
    view.yMax = dragCtx.yMax + dyData
  }
  schedule()
}

function onPointerUp(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (markerDrag >= 0) {
    // Alt+按下标记后未拖动即松手 = 清除该标记
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
  dragCtx = null
  commitViewState() // 拖拽平移结束 → 历史
  emitViewportChange(true)
}

/** 取消进行中的手势（框选/拖拽/标记拖动），不产生任何视口变更 */
function onPointerCancel(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (boxSel) {
    boxSel = null
    schedule()
  }
  if (markerDrag >= 0) {
    markerDrag = -1
    schedule()
  }
  dragCtx = null
}

/** 左键双击：暂停 ⇆ 恢复刷新；恢复刷新时清除全部标记、保留当前缩放窗宽 */
function onDblClick(): void {
  if (view.follow) {
    const xr = resolveXRange()
    setFrozenX(xr.min, xr.max)
    // 快照冻结窗为「上一帧真实窗」：消除数据帧与重绘之间的竞态，
    // 保证暂停后首帧不被误判为视口变化而清掉余辉
    lastXrReal = { min: xr.min, max: xr.max }
    // 冻结 Y 量程为当前平滑值：暂停后量程不再漂移，画面（含余辉）完全定格
    if (lastView) {
      view.yAuto = false
      view.yMin = lastView.yRange.min
      view.yMax = lastView.yRange.max
    }
    resetYAuto()
    schedule()
    emitViewportChange(true)
  } else {
    resumeFollow()
  }
}

/** 恢复跟随：保留当前缩放窗宽，清除标记；双击/角标使用 */
function resumeFollow(): void {
  view.follow = true
  view.yAuto = true
  markers = []
  markerDrag = -1
  menu.show = false
  persistSnapshot = null
  needsRestore = false
  lastDataAt = performance.now() // 恢复瞬间重置计时，避免误报中断
  resetYAuto()
  schedule()
  emitViewportChange(true)
}

function zoomReset(notify = true): void {
  view.follow = true
  view.span = Math.max(MIN_SPAN, props.span)
  view.yAuto = true
  markers = []
  markerDrag = -1
  menu.show = false
  resetYAuto() // 复位后直接吸附新窗口目标范围，不从旧范围滑入
  clearViewHistory() // 复位后历史重置为新基线
  schedule()
  emitSpanChange(notify)
  if (notify) emitViewportChange(true)
}

// ── 导出 ──
const EXPORT_MAX_ROWS = 500_000

/**
 * 合成 GL 波形层 + overlay 轴层为离屏画布（手动补绘图例，DOM 元素不入画布）。
 * 先同步 draw()：preserveDrawingBuffer=false 时，同任务内重绘+读取可确保 WebGL 帧缓冲有效
 */
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
  ctx.drawImage(glC, 0, 0)
  ctx.drawImage(ov, 0, 0)
  const dpr = window.devicePixelRatio || 1
  const cssW = glC.width / dpr
  ctx.scale(dpr, dpr)
  ctx.font = '12px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const items = [
    { label: 'I', color: th.value.traceI, on: traceVisible.i },
    { label: 'Q', color: th.value.traceQ, on: traceVisible.q }
  ]
  if (props.envelope) items.push({ label: 'Env', color: th.value.envColor, on: traceVisible.env })
  const gap = 12
  const widths = items.map((it) => 8 + 4 + ctx.measureText(it.label).width)
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)
  let x = cssW - 10 - totalW
  const y = 15
  items.forEach((it, idx) => {
    ctx.globalAlpha = it.on ? 1 : 0.35
    ctx.fillStyle = it.color
    ctx.beginPath()
    ctx.arc(x + 4, y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = th.value.darkLike ? '#c9d1d9' : '#1f2328'
    ctx.fillText(it.label, x + 12, y + 0.5)
    x += widths[idx]! + gap
  })
  ctx.globalAlpha = 1
  return out
}

/** 导出当前视图为 PNG（波形 + 坐标轴 + 图例） */
function exportPNG(): void {
  const filename = `iq-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  deliverExport({ kind: 'png', filename, dataUrl: compositeCanvas().toDataURL('image/png') })
}

/** 导出当前可见窗口原始样本为 CSV；超 50 万行按等步长抽稀，sampleRate 存在时附 time_s 列 */
function exportCSV(): void {
  const xr = resolveXRange()
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = e - s
  if (len <= 0) return
  const stride = Math.max(1, Math.ceil(len / EXPORT_MAX_ROWS))
  const rate = props.sampleRate
  const parts: string[] = [rate && rate > 0 ? 'index,time_s,i,q' : 'index,i,q']
  for (let k = 0; k < len; k += stride) {
    const abs = dropped + s + k
    const i = iBuf[s + k] ?? 0
    const q = qBuf[s + k] ?? 0
    parts.push(
      rate && rate > 0 ? `${abs},${(abs / rate).toFixed(9)},${i},${q}` : `${abs},${i},${q}`
    )
  }
  const filename = `iq-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  deliverExport({ kind: 'csv', filename, text: parts.join('\n') })
}

/** 交付导出：宿主提供 exportHandler 时交其持久化，否则回退浏览器下载；完成后发 exported 供 UI 反馈 */
function deliverExport(p: ExportPayload): void {
  const handler = props.exportHandler
  if (handler) {
    Promise.resolve(handler(p)).catch((e: unknown) =>
      emit('error', e instanceof Error ? e.message : String(e))
    )
  } else {
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
  }
  emit('exported', { kind: p.kind, filename: p.filename })
}

defineExpose({
  appendData,
  setData,
  clear,
  setViewport,
  getLength: () => dataLen,
  zoomReset,
  exportPNG,
  exportCSV,
  getView: (): IqViewInfo => ({
    follow: view.follow,
    yAuto: view.yAuto,
    ...doResolveViewInfo()
  })
})
function doResolveViewInfo(): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  return { xMin: xr.min, xMax: xr.max, yMin: yr.min, yMax: yr.max }
}

onMounted(async () => {
  await nextTick()
  window.addEventListener('keydown', onKeyDown)
  const canvas = canvasRef.value
  if (!canvas) return
  // preserveDrawingBuffer：合成后保留绘图缓冲——余辉（persistence）淡出合成的前提；
  // 关闭时浏览器每帧清空缓冲，淡出四边形无旧帧可混合，余辉完全无效
  gl = canvas.getContext('webgl2', {
    antialias: true,
    preserveDrawingBuffer: true
  }) as WebGL2RenderingContext | null
  if (!gl) {
    emit('error', 'WebGL2 not supported, fallback to Canvas2D (降低性能)')
    return
  }
  renderer = createLineRenderer(canvas, gl)
  rendererQ = createLineRenderer(canvas, gl)
  rendererEnv = createLineRenderer(canvas, gl)
  fadeRenderer = createFadeRenderer(gl)
  blitRenderer = createBlitRenderer(gl)
  // 初始数据
  if (props.data !== undefined) setData(props.data)
  draw()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  renderer?.dispose()
  rendererQ?.dispose()
  rendererEnv?.dispose()
  fadeRenderer?.dispose()
  blitRenderer?.dispose()
  if (raf) cancelAnimationFrame(raf)
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
})

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)

function setData(raw: unknown): void {
  clear(false)
  appendData(raw)
}
function appendData(raw: unknown): void {
  const n = normalize(raw)
  if (!n) {
    emit('error', 'adapter 返回 null，无法解析数据')
    return
  }
  pushNormalized(n)
}
function clear(needDraw = true): void {
  dataLen = 0
  dropped = 0
  markers = []
  markerDrag = -1
  persistSnapshot = null
  needsRestore = false
  lastDataAt = 0
  dataStale.value = false
  pyrDirty = true // 数据清空，下次推流重建金字塔
  zoomReset(false)
  if (needDraw) draw()
}
function setViewport(v: Partial<NonNullable<IqProps['viewport']>>): void {
  applyExternalViewport(v as NonNullable<IqProps['viewport']>)
}
</script>

<template>
  <div
    ref="rootRef"
    class="sig-iq"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    :style="{
      width: props.width ? props.width + 'px' : '100%',
      height: props.height ? props.height + 'px' : '260px',
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg
    }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="onPointerLeave"
    @contextmenu.prevent="onContextMenu"
    @dblclick="onDblClick"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <div
      v-if="!view.follow"
      class="sig-follow-badge"
      title="恢复跟随最新数据（保留当前缩放窗宽）"
      @click="resumeFollow()"
    >
      已暂停跟随 · 双击恢复
    </div>
    <div v-if="dataStale" class="sig-stale-badge" title="超过 3 秒未收到新数据">数据流中断</div>
    <div class="sig-legend" title="点击切换迹线显隐">
      <span
        class="sig-trace"
        :class="{ off: !traceVisible.i }"
        @click.stop="traceVisible.i = !traceVisible.i"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.traceI }" /> I
      </span>
      <span
        class="sig-trace"
        :class="{ off: !traceVisible.q }"
        style="margin-left: 12px"
        @click.stop="traceVisible.q = !traceVisible.q"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.traceQ }" /> Q
      </span>
      <span
        v-if="props.envelope"
        class="sig-trace"
        :class="{ off: !traceVisible.env }"
        style="margin-left: 12px"
        @click.stop="traceVisible.env = !traceVisible.env"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.envColor }" /> Env
      </span>
    </div>
    <div
      v-if="menu.show"
      class="sig-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <div
        class="sig-menu-item"
        :class="{ disabled: view.follow }"
        @click.stop="menuAction('add')"
        @pointerdown.stop
        @dblclick.stop
      >
        在此处标记
      </div>
      <div
        v-if="menu.hitIdx >= 0"
        class="sig-menu-item"
        @click.stop="menuAction('remove')"
        @pointerdown.stop
        @dblclick.stop
      >
        清除该标记
      </div>
      <div
        v-if="markers.length > 0"
        class="sig-menu-item"
        @click.stop="menuAction('clear')"
        @pointerdown.stop
        @dblclick.stop
      >
        清除全部标记
      </div>
      <div class="sig-menu-sep" />
      <div
        class="sig-menu-item"
        @click.stop="menuAction('toggle')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ view.follow ? '暂停刷新' : '恢复刷新（清除标记）' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sig-iq {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--sig-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sig-bg, #fff);
  user-select: none;
  touch-action: none;
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
  pointer-events: none;
}
.sig-follow-badge {
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
.sig-legend {
  position: absolute;
  right: 10px;
  top: 8px;
  font-size: 12px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
}
.sig-trace {
  cursor: pointer;
  user-select: none;
}
.sig-trace.off {
  opacity: 0.35;
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
.sig-menu-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.sig-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--sig-border);
}
.sig-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 4px;
}
</style>
