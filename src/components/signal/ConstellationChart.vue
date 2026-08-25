<script setup lang="ts">
/**
 * ConstellationChart（星座图，可复制，自带主题）
 * 输入：IQ 点（经 adapter），WebGL Points 高性能散点
 */
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { createPointsRenderer, type PointsRenderer } from './core/gl'
import { constellationAdapters } from './core/adapters'
import type { ConstellationProps } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<ConstellationProps>(), {
  theme: 'auto',
  fpsLimit: 60,
  pointSize: 2,
  alpha: 0.7,
  viewport: undefined,
  adapter: undefined,
  data: undefined
})
const emit = defineEmits<{ (e: 'error', msg: string): void }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let renderer: PointsRenderer | null = null

const isDark = computed(() => {
  if (props.theme === 'dark') return true
  if (props.theme === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
})

const MAX_POINTS = 500_000
let iBuf = new Float32Array(0)
let qBuf = new Float32Array(0)
let len = 0

function ensure(n: number): void {
  if (iBuf.length >= n) return
  const next = Math.min(MAX_POINTS, Math.max(n, iBuf.length ? iBuf.length * 2 : 4096))
  const ni = new Float32Array(next),
    nq = new Float32Array(next)
  ni.set(iBuf.subarray(0, len))
  nq.set(qBuf.subarray(0, len))
  iBuf = ni
  qBuf = nq
}

function normalize(raw: unknown): { i: Float32Array; q: Float32Array } | null {
  const fn = props.adapter ?? constellationAdapters.passthrough
  try {
    const v = fn(raw)
    if (!v) {
      const fb =
        constellationAdapters.jsonInterleaved(raw) ??
        constellationAdapters.arrayBuffer(raw) ??
        constellationAdapters.base64(raw)
      if (!fb) return null
      return toIQ(fb)
    }
    return toIQ(v)
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e))
    return null
  }
}
function toIQ(v: unknown): { i: Float32Array; q: Float32Array } | null {
  if (v instanceof Float32Array) {
    const pairs = Math.floor(v.length / 2)
    const i = new Float32Array(pairs),
      q = new Float32Array(pairs)
    for (let k = 0; k < pairs; k++) {
      i[k] = v[2 * k]
      q[k] = v[2 * k + 1]
    }
    return { i, q }
  }
  if (v && typeof v === 'object' && 'i' in (v as Record<string, unknown>)) {
    const o = v as { i: Float32Array; q: Float32Array }
    if (o.i instanceof Float32Array && o.q instanceof Float32Array) return o
  }
  return null
}

function pushIQ(p: { i: Float32Array; q: Float32Array }): void {
  const n = Math.min(p.i.length, p.q.length)
  ensure(len + n)
  if (len + n > MAX_POINTS) {
    const keep = Math.floor(MAX_POINTS * 0.8)
    iBuf.copyWithin(0, len - keep, len)
    qBuf.copyWithin(0, len - keep, len)
    len = keep
  }
  iBuf.set(p.i.subarray(0, n), len)
  qBuf.set(p.q.subarray(0, n), len)
  len += n
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

function getRange(arr: Float32Array, l: number): { min: number; max: number } {
  if (l === 0) return { min: -1, max: 1 }
  let mn = Infinity,
    mx = -Infinity
  for (let i = 0; i < l; i++) {
    const v = arr[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  if (!isFinite(mn) || !isFinite(mx) || mn === mx) return { min: mn - 1, max: mx + 1 }
  const pad = (mx - mn) * 0.1 || 0.2
  return { min: mn - pad, max: mx + pad }
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !renderer) return
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null
  if (!gl) return
  // 背景清屏（透明，容器 CSS 背景透出）
  gl.clearColor(
    isDark.value ? 0.08 : 0.98,
    isDark.value ? 0.08 : 0.98,
    isDark.value ? 0.12 : 0.98,
    1
  )
  gl.clear(gl.COLOR_BUFFER_BIT)
  if (len === 0) return
  let xRange =
    props.viewport?.xMin !== undefined && props.viewport?.xMax !== undefined
      ? { min: props.viewport.xMin, max: props.viewport.xMax }
      : getRange(iBuf, len)
  let yRange =
    props.viewport?.yMin !== undefined && props.viewport?.yMax !== undefined
      ? { min: props.viewport.yMin, max: props.viewport.yMax }
      : getRange(qBuf, len)
  // 自动范围时取对称方形：修正非正方形画布下星座被拉伸成椭圆
  if (
    props.viewport?.xMin === undefined ||
    props.viewport?.xMax === undefined ||
    props.viewport?.yMin === undefined ||
    props.viewport?.yMax === undefined
  ) {
    const m =
      Math.max(
        Math.abs(xRange.min),
        Math.abs(xRange.max),
        Math.abs(yRange.min),
        Math.abs(yRange.max)
      ) || 1
    xRange = { min: -m, max: m }
    yRange = { min: -m, max: m }
  }
  renderer.setData(iBuf.subarray(0, len), qBuf.subarray(0, len))
  const color = isDark.value ? '#ffca28' : '#1565c0'
  renderer.draw(xRange, yRange, color, props.alpha, props.pointSize)
}

useGlChart(canvasRef, { fpsLimit: props.fpsLimit, onDraw: draw })

onMounted(async () => {
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  try {
    renderer = createPointsRenderer(canvas)
  } catch {
    emit('error', 'WebGL2 not supported')
    return
  }
  if (props.data !== undefined) setData(props.data)
  draw()
})
onUnmounted(() => {
  renderer?.dispose()
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)
watch(
  () => props.pointSize,
  () => schedule()
)

function setData(raw: unknown): void {
  clear()
  appendData(raw)
}
function appendData(raw: unknown): void {
  const p = normalize(raw)
  if (!p) {
    emit('error', 'adapter null')
    return
  }
  pushIQ(p)
}
function clear(): void {
  len = 0
  draw()
}
defineExpose({ appendData, setData, clear, getLength: () => len })
</script>

<template>
  <div
    class="sig-const"
    :class="isDark ? 'sig-dark' : 'sig-light'"
    :style="{
      width: props.width ? props.width + 'px' : '100%',
      height: props.height ? props.height + 'px' : '260px'
    }"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <div class="sig-tag">星座 · {{ len }} 点</div>
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
.sig-canvas {
  display: block;
  width: 100%;
  height: 100%;
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
</style>
