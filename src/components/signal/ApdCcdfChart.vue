<script setup lang="ts">
/**
 * ApdCcdfChart（幅度概率分布 / 互补累积分布）
 * - 纯显示：调用方给 APD/CCDF 曲线
 * - 可选 analysis：把 appendData 的功率样本转成 APD/CCDF
 * - 不做 FFT/解调；X=dB，Y=%
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { drawAxisOverlay, niceTicks } from './core/axis'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { toFloat32Samples } from './core/adapters'
import { computeApdCcdf } from './core/apd'
import type { ApdCcdfData, ApdCcdfProps } from './core/types'

const props = withDefaults(defineProps<ApdCcdfProps>(), {
  theme: 'auto',
  fpsLimit: 30,
  showInfo: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  lineWidth: 1.5,
  renderer: 'canvas2d'
})

const emit = defineEmits<{
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'error', message: string): void
  (e: 'errorDetail', p: { code: 'data'; message: string }): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const data = ref<ApdCcdfData | null>(null)
const prefersDark = usePrefersDark()
let ctx: CanvasRenderingContext2D | null = null
let lastSamples: Float32Array | null = null

const theme = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle })
)
const viewWidth = computed(() => cssSize(props.width, '100%'))
const viewHeight = computed(() => cssSize(props.height, '360px'))
const analysisOn = computed(() => !!props.analysis && props.analysis.enabled !== false)
const info = computed(() => {
  const d = data.value
  if (!d || d.sampleCount <= 0) return ''
  return `${d.sampleCount} ${tr('apd.samples')} · ${tr('apd.mean')} ${d.meanDb.toFixed(1)} dB · ${tr('apd.peak')} ${d.peakDb.toFixed(1)} dB · ${tr('apd.papr')} ${d.paprDb.toFixed(1)} dB · ${tr('apd.ccdf01')} ${d.p01Db.toFixed(1)} dB`
})

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: () => draw(),
  onDraw: () => draw()
})

function tr(key: ChartMessageKey, params?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, params)
}
function report(message: string): void {
  emit('error', message)
  emit('errorDetail', { code: 'data', message })
}

function normalizeCurves(raw: unknown): ApdCcdfData | null {
  if (raw && typeof raw === 'object' && 'apd' in raw && 'ccdf' in raw) return raw as ApdCcdfData
  return null
}

function analyzeSamples(samples: Float32Array): void {
  const cfg = props.analysis ?? {}
  data.value = computeApdCcdf(samples, {
    bins: cfg.bins,
    minDb: cfg.minDb,
    maxDb: cfg.maxDb,
    linear: cfg.linear
  })
  glChart.scheduleDraw()
}

function appendData(raw: unknown): void {
  const curves = normalizeCurves(raw)
  if (curves) {
    data.value = curves
    lastSamples = null
    glChart.scheduleDraw()
    return
  }
  if (!analysisOn.value) {
    report(tr('apd.needCurves'))
    return
  }
  const samples = toFloat32Samples(raw as never)
  if (!samples) {
    report(tr('apd.badSamples'))
    return
  }
  lastSamples = samples
  analyzeSamples(samples)
}

function setData(raw: unknown): void {
  const curves = normalizeCurves(raw)
  if (curves) {
    data.value = curves
    lastSamples = null
    glChart.scheduleDraw()
    return
  }
  const samples = toFloat32Samples(raw as never)
  if (!samples) {
    data.value = null
    lastSamples = null
    glChart.scheduleDraw()
    return
  }
  if (!analysisOn.value) {
    report(tr('apd.needCurves'))
    return
  }
  lastSamples = samples
  analyzeSamples(samples)
}

function clear(): void {
  data.value = null
  lastSamples = null
  glChart.scheduleDraw()
}

function plotMetrics(): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, glChart.width.value / Math.max(1, glChart.dpr.value))
  const h = Math.max(1, glChart.height.value / Math.max(1, glChart.dpr.value))
  return { x: 58, y: 34, w: Math.max(1, w - 76), h: Math.max(1, h - 64) }
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
  const d = data.value
  const x0 = d && d.apd.x.length ? d.apd.x[0]! : 0
  const x1 = d && d.apd.x.length ? d.apd.x[d.apd.x.length - 1]! : 1
  const vals = Array.from(d?.apd.y ?? [])
  const ccdf = Array.from(d?.ccdf.y ?? [])
  const maxY = Math.max(100, ...vals, ...ccdf)
  if (props.axis) {
    const xt = niceTicks(x0, x1, 6)
    drawAxisOverlay(ctx, {
      plot,
      xMin: x0,
      xMax: x1,
      yMin: 0,
      yMax: Math.min(100, maxY),
      showX: props.xAxis,
      showGrid: props.grid,
      theme: { text: t.text, grid: t.grid, axisLine: t.border, labelChipBg: t.labelChipBg },
      yTickFormat: (v) => `${v.toFixed(0)}%`,
      xTicksOverride: { values: xt, labels: xt.map((v) => `${v.toFixed(1)} dB`) }
    })
  }
  if (props.axisLabels !== false && props.axis) {
    ctx.fillStyle = t.text
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('dB', plot.x + plot.w, plot.y + plot.h - 4)
    ctx.textAlign = 'left'
  }
  if (!d || d.apd.x.length === 0) {
    ctx.fillStyle = t.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(
      analysisOn.value ? tr('apd.waitingSamples') : tr('apd.waitingCurves'),
      plot.x + plot.w / 2,
      plot.y + plot.h / 2
    )
    ctx.textAlign = 'left'
    return
  }
  const drawCurve = (curve: { x: Float32Array; y: Float32Array }, color: string): void => {
    ctx!.strokeStyle = color
    ctx!.lineWidth = props.lineWidth
    ctx!.globalAlpha = 0.95
    ctx!.beginPath()
    for (let i = 0; i < curve.x.length; i++) {
      const x = plot.x + ((curve.x[i]! - x0) / Math.max(1e-12, x1 - x0)) * plot.w
      const y = plot.y + (1 - Math.min(100, curve.y[i]!) / 100) * plot.h
      if (i === 0) ctx!.moveTo(x, y)
      else ctx!.lineTo(x, y)
    }
    ctx!.stroke()
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.w, plot.h)
  ctx.clip()
  drawCurve(d.apd, t.traceI)
  drawCurve(d.ccdf, t.traceQ)
  ctx.restore()
  ctx.globalAlpha = 1
  // 图例（右上，避开左侧 Y 轴与信息栏）
  const lx = plot.x + plot.w - 108
  ctx.fillStyle = t.traceI
  ctx.fillRect(lx, plot.y + 8, 12, 2)
  ctx.fillStyle = t.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText('APD', lx + 16, plot.y + 13)
  ctx.fillStyle = t.traceQ
  ctx.fillRect(lx + 54, plot.y + 8, 12, 2)
  ctx.fillStyle = t.text
  ctx.fillText('CCDF', lx + 70, plot.y + 13)
}

function getStats(): ApdCcdfData | null {
  return data.value
}
function getBackend(): 'canvas2d' {
  return 'canvas2d'
}
function exportPNG(): string | null {
  return canvasRef.value?.toDataURL('image/png') ?? null
}
function exportCSV(): void {
  const d = data.value
  const lines = ['type,level_db,probability_percent']
  if (d) {
    for (let i = 0; i < d.apd.x.length; i++) lines.push(`apd,${d.apd.x[i]},${d.apd.y[i]}`)
    for (let i = 0; i < d.ccdf.x.length; i++) lines.push(`ccdf,${d.ccdf.x[i]},${d.ccdf.y[i]}`)
  }
  const filename = `apd-ccdf-${Date.now()}.csv`
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
  () => props.data,
  (v) => {
    if (v !== undefined) {
      data.value = v
      lastSamples = null
      glChart.scheduleDraw()
    }
  },
  { immediate: true }
)
watch(
  () => props.analysis,
  () => {
    if (lastSamples && analysisOn.value) analyzeSamples(lastSamples)
    glChart.scheduleDraw()
  },
  { deep: true }
)
watch(
  () => [props.theme, props.chartStyle, props.lineWidth],
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
  lastSamples = null
})

defineExpose({ appendData, setData, clear, getStats, getBackend, exportPNG, exportCSV })
</script>

<template>
  <div
    class="sig-apd"
    role="img"
    :aria-label="tr('apd.aria')"
    :style="{ width: viewWidth, height: viewHeight, background: theme.bg }"
  >
    <canvas ref="canvasRef" class="sig-apd-canvas" />
    <div v-if="props.showInfo !== false" class="sig-apd-info">{{ info || tr('apd.noData') }}</div>
    <div class="sig-apd-backend">Canvas2D</div>
  </div>
</template>

<style scoped>
.sig-apd {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}
.sig-apd-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.sig-apd-info {
  position: absolute;
  top: 8px;
  left: 58px;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.sig-apd-backend {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: #888;
  pointer-events: none;
}
</style>
