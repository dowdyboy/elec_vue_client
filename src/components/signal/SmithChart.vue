<script setup lang="ts">
/**
 * SmithChart（史密斯圆图）
 * - 纯显示：复反射系数轨迹（Γ），不做 VNA 校准/去嵌入
 * - 网格：等电阻圆 + 等电抗圆；游标显示 Γ/VSWR/回波损耗/阻抗
 * - Canvas2D；适合天线/功放/匹配网络
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import {
  SMITH_REACTANCES,
  SMITH_RESISTANCES,
  computeSmithStats,
  gammaToImpedance,
  gammaToReturnLossDb,
  gammaToVswr
} from './core/smith'
import type { SmithProps, SmithTrace } from './core/types'

const props = withDefaults(defineProps<SmithProps>(), {
  theme: 'auto',
  fpsLimit: 30,
  z0: 50,
  traceWidth: 1.5,
  alpha: 0.9,
  showGrid: true,
  showLabels: true,
  showCursor: true,
  showInfo: true,
  maxPoints: 2000,
  renderer: 'canvas2d'
})

const emit = defineEmits<{
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'error', message: string): void
  (e: 'errorDetail', p: { code: 'data'; message: string }): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const stats = ref(computeSmithStats([], props.z0))
const cursor = ref<{ trace: number; index: number; i: number; q: number } | null>(null)
const prefersDark = usePrefersDark()
let ctx: CanvasRenderingContext2D | null = null
const traces = ref<SmithTrace[]>([])

const theme = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle })
)
const viewWidth = computed(() => cssSize(props.width, '100%'))
const viewHeight = computed(() => cssSize(props.height, '420px'))
const info = computed(() => {
  const s = stats.value
  if (!s.points) return ''
  const rl = Number.isFinite(s.minReturnLossDb) ? `${s.minReturnLossDb.toFixed(1)} dB` : '∞'
  return `${traces.value.length} ${tr('smith.traces')} · ${s.points} ${tr('smith.points')} · ${tr('smith.maxVswr')} ${s.maxVswr.toFixed(2)} · ${tr('smith.minRl')} ${rl}`
})

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: () => draw(),
  onDraw: () => draw()
})

function tr(key: ChartMessageKey, params?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, params)
}

function cleanTrace(t: SmithTrace): SmithTrace | null {
  const n = Math.min(t.i.length, t.q.length)
  if (n < 1) return null
  const start = Math.max(0, n - props.maxPoints)
  const i = new Float32Array(n - start)
  const q = new Float32Array(n - start)
  for (let k = start; k < n; k++) {
    const iv = Number(t.i[k])
    const qv = Number(t.q[k])
    i[k - start] = Number.isFinite(iv) ? iv : 0
    q[k - start] = Number.isFinite(qv) ? qv : 0
  }
  return { i, q, name: t.name, color: t.color }
}

function normalize(raw: unknown): SmithTrace[] | null {
  if (Array.isArray(raw)) return raw.map(cleanTrace).filter(Boolean) as SmithTrace[]
  if (raw && typeof raw === 'object' && 'i' in raw && 'q' in raw) {
    const t = cleanTrace(raw as SmithTrace)
    return t ? [t] : null
  }
  return null
}

function appendData(raw: unknown): void {
  const list = normalize(raw)
  if (!list) {
    emit('error', tr('smith.badInput'))
    emit('errorDetail', { code: 'data', message: tr('smith.badInput') })
    return
  }
  for (const t of list) traces.value.push(t)
  stats.value = computeSmithStats(traces.value, props.z0)
  glChart.scheduleDraw()
}

function setData(raw: unknown): void {
  const list = normalize(raw)
  if (!list) {
    traces.value = []
    stats.value = computeSmithStats([])
    glChart.scheduleDraw()
    return
  }
  traces.value = list
  stats.value = computeSmithStats(traces.value, props.z0)
  glChart.scheduleDraw()
}

function clear(): void {
  traces.value = []
  cursor.value = null
  stats.value = computeSmithStats([])
  glChart.scheduleDraw()
}

function plotMetrics(): { x: number; y: number; size: number; cx: number; cy: number; r: number } {
  const w = Math.max(1, glChart.width.value / Math.max(1, glChart.dpr.value))
  const h = Math.max(1, glChart.height.value / Math.max(1, glChart.dpr.value))
  const size = Math.max(20, Math.min(w - 100, h - 56))
  const x = (w - size) / 2
  const y = 28
  return { x, y, size, cx: x + size / 2, cy: y + size / 2, r: size / 2 }
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
  const p = plotMetrics()
  if (props.showGrid !== false) drawGrid(p, t)
  drawTraces(p, t)
  if (props.showLabels !== false) drawLabels(p, t)
  if (props.showCursor !== false && cursor.value) drawCursor(p, t)
  if (traces.value.length === 0) {
    ctx.fillStyle = t.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(tr('smith.waiting'), p.cx, p.cy)
    ctx.textAlign = 'left'
  }
}

function drawGrid(
  p: { cx: number; cy: number; r: number },
  t: ReturnType<typeof resolveTheme>
): void {
  if (!ctx) return
  ctx.save()
  ctx.beginPath()
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
  ctx.clip()
  ctx.strokeStyle = t.grid
  ctx.lineWidth = 1
  // 等电阻圆
  for (const r of SMITH_RESISTANCES) {
    const c = (r / (1 + r)) * p.r
    const rr = (1 / (1 + r)) * p.r
    ctx.beginPath()
    ctx.arc(p.cx + c, p.cy, rr, 0, Math.PI * 2)
    ctx.stroke()
  }
  // 等电抗圆（正/负）
  for (const x of SMITH_REACTANCES) {
    for (const sign of [-1, 1]) {
      const rr = (1 / x) * p.r
      ctx.beginPath()
      ctx.arc(p.cx + p.r, p.cy + sign * (1 / x) * p.r, rr, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
  ctx.strokeStyle = t.border
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = t.border
  ctx.beginPath()
  ctx.moveTo(p.cx - p.r, p.cy)
  ctx.lineTo(p.cx + p.r, p.cy)
  ctx.stroke()
}

function drawTraces(
  p: { cx: number; cy: number; r: number },
  t: ReturnType<typeof resolveTheme>
): void {
  if (!ctx) return
  ctx.save()
  ctx.beginPath()
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = Math.max(0.05, Math.min(1, props.alpha))
  ctx.lineWidth = Math.max(0.5, props.traceWidth)
  traces.value.forEach((trace, ti) => {
    ctx!.strokeStyle = trace.color ?? t.tracePalette[ti % t.tracePalette.length] ?? t.traceColor
    ctx!.beginPath()
    for (let k = 0; k < trace.i.length; k++) {
      const x = p.cx + trace.i[k]! * p.r
      const y = p.cy - trace.q[k]! * p.r
      if (k === 0) ctx!.moveTo(x, y)
      else ctx!.lineTo(x, y)
    }
    ctx!.stroke()
  })
  ctx.restore()
}

function drawLabels(
  p: { cx: number; cy: number; r: number },
  t: ReturnType<typeof resolveTheme>
): void {
  if (!ctx) return
  ctx.fillStyle = t.text
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('-1', p.cx - p.r, p.cy + 12)
  ctx.fillText('0', p.cx, p.cy + 12)
  ctx.fillText('1', p.cx + p.r, p.cy + 12)
  ctx.fillText('Re(Γ)', p.cx, p.cy + p.r + 18)
  ctx.textAlign = 'left'
  ctx.fillText('Im(Γ)', p.cx + p.r + 8, p.cy + 3)
  ctx.textAlign = 'left'
}

function drawCursor(
  p: { cx: number; cy: number; r: number },
  t: ReturnType<typeof resolveTheme>
): void {
  if (!ctx || !cursor.value) return
  const c = cursor.value
  const x = p.cx + c.i * p.r
  const y = p.cy - c.q * p.r
  ctx.strokeStyle = t.crosshair
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, Math.PI * 2)
  ctx.stroke()
  const g = Math.hypot(c.i, c.q)
  const z = gammaToImpedance(c.i, c.q, props.z0)
  const text = `Γ ${c.i.toFixed(3)}${c.q >= 0 ? '+' : '-'}j${Math.abs(c.q).toFixed(3)} · |Γ| ${g.toFixed(3)} · VSWR ${gammaToVswr(c.i, c.q).toFixed(2)} · RL ${Number.isFinite(gammaToReturnLossDb(c.i, c.q)) ? gammaToReturnLossDb(c.i, c.q).toFixed(1) : '∞'} dB · Z ${Number.isFinite(z.r) ? z.r.toFixed(1) : '∞'}${z.x >= 0 ? '+' : '-'}j${Math.abs(Number.isFinite(z.x) ? z.x : 0).toFixed(1)}`
  ctx.fillStyle = t.labelChipBg
  const tw = ctx.measureText(text).width + 10
  const tx = Math.min(p.cx + p.r - tw, Math.max(p.cx - p.r, x + 8))
  const ty = Math.min(p.cy + p.r - 4, Math.max(p.cy - p.r + 12, y - 8))
  ctx.fillRect(tx, ty - 11, tw, 16)
  ctx.fillStyle = t.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(text, tx + 5, ty)
}

function onPointerMove(e: PointerEvent): void {
  if (props.showCursor === false) return
  const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const p = plotMetrics()
  let best: { trace: number; index: number; i: number; q: number; d: number } | null = null
  traces.value.forEach((trace, ti) => {
    for (let k = 0; k < trace.i.length; k++) {
      const px = p.cx + trace.i[k]! * p.r
      const py = p.cy - trace.q[k]! * p.r
      const d = (px - x) * (px - x) + (py - y) * (py - y)
      if (!best || d < best.d) best = { trace: ti, index: k, i: trace.i[k]!, q: trace.q[k]!, d }
    }
  })
  if (best && (best as { d: number }).d < 12 * 12) {
    const b = best as { trace: number; index: number; i: number; q: number }
    cursor.value = { trace: b.trace, index: b.index, i: b.i, q: b.q }
    glChart.scheduleDraw()
  } else if (cursor.value) {
    cursor.value = null
    glChart.scheduleDraw()
  }
}
function onPointerLeave(): void {
  if (cursor.value) {
    cursor.value = null
    glChart.scheduleDraw()
  }
}

function getStats(): ReturnType<typeof computeSmithStats> {
  return stats.value
}
function getTraceCount(): number {
  return traces.value.length
}
function getBackend(): 'canvas2d' {
  return 'canvas2d'
}
function exportPNG(): string | null {
  return canvasRef.value?.toDataURL('image/png') ?? null
}
function exportCSV(): void {
  const lines = ['trace,index,gamma_i,gamma_q,vswr,return_loss_db']
  traces.value.forEach((tr, ti) => {
    for (let k = 0; k < tr.i.length; k++) {
      const iv = tr.i[k]!
      const qv = tr.q[k]!
      const rl = gammaToReturnLossDb(iv, qv)
      lines.push(
        `${ti},${k},${iv},${qv},${gammaToVswr(iv, qv).toFixed(6)},${Number.isFinite(rl) ? rl.toFixed(6) : ''}`
      )
    }
  })
  const filename = `smith-${Date.now()}.csv`
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
  () => [
    props.theme,
    props.chartStyle,
    props.alpha,
    props.traceWidth,
    props.showGrid,
    props.showLabels
  ],
  () => glChart.scheduleDraw(),
  { deep: true }
)
watch(prefersDark, () => glChart.scheduleDraw())
watch(
  () => props.z0,
  () => {
    stats.value = computeSmithStats(traces.value, props.z0)
    glChart.scheduleDraw()
  }
)

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
    class="sig-smith"
    role="img"
    :aria-label="tr('smith.aria')"
    :style="{ width: viewWidth, height: viewHeight, background: theme.bg }"
  >
    <canvas
      ref="canvasRef"
      class="sig-smith-canvas"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
    <div v-if="props.showInfo !== false" class="sig-smith-info">
      {{ info || tr('smith.noData') }}
    </div>
    <div class="sig-smith-backend">Canvas2D</div>
    <div v-if="traces.length > 0" class="sig-smith-legend">
      <span v-for="(trace, i) in traces" :key="i">
        <i
          :style="{ background: trace.color ?? theme.tracePalette[i % theme.tracePalette.length] }"
        />
        {{ trace.name ?? `S${i + 1}` }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.sig-smith {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}
.sig-smith-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}
.sig-smith-info {
  position: absolute;
  top: 8px;
  left: 12px;
  font-size: 12px;
  color: #aaa;
  pointer-events: none;
}
.sig-smith-backend {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: #888;
  pointer-events: none;
}
.sig-smith-legend {
  position: absolute;
  left: 12px;
  bottom: 8px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #aaa;
  pointer-events: none;
}
.sig-smith-legend i {
  display: inline-block;
  width: 10px;
  height: 3px;
  margin-right: 4px;
  vertical-align: middle;
}
</style>
