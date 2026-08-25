/**
 * useGlChart（轻量，拷贝即用）
 * 封装：ResizeObserver 自适应 + DPR 处理 + rAF 节流 + 主题
 */
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export function useGlChart(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: {
    fpsLimit?: number
    theme?: Ref<string>
    onResize?: (w: number, h: number) => void
    onDraw?: () => void
  } = {}
): {
  width: Ref<number>
  height: Ref<number>
  dpr: Ref<number>
  scheduleDraw: () => void
  resize: () => void
} {
  const dpr = ref(window.devicePixelRatio || 1)
  const width = ref(0)
  const height = ref(0)
  let ro: ResizeObserver | null = null
  let rafId = 0
  let lastDraw = 0
  let mq: MediaQueryList | null = null
  const fpsLimit = options.fpsLimit ?? 60
  const minInterval = 1000 / fpsLimit

  function resize(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    // 用 client* 避开 getBoundingClientRect 的小数 + padding 误算，右缘不再被 NCard overflow 裁掉
    const cw = parent.clientWidth
    const ch = parent.clientHeight
    // 回退：client* 为 0 时（初挂 v-show 场景）再用 rect
    const rect = cw > 0 && ch > 0 ? null : parent.getBoundingClientRect()
    const pw = cw > 0 ? cw : rect!.width
    const ph = ch > 0 ? ch : rect!.height
    const w = Math.max(1, Math.floor(pw * dpr.value))
    const h = Math.max(1, Math.floor(ph * dpr.value))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = pw + 'px'
      canvas.style.height = ph + 'px'
      width.value = w
      height.value = h
      options.onResize?.(w, h)
      scheduleDraw()
    }
  }

  function scheduleDraw(): void {
    if (rafId) return
    rafId = requestAnimationFrame((now) => {
      rafId = 0
      if (now - lastDraw < minInterval) {
        scheduleDraw()
        return
      }
      lastDraw = now
      options.onDraw?.()
    })
  }

  // DPR 变化监听（拖到不同显示器）：dpr 变化后需按新值重建 matchMedia 订阅
  const onDpr = (): void => {
    dpr.value = window.devicePixelRatio || 1
    setupDprWatch()
    resize()
  }
  function setupDprWatch(): void {
    mq?.removeEventListener?.('change', onDpr)
    mq = window.matchMedia(`(resolution: ${dpr.value}dppx)`)
    mq.addEventListener?.('change', onDpr)
  }

  onMounted(() => {
    resize()
    ro = new ResizeObserver(() => resize())
    if (canvasRef.value?.parentElement) ro.observe(canvasRef.value.parentElement)
    window.addEventListener('resize', resize)
    setupDprWatch()
  })

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId)
    ro?.disconnect()
    window.removeEventListener('resize', resize)
    mq?.removeEventListener?.('change', onDpr)
    mq = null
  })

  watch(
    () => options.theme?.value,
    () => scheduleDraw()
  )

  return { width, height, dpr, scheduleDraw, resize }
}
