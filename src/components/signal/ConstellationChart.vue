<script setup lang="ts">
/**
 * ConstellationChart（星座图，可复用）
 * - 输入：交织 Float32 IQ 或 {i,q}；adapter 与 IQ 组件共用
 * - 渲染：WebGL2 POINTS 优先，Canvas2D 自动降级；轴/网格/游标在独立 2D 覆盖层
 * - I/Q 等比映射（不会被宽画布拉成椭圆），自动量程/手动视口、滚轮缩放、拖拽平移
 * - 统计：I/Q 极值/RMS、功率、峰值；PNG/CSV 导出
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createPointsRenderer, type PointsRenderer } from './core/gl'
import {
  createConstellationCanvasRenderer,
  type ConstellationCanvasRenderer
} from './core/constellationCanvas'
import { constellationAdapters } from './core/adapters'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { usePrefersDark } from './composables/usePrefersDark'
import { useGlChart } from './composables/useGlChart'
import { translate, type ChartMessageKey } from './core/i18n'
import { niceTicks } from './core/axis'
import {
  ConstellationAutoRange,
  ConstellationBuffer,
  autoConstellationRange,
  computeConstellationStats,
  equalizeRange,
  formatConstellationTick,
  sampleConstellation,
  type ConstellationRange,
  type SampledConstellation
} from './core/constellation'
import type {
  ConstellationProps,
  ConstellationStats,
  ConstellationViewInfo,
  ExportPayload
} from './core/types'

const props = withDefaults(defineProps<ConstellationProps>(), {
  theme: 'auto',
  fpsLimit: 60,
  pointSize: 2,
  alpha: 0.7,
  axis: true,
  grid: true,
  axisLabels: true,
  showInfo: true,
  maxPoints: 500_000
})
const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'errorDetail', p: { code: 'adapter' | 'webgl' | 'data' | 'export'; message: string }): void
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'viewportChange', v: ConstellationViewInfo): void
}>()

function tr(key: ChartMessageKey, vars?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, vars)
}
function reportError(code: 'adapter' | 'webgl' | 'data' | 'export', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const prefersDark = usePrefersDark()
const th = computed(() => resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle }))
const themeKey = computed(() => (th.value.darkLike ? 'dark' : 'light'))

const pointCount = ref(0)
const backend = ref<'webgl2' | 'canvas2d' | 'none'>('none')
const unsupported = ref(false)
const backendLabel = computed(() =>
  backend.value === 'webgl2' ? 'WebGL2' : backend.value === 'canvas2d' ? 'Canvas2D' : '-'
)

const buffer = new ConstellationBuffer(props.maxPoints)
const stableAuto = new ConstellationAutoRange({ hysteresis: 0.2, holdFrames: 180 })
let renderer: PointsRenderer | null = null
let canvasRenderer: ConstellationCanvasRenderer | null = null
let overlayCtx: CanvasRenderingContext2D | null = null

interface ViewState {
  auto: boolean
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}
const view: ViewState = { auto: true, xMin: -1, xMax: 1, yMin: -1, yMax: 1 }
let lastView: ConstellationViewInfo = { xMin: -1, xMax: 1, yMin: -1, yMax: 1, autoScale: true }
let autoCache = { version: -1, range: { min: -1, max: 1 } as ConstellationRange }
let sampleCache: { version: number; max: number; data: SampledConstellation } | null = null
let pointer = { x: 0, y: 0, inside: false }
let drag: {
  clientX: number
  clientY: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
} | null = null

const { scheduleDraw } = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit ?? 60,
  theme: themeKey,
  onDraw: () => draw()
})

function schedule(): void {
  scheduleDraw()
}

function allViewport(v: ConstellationProps['viewport']): boolean {
  return (
    !!v &&
    Number.isFinite(v.xMin) &&
    Number.isFinite(v.xMax) &&
    Number.isFinite(v.yMin) &&
    Number.isFinite(v.yMax) &&
    (v.xMax as number) > (v.xMin as number) &&
    (v.yMax as number) > (v.yMin as number)
  )
}

function autoRange(): ConstellationRange {
  if (autoCache.version === buffer.version) return autoCache.range
  const sample = sampleConstellation(buffer.i, buffer.q, buffer.length, 40_000)
  const raw = autoConstellationRange(sample.i, sample.q, sample.count)
  const range = stableAuto.resolve(raw)
  autoCache = { version: buffer.version, range }
  return range
}

function resetAutoRange(): void {
  stableAuto.reset()
  autoCache = { version: -1, range: { min: -1, max: 1 } }
}

function resolveView(plotAspect: number): ConstellationViewInfo {
  let xr: ConstellationRange
  let yr: ConstellationRange
  if (view.auto) {
    const r = autoRange()
    xr = { ...r }
    yr = { ...r }
  } else {
    xr = { min: view.xMin, max: view.xMax }
    yr = { min: view.yMin, max: view.yMax }
  }
  if (!(xr.max > xr.min) || !(yr.max > yr.min)) {
    xr = { min: -1, max: 1 }
    yr = { min: -1, max: 1 }
  }
  const eq = equalizeRange(xr, yr, plotAspect)
  return {
    xMin: eq.x.min,
    xMax: eq.x.max,
    yMin: eq.y.min,
    yMax: eq.y.max,
    autoScale: view.auto
  }
}

function plotMetrics(): { x: number; y: number; w: number; h: number; cssW: number; cssH: number } {
  const canvas = canvasRef.value
  const cssW = canvas?.clientWidth || canvas?.width || 1
  const cssH = canvas?.clientHeight || canvas?.height || 1
  const axis = props.axis !== false
  const left = axis ? 52 : 12
  const right = 14
  const top = 14
  const bottom = axis ? 28 : 12
  // 星座图必须使用正方形绘图区：宽面板上按比例扩 x 会把 QPSK 四簇压成中心一小团
  const availW = Math.max(1, cssW - left - right)
  const availH = Math.max(1, cssH - top - bottom)
  const size = Math.max(1, Math.min(availW, availH))
  return {
    x: left + (availW - size) / 2,
    y: top + (availH - size) / 2,
    w: size,
    h: size,
    cssW,
    cssH
  }
}

function renderLimit(): number {
  const explicit = props.maxRenderPoints
  if (typeof explicit === 'number' && explicit > 0) return Math.floor(explicit)
  return backend.value === 'canvas2d' ? 30_000 : 150_000
}

function renderSample(max: number): SampledConstellation {
  if (sampleCache && sampleCache.version === buffer.version && sampleCache.max === max)
    return sampleCache.data
  const data = sampleConstellation(buffer.i, buffer.q, buffer.length, max)
  sampleCache = { version: buffer.version, max, data }
  return data
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || backend.value === 'none') return
  const plot = plotMetrics()
  const ranges = resolveView(plot.w / Math.max(1, plot.h))
  lastView = ranges
  const max = renderLimit()
  const sample = renderSample(max)
  const dpr = canvas.width / Math.max(1, plot.cssW)
  if (backend.value === 'webgl2' && renderer) {
    renderer.setData(sample.i, sample.q)
    renderer.draw(
      { min: ranges.xMin, max: ranges.xMax },
      { min: ranges.yMin, max: ranges.yMax },
      th.value.traceColor,
      clampAlpha(props.alpha),
      Math.max(1, props.pointSize * dpr),
      plot
    )
  } else if (backend.value === 'canvas2d' && canvasRenderer) {
    canvasRenderer.setData(sample.i, sample.q)
    canvasRenderer.draw(
      { min: ranges.xMin, max: ranges.xMax },
      { min: ranges.yMin, max: ranges.yMax },
      th.value.traceColor,
      clampAlpha(props.alpha),
      Math.max(1, props.pointSize),
      plot
    )
  }
  drawOverlay(plot, ranges)
}

function clampAlpha(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.7))
}

function drawOverlay(
  plot: { x: number; y: number; w: number; h: number; cssW: number; cssH: number },
  ranges: ConstellationViewInfo
): void {
  const overlay = overlayRef.value
  const main = canvasRef.value
  if (!overlay || !main) return
  if (overlay.width !== main.width) overlay.width = main.width
  if (overlay.height !== main.height) overlay.height = main.height
  const ctx = overlayCtx
  if (!ctx) return
  const sx = overlay.width / Math.max(1, plot.cssW)
  const sy = overlay.height / Math.max(1, plot.cssH)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)

  // 绘图区底色（低透明度，不遮点）
  ctx.fillStyle = th.value.plotBg
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h)

  if (props.axis !== false) {
    const xTicks = niceTicks(ranges.xMin, ranges.xMax, 6)
    const yTicks = niceTicks(ranges.yMin, ranges.yMax, 6)
    const toX = (v: number): number =>
      plot.x + ((v - ranges.xMin) / (ranges.xMax - ranges.xMin)) * plot.w
    const toY = (v: number): number =>
      plot.y + plot.h - ((v - ranges.yMin) / (ranges.yMax - ranges.yMin)) * plot.h

    ctx.lineWidth = 1
    if (props.grid !== false) {
      ctx.strokeStyle = th.value.grid
      ctx.beginPath()
      for (const t of xTicks) {
        const px = Math.round(toX(t)) + 0.5
        if (px < plot.x || px > plot.x + plot.w) continue
        ctx.moveTo(px, plot.y)
        ctx.lineTo(px, plot.y + plot.h)
      }
      for (const t of yTicks) {
        const py = Math.round(toY(t)) + 0.5
        if (py < plot.y || py > plot.y + plot.h) continue
        ctx.moveTo(plot.x, py)
        ctx.lineTo(plot.x + plot.w, py)
      }
      ctx.stroke()
    }

    // 0 轴：I/Q 原点十字
    ctx.strokeStyle = th.value.zeroLine
    ctx.lineWidth = 1.25
    if (ranges.yMin <= 0 && ranges.yMax >= 0) {
      const py = Math.round(toY(0)) + 0.5
      ctx.beginPath()
      ctx.moveTo(plot.x, py)
      ctx.lineTo(plot.x + plot.w, py)
      ctx.stroke()
    }
    if (ranges.xMin <= 0 && ranges.xMax >= 0) {
      const px = Math.round(toX(0)) + 0.5
      ctx.beginPath()
      ctx.moveTo(px, plot.y)
      ctx.lineTo(px, plot.y + plot.h)
      ctx.stroke()
    }

    // 边框
    ctx.strokeStyle = th.value.border
    ctx.lineWidth = 1
    ctx.strokeRect(
      Math.round(plot.x) + 0.5,
      Math.round(plot.y) + 0.5,
      Math.round(plot.w) - 1,
      Math.round(plot.h) - 1
    )

    // 刻度文字
    ctx.font = '10px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = th.value.text
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (const t of yTicks) {
      const py = toY(t)
      if (py < plot.y - 1 || py > plot.y + plot.h + 1) continue
      ctx.fillText(
        formatConstellationTick(t, { min: ranges.yMin, max: ranges.yMax }),
        plot.x - 7,
        py
      )
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const t of xTicks) {
      const px = toX(t)
      if (px < plot.x - 1 || px > plot.x + plot.w + 1) continue
      ctx.fillText(
        formatConstellationTick(t, { min: ranges.xMin, max: ranges.xMax }),
        px,
        plot.y + plot.h + 6
      )
    }

    if (props.axisLabels !== false) {
      ctx.fillStyle = th.value.text
      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(
        props.labels?.i ?? tr('constellation.axisI'),
        plot.x + plot.w - 4,
        plot.y + plot.h - 5
      )
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(props.labels?.q ?? tr('constellation.axisQ'), plot.x + 5, plot.y + 4)
    }
  }

  if (buffer.length === 0) {
    ctx.fillStyle = th.value.text
    ctx.font = '12px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(tr('constellation.waiting'), plot.x + plot.w / 2, plot.y + plot.h / 2)
  } else if (pointer.inside) {
    drawCursor(ctx, plot, ranges)
  }
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number },
  ranges: ConstellationViewInfo
): void {
  const px = pointer.x
  const py = pointer.y
  if (px < plot.x || px > plot.x + plot.w || py < plot.y || py > plot.y + plot.h) return
  const i = ranges.xMin + ((px - plot.x) / plot.w) * (ranges.xMax - ranges.xMin)
  const q = ranges.yMin + ((plot.y + plot.h - py) / plot.h) * (ranges.yMax - ranges.yMin)
  ctx.save()
  ctx.strokeStyle = th.value.crosshair
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(plot.x, Math.round(py) + 0.5)
  ctx.lineTo(plot.x + plot.w, Math.round(py) + 0.5)
  ctx.moveTo(Math.round(px) + 0.5, plot.y)
  ctx.lineTo(Math.round(px) + 0.5, plot.y + plot.h)
  ctx.stroke()
  ctx.setLineDash([])
  const text = `I ${fmtReadout(i)}  Q ${fmtReadout(q)}`
  ctx.font = '10px system-ui, -apple-system, sans-serif'
  const tw = ctx.measureText(text).width + 12
  const tx = Math.min(plot.x + plot.w - tw - 2, Math.max(plot.x + 2, px + 10))
  const ty = Math.min(plot.y + plot.h - 20, Math.max(plot.y + 2, py - 22))
  ctx.fillStyle = th.value.labelChipBg
  ctx.fillRect(tx, ty, tw, 18)
  ctx.fillStyle = th.value.text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, tx + 6, ty + 9)
  ctx.restore()
}

function fmtReadout(v: number): string {
  if (!Number.isFinite(v)) return '-'
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)) return v.toExponential(2)
  return v.toFixed(3)
}

function drawOverlayOnly(): void {
  if (!canvasRef.value) return
  const plot = plotMetrics()
  drawOverlay(plot, lastView)
}

function setupRenderer(): void {
  const canvas = canvasRef.value
  const overlay = overlayRef.value
  if (!canvas || !overlay) return
  renderer?.dispose()
  canvasRenderer?.dispose()
  renderer = null
  canvasRenderer = null
  overlayCtx = overlay.getContext('2d')
  unsupported.value = false
  const kind = props.renderer ?? 'auto'
  if (kind !== 'canvas2d') {
    try {
      renderer = createPointsRenderer(canvas)
      backend.value = 'webgl2'
      return
    } catch (e) {
      if (kind === 'webgl2') {
        backend.value = 'none'
        unsupported.value = true
        reportError('webgl', e instanceof Error ? e.message : String(e))
        schedule()
        return
      }
    }
  }
  try {
    canvasRenderer = createConstellationCanvasRenderer(canvas)
    backend.value = 'canvas2d'
    return
  } catch {
    // fall through
  }
  backend.value = 'none'
  unsupported.value = true
  reportError('webgl', tr('constellation.webglUnsupported'))
}

function normalize(raw: unknown): { i: Float32Array; q: Float32Array } | null {
  const fn = props.adapter ?? constellationAdapters.passthrough
  try {
    const v = fn(raw)
    const base =
      v ??
      constellationAdapters.jsonInterleaved(raw) ??
      constellationAdapters.arrayBuffer(raw) ??
      constellationAdapters.base64(raw)
    if (!base) return null
    return toIQ(base)
  } catch (e) {
    reportError('adapter', e instanceof Error ? e.message : String(e))
    return null
  }
}

function toIQ(v: unknown): { i: Float32Array; q: Float32Array } | null {
  if (v instanceof Float32Array) {
    const pairs = Math.floor(v.length / 2)
    const i = new Float32Array(pairs)
    const q = new Float32Array(pairs)
    for (let k = 0; k < pairs; k++) {
      const iv = v[2 * k]!
      const qv = v[2 * k + 1]!
      // 入口清洗：NaN/Inf 置 0，避免污染自动量程/统计/GL
      i[k] = Number.isFinite(iv) ? iv : 0
      q[k] = Number.isFinite(qv) ? qv : 0
    }
    return { i, q }
  }
  if (v && typeof v === 'object' && 'i' in (v as Record<string, unknown>)) {
    const o = v as { i: Float32Array; q: Float32Array }
    if (o.i instanceof Float32Array && o.q instanceof Float32Array) return sanitizePair(o.i, o.q)
  }
  return null
}

/** 只在检测到非有限值时复制，避免正常路径多一次分配 */
function sanitizePair(i: Float32Array, q: Float32Array): { i: Float32Array; q: Float32Array } {
  const n = Math.min(i.length, q.length)
  let bad = false
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(i[k]) || !Number.isFinite(q[k])) {
      bad = true
      break
    }
  }
  if (!bad) return { i, q }
  const ci = i.slice(0, n)
  const cq = q.slice(0, n)
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(ci[k])) ci[k] = 0
    if (!Number.isFinite(cq[k])) cq[k] = 0
  }
  return { i: ci, q: cq }
}

