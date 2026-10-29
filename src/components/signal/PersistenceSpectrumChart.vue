<script setup lang="ts">
/**
 * PersistenceSpectrumChart（持续谱/密度谱）
 * - 纯显示：调用方直接给频率×幅度密度矩阵
 * - 可选 analysis：把 appendData 的 dB 谱逐帧累加到密度矩阵
 * - Canvas2D 热力图 + 轴/色标/游标；不做 FFT/检波
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { drawAxisOverlay, niceTicks } from './core/axis'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { toFloat32Samples } from './core/adapters'
import { colorMapLut } from './core/spectrogram'
import { PersistenceBuffer, type PersistenceStats } from './core/persistence'
import type { PersistenceMatrix, PersistenceProps, SpectrumMode } from './core/types'

const props = withDefaults(defineProps<PersistenceProps>(), {
  theme: 'auto',
  fpsLimit: 30,
  levels: 256,
  minDb: -120,
  maxDb: 0,
  colorMap: 'viridis',
  gamma: 1,
  showInfo: true,
  showColorbar: true,
  showCursor: true,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  spectrumMode: 'real' as SpectrumMode,
  renderer: 'canvas2d'
})

const emit = defineEmits<{
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'error', message: string): void
  (e: 'errorDetail', p: { code: 'adapter' | 'data'; message: string }): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const stats = ref<PersistenceStats | null>(null)
const cursor = ref<{ bin: number; level: number; count: number } | null>(null)
const prefersDark = usePrefersDark()
const buffer = new PersistenceBuffer({
  width: props.bins ?? 512,
  height: props.levels,
  minDb: props.minDb,
  maxDb: props.maxDb,
  decay: props.analysis?.decay ?? 0
})
let ctx: CanvasRenderingContext2D | null = null
let imageCanvas: HTMLCanvasElement | null = null
let imageCtx: CanvasRenderingContext2D | null = null
let imageData: ImageData | null = null
let imageDirty = true
let lut = colorMapLut(props.colorMap, 256)

const theme = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle })
)
const viewWidth = computed(() => cssSize(props.width, '100%'))
const viewHeight = computed(() => cssSize(props.height, '360px'))
const analysisOn = computed(() => !!props.analysis && props.analysis.enabled !== false)
const binHz = computed(() => {
  if (props.binHz && props.binHz > 0) return props.binHz
  if (props.sampleRate && props.fftSize) return props.sampleRate / props.fftSize
  return 1
})
const freqStart = computed(() => {
  if (props.freqStartHz !== undefined) return props.freqStartHz
  return props.spectrumMode === 'complex' && props.fftShift !== false
    ? -((buffer.width * binHz.value) / 2)
    : 0
})
const info = computed(() => {
  const s = stats.value
  if (!s) return ''
  return `${s.width} ${tr('persistence.bins')} × ${s.height} ${tr('persistence.levels')} · ${s.frames} ${tr('persistence.frames')} · ${tr('persistence.max')} ${formatCount(s.max)}`
})

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: () => {
    draw()
  },
  onDraw: () => draw()
})

function tr(key: ChartMessageKey, params?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, params)
}
function report(code: 'adapter' | 'data', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}
function formatCount(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return v.toFixed(0)
}
function formatFreq(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(3)} GHz`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(3)} MHz`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(3)} kHz`
  return `${v.toFixed(0)} Hz`
}

function markDirty(): void {
  imageDirty = true
  stats.value = buffer.getStats()
  glChart.scheduleDraw()
}

function ensureBuffer(): void {
  const targetWidth = props.bins && props.bins > 1 ? props.bins : buffer.width
  buffer.configure({
    width: targetWidth,
    height: props.levels,
    minDb: props.minDb,
    maxDb: props.maxDb,
    decay: props.analysis?.decay ?? 0
  })
  imageDirty = true
}

function normalizeInput(raw: unknown): PersistenceMatrix | Float32Array | null {
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
  if (input && typeof input === 'object' && 'density' in input) return input as PersistenceMatrix
  const samples = toFloat32Samples(input as never)
  return samples ?? null
}

function appendData(raw: unknown): void {
  const input = normalizeInput(raw)
  if (!input) return
  ensureBuffer()
  if (input instanceof Float32Array) {
    if (!analysisOn.value) {
      report('data', tr('persistence.needMatrix'))
      return
    }
    const width = props.bins && props.bins > 1 ? props.bins : input.length
    if (buffer.width !== width) {
      buffer.configure({ width })
      imageDirty = true
    }
    buffer.addSpectrum(input, { minDb: props.minDb, maxDb: props.maxDb })
  } else {
    buffer.setMatrix(input)
    imageDirty = true
  }
  markDirty()
}

function setData(raw: unknown): void {
  const input = normalizeInput(raw)
  if (!input) return
  buffer.clear()
  ensureBuffer()
  if (input instanceof Float32Array) {
    if (!analysisOn.value) {
      report('data', tr('persistence.needMatrix'))
      return
    }
    const width = props.bins && props.bins > 1 ? props.bins : input.length
    buffer.configure({ width })
    buffer.addSpectrum(input, { minDb: props.minDb, maxDb: props.maxDb })
  } else {
    buffer.setMatrix(input)
  }
  imageDirty = true
  markDirty()
}

function clear(): void {
  buffer.clear()
  stats.value = buffer.getStats()
  imageDirty = true
  cursor.value = null
  glChart.scheduleDraw()
}

function rebuildImage(): void {
  const w = buffer.width
  const h = buffer.height
  if (!imageCanvas || imageCanvas.width !== w || imageCanvas.height !== h) {
    imageCanvas = document.createElement('canvas')
    imageCanvas.width = w
    imageCanvas.height = h
    imageCtx = imageCanvas.getContext('2d')
    imageData = imageCtx?.createImageData(w, h) ?? null
  }
  if (!imageCtx || !imageData) return
  const t = buffer.normalize(props.gamma)
  const px = imageData.data
  for (let y = 0; y < h; y++) {
    const level = h - 1 - y
    for (let x = 0; x < w; x++) {
      const v = t[level * w + x]!
      const lutIdx = Math.max(0, Math.min(255, Math.round(v * 255))) * 4
      const p = (y * w + x) * 4
      px[p] = lut[lutIdx]!
      px[p + 1] = lut[lutIdx + 1]!
      px[p + 2] = lut[lutIdx + 2]!
      px[p + 3] = 255
    }
  }
  imageCtx.putImageData(imageData, 0, 0)
  imageDirty = false
}

function plotMetrics(): { x: number; y: number; w: number; h: number; barX: number; barW: number } {
  const w = Math.max(1, glChart.width.value / Math.max(1, glChart.dpr.value))
  const h = Math.max(1, glChart.height.value / Math.max(1, glChart.dpr.value))
  const left = 56
  const right = props.showColorbar !== false ? 78 : 16
  const top = 32
  const bottom = 28
  return {
    x: left,
    y: top,
    w: Math.max(1, w - left - right),
    h: Math.max(1, h - top - bottom),
    barX: w - 64,
    barW: 14
  }
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
  const th = theme.value
  ctx.fillStyle = th.bg
  ctx.fillRect(0, 0, w, h)
  const plot = plotMetrics()
  if (imageDirty) rebuildImage()
  const hasData = buffer.getStats().occupied > 0
  if (!hasData) {
    if (props.axis) {
      drawAxisOverlay(ctx, {
        plot,
        xMin: 0,
        xMax: buffer.width,
        yMin: buffer.minDb,
        yMax: buffer.maxDb,
        showX: props.xAxis,
        showGrid: props.grid,
        theme: { text: th.text, grid: th.grid, axisLine: th.border, labelChipBg: th.labelChipBg }
      })
    }
    ctx.fillStyle = th.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(
      analysisOn.value ? tr('persistence.waitingSpectrum') : tr('persistence.waitingMatrix'),
      plot.x + plot.w / 2,
      plot.y + plot.h / 2
    )
    ctx.textAlign = 'left'
    return
  }
  if (imageCanvas && imageCtx) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(imageCanvas, plot.x, plot.y, plot.w, plot.h)
  }
  if (props.axis) {
    const xt = niceTicks(0, buffer.width, 5)
    drawAxisOverlay(ctx, {
      plot,
      xMin: 0,
      xMax: buffer.width,
      yMin: buffer.minDb,
      yMax: buffer.maxDb,
      showX: props.xAxis,
      showGrid: props.grid,
      theme: { text: th.text, grid: th.grid, axisLine: th.border, labelChipBg: th.labelChipBg },
      xTicksOverride: {
        values: xt,
        labels: xt.map((v) => formatFreq(freqStart.value + v * binHz.value))
      }
    })
  }
  if (props.axisLabels !== false && props.axis) {
    ctx.fillStyle = th.text
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(props.unit ?? 'dB', plot.x + 4, plot.y + 12)
    ctx.textAlign = 'right'
    ctx.fillText('Hz', plot.x + plot.w, plot.y + plot.h - 4)
    ctx.textAlign = 'left'
  }
  if (props.showColorbar !== false) drawColorbar(plot, th)
  if (props.showCursor !== false && cursor.value) drawCursor(plot, th)
}

function drawColorbar(
  plot: { x: number; y: number; w: number; h: number; barX: number; barW: number },
  th: ReturnType<typeof resolveTheme>
): void {
  if (!ctx) return
  const steps = 128
  for (let i = 0; i < steps; i++) {
    const t = 1 - i / (steps - 1)
    const idx = Math.max(0, Math.min(255, Math.round(t * 255))) * 4
    ctx.fillStyle = `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`
    ctx.fillRect(plot.barX, plot.y + (i / steps) * plot.h, plot.barW, plot.h / steps + 1)
  }
  ctx.strokeStyle = th.border
  ctx.strokeRect(plot.barX, plot.y, plot.barW, plot.h)
  ctx.fillStyle = th.text
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillText(formatCount(buffer.getStats().max), plot.barX + plot.barW + 4, plot.y + 9)
  ctx.fillText('0', plot.barX + plot.barW + 4, plot.y + plot.h)
}

function drawCursor(
  plot: { x: number; y: number; w: number; h: number },
  th: ReturnType<typeof resolveTheme>
): void {
  if (!ctx || !cursor.value) return
  const x = plot.x + (cursor.value.bin / Math.max(1, buffer.width - 1)) * plot.w
  const y = plot.y + (1 - cursor.value.level / Math.max(1, buffer.height - 1)) * plot.h
  ctx.save()
  ctx.strokeStyle = th.crosshair
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, plot.y)
  ctx.lineTo(x, plot.y + plot.h)
  ctx.moveTo(plot.x, y)
  ctx.lineTo(plot.x + plot.w, y)
  ctx.stroke()
  ctx.restore()
  const f = freqStart.value + cursor.value.bin * binHz.value
  const db =
    buffer.minDb +
    (cursor.value.level / Math.max(1, buffer.height - 1)) * (buffer.maxDb - buffer.minDb)
  const text = `${formatFreq(f)} · ${db.toFixed(1)} dB · ${formatCount(cursor.value.count)}`
  ctx.fillStyle = th.labelChipBg
  const tw = ctx.measureText(text).width + 10
  const tx = Math.min(plot.x + plot.w - tw, Math.max(plot.x, x + 8))
  const ty = Math.max(plot.y + 12, y - 8)
  ctx.fillRect(tx, ty - 11, tw, 16)
  ctx.fillStyle = th.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(text, tx + 5, ty)
}

function onPointerMove(e: PointerEvent): void {
  if (!ctx || props.showCursor === false) return
  const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const plot = plotMetrics()
  if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) {
    if (cursor.value) {
      cursor.value = null
      glChart.scheduleDraw()
    }
    return
  }
  const bin = Math.max(
    0,
    Math.min(buffer.width - 1, Math.floor(((x - plot.x) / plot.w) * buffer.width))
  )
  const level = Math.max(
    0,
    Math.min(buffer.height - 1, Math.floor((1 - (y - plot.y) / plot.h) * buffer.height))
  )
  cursor.value = { bin, level, count: buffer.density[level * buffer.width + bin] ?? 0 }
  glChart.scheduleDraw()
}
function onPointerLeave(): void {
  if (cursor.value) {
    cursor.value = null
    glChart.scheduleDraw()
  }
}

function getStats(): PersistenceStats {
  return buffer.getStats()
}
function getDensity(): Float32Array {
  return buffer.density
}
function getBackend(): 'canvas2d' {
  return 'canvas2d'
}
function exportPNG(): string | null {
  return canvasRef.value?.toDataURL('image/png') ?? null
}
function exportCSV(): void {
  const lines = ['bin,level,minDb,maxDb,count']
  for (let level = 0; level < buffer.height; level++)
    for (let bin = 0; bin < buffer.width; bin++) {
      const v = buffer.density[level * buffer.width + bin]!
      if (v > 0) lines.push(`${bin},${level},${buffer.minDb},${buffer.maxDb},${v}`)
    }
  const filename = `persistence-${Date.now()}.csv`
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
    if (v !== undefined) setData(v)
  },
  { immediate: true }
)
watch(
  () => [props.bins, props.levels, props.minDb, props.maxDb],
  () => {
    ensureBuffer()
    imageDirty = true
    stats.value = buffer.getStats()
    glChart.scheduleDraw()
  }
)
watch(
  () => props.analysis,
  () => {
    ensureBuffer()
    imageDirty = true
    glChart.scheduleDraw()
  },
  { deep: true }
)
watch(
  () => props.colorMap,
  (m) => {
    lut = colorMapLut(m, 256)
    imageDirty = true
    glChart.scheduleDraw()
  }
)
watch(
  () => props.gamma,
  () => {
    imageDirty = true
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
  ctx = canvasRef.value?.getContext('2d') ?? null
  glChart.scheduleDraw()
})
onUnmounted(() => {
  ctx = null
  imageCanvas = null
  imageCtx = null
  imageData = null
})

defineExpose({
  appendData,
  setData,
  clear,
  getStats,
  getDensity,
  getBackend,
  exportPNG,
  exportCSV
})
</script>

<template>
  <div
    class="sig-persist"
    role="img"
    :aria-label="tr('persistence.aria')"
    :style="{ width: viewWidth, height: viewHeight, background: theme.bg }"
  >
    <canvas
      ref="canvasRef"
      class="sig-persist-canvas"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
    <div v-if="props.showInfo !== false" class="sig-persist-info">
      {{ info || tr('persistence.noData') }}
    </div>
    <div class="sig-persist-backend">Canvas2D</div>
  </div>
</template>

<style scoped>
.sig-persist {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}
.sig-persist-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}
.sig-persist-info {
  position: absolute;
  top: 8px;
  left: 58px;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.sig-persist-backend {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: #888;
  pointer-events: none;
}
</style>
