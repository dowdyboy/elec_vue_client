<script setup lang="ts">
/**
 * SpectrogramChart（瀑布/时频，可复制，自带主题）
 * 输入：服务端算好的 dB 行 Float32Array（长度 = fftSize/2）
 * 组件只做：行累计成瀑布 + colorMap 上色 + Canvas2D 绘制（高性能展示，零信号处理）
 */
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { spectrumAdapters } from './core/adapters'
import type { SpectrogramProps } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<SpectrogramProps>(), {
  theme: 'auto',
  fpsLimit: 30,
  colorMap: 'viridis',
  timeSpan: 128,
  adapter: undefined,
  data: undefined
})
const emit = defineEmits<{ (e: 'error', msg: string): void }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDark = computed(() => {
  if (props.theme === 'dark') return true
  if (props.theme === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
})

// 瀑布缓冲：timeSpan 行，每行长度 = fftSize/2（由首帧决定）
let waterfall: Float32Array[] = []
let rowCount = 0
// 绘制缓存：尺寸不变时复用 ImageData 与离屏 canvas，减少每帧分配
let cachedImg: ImageData | null = null
let tmpCanvas: HTMLCanvasElement | null = null
let cachedCols = 0
let cachedRows = 0

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
    emit('error', e instanceof Error ? e.message : String(e))
    return null
  }
}

// 色阶
function colormap(t: number, map: string): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  if (map === 'grayscale') {
    const v = Math.floor(t * 255)
    return [v, v, v]
  }
  if (map === 'jet') {
    const r = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * t - 3))))
    const g = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * t - 2))))
    const b = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * t - 1))))
    return [r, g, b]
  }
  if (map === 'hot') {
    const r = Math.min(255, t * 3 * 255)
    const g = Math.min(255, Math.max(0, t * 3 * 255 - 255))
    const b = Math.min(255, Math.max(0, t * 3 * 255 - 510))
    return [r, g, b]
  }
  // viridis 近似
  const r = Math.floor(68 + t * (253 - 68))
  const g = Math.floor(1 + t * (231 - 1))
  const b = Math.floor(84 + t * (37 - 84))
  return [r, g, b]
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
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width,
    h = canvas.height
  // 背景
  ctx.fillStyle = isDark.value ? '#0f1115' : '#ffffff'
  ctx.fillRect(0, 0, w, h)
  if (waterfall.length === 0) return
  const cols = waterfall[0].length
  const rows = waterfall.length
  // dB 已约定 -120~0
  const gMin = -120
  const gMax = 0
  if (!cachedImg || cachedImg.width !== cols || cachedImg.height !== rows) {
    cachedImg = ctx.createImageData(cols, rows)
  }
  const img = cachedImg
  for (let y = 0; y < rows; y++) {
    const row = waterfall[y]
    for (let x = 0; x < cols; x++) {
      const t = (row[x] - gMin) / (gMax - gMin)
      const [r, g, b] = colormap(t, props.colorMap)
      const idx = (y * cols + x) * 4
      img.data[idx] = r
      img.data[idx + 1] = g
      img.data[idx + 2] = b
      img.data[idx + 3] = 255
    }
  }
  // 将小图缩放到 canvas（保持瀑布滚动：最新行在顶部，历史行随新数据向下滚动）
  if (!tmpCanvas || cachedCols !== cols || cachedRows !== rows) {
    tmpCanvas = document.createElement('canvas')
    tmpCanvas.width = cols
    tmpCanvas.height = rows
    cachedCols = cols
    cachedRows = rows
  }
  tmpCanvas.getContext('2d')!.putImageData(img, 0, 0)
  // 翻转 y：img 末行（最新）映射到画布顶部
  ctx.save()
  ctx.scale(1, -1)
  ctx.translate(0, -h)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmpCanvas, 0, 0, cols, rows, 0, 0, w, h)
  ctx.restore()
}

useGlChart(canvasRef, { fpsLimit: props.fpsLimit, onDraw: draw })

onMounted(async () => {
  await nextTick()
  waterfall = []
  if (props.data !== undefined) setData(props.data)
  draw()
})
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)

function setData(raw: unknown): void {
  clear()
  appendData(raw)
}
function appendData(raw: unknown): void {
  const n = normalize(raw)
  if (!n) {
    emit('error', 'adapter null')
    return
  }
  // 行长度守卫：fftSize 等配置即时变更后行长变化，旧瀑布直接重置，避免混行出黑条
  if (waterfall.length > 0 && n.length !== waterfall[waterfall.length - 1].length) {
    waterfall = []
  }
  waterfall.push(n)
  if (waterfall.length > props.timeSpan) waterfall.shift()
  rowCount = waterfall.length
  schedule()
}
function clear(): void {
  waterfall = []
  rowCount = 0
  draw()
}
defineExpose({ appendData, setData, clear, getRows: () => rowCount })
</script>

<template>
  <div
    class="sig-specgram"
    :class="isDark ? 'sig-dark' : 'sig-light'"
    :style="{
      width: props.width ? props.width + 'px' : '100%',
      height: props.height ? props.height + 'px' : '300px'
    }"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <div class="sig-tag">时频瀑布 · {{ props.colorMap }} · 服务端计算</div>
  </div>
</template>

<style scoped>
.sig-specgram {
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