function appendData(raw: unknown): void {
  const p = normalize(raw)
  if (!p) {
    reportError('adapter', tr('common.adapterNull'))
    return
  }
  const clean = sanitizePair(p.i, p.q)
  buffer.append(clean.i, clean.q)
  pointCount.value = buffer.length
  sampleCache = null
  schedule()
}

function setData(raw: unknown): void {
  buffer.clear()
  pointCount.value = 0
  sampleCache = null
  resetAutoRange()
  appendData(raw)
}

function clear(): void {
  buffer.clear()
  pointCount.value = 0
  sampleCache = null
  resetAutoRange()
  schedule()
}

function getStats(): ConstellationStats {
  const sample = renderSample(renderLimit())
  const s = computeConstellationStats(buffer.i, buffer.q, buffer.length)
  return { ...s, renderPoints: sample.count }
}

function getView(): ConstellationViewInfo {
  if (!canvasRef.value) return { ...lastView }
  const plot = plotMetrics()
  return resolveView(plot.w / Math.max(1, plot.h))
}

function setViewport(v: ConstellationProps['viewport']): void {
  if (!v || v.autoScale === true || !allViewport(v)) {
    view.auto = true
    resetAutoRange()
  } else {
    view.auto = false
    view.xMin = v.xMin as number
    view.xMax = v.xMax as number
    view.yMin = v.yMin as number
    view.yMax = v.yMax as number
  }
  schedule()
}

