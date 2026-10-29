<script setup lang="ts">
/**
 * PowerTimeChart（功率-时间 / 零扫宽）
 * - 默认纯显示：只接收功率序列，不要求脉冲分析
 * - 可选 analysis：门限 + 滞回 + 最小脉宽，输出脉冲/占空比/PAPR
 * - 时间轴由 timeStepSec/sampleRate 推导；不传按样本序号显示
 * - 轴/网格/自动量程/导出/主题/i18n；GL 线渲染，失败回退 Canvas2D
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { drawAxisOverlay, niceTicks } from './core/axis'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import { createCanvasLineRenderer } from './core/canvasRenderer'
import { createLineRenderer, type LineRenderer } from './core/gl'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { toFloat32Samples } from './core/adapters'
import { YAutoScaler } from './core/yauto'
import {
  PowerBuffer,
  analyzePowerPulses,
  cleanPowerValues,
  computePowerStats,
  type PulseAnalysis
} from './core/power'
import type { PowerTimeNormalized, PowerTimeProps } from './core/types'

const props = withDefaults(defineProps<PowerTimeProps>(), {
  theme: 'auto',
  fpsLimit: 60,
  mode: 'line',
  lineWidth: 1,
  span: 4096,
  autoScale: true,
  showInfo: true,
  follow: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  maxPoints: 500_000,
  unit: 'dB',
  renderer: 'auto'
})

const emit = defineEmits<{
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'error', message: string): void
  (e: 'errorDetail', p: { code: 'adapter' | 'webgl' | 'data'; message: string }): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const pointCount = ref(0)
const backend = ref<'webgl2' | 'canvas2d' | 'none'>('none')
const pulseResult = ref<PulseAnalysis | null>(null)
const prefersDark = usePrefersDark()

const buffer = new PowerBuffer(props.maxPoints)
const yAuto = new YAutoScaler({ snap: true, hysteresis: 0.12, holdFrames: 90 })
let timeStepSec = 1
let startTimeSec = 0
let hasTimeAxis = false
let lineRenderer: LineRenderer | null = null
let gl: WebGL2RenderingContext | null = null
let ctx2d: CanvasRenderingContext2D | null = null
let ovCtx: CanvasRenderingContext2D | null = null
let manualView: { xMin: number; xMax: number } | null = null
let dragging = false
let dragX = 0
let dragStart = 0
let lastAnalyze = 0

const resolvedTheme = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle })
)
const analysisOn = computed(() => !!props.analysis && props.analysis.enabled !== false)
const threshold = computed(() => {
  const v = props.analysis?.thresholdDb ?? props.thresholdDb
  return Number.isFinite(v) ? (v as number) : undefined
})
const info = computed(() => {
  void pointCount.value
  const s = computePowerStats(buffer.values, buffer.length)
  const unit = props.unit
  if (!s.count) return ''
  const base = `${tr('powerTime.peak')} ${s.peak.toFixed(1)} ${unit} · ${tr('powerTime.mean')} ${s.mean.toFixed(1)} ${unit}`
  if (!analysisOn.value || !pulseResult.value?.measured) return base
  const p = pulseResult.value
  return `${base} · ${tr('powerTime.pulseCount', { n: p.count })} · ${tr('powerTime.width')} ${formatDuration(p.widthMeanSec)} · ${tr('powerTime.duty')} ${(p.dutyCycle * 100).toFixed(1)}%`
})
const viewWidth = computed(() => cssSize(props.width, '100%'))
const viewHeight = computed(() => cssSize(props.height, '320px'))

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: () => draw(),
  onDraw: () => draw()
})

function tr(key: ChartMessageKey, params?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, params)
}

function reportError(code: 'adapter' | 'webgl' | 'data', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

function formatDuration(sec: number): string {
  if (!(sec > 0)) return '0 s'
  if (sec < 1e-6) return `${(sec * 1e9).toFixed(1)} ns`
  if (sec < 1e-3) return `${(sec * 1e6).toFixed(1)} µs`
  if (sec < 1) return `${(sec * 1e3).toFixed(2)} ms`
  return `${sec.toFixed(3)} s`
}

function formatTime(x: number): string {
  if (!hasTimeAxis) return x.toFixed(0)
  const t = startTimeSec + x * timeStepSec
  if (!(timeStepSec > 0)) return x.toFixed(0)
  if (Math.abs(t) < 1e-3) return `${(t * 1e6).toFixed(1)} µs`
  if (Math.abs(t) < 1) return `${(t * 1e3).toFixed(2)} ms`
  return `${t.toFixed(3)} s`
}

function normalize(raw: unknown): PowerTimeNormalized | null {
  let input: unknown = raw
  if (props.adapter) {
    try {
      input = props.adapter(raw as never)
    } catch (e) {
      reportError('adapter', e instanceof Error ? e.message : String(e))
      return null
    }
    if (!input) {
      reportError('adapter', tr('common.adapterNull'))
      return null
    }
  }
  if (!ArrayBuffer.isView(input) && input && typeof input === 'object' && 'values' in input) {
    const o = input as {
      values: unknown
      timeStepSec?: number
      sampleRate?: number
      startTimeSec?: number
    }
    const values = toFloat32Samples(o.values as never)
    if (!values) return null
    return {
      values,
      timeStepSec: o.timeStepSec,
      sampleRate: o.sampleRate,
      startTimeSec: o.startTimeSec
    }
  }
  const values = toFloat32Samples(input as never)
  if (!values) return null
  return { values }
}

function resolveTiming(meta?: PowerTimeNormalized): void {
  const rate = meta?.sampleRate ?? props.sampleRate ?? 0
  const explicitStep = meta?.timeStepSec ?? props.timeStepSec ?? 0
  hasTimeAxis = explicitStep > 0 || rate > 0
  timeStepSec = explicitStep > 0 ? explicitStep : rate > 0 ? 1 / rate : 1
  startTimeSec = meta?.startTimeSec ?? props.startTimeSec ?? 0
}

function analyzeIfNeeded(force = false): void {
  if (!analysisOn.value || threshold.value === undefined) {
    if (!analysisOn.value) pulseResult.value = null
    return
  }
  const now = Date.now()
  if (!force && now - lastAnalyze < 250) return
  lastAnalyze = now
  const cfg = props.analysis ?? {}
  pulseResult.value = analyzePowerPulses(
    buffer.values.subarray(0, buffer.length),
    threshold.value ?? 0,
    cfg.hysteresisDb ?? 3,
    timeStepSec,
    cfg.minWidthSec ?? 0,
    cfg.maxPulses ?? 512
  )
}

function appendData(raw: unknown): void {
  const p = normalize(raw)
  if (!p) return
  resolveTiming(p)
  const values = cleanPowerValues(p.values)
  buffer.append(values)
  pointCount.value = buffer.length
  if (analysisOn.value) analyzeIfNeeded()
  glChart.scheduleDraw()
}

function setData(raw: unknown): void {
  buffer.clear()
  manualView = null
  yAuto.reset()
  pulseResult.value = null
  pointCount.value = 0
  const p = normalize(raw)
  if (!p) return
  resolveTiming(p)
  buffer.set(cleanPowerValues(p.values))
  pointCount.value = buffer.length
  if (analysisOn.value) analyzeIfNeeded(true)
  glChart.scheduleDraw()
}

function clear(): void {
  buffer.clear()
  manualView = null
  yAuto.reset()
  pulseResult.value = null
  pointCount.value = 0
  glChart.scheduleDraw()
}

function visibleRange(): { xMin: number; xMax: number; n: number } {
  const n = buffer.length
  const span = Math.max(2, Math.floor(props.span))
  const xMax = n > 0 ? n - 1 : 1
  let xMin = Math.max(0, n - span)
  if (manualView) {
    xMin = Math.max(0, Math.min(manualView.xMin, n - 2))
    return { xMin, xMax: Math.max(xMin + 1, Math.min(manualView.xMax, n - 1)), n }
  }
  if (!props.follow) xMin = 0
  return { xMin, xMax, n }
}

function plotMetrics(): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, glChart.width.value / Math.max(1, glChart.dpr.value))
  const h = Math.max(1, glChart.height.value / Math.max(1, glChart.dpr.value))
  const left = 56
  const right = 16
  const top = 30
  const bottom = 28
  return { x: left, y: top, w: Math.max(1, w - left - right), h: Math.max(1, h - top - bottom) }
}

function draw(): void {
  const ov = overlayRef.value
  if (!ov || !lineRenderer) return
  const cw = Math.max(1, glChart.width.value)
  const ch = Math.max(1, glChart.height.value)
  if (ov.width !== cw || ov.height !== ch) {
    ov.width = cw
    ov.height = ch
  }
  const plot = plotMetrics()
  const { xMin, xMax, n } = visibleRange()
  if (n <= 1) {
    lineRenderer.setData(new Float32Array(0))
    if (gl) {
      gl.viewport(0, 0, cw, ch)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else if (ctx2d) ctx2d.clearRect(0, 0, cw, ch)
    drawOverlay(plot, xMin, xMax, 0, 1, true)
    return
  }
  const visible = buffer.values.subarray(0, n)
  const stats = computePowerStats(visible.subarray(xMin, xMax + 1))
  let yMinValue = props.yMin
  let yMaxValue = props.yMax
  if (props.autoScale || yMinValue === undefined || yMaxValue === undefined) {
    const r = yAuto.resolve(
      Number.isFinite(stats.min) ? stats.min : 0,
      Number.isFinite(stats.max) ? stats.max : 1
    )
    yMinValue = r.min
    yMaxValue = r.max
  }
  const yMin = yMinValue ?? 0
  const yMax = Math.max(yMin + 1e-9, yMaxValue ?? 1)
  lineRenderer.setData(visible)
  lineRenderer.draw(
    { xMin, xMax, yMin, yMax },
    resolvedTheme.value.traceColor,
    true,
    plot,
    false,
    props.mode === 'dots' ? 2 : 0,
    props.lineWidth
  )
  drawOverlay(plot, xMin, xMax, yMin, yMax, false)
}

function drawOverlay(
  plot: { x: number; y: number; w: number; h: number },
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  empty: boolean
): void {
  const ov = overlayRef.value
  if (!ov) return
  if (!ovCtx) ovCtx = ov.getContext('2d')
  const ctx = ovCtx
  if (!ctx) return
  const sx = ov.width / Math.max(1, ov.getBoundingClientRect().width)
  const sy = ov.height / Math.max(1, ov.getBoundingClientRect().height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.clearRect(0, 0, ov.width / sx, ov.height / sy)
  const theme = resolvedTheme.value
  const xTicks = niceTicks(xMin, xMax, 6)
  if (props.axis) {
    drawAxisOverlay(ctx, {
      plot,
      xMin,
      xMax,
      yMin,
      yMax,
      showX: props.xAxis,
      showGrid: props.grid,
      frame: true,
      theme: {
        text: theme.text,
        grid: theme.grid,
        axisLine: theme.border,
        labelChipBg: theme.labelChipBg
      },
      xTicksOverride: {
        values: xTicks,
        labels: xTicks.map((v) => formatTime(v + buffer.offset))
      }
    })
  }
  if (props.axisLabels !== false && props.axis) {
    ctx.fillStyle = theme.text
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(props.unit || tr('powerTime.axisY'), plot.x + 4, plot.y + 12)
    ctx.textAlign = 'right'
    ctx.fillText(
      hasTimeAxis ? tr('powerTime.axisXTime') : tr('powerTime.axisXSamples'),
      plot.x + plot.w,
      plot.y + plot.h - 4
    )
  }
  if (empty) {
    ctx.fillStyle = theme.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(tr('powerTime.waiting'), plot.x + plot.w / 2, plot.y + plot.h / 2)
    ctx.textAlign = 'left'
    return
  }
  const xToPx = (x: number): number => plot.x + ((x - xMin) / (xMax - xMin)) * plot.w
  const yToPx = (v: number): number => plot.y + ((yMax - v) / (yMax - yMin)) * plot.h
  if (threshold.value !== undefined) {
    const y = yToPx(threshold.value)
    if (y > plot.y && y < plot.y + plot.h) {
      ctx.save()
      ctx.strokeStyle = theme.triggerColor
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
      ctx.fillStyle = theme.triggerColor
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${threshold.value.toFixed(1)} ${props.unit}`, plot.x + plot.w - 4, y - 3)
      ctx.textAlign = 'left'
      ctx.restore()
    }
  }
  if (analysisOn.value && pulseResult.value?.measured) {
    const p = pulseResult.value
    const bands = p.pulses
    ctx.save()
    ctx.fillStyle = `${theme.triggerColor}22`
    for (const pulse of bands) {
      const x0 = xToPx(pulse.startIndex)
      const x1 = xToPx(pulse.endIndex)
      if (x1 < plot.x || x0 > plot.x + plot.w) continue
      ctx.fillRect(
        Math.max(plot.x, x0),
        plot.y,
        Math.max(1, Math.min(plot.x + plot.w, x1) - Math.max(plot.x, x0)),
        plot.h
      )
    }
    ctx.restore()
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const n = buffer.length
  if (n < 2) return
  const cur = visibleRange()
  const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2
  const center = (cur.xMin + cur.xMax) / 2
  const half = ((cur.xMax - cur.xMin) / 2) * factor
  manualView = {
    xMin: Math.max(0, center - half),
    xMax: Math.min(n - 1, center + half)
  }
  glChart.scheduleDraw()
}

function onPointerDown(e: PointerEvent): void {
  if (!manualView) return
  dragging = true
  dragX = e.clientX
  dragStart = manualView.xMin
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging || !manualView) return
  const plot = plotMetrics()
  const n = buffer.length
  const dx = ((e.clientX - dragX) / Math.max(1, plot.w)) * (manualView.xMax - manualView.xMin)
  const left = Math.max(0, Math.min(n - 2, dragStart - dx))
  const width = manualView.xMax - manualView.xMin
  manualView = { xMin: left, xMax: Math.min(n - 1, left + width) }
  glChart.scheduleDraw()
}

function onPointerUp(): void {
  dragging = false
}

function resetView(): void {
  manualView = null
  yAuto.reset()
  glChart.scheduleDraw()
}

function setupContext(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const backendProp = props.renderer
  if (backendProp !== 'canvas2d') {
    gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true })
  }
  if (!gl && backendProp !== 'webgl2') {
    ctx2d = canvas.getContext('2d')
  }
  if (gl) {
    try {
      lineRenderer = createLineRenderer(canvas, gl)
      backend.value = 'webgl2'
    } catch (e) {
      backend.value = 'none'
      reportError('webgl', e instanceof Error ? e.message : tr('powerTime.webglUnsupported'))
    }
  } else if (ctx2d) {
    try {
      lineRenderer = createCanvasLineRenderer(canvas)
      backend.value = 'canvas2d'
    } catch (e) {
      backend.value = 'none'
      reportError('webgl', e instanceof Error ? e.message : tr('powerTime.webglUnsupported'))
    }
  } else {
    backend.value = 'none'
    reportError('webgl', tr('powerTime.webglUnsupported'))
  }
}

function getStats(): ReturnType<typeof computePowerStats> {
  return computePowerStats(buffer.values, buffer.length)
}

function getPulses(): PulseAnalysis | null {
  return pulseResult.value
}

function exportCSV(): void {
  const lines = ['index,timeSec,power']
  for (let i = 0; i < buffer.length; i++)
    lines.push(
      `${buffer.offset + i},${((buffer.offset + i) * timeStepSec + startTimeSec).toFixed(9)},${buffer.values[i]}`
    )
  const filename = `power-time-${Date.now()}.csv`
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  emit('exported', { kind: 'csv', filename })
}

function exportPNG(): string | null {
  if (!canvasRef.value) return null
  return canvasRef.value.toDataURL('image/png')
}

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  },
  { immediate: true }
)
watch(
  () => props.maxPoints,
  (v) => {
    buffer.setMaxPoints(v)
    pointCount.value = buffer.length
    glChart.scheduleDraw()
  }
)
watch(
  () => [props.timeStepSec, props.sampleRate, props.startTimeSec],
  () => {
    yAuto.reset()
    glChart.scheduleDraw()
  }
)
watch(
  () => JSON.stringify(props.analysis ?? null),
  () => {
    pulseResult.value = null
    analyzeIfNeeded(true)
    glChart.scheduleDraw()
  }
)
watch(
  () => [props.theme, props.chartStyle],
  () => glChart.scheduleDraw(),
  { deep: true }
)
watch(prefersDark, () => glChart.scheduleDraw())

onMounted(async () => {
  await nextTick()
  setupContext()
  ovCtx = overlayRef.value?.getContext('2d') ?? null
  glChart.scheduleDraw()
})
onUnmounted(() => {
  lineRenderer?.dispose()
  lineRenderer = null
})

defineExpose({
  appendData,
  setData,
  clear,
  resetView,
  getStats,
  getPulses,
  exportPNG,
  exportCSV,
  getBackend: () => backend.value
})
</script>

<template>
  <div
    class="sig-power"
    role="img"
    :aria-label="tr('powerTime.aria')"
    :style="{ width: viewWidth, height: viewHeight, background: resolvedTheme.bg }"
  >
    <canvas ref="canvasRef" class="sig-power-canvas" />
    <canvas
      ref="overlayRef"
      class="sig-power-overlay"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @dblclick="resetView"
    />
    <div v-if="props.showInfo !== false" class="sig-power-info">
      {{ info || tr('powerTime.noData') }}
    </div>
    <div v-if="backend === 'canvas2d'" class="sig-power-backend">Canvas2D</div>
  </div>
</template>

<style scoped>
.sig-power {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}
.sig-power-canvas,
.sig-power-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.sig-power-overlay {
  touch-action: none;
  cursor: crosshair;
}
.sig-power-info {
  position: absolute;
  top: 8px;
  left: 58px;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.sig-power-backend {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: #888;
  pointer-events: none;
}
</style>
