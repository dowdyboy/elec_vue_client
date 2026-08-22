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
import { createLineRenderer, withAlpha, hexToRgba, type LineRenderer } from './core/gl'
import { iqAdapters } from './core/adapters'
import { drawAxisOverlay, type PlotRect } from './core/axis'
import { resolveTheme } from './core/theme'
import type { IqProps, IqNormalized, IqViewInfo, Theme } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<IqProps>(), {
  theme: 'auto' as Theme,
  decimation: 'minmax',
  fpsLimit: 60,
  mode: 'line',
  lineWidth: 1,
  viewport: undefined,
  adapter: undefined,
  data: undefined,
  axis: true,
  xAxis: true,
  grid: true
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'viewportChange', v: IqViewInfo): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let rendererQ: LineRenderer | null = null
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
}

/** 环形丢老：保留最近 keep 条，累计 dropped */
function compact(keep: number): void {
  dropped += dataLen - keep
  iBuf.copyWithin(0, dataLen - keep, dataLen)
  qBuf.copyWithin(0, dataLen - keep, dataLen)
  dataLen = keep
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
  schedule()
}

// ── 视口状态机 ──
// follow=true：窗口吸附最新数据；任何缩放/平移后 follow=false（冻结），数据从视图下方流过
const view = reactive({
  follow: true,
  span: DEFAULT_SPAN, // 当前窗宽（样本数），follow 与缩放共用
  xMin: 0, // 冻结时的绝对索引范围
  xMax: DEFAULT_SPAN,
  yAuto: true,
  yMin: -1,
  yMax: 1
})

function applyExternalViewport(v: NonNullable<IqProps['viewport']>): void {
  if (v.autoScale !== undefined) view.yAuto = v.autoScale
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

/** 冻结 X 视口并钳制到可保留范围 [dropped, total]，保持窗宽 */
function setFrozenX(min: number, max: number): void {
  const total = totalAbs()
  const span = Math.max(MIN_SPAN, max - min)
  min = Math.min(Math.max(min, dropped), Math.max(dropped, total - span))
  view.follow = false
  view.span = span
  view.xMin = min
  view.xMax = min + span
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
    max = total
    min = Math.max(dropped, total - DEFAULT_SPAN)
  }
  return { min, max }
}

// 抽稀（主线程简版 minmax，按原索引排序避免折线交叉伪影；大数据可移入 Worker）
function decimate(arr: Float32Array, len: number, target: number): Float32Array {
  if (!props.decimation || len <= target) return arr.subarray(0, len)
  const bucket = len / target
  const out = new Float32Array(target * 2)
  let oi = 0
  for (let i = 0; i < target; i++) {
    const s = Math.floor(i * bucket)
    const e = Math.floor((i + 1) * bucket)
    let min = Infinity,
      max = -Infinity
    let minIdx = s,
      maxIdx = s
    for (let j = s; j < e && j < len; j++) {
      const v = arr[j]
      if (v < min) {
        min = v
        minIdx = j
      }
      if (v > max) {
        max = v
        maxIdx = j
      }
    }
    if (minIdx < maxIdx) {
      out[oi++] = min
      out[oi++] = max
    } else {
      out[oi++] = max
      out[oi++] = min
    }
  }
  return out.subarray(0, oi)
}

function resolveYRange(s: number, e: number): { min: number; max: number } {
  if (!view.yAuto) return { min: view.yMin, max: view.yMax }
  if (e <= s) return { min: -1, max: 1 }
  let mn = Infinity,
    mx = -Infinity
  for (let i = s; i < e; i++) {
    const a = iBuf[i],
      b = qBuf[i]
    if (a < mn) mn = a
    if (a > mx) mx = a
    if (b < mn) mn = b
    if (b > mx) mx = b
  }
  if (!isFinite(mn) || !isFinite(mx)) return { min: -1, max: 1 }
  // 居中 + 25% 余量：波形不贴边，网格有呼吸空间
  const cx = (mn + mx) / 2
  const half = Math.max((mx - mn) / 2, 1e-3) * 1.25
  return { min: cx - half, max: cx + half }
}

// 绘图区（CSS px）：左侧固定刻度带 + 底部 X 刻度槽；Y 芯片右对齐贴绘图区左边框
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