function resetView(): void {
  view.auto = true
  resetAutoRange()
  schedule()
  emit('viewportChange', getView())
}

function emitView(): void {
  emit('viewportChange', getView())
}

function pointerPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onWheel(e: WheelEvent): void {
  const p = pointerPos(e)
  const plot = plotMetrics()
  if (p.x < plot.x || p.x > plot.x + plot.w || p.y < plot.y || p.y > plot.y + plot.h) return
  e.preventDefault()
  const cur = resolveView(plot.w / Math.max(1, plot.h))
  const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2
  const anchorI = cur.xMin + ((p.x - plot.x) / plot.w) * (cur.xMax - cur.xMin)
  const anchorQ = cur.yMin + ((plot.y + plot.h - p.y) / plot.h) * (cur.yMax - cur.yMin)
  view.auto = false
  view.xMin = anchorI + (cur.xMin - anchorI) * factor
  view.xMax = anchorI + (cur.xMax - anchorI) * factor
  view.yMin = anchorQ + (cur.yMin - anchorQ) * factor
  view.yMax = anchorQ + (cur.yMax - anchorQ) * factor
  pointer = { x: p.x, y: p.y, inside: true }
  schedule()
  emitView()
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const p = pointerPos(e)
  const plot = plotMetrics()
  if (p.x < plot.x || p.x > plot.x + plot.w || p.y < plot.y || p.y > plot.y + plot.h) return
  const cur = resolveView(plot.w / Math.max(1, plot.h))
  drag = {
    clientX: e.clientX,
    clientY: e.clientY,
    xMin: cur.xMin,
    xMax: cur.xMax,
    yMin: cur.yMin,
    yMax: cur.yMax
  }
  pointer = { x: p.x, y: p.y, inside: true }
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  const p = pointerPos(e)
  pointer = { x: p.x, y: p.y, inside: true }
  if (!drag) {
    drawOverlayOnly()
    return
  }
  const plot = plotMetrics()
  const dx = ((e.clientX - drag.clientX) / Math.max(1, plot.w)) * (drag.xMax - drag.xMin)
  const dy = ((e.clientY - drag.clientY) / Math.max(1, plot.h)) * (drag.yMax - drag.yMin)
  view.auto = false
  view.xMin = drag.xMin - dx
  view.xMax = drag.xMax - dx
  view.yMin = drag.yMin + dy
  view.yMax = drag.yMax + dy
  schedule()
}

