<script setup lang="ts">
/**
 * SpectrumChart（可复制，自带主题）
 * 输入：服务端算好的 dB 幅度谱 Float32Array（长度 = fftSize/2）
 * 组件只做：minmax 抽稀 + WebGL2 折线绘制（高性能展示，零信号处理）
 */
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { createLineRenderer, type LineRenderer } from './core/gl'
import { spectrumAdapters } from './core/adapters'
import type { SpectrumProps } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<SpectrumProps>(), {
  theme: 'auto',
  decimation: 'minmax',
  fpsLimit: 60,
  lineColor: '#1976d2',
  viewport: undefined,
  adapter: undefined,
  data: undefined
})
const emit = defineEmits<{ (e: 'error', msg: string): void }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let gl: WebGL2RenderingContext | null = null

const isDark = computed(() => {
  if (props.theme === 'dark') return true
  if (props.theme === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
})

let spectrum: Float32Array | null = null
// 非受控视口（未传 viewport prop 时 setViewport 写入这里生效）
const innerViewport: { xMin?: number; xMax?: number; yMin?: number; yMax?: number } = {}

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
  if (!canvas || !gl || !renderer || !spectrum) return
  const w = canvas.width
  const target = Math.floor(w / (window.devicePixelRatio || 1))
  let data = spectrum
  // 抽稀到视口宽度（保留视觉包络，min/max 按原索引排序避免折线交叉伪影）
  if (props.decimation && data.length > target) {
    const bucket = data.length / target
    const out = new Float32Array(target * 2)
    let oi = 0
    for (let i = 0; i < target; i++) {
      const s = Math.floor(i * bucket),
        e = Math.floor((i + 1) * bucket)
      let mn = Infinity,
        mx = -Infinity
      let mnIdx = s,
        mxIdx = s
      for (let j = s; j < e; j++) {
        const v = data[j]
        if (v < mn) {
          mn = v
          mnIdx = j
        }
        if (v > mx) {
          mx = v
          mxIdx = j
        }
      }
      if (mnIdx < mxIdx) {
        out[oi++] = mn
        out[oi++] = mx
      } else {
        out[oi++] = mx
        out[oi++] = mn
      }
    }
    data = out.subarray(0, oi)
  }
  // 数据已是 dB：默认纵轴 -120~0，可被 viewport 覆盖（受控 prop 优先，其次内部 setViewport）
  const vp = props.viewport ?? innerViewport
  const yMin = vp.yMin ?? -120
  const yMax = vp.yMax ?? 0
  gl.clearColor(
    isDark.value ? 0.08 : 0.98,
    isDark.value ? 0.08 : 0.98,
    isDark.value ? 0.12 : 0.98,
    1
  )
  gl.clear(gl.COLOR_BUFFER_BIT)
  renderer.setData(data)
  const xMin = vp.xMin ?? 0
  const xMax = vp.xMax ?? data.length - 1
  // 背景已自绘，叠加绘制不再清屏
  renderer.draw({ xMin, xMax, yMin, yMax }, isDark.value ? '#4fc3f7' : props.lineColor, false)
}

useGlChart(canvasRef, { fpsLimit: props.fpsLimit, onDraw: draw })

onMounted(async () => {
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  gl = canvas.getContext('webgl2', { antialias: true }) as WebGL2RenderingContext | null
  if (!gl) {
    emit('error', 'WebGL2 not supported')
    return
  }
  renderer = createLineRenderer(canvas, gl)
  if (props.data !== undefined) setData(props.data)
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

function setData(raw: unknown): void {
  clear()
  appendData(raw)
}
function appendData(raw: unknown): void {
  const n = normalize(raw)
  if (!n) {
    emit('error', 'adapter 返回 null')
    return
  }
  spectrum = n
  schedule()
}
function clear(): void {
  spectrum = null
  draw()
}
function setViewport(v: Partial<NonNullable<SpectrumProps['viewport']>>): void {
  if (props.viewport) {
    // 受控模式：viewport 对象由父组件持有，原地合并保持既有行为
    Object.assign(props.viewport as Record<string, unknown>, v as Record<string, unknown>)
  } else {
    // 非受控模式：写入内部视口（修复原先赋给临时对象导致 setViewport 无效的问题）
    Object.assign(innerViewport, v)
  }
  schedule()
}
defineExpose({ appendData, setData, clear, setViewport })
</script>

<template>
  <div
    class="sig-spectrum"
    :class="isDark ? 'sig-dark' : 'sig-light'"
    :style="{
      width: props.width ? props.width + 'px' : '100%',
      height: props.height ? props.height + 'px' : '260px'
    }"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <div class="sig-tag">dB 频谱 · 服务端计算</div>
  </div>
</template>

<style scoped>
.sig-spectrum {
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
