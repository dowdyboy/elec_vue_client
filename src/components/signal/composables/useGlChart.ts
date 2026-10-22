/**
 * useGlChart（轻量，拷贝即用）
 * 封装：ResizeObserver 自适应 + DPR 处理 + rAF 节流 + 主题
 */
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export function useGlChart(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: {
    /** 帧率上限：数字或 getter（getter 支持宿主运行时改 fpsLimit） */
    fpsLimit?: number | (() => number)
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
  const dpr = ref(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const width = ref(0)
  const height = ref(0)
  let ro: ResizeObserver | null = null
  let rafId = 0
  let lastDraw = 0
  let mq: MediaQueryList | null = null
  const readFpsLimit = (): number => {
    const v = typeof options.fpsLimit === 'function' ? options.fpsLimit() : options.fpsLimit
    return Math.max(1, Number.isFinite(v) ? (v as number) : 60)
  }

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
    // 实时 DPR：页面缩放/跨显示器时 dpr 变化若未走 matchMedia 事件，ref 会是旧值；
    // backing 必须按"当前真实比例"计算，否则绘制侧（用 window.devicePixelRatio）与
    // 尺寸侧（用 ref）参考系不一致，画布 CSS/backing 比例脱节
    const liveDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    if (dpr.value !== liveDpr) dpr.value = liveDpr
    const w = Math.max(1, Math.floor(pw * liveDpr))
    const h = Math.max(1, Math.floor(ph * liveDpr))
    // 显式 CSS 尺寸独立于 backing 变化刷新：DPR/页面缩放变化时 backing 整数值可能不变，
    // 但布局尺寸已变——style 滞后会让画布 CSS 尺寸与 backing 比例脱节（overlay 跟随父容器、
    // GL 画布保留旧 style，导致轴层与波形尺寸不一致）
    const sw = pw + 'px'
    const sh = ph + 'px'
    if (canvas.style.width !== sw) canvas.style.width = sw
    if (canvas.style.height !== sh) canvas.style.height = sh
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      width.value = w
      height.value = h
      options.onResize?.(w, h)
      scheduleDraw()
    }
  }

  function scheduleDraw(): void {
    if (rafId) return
    if (typeof requestAnimationFrame === 'undefined') return
    rafId = requestAnimationFrame((now) => {
      rafId = 0
      // 每帧读取 fpsLimit：宿主运行时改 prop 时无需重建组件
      if (now - lastDraw < 1000 / readFpsLimit()) {
        scheduleDraw()
        return
      }
      lastDraw = now
      options.onDraw?.()
    })
  }

  // DPR 变化监听（拖到不同显示器）：dpr 变化后需按新值重建 matchMedia 订阅
  const onDpr = (): void => {
    dpr.value = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    setupDprWatch()
    resize()
  }
  function setupDprWatch(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    mq?.removeEventListener?.('change', onDpr)
    mq = window.matchMedia(`(resolution: ${dpr.value}dppx)`)
    mq.addEventListener?.('change', onDpr)
  }

  onMounted(() => {
    resize()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resize())
      if (canvasRef.value?.parentElement) ro.observe(canvasRef.value.parentElement)
    }
    window.addEventListener('resize', resize)
    setupDprWatch()
  })

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId)
    ro?.disconnect()
    if (typeof window !== 'undefined') window.removeEventListener('resize', resize)
    mq?.removeEventListener?.('change', onDpr)
    mq = null
  })

  watch(
    () => options.theme?.value,
    () => scheduleDraw()
  )

  return { width, height, dpr, scheduleDraw, resize }
}