function onPointerUp(e: PointerEvent): void {
  if (!drag) return
  drag = null
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  emitView()
}

function onPointerLeave(): void {
  pointer.inside = false
  drag = null
  drawOverlayOnly()
}

function onDoubleClick(): void {
  resetView()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === '0') resetView()
  else if (e.key === '+' || e.key === '=') zoomCenter(1 / 1.2)
  else if (e.key === '-') zoomCenter(1.2)
}

function zoomCenter(factor: number): void {
  const plot = plotMetrics()
  const cur = resolveView(plot.w / Math.max(1, plot.h))
  view.auto = false
  view.xMin = ((cur.xMin + cur.xMax) / 2) * (1 - factor) + cur.xMin * factor
  view.xMax = ((cur.xMin + cur.xMax) / 2) * (1 - factor) + cur.xMax * factor
  view.yMin = ((cur.yMin + cur.yMax) / 2) * (1 - factor) + cur.yMin * factor
  view.yMax = ((cur.yMin + cur.yMax) / 2) * (1 - factor) + cur.yMax * factor
  schedule()
  emitView()
}

function compositeCanvas(): HTMLCanvasElement {
  const main = canvasRef.value
  const overlay = overlayRef.value
  const out = document.createElement('canvas')
  out.width = main?.width ?? 1
  out.height = main?.height ?? 1
  const ctx = out.getContext('2d')
  if (!ctx) return out
  ctx.fillStyle = th.value.bg
  ctx.fillRect(0, 0, out.width, out.height)
  if (main) ctx.drawImage(main, 0, 0, out.width, out.height)
  if (overlay) ctx.drawImage(overlay, 0, 0, out.width, out.height)
  return out
}

