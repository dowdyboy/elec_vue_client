<script setup lang="ts">
/**
 * EyeDiagramChart（眼图）
 * - 输入：调用方切好的眼图轨迹（每段 2UI/多 UI），组件只叠加绘制
 * - 默认纯显示；眼高/眼宽/抖动是从已给轨迹得到的显示测量，不做时钟恢复
 * - Canvas2D 叠加轨迹 + 轴/网格/自动量程；PNG/CSV
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { drawAxisOverlay, niceTicks } from './core/axis'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { toFloat32Samples } from './core/adapters'
import { YAutoScaler } from './core/yauto'
import { EyeBuffer, cleanEyeTrace, computeEyeStats, type EyeStats } from './core/eye'
import type { EyeDiagramProps, EyeInput } from './core/types'

const props = withDefaults(defineProps<EyeDiagramProps>(), {
  theme: 'auto',
  fpsLimit: 60,
  spanSymbols: 2,
  samplesPerSymbol: 32,
  maxTraces: 500,
  alpha: 0.55,
  lineWidth: 1,
  autoScale: true,
  showInfo: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  renderer: 'canvas2d'
})

const emit = defineEmits<{
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'error', message: string): void
  (e: 'errorDetail', p: { code: 'adapter' | 'data'; message: string }): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const stats = ref<EyeStats | null>(null)
const prefersDark = usePrefersDark()
const buffer = new EyeBuffer(props.maxTraces)
const yAuto = new YAutoScaler({ snap: true, hysteresis: 0.08, holdFrames: 60 })
let ctx: CanvasRenderingContext2D | null = null
let span = props.spanSymbols

const theme = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle })
)
const viewWidth = computed(() => cssSize(props.width, '100%'))
const viewHeight = computed(() => cssSize(props.height, '320px'))
const info = computed(() => {
  const s = stats.value
  if (!s?.measured) return ''
  return `${s.traceCount} ${tr('eye.traces')} · ${tr('eye.height')} ${s.height.toFixed(2)} · ${tr('eye.width')} ${(s.width * span).toFixed(2)} UI · ${tr('eye.jitter')} ${s.jitterUi.toFixed(3)} UI`
})

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: () => draw(),
  onDraw: () => draw()
})

function tr(key: ChartMessageKey, params?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, params)
}
function report(code: 'adapter' | 'data', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

function normalize(raw: unknown): Float32Array[] | null {
  let input: unknown = raw
  if (props.adapter) {
    try {
      input = props.adapter(raw as never)
    } catch (e) {
      report('adapter', e instanceof Error ? e.message : String(e))
      return null
    }
    if (!input) {
      report('adapter', tr('common.adapterNull'))
      return null
    }
  }
  if (input && typeof input === 'object' && 'traces' in input) {
    const o = input as EyeInput
    if (o.spanSymbols && o.spanSymbols > 0) span = o.spanSymbols
    return (o.traces ?? []).map(cleanEyeTrace).filter((t) => t.length >= 2)
  }
  if (Array.isArray(input)) {
    return input.map((t) => cleanEyeTrace(t as ArrayLike<number>)).filter((t) => t.length >= 2)
  }
  const one = toFloat32Samples(input as never)
  if (!one) return null
  return [cleanEyeTrace(one)]
}

function recompute(): void {
  const next = computeEyeStats(buffer.traces, span)
  stats.value = next
}

function appendData(raw: unknown): void {
  const traces = normalize(raw)
  if (!traces) return
  for (const t of traces) buffer.append(t)
  recompute()
  glChart.scheduleDraw()
}

function appendTraces(traces: Float32Array[]): void {
  for (const t of traces) buffer.append(cleanEyeTrace(t))
  recompute()
  glChart.scheduleDraw()
}

function setData(raw: unknown): void {
  buffer.clear()
  span = props.spanSymbols
  yAuto.reset()
  const traces = normalize(raw)
  if (traces) buffer.set(traces)
  recompute()
  glChart.scheduleDraw()
}

function clear(): void {
  buffer.clear()
  stats.value = null
  yAuto.reset()
  glChart.scheduleDraw()
}

function plotMetrics(): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, glChart.width.value / Math.max(1, glChart.dpr.value))
  const h = Math.max(1, glChart.height.value / Math.max(1, glChart.dpr.value))
  return { x: 56, y: 32, w: Math.max(1, w - 72), h: Math.max(1, h - 60) }
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  if (!ctx) ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = Math.max(1, glChart.dpr.value)
  const w = Math.max(1, glChart.width.value / dpr)
  const h = Math.max(1, glChart.height.value / dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const t = theme.value
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, w, h)
  const plot = plotMetrics()
  const traces = buffer.traces
  if (traces.length === 0) {
    if (props.axis) {
      drawAxisOverlay(ctx, {
        plot,
        xMin: 0,
        xMax: span,
        yMin: props.yMin ?? -1,
        yMax: props.yMax ?? 1,
        showX: props.xAxis,
        showGrid: props.grid,
        theme: {
          text: t.text,
          grid: t.grid,
          axisLine: t.border,
          labelChipBg: t.labelChipBg
        }
      })
    }
    ctx.fillStyle = t.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(tr('eye.waiting'), plot.x + plot.w / 2, plot.y + plot.h / 2)
    ctx.textAlign = 'left'
    return
  }
  let min = Infinity
  let max = -Infinity
  for (const tr of traces) {
    for (let i = 0; i < tr.length; i++) {
      const v = tr[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  let yMin = props.yMin
  let yMax = props.yMax
  if (props.autoScale || yMin === undefined || yMax === undefined) {
    const r = yAuto.resolve(min, max)
    yMin = r.min
    yMax = r.max
  }
  const y0 = yMin ?? -1
  const y1 = Math.max(y0 + 1e-9, yMax ?? 1)
  if (props.axis) {
    const xt = niceTicks(0, span, 5)
    drawAxisOverlay(ctx, {
      plot,
      xMin: 0,
      xMax: span,
      yMin: y0,
      yMax: y1,
      showX: props.xAxis,
      showGrid: props.grid,
      theme: {
        text: t.text,
        grid: t.grid,
        axisLine: t.border,
        labelChipBg: t.labelChipBg
      },
      xTicksOverride: { values: xt, labels: xt.map((v) => `${v.toFixed(2)} UI`) }
    })
  }
  if (props.axisLabels !== false && props.axis) {
    ctx.fillStyle = t.text
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText('UI', plot.x + 4, plot.y + 12)
    ctx.textAlign = 'right'
    ctx.fillText(tr('eye.axisX'), plot.x + plot.w, plot.y + plot.h - 4)
    ctx.textAlign = 'left'
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.w, plot.h)
  ctx.clip()
  ctx.strokeStyle = t.traceColor
  ctx.globalAlpha = Math.max(0.05, Math.min(1, props.alpha))
  ctx.lineWidth = Math.max(0.5, props.lineWidth)
  for (const tr of traces) {
    const denom = Math.max(1, tr.length - 1)
    ctx.beginPath()
    for (let i = 0; i < tr.length; i++) {
      const x = plot.x + (i / denom) * plot.w
      const y = plot.y + ((y1 - tr[i]!) / (y1 - y0)) * plot.h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function getStats(): EyeStats | null {
  return stats.value
}

function getTraceCount(): number {
  return buffer.length
}

function getBackend(): 'canvas2d' {
  return 'canvas2d'
}

function exportPNG(): string | null {
  return canvasRef.value?.toDataURL('image/png') ?? null
}

function exportCSV(): void {
  const lines = ['trace,index,ui,value']
  buffer.traces.forEach((t, ti) => {
    for (let i = 0; i < t.length; i++)
      lines.push(`${ti},${i},${((i / Math.max(1, t.length - 1)) * span).toFixed(6)},${t[i]}`)
  })
  const filename = `eye-${Date.now()}.csv`
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  emit('exported', { kind: 'csv', filename })
}

watch(
  () => props.maxTraces,
  (v) => {
    buffer.setMaxTraces(v)
    recompute()
    glChart.scheduleDraw()
  }
)
watch(
  () => props.spanSymbols,
  (v) => {
    span = v
    yAuto.reset()
    recompute()
    glChart.scheduleDraw()
  }
)
watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  },
  { immediate: true }
)
watch(
  () => [props.theme, props.chartStyle, props.alpha, props.autoScale],
  () => glChart.scheduleDraw(),
  { deep: true }
)
watch(prefersDark, () => glChart.scheduleDraw())

onMounted(async () => {
  await nextTick()
  ctx = canvasRef.value?.getContext('2d') ?? null
  glChart.scheduleDraw()
})
onUnmounted(() => {
  ctx = null
})

defineExpose({
  appendData,
  appendTraces,
  setData,
  clear,
  getStats,
  getTraceCount,
  getBackend,
  exportPNG,
  exportCSV
})
</script>

<template>
  <div
    class="sig-eye"
    role="img"
    :aria-label="tr('eye.aria')"
    :style="{ width: viewWidth, height: viewHeight, background: theme.bg }"
  >
    <canvas ref="canvasRef" class="sig-eye-canvas" />
    <div v-if="props.showInfo !== false" class="sig-eye-info">{{ info || tr('eye.noData') }}</div>
    <div class="sig-eye-backend">Canvas2D</div>
  </div>
</template>

<style scoped>
.sig-eye {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}
.sig-eye-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.sig-eye-info {
  position: absolute;
  top: 8px;
  left: 58px;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.sig-eye-backend {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: #888;
  pointer-events: none;
}
</style>