// 上一帧视口缓存：交互时光标坐标 ↔ 数据坐标换算依据
let lastView: {
  xRange: { min: number; max: number }
  yRange: { min: number; max: number }
  plot: PlotRect
} | null = null

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
  const dpr = window.devicePixelRatio || 1
  const xr = resolveXRange()
  // 绝对索引 → 缓冲下标
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = Math.max(0, e - s)
  // 先解析最终 Y 范围（决定网格/零线与刻度芯片位置）
  const yr = len > 0 ? resolveYRange(s, e) : { min: -1, max: 1 }
  const plot = computePlot(canvas)
  // 背景（全画布；先关 scissor 再清屏；颜色由主题 bg 驱动）
  gl.disable(gl.SCISSOR_TEST)
  const bgRgb = hexToRgba(th.value.bg)
  gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  if (len <= 0) {
    lastView = null
    clearOverlay()
    return
  }
  lastView = { xRange: xr, yRange: yr, plot }
  const targetPoints = Math.max(1, Math.floor(plot.w))
  const iSlice = iBuf.subarray(s, e)
  const qSlice = qBuf.subarray(s, e)
  const iDec = decimate(iSlice, len, targetPoints)
  const qDec = decimate(qSlice, len, targetPoints)
  // 绘制 I（背景已自绘，不再清屏；限制在绘图区；微透明让网格透出）
  renderer.setData(iDec)
  renderer.draw(
    { xMin: 0, xMax: Math.max(0, iDec.length - 1), yMin: yr.min, yMax: yr.max },
    withAlpha(th.value.traceI, th.value.traceAlpha),
    false,
    plot
  )
  // 绘制 Q（叠加，不再清空）
  if (rendererQ) {
    rendererQ.setData(qDec)
    rendererQ.draw(
      { xMin: 0, xMax: Math.max(0, qDec.length - 1), yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceQ, th.value.traceAlpha),
      false,
      plot
    )
  }
  drawOverlay(xr, yr, plot, dpr)
}

// ── 坐标轴覆盖层 ──
function drawOverlay(
  xr: { min: number; max: number },
  yr: { min: number; max: number },
  plot: PlotRect,
  dpr: number
): void {
  const ov = overlayRef.value
  if (!ov || !props.axis) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ov.width, ov.height)
  ctx.scale(dpr, dpr)
  const t = th.value
  drawAxisOverlay(ctx, {
    plot,
    xMin: xr.min,
    xMax: xr.max,
    yMin: yr.min,
    yMax: yr.max,
    showX: props.xAxis !== false,
    showGrid: props.grid !== false,
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
    // X 轴缩放：锚定光标处绝对索引（光标左右两侧比例保持不变）
    const anchor = pxToDataX(p.px)
    const { xRange } = lastView
    const limit = Math.max(totalAbs(), MIN_SPAN)
    const span = Math.min(Math.max((xRange.max - xRange.min) * factor, MIN_SPAN), limit)
    const leftSpan = (anchor - xRange.min) * factor
    setFrozenX(anchor - leftSpan, anchor - leftSpan + span)
  }
  schedule()
  emitViewportChange()
}

// 拖拽平移上下文（dragStart 时冻结的基准）
interface DragCtx {
  px: number
  py: number
  plotW: number
  plotH: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  yAuto: boolean
}
let dragCtx: DragCtx | null = null

function onPointerDown(evt: PointerEvent): void {
  if (!lastView || evt.button !== 0) return
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  dragCtx = {
    px: p.px,
    py: p.py,
    plotW: lastView.plot.w,
    plotH: lastView.plot.h,
    xMin: lastView.xRange.min,
    xMax: lastView.xRange.max,
    yMin: lastView.yRange.min,
    yMax: lastView.yRange.max,
    yAuto: view.yAuto
  }
}

function onPointerMove(evt: PointerEvent): void {
  if (!dragCtx) return
  const p = clientToPlot(evt)
  if (!p) return
  const dx = p.px - dragCtx.px
  const dy = p.py - dragCtx.py
  // X 平移：像素位移 → 样本位移（拖左看更老数据）
  const dsamp = -(dx * (dragCtx.xMax - dragCtx.xMin)) / dragCtx.plotW
  setFrozenX(dragCtx.xMin + dsamp, dragCtx.xMax + dsamp)
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
  if (!dragCtx) return
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  dragCtx = null
  emitViewportChange(true)
}

function zoomReset(notify = true): void {
  view.follow = true
  view.span = DEFAULT_SPAN
  view.yAuto = true
  schedule()
  if (notify) emitViewportChange(true)
}

defineExpose({
  appendData,
  setData,
  clear,
  setViewport,
  getLength: () => dataLen,
  zoomReset,
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
  const canvas = canvasRef.value
  if (!canvas) return
  gl = canvas.getContext('webgl2', { antialias: true }) as WebGL2RenderingContext | null
  if (!gl) {
    emit('error', 'WebGL2 not supported, fallback to Canvas2D (降低性能)')
    return
  }
  renderer = createLineRenderer(canvas, gl)
  rendererQ = createLineRenderer(canvas, gl)
  // 初始数据
  if (props.data !== undefined) setData(props.data)
  draw()
})

onUnmounted(() => {
  renderer?.dispose()
  rendererQ?.dispose()
  if (raf) cancelAnimationFrame(raf)
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
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
  zoomReset(false)
  if (needDraw) draw()
}
function setViewport(v: Partial<NonNullable<IqProps['viewport']>>): void {
  applyExternalViewport(v as NonNullable<IqProps['viewport']>)
}
</script>

<template>
  <div
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
    @pointercancel="onPointerUp"
    @dblclick="zoomReset()"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <div v-if="!view.follow" class="sig-follow-badge" title="恢复跟随最新数据" @click="zoomReset()">
      已暂停跟随 · 双击恢复
    </div>
    <div class="sig-legend">
      <span class="sig-dot" :style="{ background: th.traceI }" /> I
      <span class="sig-dot" :style="{ background: th.traceQ, marginLeft: '12px' }" /> Q
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
.sig-legend {
  position: absolute;
  right: 10px;
  top: 8px;
  font-size: 12px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  pointer-events: none;
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