function pngFilename(): string {
  return `constellation-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
}

function exportPNG(): void {
  draw()
  deliverExport({
    kind: 'png',
    filename: pngFilename(),
    dataUrl: compositeCanvas().toDataURL('image/png')
  })
}

async function exportPNGAsync(): Promise<void> {
  draw()
  const filename = pngFilename()
  const blob = await new Promise<Blob | null>((resolve) =>
    compositeCanvas().toBlob(resolve, 'image/png')
  )
  if (!blob) {
    reportError('export', tr('common.pngEncodeFailed'))
    return
  }
  deliverExport({ kind: 'png', filename, blob })
}

function exportCSV(): void {
  if (buffer.length === 0) {
    reportError('export', tr('constellation.exportEmpty'))
    return
  }
  const i = buffer.i
  const q = buffer.q
  const parts = ['index,i,q']
  for (let k = 0; k < i.length; k++) parts.push(`${k},${i[k]},${q[k]}`)
  const filename = `constellation-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
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
      if (p.dataUrl) a.href = p.dataUrl
      else if (p.blob) {
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

onMounted(async () => {
  await nextTick()
  setupRenderer()
  if (props.data !== undefined) setData(props.data)
  schedule()
})
onUnmounted(() => {
  renderer?.dispose()
  canvasRenderer?.dispose()
  renderer = null
  canvasRenderer = null
  overlayCtx = null
})

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)
watch(
  () => props.maxPoints,
  (v) => {
    buffer.setMaxPoints(v)
    pointCount.value = buffer.length
    sampleCache = null
    resetAutoRange()
    schedule()
  }
)
watch(
  () => props.viewport,
  (v) => {
    if (!v || v.autoScale === true || !allViewport(v)) {
      view.auto = true
      resetAutoRange()
    } else {
      view.auto = false
      view.xMin = v.xMin as number
      view.xMax = v.xMax as number
      view.yMin = v.yMin as number
      view.yMax = v.yMax as number
    }
    schedule()
  },
  { deep: true, immediate: true }
)
watch(
  () => props.renderer,
  () => setupRenderer()
)
watch(
  [
    () => props.pointSize,
    () => props.alpha,
    () => props.axis,
    () => props.grid,
    () => props.axisLabels,
    () => props.showInfo,
    () => props.maxRenderPoints,
    () => props.locale,
    () => props.messages
  ],
  () => schedule()
)
watch([() => props.theme, () => props.chartStyle], () => schedule(), { deep: true })
watch(prefersDark, () => schedule())

defineExpose({
  appendData,
  setData,
  clear,
  getLength: () => buffer.length,
  getStats,
  getView,
  setViewport,
  resetView,
  fit: resetView,
  exportPNG,
  exportPNGAsync,
  exportCSV,
  getBackend: () => backend.value
})
</script>

<template>
  <div
    ref="rootRef"
    class="sig-const"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    tabindex="0"
    role="application"
    :aria-label="props.labels?.aria ?? tr('constellation.aria')"
    :style="{
      width: cssSize(props.width, '100%'),
      height: cssSize(props.height, '320px'),
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg,
      '--sig-text': th.text,
      '--sig-border': th.border
    }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="onPointerLeave"
    @dblclick="onDoubleClick"
    @keydown="onKeyDown"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <div class="sig-host-overlay"><slot name="overlay" /></div>
    <div v-if="props.showInfo !== false" class="sig-tag">
      {{ tr('constellation.points', { n: pointCount }) }} · {{ backendLabel }}
    </div>
    <div v-if="unsupported" class="sig-unsupported">
      {{ tr('constellation.webglUnsupported') }}
    </div>
  </div>
</template>

<style scoped>
.sig-const {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--sig-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sig-bg, #fff);
  cursor: crosshair;
  outline: none;
}
.sig-const:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sig-text) 35%, transparent);
}
.sig-canvas,
.sig-overlay {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.sig-overlay {
  pointer-events: none;
}
.sig-host-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.sig-tag {
  position: absolute;
  right: 10px;
  top: 8px;
  font-size: 11px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  pointer-events: none;
}
.sig-dark {
  --sig-bg: #0f1115;
  --sig-border: #2a2e39;
  --sig-text: #c9d1d9;
}
.sig-light {
  --sig-bg: #fff;
  --sig-border: #e6e8eb;
  --sig-text: #1f2328;
}
.sig-unsupported {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 92%, transparent);
}
</style>
