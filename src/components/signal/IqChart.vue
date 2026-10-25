<script setup lang="ts">
/**
 * IqChart（可复制，零依赖，自带主题，高性能）
 * 复用：拷本文件 + core/* + composables/useGlChart.ts 到他项目即可
 * 数据：经 adapter 自转 RawInput → IqNormalized（见 core/adapters.ts）
 * 渲染：WebGL2 折线 + Canvas2D 轴层覆盖，主线程仅 rAF
 * 交互：滚轮=X 轴缩放（光标锚点）· Shift+滚轮=Y 轴缩放 · 拖拽=平移 · 双击/角标=复位跟随
 * 外观：theme 预置（light/dark/auto/spectrum 频谱仪黑底黄迹）+ chartStyle 字段级覆盖
 */
import { ref, reactive, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import {
  createLineRenderer,
  withAlpha,
  hexToRgba,
  createFadeRenderer,
  createBlitRenderer,
  type FadeRenderer,
  type BlitRenderer,
  type LineRenderer
} from './core/gl'
import { createCanvasLineRenderer } from './core/canvasRenderer'
import { iqAdapters } from './core/adapters'
import {
  drawAxisOverlay,
  drawChip,
  drawPanel,
  niceTicks,
  niceStep,
  CHIP_H,
  type PlotRect
} from './core/axis'
import { MinMaxPyramid, PYRAMID_BLOCK, type RangeStats } from './core/pyramid'
import { TriggerEngine, triggerRightNeed, type TriggerConfig } from './core/trigger'
import { YAutoScaler } from './core/yauto'
import { resolveTheme } from './core/theme'
import { translate, type ChartMessageKey } from './core/i18n'
import { cssSize } from './core/css'
import type {
  ExportPayload,
  IqCursorInfo,
  IqProps,
  IqNormalized,
  IqViewInfo,
  IqStats,
  IqVisibleData,
  IqFrameMeta,
  Theme
} from './core/types'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'

const props = withDefaults(defineProps<IqProps>(), {
  theme: 'auto' as Theme,
  decimation: 'minmax',
  fpsLimit: 60,
  mode: 'line',
  lineWidth: 1,
  span: 4096,
  viewport: undefined,
  adapter: undefined,
  data: undefined,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  // 注意：Vue 会把「未传的 Boolean prop」转为 false；follow 需要三态（未传=组件自管），
  // 必须显式 default undefined，否则组件会默认进入暂停态
  follow: undefined,
  preserveDrawingBuffer: true,
  contextMenu: true
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'viewportChange', v: IqViewInfo): void
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
  (e: 'update:span', span: number): void
  (e: 'update:follow', v: boolean): void
  (e: 'ready'): void
  (e: 'contextLost'): void
  (e: 'contextRestored'): void
  (e: 'contextmenu', p: { x: number; y: number; dataX: number }): void
  (e: 'cursorChange', p: IqCursorInfo | null): void
  (e: 'errorDetail', p: { code: 'adapter' | 'webgl' | 'data' | 'export'; message: string }): void
}>()

/** 组件文案：messages > locale 内置；labels 旧字段在调用处优先覆盖 */
function tr(key: ChartMessageKey, vars?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, vars)
}

/** 兼容旧 error(string)，同时提供带 code 的 errorDetail */
function reportError(code: 'adapter' | 'webgl' | 'data' | 'export', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

/** 不依赖 Vite 的 DEV 判断（非 Vite 宿主也能安全运行） */
const IS_DEV = (() => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
})()

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let rendererQ: LineRenderer | null = null
let rendererEnv: LineRenderer | null = null
let fadeRenderer: FadeRenderer | null = null
let blitRenderer: BlitRenderer | null = null
// 余辉渐隐过渡：视口变化（缩放/平移）时旧余辉按此步数平滑淡出（约 0.2s），避免生硬瞬间清屏。
// 旧拖影与旧视口绑定，新映射下必然错位——淡出后由新视口数据重绘
const FADE_OUT_STEPS = 12
const FADE_OUT_ALPHA = 0.25
let fadeOutFrames = 0
// 冻结态 GL 缓冲快照：画布被重建（窗口尺寸变化，如按 Alt 弹出菜单栏）后贴图回填，
// 余辉像素不会随 canvas.width 重置而丢失
let persistSnapshot: HTMLCanvasElement | null = null
let needsRestore = false
// auto 触发模式：触发失联超过该时长（ms）→ 回退自由滚动（free-run），避免信号消失后死屏；
// 有触发期间 auto 与 normal 一样锁定显示触发对齐窗
const AUTO_STALE_MS = 500

// ── 数据流中断反馈（跟随态下超过阈值无新数据 → 顶部角标提示）──
const DATA_STALE_MS = 3000
let lastDataAt = 0 // 最近一次实际接收数据的时间戳（performance.now）
const dataStale = ref(false)

// ── 触发显示 UI 状态（badge 需反应式）──
const trigUi = reactive({
  enabled: false,
  level: 0,
  mode: 'auto',
  edge: 'rising',
  status: '' // 触发锁定 / 等待触发 / 已捕获（single）
})
let levelDrag = false // 电平线拖拽中
// 单 canvas 双 program 也可，此处双 renderer 简化（Q 用第二 canvas 叠加或同一 GL 分两 draw）
// 为拷贝轻量：复用同一 canvas，绘制 I 后再绘制 Q（同一 GL 上下文分两次 draw）
let gl: WebGL2RenderingContext | null = null
// Canvas2D 降级后端（WebGL2 不可用/显式 renderer:'canvas2d'）
let ctx2d: CanvasRenderingContext2D | null = null
// WebGL 上下文丢失（GPU 重置/驱动崩溃）：丢失期间停止绘制；恢复事件到达后重建 renderer
let contextLost = false

/** 背景清屏：GL 用 clear，Canvas2D 用 fillRect（设备像素空间） */
function clearBackground(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const bg = hexToRgba(th.value.bg)
  if (gl) {
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.fillStyle = th.value.bg
    ctx2d.fillRect(0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

/** 余辉淡出：GL 用全屏混合四边形，Canvas2D 用低 alpha 背景覆盖 */
function fadeBackground(alpha: number): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const bg = hexToRgba(th.value.bg)
  if (gl && fadeRenderer) {
    fadeRenderer.draw([bg[0], bg[1], bg[2], alpha])
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.globalAlpha = Math.min(1, Math.max(0, alpha))
    ctx2d.fillStyle = th.value.bg
    ctx2d.fillRect(0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

/** 尺寸重建后的冻结帧回填 */
function restoreSnapshot(): void {
  const canvas = canvasRef.value
  if (!canvas || !persistSnapshot) return
  if (blitRenderer && gl) {
    blitRenderer.draw(persistSnapshot)
  } else if (ctx2d) {
    ctx2d.save()
    ctx2d.setTransform(1, 0, 0, 1, 0, 0)
    ctx2d.drawImage(persistSnapshot, 0, 0, canvas.width, canvas.height)
    ctx2d.restore()
  }
}

// 主题解析：chartStyle 覆盖 > colors 迹线对 > 预置；spectrum 为固定观感不随系统切换
const prefersDark = usePrefersDark()
const th = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { colors: props.colors, style: props.chartStyle })
)

// ── 布局常量（CSS px）──
const GUTTER_BOTTOM = 20 // 底部 X 刻度槽；左侧刻度带宽由主题 axisWidth 提供（默认 56）
const PAD_X = 24 // 波形左右内缩留白：避免满幅波形的左/右边缘贴住绘图区形成「信号墙」
const MIN_SPAN = 16 // 最小可见样本数
const DEFAULT_SPAN = 4096 // follow 模式默认窗宽（须明显大于单帧点数）
const ZOOM_FACTOR = 1.2 // 每次滚轮缩放系数

// ── 数据缓冲（线性增长 + 环形丢老，保留最近 maxPoints）──
// 挂载时生效；宿主可调小以降低内存（2M 双缓冲 + 金字塔约 25~40MB）
const requestedMaxPoints = Number.isFinite(props.maxPoints) ? Number(props.maxPoints) : 2_000_000
const maxPoints = Math.max(1024, Math.floor(requestedMaxPoints))
// 环形淘汰后保留的样本数（见 compact 调用）；follow/free-run 有效窗宽须 ≤ 该值，
// 否则窗口左缘钳到 dropped、淘汰推进时产生可见跳变
const ringKeep = Math.floor(maxPoints * 0.9)
const maxFollowSpan = ringKeep
let iBuf = new Float32Array(0)
let qBuf = new Float32Array(0)
let dataLen = 0
// 已丢弃的最老样本数：绝对索引 = dropped + 缓冲下标。
// 视口用绝对索引表达，冻结视图不受环形丢数据影响
let dropped = 0
// 极值金字塔：区间极值/按桶抽稀 O(块数) 替代每帧全量扫描；结构变化后需整树重建
const pyr = new MinMaxPyramid(maxPoints)
let pyrDirty = true

// 采样率：appendData/setData 的 meta 优先，其次 sampleRate prop（时间轴/读数共用）
const frameSampleRate = ref<number | undefined>(undefined)
const effectiveSampleRate = computed(() => frameSampleRate.value ?? props.sampleRate)

// rAF 调度（提前声明：触发 watch immediate 回调依赖 schedule）
// 统一经此处节流：数据推送 / 交互 / 尺寸变化的所有重绘都受 fpsLimit 约束
let raf = 0
let lastDrawAt = 0
// 离屏/销毁时暂停重绘：数据仍入缓冲，恢复可见后由 IntersectionObserver 触发一次
let visible = true
let disposed = false
let io: IntersectionObserver | null = null
// useGlChart 的 resize（setup 结束后赋值）：每帧校准画布 CSS/backing 与容器、实时 DPR 一致。
// RO/DPR 事件在页面缩放/布局时序下可能漏触发，显式像素 style 一旦滞后会让
// GL 层（clientWidth）与 overlay 层（容器宽度）参考系差出比例（曾导致导出轴层只覆盖左侧）
let glChartResize: (() => void) | null = null
function schedule(): void {
  if (raf) return
  if (disposed || !visible) return
  // SSR / 无 rAF 环境直接跳过（组件渲染依赖浏览器）
  if (typeof requestAnimationFrame === 'undefined') return
  raf = requestAnimationFrame((now) => {
    raf = 0
    glChartResize?.() // 内部带变化守卫：稳定时仅读尺寸、零写入
    // 1ms 容差：rAF 间隔与 1000/fpsLimit 在浮点/显示刷新率边界上可能微差，
    // 无容差会把 60Hz 显示器上的 60fps 限制误判为不满足而隔帧绘制（实际掉到 30fps）
    const minInterval = 1000 / Math.max(1, props.fpsLimit) - 1
    if (now - lastDrawAt < minInterval) {
      schedule()
      return
    }
    lastDrawAt = now
    draw()
  })
}

// 触发引擎：触发对齐显示模式（独立于跟随/暂停）
const triggerEng = new TriggerEngine()
// 最近已渲染的触发显示键（`触发点绝对索引:窗宽`）；空串=尚未渲染过。
// normal/single 触发后首帧渲染「触发对齐窗口」并冻结，仅当触发点或窗宽变化才重绘——
// 环形缓冲持续流入淘汰也不影响已冻结画面（消除周期性跳变）
let lastShownTriggerKey = ''
// 组件级触发配置（在 TriggerConfig 基础上附加 autoTimeout，纯展示/回退逻辑用，引擎不感知）
type IqTriggerCfg = TriggerConfig & { autoTimeout?: number }
let triggerCfg: IqTriggerCfg = {
  enabled: false,
  source: 'i',
  edge: 'rising',
  level: 0,
  mode: 'auto',
  preTrigger: 0.25,
  autoTimeout: undefined
}

/** 触发对齐的显示窗（绝对索引域）。
 *  触发点须锚定在屏上 preTrigger 比例处——若窗口右端超出当前数据（total）被钳制，
 *  触发点会被推到窗口右缘（偏离屏位）；故右侧数据未到位时返回 null，等待数据到达后再渲染对齐帧。
 *  窗宽同时封顶到环形缓冲保留容量（ringKeep），避免过大窗宽左侧被淘汰钳制 */
function triggerViewWindow(span: number): { min: number; max: number } | null {
  const c = triggerCfg
  if (!c.enabled || triggerEng.state.lastTriggerAbs < 0) return null
  const spanC = Math.min(span, maxFollowSpan)
  const min = triggerEng.state.lastTriggerAbs - Math.floor(c.preTrigger * spanC)
  const max = min + spanC
  if (max > totalAbs()) return null // 右侧数据未到位：等待，不渲染错位帧
  return { min: Math.max(dropped, min), max }
}
/** auto/normal：待渲染触发点右侧数据补齐后提升为 lastTriggerAbs（此后才渲染对齐帧/冻结） */
function promotePendingIfReady(): void {
  const p = triggerEng.state.pendingAbs
  if (p < 0) return
  const need = triggerRightNeed(triggerCfg.preTrigger, Math.min(view.span, maxFollowSpan))
  if (p + need <= totalAbs()) triggerEng.promote()
}
/** 外部/内部刷新 trigger 配置 */
function syncTriggerCfg(): void {
  const t = props.trigger
  if (!t) return
  const prev = triggerCfg
  triggerCfg = {
    enabled: t.enabled,
    source: t.source ?? 'i',
    edge: t.edge ?? 'rising',
    level: t.level ?? 0,
    mode: t.mode ?? 'auto',
    preTrigger: Math.min(1, Math.max(0, t.preTrigger ?? 0.25)),
    autoTimeout: typeof t.autoTimeout === 'number' && t.autoTimeout > 0 ? t.autoTimeout : undefined
  }
  trigUi.enabled = triggerCfg.enabled
  trigUi.level = triggerCfg.level
  trigUi.mode = triggerCfg.mode
  trigUi.edge = triggerCfg.edge
  trigUi.status =
    triggerCfg.mode === 'single' && !triggerEng.state.armed
      ? tr('iq.statusCaptured')
      : tr('iq.statusWaiting')
  // 触发参数变化（开关/通道/边沿/电平/模式/屏位/失联超时）：旧捕获点与阈值不再匹配，
  // 重置触发状态等待新触发——否则残留 lastTriggerAbs/lastFeedHit 会让显示窗锚在旧捕获、
  // 而阈值线已画到新电平，波形看起来「突破不了阈值线」
  const changed =
    prev.enabled !== triggerCfg.enabled ||
    prev.source !== triggerCfg.source ||
    prev.edge !== triggerCfg.edge ||
    prev.level !== triggerCfg.level ||
    prev.mode !== triggerCfg.mode ||
    prev.preTrigger !== triggerCfg.preTrigger ||
    prev.autoTimeout !== triggerCfg.autoTimeout
  if (changed) {
    triggerEng.reset()
    lastShownTriggerKey = ''
  }
  schedule()
}
watch(
  () => props.trigger,
  () => syncTriggerCfg(),
  { deep: true, immediate: true }
)
function totalAbs(): number {
  return dropped + dataLen
}

function ensureCapacity(n: number): void {
  if (iBuf.length >= n) return
  const next = Math.min(maxPoints, Math.max(n, iBuf.length ? iBuf.length * 2 : 4096))
  const ni = new Float32Array(next)
  const nq = new Float32Array(next)
  ni.set(iBuf.subarray(0, dataLen))
  nq.set(qBuf.subarray(0, dataLen))
  iBuf = ni
  qBuf = nq
  pyrDirty = true // 数据拷贝到新缓冲，金字塔需重建
}

/** 环形丢老：保留最近 keep 条，累计 dropped，数据前移；返回淘汰量（金字塔由调用方更新） */
function compact(keep: number): number {
  const evicted = dataLen - keep
  dropped += evicted
  iBuf.copyWithin(0, evicted, dataLen)
  qBuf.copyWithin(0, evicted, dataLen)
  dataLen = keep
  return evicted
}

let adapterErrored = false
function normalize(raw: unknown): IqNormalized | null {
  const fn = props.adapter ?? iqAdapters.passthrough
  try {
    const v = fn(raw)
    if (!v) {
      // 尝试兜底：多适配器
      const fallback =
        iqAdapters.jsonInterleaved(raw) ?? iqAdapters.arrayBuffer(raw) ?? iqAdapters.base64(raw)
      return fallback
    }
    return v
  } catch (e) {
    adapterErrored = true
    reportError('adapter', e instanceof Error ? e.message : String(e))
    return null
  }
}

function pushNormalized(n: IqNormalized): void {
  // 暂停（非跟随）期间仍持续入缓冲与触发检测：不丢样本，恢复跟随后无缝续接；
  // 缓冲满后环形淘汰会继续推进——冻结窗被淘汰时由 resolveXRange 锚定最老可用数据滑动
  const prevLen = dataLen
  // 金字塔已同步到的长度（追加样本先增量同步，淘汰时 compactShift 平移）
  let pyrStart = prevLen
  // 触发扫描起点（淘汰会使新样本前移：淘汰量累计扣除）
  let trigStart = prevLen
  const appendSample = (i: number, q: number): void => {
    if (dataLen >= maxPoints) {
      // 先把本帧已追加样本同步进金字塔（compactShift 要求金字塔与淘汰前数据一致）
      if (dataLen > pyrStart) pyr.appendRange(iBuf, qBuf, pyrStart, dataLen)
      // 淘汰量取 PYRAMID_BLOCK 整数倍：保留数据与金字塔块对齐，可增量平移避免整树重建（~38ms）
      const ev = Math.ceil((dataLen - ringKeep) / PYRAMID_BLOCK) * PYRAMID_BLOCK
      const newLen = dataLen - ev
      compact(newLen)
      pyr.compactShift(newLen, ev)
      pyrDirty = false
      pyrStart = newLen
      trigStart -= ev
    }
    // 真实硬件/解码异常可能产生 NaN/Inf：入口清洗为 0，避免金字塔 min/max 与 GL 被污染
    iBuf[dataLen] = Number.isFinite(i) ? i : 0
    qBuf[dataLen] = Number.isFinite(q) ? q : 0
    dataLen++
  }
  if (n instanceof Float32Array) {
    // 交织 [I0,Q0,I1,Q1...]
    const pairs = Math.floor(n.length / 2)
    ensureCapacity(dataLen + pairs)
    for (let k = 0; k < pairs; k++) appendSample(n[2 * k], n[2 * k + 1])
  } else {
    const len = Math.min(n.i.length, n.q.length)
    ensureCapacity(dataLen + len)
    for (let k = 0; k < len; k++) appendSample(n.i[k], n.q[k])
  }
  // 维护金字塔：扩容 → 整树重建；否则增量同步本帧新样本（淘汰已 compactShift）
  if (pyrDirty) {
    pyr.rebuild(iBuf, qBuf, dataLen)
    pyrDirty = false
  } else if (dataLen > pyrStart) {
    pyr.appendRange(iBuf, qBuf, pyrStart, dataLen)
  }
  // 触发检测：在新增数据段上找边沿（源通道）
  if (triggerCfg.enabled) {
    const src = triggerCfg.source === 'i' ? iBuf : qBuf
    triggerEng.feed(triggerCfg, src, trigStart, dataLen, dropped)
    promotePendingIfReady()
  }
  lastDataAt = performance.now() // 实际入缓冲才刷新（数据流中断角标依据）
  schedule()
}

// ── 视口状态机 ──
// follow=true：窗口吸附最新数据；任何缩放/平移后 follow=false（冻结），数据从视图下方流过
const view = reactive({
  follow: true,
  span: Math.max(MIN_SPAN, props.span), // 当前窗宽（样本数），follow 与缩放共用；初值/复位取 props.span
  xMin: 0, // 冻结时的绝对索引范围
  xMax: DEFAULT_SPAN,
  yAuto: true,
  yMin: -1,
  yMax: 1
})
// 暂停（双击/角标）时的 Y 显示范围冻结：仅作显示层覆盖，不改 yAuto 语义——
// 恢复跟随后自动继续自动、手动保持手动（避免双击恢复重置用户手动缩放的 Y）
let pausedY: { min: number; max: number } | null = null

// 调用方运行时修改窗宽：跟随状态下立即生效并重绘
watch(
  () => props.span,
  (v) => {
    if (v === undefined) return
    view.span = Math.max(MIN_SPAN, v)
    if (view.follow) schedule()
  }
)

// 迹线可见性：点击图例切换；隐藏的通道不参与绘制与 Y 轴自适应统计
const traceVisible = reactive({ i: true, q: true, env: true })

function applyExternalViewport(v: NonNullable<IqProps['viewport']>): void {
  if (v.autoScale !== undefined) {
    // 外部切回自动缩放时丢弃旧平滑状态，避免从历史范围缓慢滑入
    if (v.autoScale && !view.yAuto) resetYAuto()
    view.yAuto = v.autoScale
  }
  if (v.yMin !== undefined) view.yMin = v.yMin
  if (v.yMax !== undefined) view.yMax = v.yMax
  if (v.xMin !== undefined && v.xMax !== undefined && v.xMax > v.xMin) {
    view.xMin = v.xMin
    view.xMax = v.xMax
    view.span = Math.max(MIN_SPAN, v.xMax - v.xMin)
    view.follow = false
  }
  schedule()
}
watch(
  () => props.viewport,
  (v) => {
    if (v) applyExternalViewport(v)
  },
  { immediate: true, deep: true }
)

// 外观配置变化：重绘（静态数据下也能立即看到切换效果）
watch([() => props.theme, () => props.chartStyle], () => schedule(), { deep: true })
// 余辉强度变化：立即重绘（暂停态下拖滑块也能实时看到拖影变化）
watch(
  () => props.persistence,
  () => schedule()
)
// 其余外观/数据语义 props：任一变化都重绘（暂停/冻结态下切换同样即时生效，不必等下一帧数据）
watch(
  [
    () => props.colors,
    () => props.envelope,
    () => props.mode,
    () => props.lineWidth,
    () => props.decimation,
    () => props.axis,
    () => props.xAxis,
    () => props.grid,
    () => props.axisLabels,
    () => props.sampleRate
  ],
  () => schedule(),
  { deep: true }
)
// auto 主题：系统深浅色切换时重绘波形层（DOM 浮层随响应式自动更新，画布需主动重绘）
watch(prefersDark, () => {
  if (props.theme === 'auto') schedule()
})

/** 冻结 X 视口并钳制到可保留范围 [dropped, total]，保持窗宽 */
function setFrozenX(min: number, max: number): void {
  const total = totalAbs()
  const span = Math.max(MIN_SPAN, max - min)
  min = Math.min(Math.max(min, dropped), Math.max(dropped, total - span))
  view.follow = false
  view.span = span
  view.xMin = min
  view.xMax = min + span
  emitSpanChange()
}

let spanNotifyTimer: ReturnType<typeof setTimeout> | null = null
/** 窗宽变化反馈（v-model:span 双向）：节流上报当前视口窗宽 */
function emitSpanChange(immediate = false): void {
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
  const send = (): void => {
    spanNotifyTimer = null
    emit('update:span', Math.max(MIN_SPAN, Math.round(view.span)))
  }
  if (immediate) send()
  else spanNotifyTimer = setTimeout(send, 150)
}

function resolveXRange(): { min: number; max: number } {
  const total = totalAbs()
  // follow/free-run 有效窗宽：封顶到环形缓冲保留容量（ringKeep），
  // 避免窗口左缘钳到 dropped 后随淘汰推进产生可见跳变
  const followSpan = Math.min(view.span, Math.max(MIN_SPAN, total), maxFollowSpan)
  // auto 模式：触发失联超时 → 回退自由滚动（free-run），防死屏
  const autoStale =
    triggerCfg.mode === 'auto' &&
    triggerEng.state.lastTriggerAt >= 0 &&
    Date.now() - triggerEng.state.lastTriggerAt > (triggerCfg.autoTimeout ?? AUTO_STALE_MS)
  // 触发对齐显示（独立于跟随/暂停）
  if (triggerCfg.enabled) {
    const tw = triggerViewWindow(view.span)
    if (tw) {
      // auto 模式：触发失联超时 → 回退滚动（free-run）
      if (triggerCfg.mode === 'auto' && autoStale) {
        return { min: Math.max(dropped, total - followSpan), max: total }
      }
      return tw
    }
    // 尚无触发（lastTriggerAbs<0）：auto 直接滚动；normal/single 在首次触发前也跟随最新数据
    if (triggerCfg.mode === 'auto' || triggerEng.state.lastTriggerAbs < 0) {
      return { min: Math.max(dropped, total - followSpan), max: total }
    }
  }
  if (view.follow) {
    return { min: Math.max(dropped, total - followSpan), max: total }
  }
  let min = Math.max(dropped, view.xMin)
  let max = Math.min(total, view.xMax)
  if (max - min < MIN_SPAN) min = Math.max(dropped, max - MIN_SPAN)
  if (max <= min) {
    // 环形淘汰已吞掉冻结窗：锚定最老可用数据，保持「已暂停」语义（绝不自动跳回最新）
    // 后续每次淘汰会让该窗口随淘汰前沿步进——有限历史下的必然，但永不恢复实时跟随
    const span = Math.max(MIN_SPAN, Math.min(view.span, total - dropped))
    min = dropped
    max = Math.min(total, dropped + span)
  }
  return { min, max }
}

// ── 自动 Y 轴平滑（即时扩张 / 慢速收缩）──
// 流式数据下逐帧精确自适应会导致刻度值与网格行每帧跳动；见 core/yauto.ts。
// 稳定参数：换档滞回 + 收窄驻留 + 档位直接吸附——抑制随机调制信号（QAM 过冲）极值在档位边界
// 附近的逐帧翻转，以及自动量程缓动造成的刻度/网格“呼吸”。扩张仍即时保证不裁切。
const yAuto = new YAutoScaler({
  hysteresis: 0.3,
  holdFrames: 120,
  shrinkRelease: 0.05,
  snap: true
})

/** 可见窗口真实极值（尊重图例显隐通道）；无效返回 null */
function computeVisibleMM(s: number, e: number): { min: number; max: number } | null {
  if (e <= s) return null
  const mm = pyr.query(iBuf, qBuf, s, e)
  if (!mm) return null
  let mn = Infinity
  let mx = -Infinity
  if (traceVisible.i) {
    if (mm.minI < mn) mn = mm.minI
    if (mm.maxI > mx) mx = mm.maxI
  }
  if (traceVisible.q) {
    if (mm.minQ < mn) mn = mm.minQ
    if (mm.maxQ > mx) mx = mm.maxQ
  }
  // 包络只有在 envelope 开启且图例未隐藏时才参与自动量程；
  // 否则 √(I²+Q²) 会悄悄把 Y 量程撑大（最大 √2 倍），而屏幕上根本看不到这条迹线
  if (props.envelope && traceVisible.env) {
    if (mm.envMin < mn) mn = mm.envMin
    if (mm.envMax > mx) mx = mm.envMax
  }
  if (!isFinite(mn)) return null
  return { min: mn, max: mx }
}

/** 重置自动 Y 轴平滑状态（清空数据/切换 yAuto 等），下一帧直接吸附目标 */
function resetYAuto(): void {
  yAuto.reset()
}

function resolveYRange(s: number, e: number): { min: number; max: number } {
  // 暂停时的 Y 冻结（仅自动模式；手动由 yMin/yMax 决定）：显示层覆盖，不改 yAuto 语义
  if (!view.follow && view.yAuto && pausedY) return { min: pausedY.min, max: pausedY.max }
  if (!view.yAuto) return { min: view.yMin, max: view.yMax }
  const mm = computeVisibleMM(s, e)
  if (!mm) return { min: -1, max: 1 }
  return yAuto.resolve(mm.min, mm.max)
}

// 绘图区（CSS px）：左侧固定刻度带 + 底部 X 刻度槽；Y 芯片+竖直轴线钉在组件最左，与绘图区间留空隙
function computePlot(canvas: HTMLCanvasElement): PlotRect {
  const dpr = window.devicePixelRatio || 1
  const wCss = canvas.width / dpr
  const hCss = canvas.height / dpr
  if (!props.axis) return { x: 0, y: 0, w: wCss, h: hCss }
  // 左带固定宽度不随数据变化 → 无逐帧抖动；波形与刻度区彻底分离
  return {
    x: th.value.axisWidth,
    y: 0,
    w: Math.max(1, wCss - th.value.axisWidth),
    h: Math.max(1, hCss - GUTTER_BOTTOM)
  }
}

// 上一帧视口缓存：交互时光标坐标 ↔ 数据坐标换算依据。
// xRange 为「显示域」：真实窗口两侧外扩 xFrac 比例后的范围（与屏幕波形一一对应）
let lastView: {
  xRange: { min: number; max: number }
  yRange: { min: number; max: number }
  plot: PlotRect
  /** 波形水平留白比例（每侧），显示域 ↔ 真实窗口换算用 */
  xFrac: number
  /** 当前帧缓冲切片 [s,e)（缓冲下标），供十字光标采样读数 */
  slice: { s: number; e: number }
} | null = null
// 上一帧真实窗口（不带留白外扩）；供余辉「视口是否变化」判断（与显示域 lastView.xRange 区分）
let lastXrReal: { min: number; max: number } | null = null

// 十字光标状态：绘图区内悬停位置；null=不显示
let cursor: { px: number; py: number } | null = null
// 鼠标是否悬停本实例：键盘快捷键只作用于悬停中的图表（多实例不抢键）
let hovered = false
const focused = ref(false)

// Shift+拖拽框选状态：像素坐标矩形；null=未框选
let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null

// ── 测量标记 ──
// Alt+点击空白：添加标记；Alt+点击标记：清除该标记（按下无拖动判定）；Alt+按住标记拖拽：微调位置。
// 右键菜单：在此处标记 / 清除该标记 / 清除全部标记 / 暂停-恢复刷新。
// 刷新（跟随）状态下不允许标记与拖拽平移，仅滚轮/框选缩放（缩放即进入暂停态）。
// 标记锚定绝对样本索引（缩放/平移保持数据位置），clear/恢复刷新时清空
let markers: number[] = []
let markerDrag = -1 // 正在拖拽的标记下标；-1=无
let markerMoved = false // 拖拽位移超阈值（区分「点击清除」与「拖拽微调」）
const markerDownPx = { x: 0, y: 0 }
const MARKER_HIT_PX = 6

// 右键菜单状态
const menu = reactive({ show: false, x: 0, y: 0, hitIdx: -1, dataX: 0 })

/**
 * 标记绝对索引 → 当前显示域像素 x。
 * 注意：lastView.xRange 是「显示域」（真实窗口两侧外扩了 PAD），
 * 因此按整幅 plot.w 映射与波形（按真实窗口 + 内缩绘制）是等价变换，
 * 不要再叠加一次 PAD_X，否则会重复内缩导致标记线偏移。
 */
function markerPx(c: number): number {
  if (!lastView) return Number.NaN
  const { plot, xRange } = lastView
  return plot.x + ((c - xRange.min) / (xRange.max - xRange.min)) * plot.w
}
/** 命中检测：返回像素 x 处命中的标记下标；-1=未命中 */
function markerHit(px: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const mx = markerPx(markers[i]!)
    if (lastView && Math.abs(mx - px) <= MARKER_HIT_PX) return i
  }
  return -1
}
/** 添加标记（刷新状态下禁止；触发模式允许）；位置取整到采样点 */
function addMarkerAt(dispX: number): void {
  if (view.follow && !triggerCfg.enabled) return
  markers.push(Math.round(dispX))
  schedule()
}

// ── 程序化标记 API（宿主自动化/报告用；不限制跟随态）──
function addMarker(index: number): boolean {
  const i = Math.round(index)
  if (!Number.isFinite(i)) return false
  markers.push(i)
  schedule()
  return true
}
function setMarkers(list: number[]): void {
  markers = list.filter((v) => Number.isFinite(v)).map((v) => Math.round(v))
  markerDrag = -1
  schedule()
}
function removeMarker(i: number): boolean {
  if (!Number.isInteger(i) || i < 0 || i >= markers.length) return false
  markers.splice(i, 1)
  markerDrag = -1
  schedule()
  return true
}

/** 右键菜单：按点击位置与命中状态构建动作集 */
function onContextMenu(evt: MouseEvent): void {
  evt.preventDefault()
  const root = rootRef.value
  if (!root || !lastView) return
  const rr = root.getBoundingClientRect()
  const px = evt.clientX - rr.left
  const py = evt.clientY - rr.top
  menu.x = Math.min(Math.max(4, px), Math.max(4, rr.width - 175))
  menu.y = Math.min(Math.max(4, py), Math.max(4, rr.height - 150))
  menu.hitIdx = markerHit(px)
  menu.dataX = pxToDataX(px)
  emit('contextmenu', { x: px, y: py, dataX: menu.dataX })
  if (props.contextMenu === false) return
  menu.show = true
  schedule()
}

function menuAction(act: 'add' | 'remove' | 'clear' | 'toggle'): void {
  menu.show = false
  if (act === 'add') {
    addMarkerAt(menu.dataX)
  } else if (act === 'remove' && menu.hitIdx >= 0) {
    markers.splice(menu.hitIdx, 1)
  } else if (act === 'clear') {
    markers = []
  } else if (act === 'toggle') {
    onDblClick()
  }
  schedule()
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || !renderer || (!gl && !ctx2d) || contextLost) return
  promotePendingIfReady() // 待渲染触发点右侧数据补齐 → 提升后本帧即可渲染对齐窗
  const xr = resolveXRange()
  // 绝对索引 → 缓冲下标
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = Math.max(0, e - s)
  // 先解析最终 Y 范围（决定网格/零线与刻度芯片位置）
  const yr = len > 0 ? resolveYRange(s, e) : { min: -1, max: 1 }
  const plot = computePlot(canvas)
  // 背景（全画布；先关 scissor；颜色由主题 bg 驱动）。
  // 余辉语义：
  // - 流式跟随：每帧淡出合成（旧迹线逐帧衰减、持续累积）
  // - 暂停且视口未变：不淡出不清理 → 绘图缓冲冻结，余辉停留在暂停瞬间（不随重绘衰减）
  // - 暂停后缩放/平移（视口已变）：旧内容与新视口错位 → 清屏重绘
  gl?.disable(gl.SCISSOR_TEST)
  const persist = Math.min(0.95, Math.max(0, props.persistence ?? 0))
  const fading = persist > 0 && (fadeRenderer !== null || ctx2d !== null)
  // 触发状态角标：single=等待触发/已捕获；normal=定格显示触发窗→触发锁定/无触发滚动→等待触发；
  // auto=有触发且未失联→触发锁定/触发失联或无触发→等待触发（free-run）
  const autoStale =
    triggerCfg.mode === 'auto' &&
    triggerEng.state.lastTriggerAt >= 0 &&
    Date.now() - triggerEng.state.lastTriggerAt > (triggerCfg.autoTimeout ?? AUTO_STALE_MS)
  trigUi.status =
    triggerCfg.mode === 'single'
      ? triggerEng.state.armed
        ? tr('iq.statusWaiting')
        : tr('iq.statusCaptured')
      : triggerCfg.mode === 'normal'
        ? triggerEng.state.lastTriggerAbs >= 0
          ? tr('iq.statusLocked')
          : tr('iq.statusWaiting')
        : triggerCfg.mode === 'auto'
          ? !autoStale && triggerEng.state.lastTriggerAbs >= 0
            ? tr('iq.statusLocked')
            : tr('iq.statusWaiting')
          : tr('iq.statusWaiting')
  // 触发对齐冻结：normal/single/auto(触发未失联) 触发后定格显示触发窗，仅当「触发点或窗宽变化」才重绘一帧。
  // （缓冲持续流入淘汰也不影响已冻结画面；右侧数据未到位时 triggerViewWindow 返回 null，
  //   不冻结不渲染，等待数据到达后渲染对齐帧——避免窗口被钳制导致触发点偏离屏位）
  // auto：有触发时锁定显示（同 normal），触发失联超 AUTO_STALE_MS 后回退自由滚动（free-run）
  const trigWin = triggerViewWindow(view.span)
  const trigAbs = trigWin ? triggerEng.state.lastTriggerAbs : -1
  const trigKey = trigWin ? `${trigAbs}:${view.span}` : ''
  const trigNew = !!trigWin && trigKey !== lastShownTriggerKey
  const trigFrozen =
    !!trigWin &&
    !trigNew &&
    (triggerCfg.mode === 'normal' ||
      (triggerCfg.mode === 'single' && !triggerEng.state.armed) ||
      (triggerCfg.mode === 'auto' && !autoStale))
  if (trigFrozen) {
    // 冻结：不重绘 GL 波形缓冲（保留捕获画面，余辉/拖影不衰减），
    // 但 overlay 仍每帧重绘——十字光标/标记/电平线/框选继续跟随交互（不随冻结停滞）。
    // 缓冲持续摄入导致 dropped 推进时，刷新 slice 使悬停采样读数仍指向正确本地下标
    if (lastView) {
      const rr = lastXrReal ?? { min: lastView.xRange.min, max: lastView.xRange.max }
      const fs = Math.max(0, Math.floor(rr.min) - dropped)
      const fe = Math.min(dataLen, Math.ceil(rr.max) - dropped)
      lastView.slice = { s: fs, e: Math.max(fs, fe) }
      drawOverlay(lastView.xRange, lastView.yRange, lastView.plot)
    }
    return
  }
  // 画布被重建（窗口尺寸变化等）后：先用冻结态快照回填，余辉像素不丢失
  if (needsRestore && persistSnapshot && (blitRenderer || ctx2d)) {
    restoreSnapshot()
    needsRestore = false
  }
  // 视口比较用「真实窗」与「上一帧真实窗」（lastView.xRange 是带留白外扩的显示域，不可直接比较）
  const viewChanged =
    !lastView ||
    !lastXrReal ||
    xr.min !== lastXrReal.min ||
    xr.max !== lastXrReal.max ||
    yr.min !== lastView.yRange.min ||
    yr.max !== lastView.yRange.max
  lastXrReal = { min: xr.min, max: xr.max }
  const fade = (a: number): void => fadeBackground(a)
  if (trigNew) {
    // 触发对齐渲染帧：清屏 + 不透明直写，干净定格（渲染完成后冻结）
    fadeOutFrames = 0
    clearBackground()
  } else if (fading && view.follow) {
    fadeOutFrames = 0
    persistSnapshot = null // 跟随态快照无意义，回填需求作废
    needsRestore = false
    fade(1 - persist)
  } else if (fading && !view.follow) {
    // 暂停态：视口未变 → 缓冲冻结（余辉保留）；视口变化 → 旧余辉快速渐隐而非瞬间清屏
    if (viewChanged) {
      fadeOutFrames = FADE_OUT_STEPS
      persistSnapshot = null // 旧视口快照作废，渐隐完成后重建
    }
    if (fadeOutFrames > 0) {
      fade(FADE_OUT_ALPHA)
      fadeOutFrames--
      if (fadeOutFrames === 0) {
        clearBackground()
      }
    }
  } else {
    clearBackground()
  }
  if (len <= 0) {
    // 无数据：强制完全清屏（余辉残影不保留）
    fadeOutFrames = 0
    clearBackground()
    lastView = null
    clearOverlay()
    if (dataStale.value) dataStale.value = false
    return
  }
  // 数据流中断检测（仅跟随态；状态变化才更新 ref，避免每帧触发渲染）
  const stale = view.follow && lastDataAt > 0 && performance.now() - lastDataAt > DATA_STALE_MS
  if (dataStale.value !== stale) dataStale.value = stale
  // 波形水平内缩留白：视窗两侧外扩等效 PAD_X 像素再映射到全宽绘图区
  // （轴线/网格不动，与 Y 轴纵向余量同一思路；首末采样点落在 f 与 1-f 像素分数处）
  const effPad = Math.min(PAD_X, plot.w * 0.08)
  const xFrac = effPad / plot.w
  const kS = 1 - 2 * xFrac
  const spanX = Math.max(1e-9, xr.max - xr.min)
  const padData = (xFrac * spanX) / kS
  const xrView = { min: xr.min - padData, max: xr.max + padData }
  lastView = { xRange: xrView, yRange: yr, plot, xFrac, slice: { s, e } }
  const targetPoints = Math.max(1, Math.floor(plot.w))
  // 抽稀：窗口小于像素宽时直接用原始切片；否则走极值金字塔按桶 minmax（保持原索引顺序）
  let iDec: Float32Array
  let qDec: Float32Array
  if (!props.decimation || len <= targetPoints) {
    iDec = iBuf.subarray(s, e)
    qDec = qBuf.subarray(s, e)
  } else {
    iDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 0)
    qDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 1)
  }
  // 抽稀索引空间同变换：idx=0 / idx=N-1 对齐 f 与 1-f 像素分数（与采样值域严格一致）
  const nIdx = Math.max(1, iDec.length - 1)
  const vpX = { xMin: (-xFrac * nIdx) / kS, xMax: nIdx + (xFrac * nIdx) / kS }
  // 冻结稳定态：迹线不透明直写（幂等重绘）——半透明混合重复叠加会逐次变亮（Alt 循环下可见）
  // 触发对齐渲染帧亦不透明直写（干净定格触发画面）
  const opaque = trigNew || (fading && !view.follow && !viewChanged && fadeOutFrames === 0)
  // mode:'dots' 时间域散点；点径随 lineWidth；line 模式下 lineWidth>1 走 ribbon 粗线
  const pt = props.mode === 'dots' ? Math.max(1, Math.round(2 * (props.lineWidth || 1))) : 0
  const lw = Math.max(1, props.lineWidth || 1)
  // 绘制 I（背景已自绘，不再清屏；限制在绘图区；微透明让网格透出）
  if (traceVisible.i) {
    renderer.setData(iDec)
    renderer.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceI, opaque ? 1 : th.value.traceAlpha),
      false,
      plot,
      opaque,
      pt,
      lw
    )
  }
  // 绘制 Q（叠加，不再清空）
  if (traceVisible.q && rendererQ) {
    rendererQ.setData(qDec)
    rendererQ.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceQ, opaque ? 1 : th.value.traceAlpha),
      false,
      plot,
      opaque,
      pt,
      lw
    )
  }
  // 绘制幅度包络 √(I²+Q²)（第三条叠加迹线；金字塔 env 聚合，大窗仍 O(块数)）
  if (props.envelope && traceVisible.env && rendererEnv) {
    let envDec: Float32Array
    if (!props.decimation || len <= targetPoints) {
      envDec = new Float32Array(len)
      for (let k = 0; k < len; k++) envDec[k] = Math.hypot(iBuf[s + k] ?? 0, qBuf[s + k] ?? 0)
    } else {
      envDec = pyr.bucketChannel(iBuf, qBuf, s, e, targetPoints, 2)
    }
    rendererEnv.setData(envDec)
    rendererEnv.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.envColor, opaque ? 1 : th.value.traceAlpha * 0.8),
      false,
      plot,
      opaque,
      // 与 I/Q 保持一致：dots 模式下包络也画散点（pt=0 会退回折线）
      pt,
      lw
    )
  }
  drawOverlay(xrView, yr, plot)
  // 冻结态 + 余辉：记录 GL 缓冲快照（画布重建后可回填恢复余辉像素）
  if (fading && !view.follow && !viewChanged && fadeOutFrames === 0) {
    if (
      !persistSnapshot ||
      persistSnapshot.width !== canvas.width ||
      persistSnapshot.height !== canvas.height
    ) {
      const snap = document.createElement('canvas')
      snap.width = canvas.width
      snap.height = canvas.height
      snap.getContext('2d')?.drawImage(canvas, 0, 0)
      persistSnapshot = snap
    }
  }
  // 触发对齐帧渲染完成：标记已渲染，后续帧进入冻结
  if (trigNew) lastShownTriggerKey = trigKey
}

// overlay 尺寸漂移诊断：dev 下首次检测到与 GL backing / CSS 宽度不一致时告警
let overlaySizeWarned = false
let overlayScaleWarned = false

// ── 坐标轴覆盖层 ──
function drawOverlay(
  xv: { min: number; max: number },
  yr: { min: number; max: number },
  plot: PlotRect
): void {
  const ov = overlayRef.value
  if (!ov || !props.axis) return
  // 自愈：overlay backing 必须与 GL backing 一致——否则轴层以 CSS 分辨率绘制，
  // 屏幕上看似完整（元素按 CSS 尺寸显示小 buffer），导出 1:1 合成时只覆盖左上角
  const glC = canvasRef.value
  if (glC && (ov.width !== glC.width || ov.height !== glC.height)) {
    if (IS_DEV && !overlaySizeWarned) {
      overlaySizeWarned = true
      console.warn('[IqChart] overlay 尺寸与 GL 画布不一致，已自动同步', {
        overlay: [ov.width, ov.height],
        gl: [glC.width, glC.height],
        dpr: window.devicePixelRatio
      })
    }
    ov.width = glC.width
    ov.height = glC.height
  }
  const ctx = ov.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ov.width, ov.height)
  // 映射基准 = overlay 自身显示盒（bitmap ÷ CSS 尺寸）。canvas 是 replaced element，
  // 仅靠 absolute+inset:0 不会被拉伸（按固有尺寸=bitmap 宽显示）；样式区已显式
  // width/height:100%，使其与 GL 画布拉伸到同一布局盒，故该比例与 GL 的
  // canvas.width/clientWidth 一致（两层同一换算，光标/标记与鼠标严格对齐）
  const rect = ov.getBoundingClientRect()
  const refW = ov.clientWidth || rect.width
  const refH = ov.clientHeight || rect.height
  if (IS_DEV && !overlayScaleWarned && glC && Math.abs(refW - glC.clientWidth) > 1) {
    overlayScaleWarned = true
    console.warn('[IqChart] overlay 与 GL 画布 CSS 宽度不一致', {
      overlayClientW: refW,
      glClientW: glC.clientWidth,
      dpr: window.devicePixelRatio
    })
  }
  const sx = ov.width / Math.max(1, refW)
  const sy = ov.height / Math.max(1, refH)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  const t = th.value
  // X 轴时间单位（sampleRate > 0）：刻度值仍为样本索引域，标签换算为时间
  const rate = effectiveSampleRate.value
  const timeOn = !!rate && rate > 0
  const tStep = timeOn ? (xv.max - xv.min) / (rate as number) / 6 : 0
  const xTicksOverride = buildTimeTicks(xv.min, xv.max)
  drawAxisOverlay(ctx, {
    plot,
    xMin: xv.min,
    xMax: xv.max,
    yMin: yr.min,
    yMax: yr.max,
    showX: props.xAxis !== false,
    showGrid: props.grid !== false,
    frame: false,
    xTicksOverride,
    theme: {
      text: t.text,
      grid: t.grid,
      axisLine: t.border,
      plotBg: t.plotBg,
      border: t.border,
      zeroLine: t.zeroLine,
      labelChipBg: t.labelChipBg
    }
  })

  // ── 轴单位标题（半透明浮于绘图区角部，不占布局；props.axisLabels 控制显隐）──
  if (props.axisLabels !== false) {
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    // Y：竖排「幅度」于绘图区左上角
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(plot.x + 8, plot.y + 12)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(props.labels?.y ?? tr('iq.axisY'), 0, 0)
    ctx.restore()
    // X：单位于绘图区右下角（时间/样本随 sampleRate）
    ctx.save()
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = t.text
    ctx.globalAlpha = 0.55
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(
      props.labels?.x ?? tr(timeOn ? 'iq.axisXTime' : 'iq.axisXSamples'),
      plot.x + plot.w - 6,
      plot.y + plot.h - 6
    )
    ctx.restore()
  }

  // ── 触发显示：电平线（可拖拽）+ 触发点标记 + 状态 ──
  if (triggerCfg.enabled) {
    const ySpan = yr.max - yr.min
    const ly =
      ySpan > 1e-9
        ? plot.y + plot.h - ((triggerCfg.level - yr.min) / ySpan) * plot.h
        : plot.y + plot.h
    if (ly >= plot.y - 2 && ly <= plot.y + plot.h + 2) {
      ctx.save()
      ctx.strokeStyle = t.triggerColor
      ctx.setLineDash([6, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plot.x, Math.round(ly) + 0.5)
      ctx.lineTo(plot.x + plot.w, Math.round(ly) + 0.5)
      ctx.stroke()
      ctx.restore()
      // 电平标签
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lvLbl = `Lv ${triggerCfg.level.toFixed(yDecimals())}`
      const lvChipY = Math.min(
        Math.max(Math.round(ly) - CHIP_H / 2, plot.y + 2),
        plot.y + plot.h - CHIP_H - 2
      )
      drawChip(ctx, plot.x + plot.w - 64, lvChipY, lvLbl, t.labelChipBg, t.triggerColor)
    }
    // 状态文字（每帧更新角标，已在 draw() 顶部统一计算）
    // 触发点标记（三角标，位于触发样本所在屏幕 x；计入 PAD_X 内缩与波形映射一致）
    if (triggerEng.state.lastTriggerAbs >= 0 && lastView) {
      const pre = triggerCfg.preTrigger
      const tx = plot.x + PAD_X + pre * (plot.w - 2 * PAD_X)
      if (tx >= plot.x && tx <= plot.x + plot.w) {
        ctx.save()
        ctx.fillStyle = t.triggerColor
        ctx.beginPath()
        ctx.moveTo(Math.round(tx) + 0.5, plot.y + 1)
        ctx.lineTo(Math.round(tx) - 3, plot.y + 8)
        ctx.lineTo(Math.round(tx) + 3, plot.y + 8)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }
  }

  // ── Shift+拖拽 框选矩形（松手放大到该区域）──
  if (boxSel) {
    const bx = Math.min(boxSel.x0, boxSel.x1)
    const by = Math.min(boxSel.y0, boxSel.y1)
    const bw = Math.abs(boxSel.x1 - boxSel.x0)
    const bh = Math.abs(boxSel.y1 - boxSel.y0)
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.fillStyle = t.crosshair
    ctx.fillRect(bx, by, bw, bh)
    ctx.globalAlpha = 1
    ctx.strokeStyle = t.crosshair
    ctx.setLineDash([4, 3])
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
    ctx.restore()
  }

  // ── 窗口自动测量（暂停态；Vpp/均值/RMS，仅显示可见通道）──
  if (!view.follow) {
    const st = windowStats()
    if (st) {
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const fmt3 = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
      const lines = [tr('iq.windowSamples', { n: st.count })]
      if (traceVisible.i) {
        lines.push(
          `I  Vpp ${(st.maxI - st.minI).toFixed(yDecimals())}  ${tr('iq.mean')} ${fmt3(st.meanI)}  RMS ${st.rmsI.toFixed(yDecimals())}`
        )
      }
      if (traceVisible.q) {
        lines.push(
          `Q  Vpp ${(st.maxQ - st.minQ).toFixed(yDecimals())}  ${tr('iq.mean')} ${fmt3(st.meanQ)}  RMS ${st.rmsQ.toFixed(yDecimals())}`
        )
      }
      let wMax = 0
      for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
      const padX = 8
      const lineH = 14
      const bw = Math.ceil(wMax) + padX * 2
      const bh = lines.length * lineH + 6
      const bx = plot.x + 8
      const byC = plot.y + 34 // 暂停角标下方
      drawPanel(ctx, bx, byC, bw, bh, t.labelChipBg)
      ctx.fillStyle = t.text
      lines.forEach((ln, li) => ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2))
    }
  }

  // ── 测量标记（锚定样本索引，随缩放平移保持数据位置；数量不限）──
  if (markers.length > 0) {
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chipBg2 = t.labelChipBg
    const readAt = (c: number): string | null => {
      const local = c - dropped
      if (local < 0 || local >= dataLen) return null
      return `I ${fmtValIqAdaptive(iBuf[local] ?? 0)} Q ${fmtValIqAdaptive(qBuf[local] ?? 0)}`
    }
    const markerLines: string[] = []
    markers.forEach((c, i) => {
      if (!lastView) return
      const pl = lastView.plot
      // 与命中检测共用同一映射（显示域 + 整幅 plot.w）。不要在这里再按 PAD_X 内缩一次：
      // lastView.xRange 本身已经是外扩后的显示域，双重内缩会让标记线偏离波形 ~20px。
      const px = markerPx(c)
      if (px < pl.x - 0.5 || px > pl.x + pl.w + 0.5) return
      const pxc = Math.round(px) + 0.5
      ctx.save()
      ctx.strokeStyle = t.crosshair
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(pxc, pl.y)
      ctx.lineTo(pxc, pl.y + pl.h)
      ctx.stroke()
      ctx.restore()
      drawChip(ctx, pxc, pl.y + 2, `M${i + 1}`, chipBg2, t.text, 'center', {
        min: pl.x,
        max: pl.x + pl.w
      })
      const local = c - dropped
      const tTxt = timeOn ? ` · ${fmtTime(c / (rate as number), tStep)}` : ''
      markerLines.push(
        local >= 0 && local < dataLen
          ? `M${i + 1}  #${c}${tTxt}  ${readAt(c)}`
          : `M${i + 1}  #${c}${tTxt}`
      )
    })
    // 恰好两个标记时附加 Δ 测量（样本/时间/频率）
    if (markers.length === 2) {
      const sorted = [...markers].sort((x, y) => x - y)
      const dSamples = Math.abs(sorted[1]! - sorted[0]!)
      markerLines.push(tr('iq.deltaSamples', { n: dSamples }))
      if (timeOn && dSamples > 0) {
        const dt = dSamples / (rate as number)
        markerLines.push(`Δt ${fmtTime(dt, tStep)}`)
        markerLines.push(`1/Δt ${fmtFreq(1 / dt)}`)
      }
    }
    if (markerLines.length > 0) {
      ctx.textAlign = 'left'
      let wMax = 0
      for (const ln of markerLines) wMax = Math.max(wMax, ctx.measureText(ln).width)
      const padX = 8
      const lineH = 14
      const bw = Math.ceil(wMax) + padX * 2
      const bh = markerLines.length * lineH + 6
      const bx = plot.x + plot.w - 8 - bw // 右上角，避开左上角标
      const byC = plot.y + 40 // 图例下方
      drawPanel(ctx, bx, byC, bw, bh, chipBg2)
      ctx.fillStyle = t.text
      markerLines.forEach((ln, li) => {
        ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2)
      })
    }
  }

  // ── 十字光标与读数（悬停；跟随/暂停均可用）──
  if (!cursor) return
  const cxp = Math.round(cursor.px) + 0.5
  const cyp = Math.round(cursor.py) + 0.5
  ctx.save()
  ctx.strokeStyle = t.crosshair
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cxp, plot.y)
  ctx.lineTo(cxp, plot.y + plot.h)
  ctx.moveTo(plot.x, cyp)
  ctx.lineTo(plot.x + plot.w, cyp)
  ctx.stroke()
  ctx.restore()

  // 轴缘读数芯片：X 值贴底部刻度槽、Y 值贴左带（与 Y 刻度芯片同款样式）
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chipBg = t.labelChipBg
  const dispX = pxToDataX(cursor.px)
  const xText = timeOn ? fmtTime(dispX / (rate as number), tStep) : String(Math.round(dispX))
  drawChip(ctx, cxp, plot.y + plot.h + 3, xText, chipBg, t.text, 'center', {
    min: plot.x,
    max: plot.x + plot.w
  })
  const yText = pyToDataY(cursor.py).toFixed(yDecimals())
  const yChipY = Math.min(Math.max(cyp - CHIP_H / 2, plot.y + 2), plot.y + plot.h - CHIP_H - 2)
  drawChip(ctx, 2, yChipY, yText, chipBg, t.text)

  // 浮动读数框：样本索引 + 最近采样点实际 I/Q 值（贴近右/下边缘时自动翻转避让）
  const smp = sampleAt(cursor.px)
  if (!smp) return
  const fmtVal = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
  const idxLine = timeOn
    ? `#${smp.idx} · ${fmtTime(dispX / (rate as number), tStep)}`
    : `#${smp.idx}`
  const lines = [idxLine]
  if (traceVisible.i) lines.push(`I ${fmtVal(smp.i)}`)
  if (traceVisible.q) lines.push(`Q ${fmtVal(smp.q)}`)
  ctx.textAlign = 'left'
  let wMax = 0
  for (const ln of lines) wMax = Math.max(wMax, ctx.measureText(ln).width)
  const padX = 8
  const lineH = 14
  const bw = Math.ceil(wMax) + padX * 2
  const bh = lines.length * lineH + 6
  let bx = cursor.px + 14
  const byC = Math.min(cursor.py + 14, plot.y + plot.h - bh - 4)
  if (bx + bw > plot.x + plot.w) bx = cursor.px - 14 - bw
  drawPanel(ctx, bx, byC, bw, bh, chipBg)
  ctx.fillStyle = t.text
  lines.forEach((ln, li) => {
    ctx.fillText(ln, bx + padX, byC + 3 + lineH * li + lineH / 2)
  })
}
function clearOverlay(): void {
  const ov = overlayRef.value
  if (!ov) return
  ov.getContext('2d')?.clearRect(0, 0, ov.width, ov.height)
}

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: (w, h) => {
    // 覆盖层与 GL canvas 尺寸同步（device px）
    const ov = overlayRef.value
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w
      ov.height = h
    }
    // WebGL2/Canvas2D 均不可用：仅显示显式提示
    if (!gl && !ctx2d) {
      drawUnsupported(tr('iq.webglUnsupported'))
      return
    }
    // 画布被重建（缓冲已清空）：冻结态存在快照时标记回填，下一帧恢复余辉
    if (persistSnapshot) needsRestore = true
    // 触发对齐冻结画面：GL 缓冲随画布重建清空 → 重置已渲染键，强制下一帧重渲染触发帧
    if (triggerCfg.enabled && lastShownTriggerKey !== '') {
      lastShownTriggerKey = ''
      needsRestore = false
    }
  },
  onDraw: schedule
})
// 供 schedule() 每帧兜底校准（见 glChartResize 声明处）
glChartResize = glChart.resize

// ── 交互：光标 ↔ 数据坐标换算 ──
function clientToPlot(evt: MouseEvent): { px: number; py: number } | null {
  const canvas = canvasRef.value
  if (!canvas || !lastView) return null
  const r = canvas.getBoundingClientRect()
  return { px: evt.clientX - r.left, py: evt.clientY - r.top }
}
function pxToDataX(px: number): number {
  const { xRange, plot } = lastView!
  return xRange.min + ((px - plot.x) / plot.w) * (xRange.max - xRange.min)
}
function pyToDataY(py: number): number {
  const { yRange, plot } = lastView!
  return yRange.min + (1 - (py - plot.y) / plot.h) * (yRange.max - yRange.min)
}
/** 显示域窗口 → 真实窗口：去掉两侧波形留白外扩（与 draw() 的外扩互逆） */
function unpadX(min: number, max: number, frac: number): { min: number; max: number } {
  const p = frac * (max - min)
  return { min: min + p, max: max - p }
}
/** 光标处最近采样点读取；显示域坐标越出当前缓冲切片时返回 null */
function sampleAt(px: number): { idx: number; i: number; q: number } | null {
  if (!lastView || dataLen === 0) return null
  const absIdx = Math.round(pxToDataX(px))
  const local = absIdx - dropped
  const { s, e } = lastView.slice
  if (local < s || local >= e) return null
  return { idx: absIdx, i: iBuf[local] ?? 0, q: qBuf[local] ?? 0 }
}

// ── 窗口自动测量（暂停态）──
let statsKey = ''
let statsCache: RangeStats | null = null
/** 暂停态计算可见窗口统计（Vpp/均值/RMS，金字塔 O(块数)）；按窗口切片缓存；跟随态返回 null */
function windowStats(): RangeStats | null {
  if (!lastView || view.follow) return null
  const { s, e } = lastView.slice
  const key = `${s}:${e}`
  if (statsKey === key) return statsCache
  statsKey = key
  statsCache = pyr.queryStats(iBuf, qBuf, s, e)
  return statsCache
}

// ── X 轴时间单位（sampleRate > 0 时启用）──
/** 数值按步长量级取小数并去掉尾随 0 */
function trimZeros(v: number, step: number): string {
  const dec = Math.min(4, Math.max(0, Math.ceil(-Math.log10(Math.max(step, 1e-12)))))
  const s = v.toFixed(dec)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
/** 秒 → 自适应时间文本（µs/ms/s），小数位随刻度步长量级 */
function fmtTime(seconds: number, stepSeconds: number): string {
  const a = Math.abs(seconds)
  if (a >= 1) return `${trimZeros(seconds, stepSeconds)} s`
  if (a >= 1e-3) return `${trimZeros(seconds * 1e3, stepSeconds * 1e3)} ms`
  return `${trimZeros(seconds * 1e6, stepSeconds * 1e6)} µs`
}
/** 依据采样率构建时间刻度：值仍为样本索引域（供网格定位），labels 为时间文本 */
function buildTimeTicks(
  min: number,
  max: number
): { values: number[]; labels: string[] } | undefined {
  const rate = effectiveSampleRate.value
  if (!rate || rate <= 0 || !(max > min)) return undefined
  const times = niceTicks(min / rate, max / rate, 6)
  if (!times.length) return undefined
  const stepT = times.length > 1 ? times[1]! - times[0]! : Math.max((max - min) / rate / 6, 1e-9)
  return {
    values: times.map((t) => t * rate),
    labels: times.map((t) => fmtTime(t, stepT))
  }
}
/** Hz → 自适应频率文本（Hz/kHz/MHz） */
function fmtFreq(hz: number): string {
  if (!isFinite(hz) || hz <= 0) return '—'
  if (hz >= 1e6) return `${trimZeros(hz / 1e6, 1e-3)} MHz`
  if (hz >= 1e3) return `${trimZeros(hz / 1e3, 1e-3)} kHz`
  return `${trimZeros(hz, 1e-3)} Hz`
}
/** 读数小数位自适应：随 Y 轴 V/div 档位（步长量级）自动定精度，钳制 2~6 位 */
function yDecimals(): number {
  if (!lastView) return 3
  const step = niceStep(lastView.yRange.max - lastView.yRange.min, 5)
  return Math.min(6, Math.max(2, Math.ceil(-Math.log10(Math.max(step, 1e-9))) + 2))
}
/** 带符号自适应小数位（精度随 V/div 档位） */
function fmtValIqAdaptive(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(yDecimals())}`
}

// ── 缩放历史栈（Z 撤销 / Shift+Z 重做）──
interface ViewState {
  follow: boolean
  span: number
  xMin: number
  xMax: number
  yAuto: boolean
  yMin: number
  yMax: number
}
const viewHistory: ViewState[] = []
let viewHistoryPos = -1
const VIEW_HISTORY_MAX = 30

function captureView(): ViewState {
  const xr = resolveXRange()
  return {
    follow: view.follow,
    span: view.span,
    xMin: xr.min,
    xMax: xr.max,
    yAuto: view.yAuto,
    yMin: view.yMin,
    yMax: view.yMax
  }
}
/** 视口变更后提交当前状态（截断 redo 尾部，容量封顶） */
function commitViewState(): void {
  viewHistory.length = viewHistoryPos + 1
  viewHistory.push(captureView())
  if (viewHistory.length > VIEW_HISTORY_MAX) viewHistory.shift()
  viewHistoryPos = viewHistory.length - 1
}
function clearViewHistory(): void {
  viewHistory.length = 0
  viewHistoryPos = -1
  commitViewState() // 记录新基线
}
function applyViewState(s: ViewState): void {
  view.follow = s.follow
  view.span = s.span
  view.yAuto = s.yAuto
  view.yMin = s.yMin
  view.yMax = s.yMax
  if (!s.follow) {
    view.xMin = s.xMin
    view.xMax = s.xMax
  }
  pausedY = null // 视口快照接管显示（暂停冻结范围不再覆盖）
  resetYAuto()
  schedule()
  emitViewportChange(true)
}
function undoView(): void {
  if (viewHistoryPos <= 0) return
  viewHistoryPos--
  applyViewState(viewHistory[viewHistoryPos]!)
}
function redoView(): void {
  if (viewHistoryPos >= viewHistory.length - 1) return
  viewHistoryPos++
  applyViewState(viewHistory[viewHistoryPos]!)
}

// ── 键盘微调（暂停态）：←→ X 平移 / ↑↓ Y 平移 / +− X 缩放 / Z 撤销 / Shift+Z 重做 ──
function panView(dx: number): void {
  const xr = resolveXRange()
  const span = xr.max - xr.min
  setFrozenX(xr.min + dx * span, xr.max + dx * span)
  schedule()
  emitViewportChange(true)
}
function panViewY(dy: number): void {
  const r = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  view.yAuto = false
  const d = dy * (r.max - r.min)
  view.yMin = r.min + d
  view.yMax = r.max + d
  resetYAuto()
  schedule()
  emitViewportChange(true)
}
function zoomViewX(factor: number): void {
  const xr = resolveXRange()
  const span = Math.min(
    Math.max((xr.max - xr.min) * factor, MIN_SPAN),
    Math.max(totalAbs(), MIN_SPAN)
  )
  const c = (xr.min + xr.max) / 2
  setFrozenX(c - span / 2, c + span / 2)
  schedule()
  emitViewportChange(true)
}
function onKeyDown(evt: KeyboardEvent): void {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return
  // 键盘快捷键作用于悬停或聚焦的实例（多图同页不互相抢键）；
  // 且焦点在输入控件内时完全不响应（避免打字触发撤销/平移/缩放）
  if (!hovered && !focused.value) return
  const t = evt.target as HTMLElement | null
  if (
    t &&
    (t.isContentEditable ||
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT')
  )
    return
  if (evt.key === 'z' || evt.key === 'Z') {
    evt.preventDefault()
    if (evt.shiftKey) redoView()
    else undoView()
    return
  }
  // 触发模式：仅允许 +/- 调窗宽（保持触发对齐）；方向键平移破坏对齐，禁用
  if (triggerCfg.enabled) {
    const f =
      evt.key === '+' || evt.key === '=' ? 1 / 1.2 : evt.key === '-' || evt.key === '_' ? 1.2 : 0
    if (f) {
      evt.preventDefault()
      const limit = Math.max(totalAbs(), MIN_SPAN)
      view.span = Math.min(Math.max(view.span * f, MIN_SPAN), limit)
      commitViewState()
      schedule()
      emitSpanChange()
      emitViewportChange(true)
    }
    return
  }
  if (view.follow) return // 跟随态不允许视口微调
  if (!lastView) return
  const commit = (fn: () => void): void => {
    fn()
    commitViewState()
  }
  switch (evt.key) {
    case 'ArrowLeft':
      evt.preventDefault()
      commit(() => panView(-0.1))
      break
    case 'ArrowRight':
      evt.preventDefault()
      commit(() => panView(0.1))
      break
    case 'ArrowUp':
      evt.preventDefault()
      commit(() => panViewY(0.1))
      break
    case 'ArrowDown':
      evt.preventDefault()
      commit(() => panViewY(-0.1))
      break
    case '+':
    case '=':
      evt.preventDefault()
      commit(() => zoomViewX(1 / 1.2))
      break
    case '-':
    case '_':
      evt.preventDefault()
      commit(() => zoomViewX(1.2))
      break
  }
}

// ── 十字光标 ──
function updateCursor(evt: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || !lastView) {
    if (cursor !== null) {
      cursor = null
      emit('cursorChange', null)
      schedule()
    }
    return
  }
  const r = canvas.getBoundingClientRect()
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  const { plot } = lastView
  const inside = px >= plot.x && px <= plot.x + plot.w && py >= plot.y && py <= plot.y + plot.h
  const next = inside ? { px, py } : null
  const changed =
    (next === null) !== (cursor === null) ||
    (next !== null && cursor !== null && (next.px !== cursor.px || next.py !== cursor.py))
  const wasNull = cursor === null
  cursor = next
  if (changed) {
    const info = cursor ? sampleAt(cursor.px) : null
    if (info && cursor) {
      emit('cursorChange', {
        px: cursor.px,
        py: cursor.py,
        dataX: info.idx,
        i: info.i,
        q: info.q
      })
    } else if (!wasNull) {
      emit('cursorChange', null)
    }
    schedule()
  }
}
function onPointerEnter(): void {
  hovered = true
}
function onPointerLeave(): void {
  hovered = false
  if (cursor !== null) {
    cursor = null
    emit('cursorChange', null)
    schedule()
  }
}

let viewportNotifyTimer: ReturnType<typeof setTimeout> | null = null
function emitViewportChange(immediate = false): void {
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
  if (immediate) {
    doEmitViewportChange()
    return
  }
  viewportNotifyTimer = setTimeout(doEmitViewportChange, 150)
}
function doEmitViewportChange(): void {
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  emit('viewportChange', {
    follow: view.follow,
    yAuto: view.yAuto,
    xMin: xr.min,
    xMax: xr.max,
    yMin: yr.min,
    yMax: yr.max
  })
}

function onWheel(evt: WheelEvent): void {
  if (!lastView) return
  evt.preventDefault()
  const p = clientToPlot(evt)
  if (!p) return
  const factor = evt.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  // 触发模式：缩放只改窗宽（span），不退出触发对齐、不暂停
  if (triggerCfg.enabled && !evt.shiftKey) {
    const limit = Math.max(totalAbs(), MIN_SPAN)
    view.span = Math.min(Math.max(view.span * factor, MIN_SPAN), limit)
    schedule()
    commitViewState()
    emitSpanChange()
    emitViewportChange()
    return
  }
  if (evt.shiftKey) {
    // Y 轴缩放：锚定光标处数据值
    const anchor = pyToDataY(p.py)
    const { yRange } = lastView
    const min = anchor + (yRange.min - anchor) * factor
    const max = anchor + (yRange.max - anchor) * factor
    if (!(max - min > 1e-6)) return
    view.yAuto = false
    view.yMin = min
    view.yMax = max
  } else {
    // X 轴缩放：锚定光标处绝对索引（光标左右两侧比例保持不变）；显示域计算后去留白回真实窗口
    const anchor = pxToDataX(p.px)
    const { xRange, xFrac } = lastView
    const limit = Math.max(totalAbs(), MIN_SPAN)
    const span = Math.min(Math.max((xRange.max - xRange.min) * factor, MIN_SPAN), limit)
    const leftSpan = (anchor - xRange.min) * factor
    const rw = unpadX(anchor - leftSpan, anchor - leftSpan + span, xFrac)
    setFrozenX(rw.min, rw.max)
  }
  commitViewState() // 缩放历史（Z 可逐级撤销）
  schedule()
  emitViewportChange()
}

// 拖拽平移上下文（dragStart 时冻结的基准；xMin/xMax 为显示域）
interface DragCtx {
  px: number
  py: number
  plotW: number
  plotH: number
  xMin: number
  xMax: number
  xFrac: number
  yMin: number
  yMax: number
  yAuto: boolean
}
let dragCtx: DragCtx | null = null
// 触摸双指缩放：两指距离变化映射为 X 窗宽，中心保持起始中点
const touchPts = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; span: number; centerAbs: number } | null = null
function startPinch(): void {
  if (!lastView || touchPts.size !== 2) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const cx = (a.x + b.x) / 2
  pinch = { dist, span: view.span, centerAbs: pxToDataX(cx) }
  dragCtx = null
  levelDrag = false
  boxSel = null
}
function updatePinch(): void {
  if (!pinch || touchPts.size !== 2 || !lastView) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const span = Math.min(
    Math.max(MIN_SPAN, (pinch.span * pinch.dist) / dist),
    Math.max(MIN_SPAN, totalAbs())
  )
  const c = pinch.centerAbs
  setFrozenX(c - span / 2, c + span / 2)
  schedule()
}

function onPointerDown(evt: PointerEvent): void {
  if (!lastView || evt.button !== 0) return
  menu.show = false // 任意按下先收起右键菜单
  if (evt.pointerType === 'touch') {
    ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (touchPts.size === 2) startPinch()
    return
  }
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  // Alt+点击：空白处添加标记；命中标记则进入「按下-拖拽/松手清除」流程。
  // 刷新（跟随）状态下不允许标记（触发模式允许）
  if (evt.altKey) {
    if (view.follow && !triggerCfg.enabled) return
    const hit = markerHit(p.px)
    if (hit >= 0) {
      markerDrag = hit
      markerMoved = false
      markerDownPx.x = p.px
      markerDownPx.y = p.py
    } else {
      addMarkerAt(pxToDataX(p.px))
    }
    schedule()
    return
  }
  // Shift+拖拽：框选放大（缩放类操作，刷新状态下允许，松手即进入暂停态）
  if (evt.shiftKey) {
    boxSel = { x0: p.px, y0: p.py, x1: p.px, y1: p.py }
    return
  }
  // 触发模式：电平线拖拽（命中电平线 6px 内）
  if (triggerCfg.enabled && lastView) {
    const lvl = triggerCfg.level
    const ys = lastView.yRange.max - lastView.yRange.min
    const yPx =
      ys > 1e-9
        ? lastView.plot.y + lastView.plot.h - ((lvl - lastView.yRange.min) / ys) * lastView.plot.h
        : lastView.plot.y + lastView.plot.h
    if (Math.abs(yPx - p.py) <= 6) {
      levelDrag = true
      schedule()
      return
    }
  }
  // 刷新（跟随）状态下禁止拖拽平移：始终展示最新数据
  if (view.follow) return
  dragCtx = {
    px: p.px,
    py: p.py,
    plotW: lastView.plot.w,
    plotH: lastView.plot.h,
    xMin: lastView.xRange.min,
    xMax: lastView.xRange.max,
    xFrac: lastView.xFrac,
    yMin: lastView.yRange.min,
    yMax: lastView.yRange.max,
    yAuto: view.yAuto
  }
}

/** 框选放大：宽 ≥8px 缩放 X、高 ≥8px 缩放 Y（扁平/细长框只缩放对应轴，两向都过小才忽略） */
function finishBoxZoom(): void {
  if (!boxSel || !lastView) return
  const { x0, y0, x1, y1 } = boxSel
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  if (dx < 8 && dy < 8) return
  if (triggerCfg.enabled) {
    // 触发模式：框选只调整窗宽与 Y 量程，保持触发对齐
    if (dx >= 8) {
      const span = Math.max(MIN_SPAN, Math.abs(pxToDataX(x1) - pxToDataX(x0)))
      view.span = Math.min(span, Math.max(totalAbs(), MIN_SPAN))
      emitSpanChange()
    }
    if (dy >= 8) {
      const yHi = pyToDataY(Math.min(y0, y1))
      const yLo = pyToDataY(Math.max(y0, y1))
      if (yHi - yLo > 1e-9) {
        view.yAuto = false
        view.yMin = yLo
        view.yMax = yHi
        resetYAuto()
      }
    }
    commitViewState()
    return
  }
  if (dx >= 8) {
    const rw = unpadX(pxToDataX(Math.min(x0, x1)), pxToDataX(Math.max(x0, x1)), lastView.xFrac)
    setFrozenX(rw.min, rw.max)
  }
  if (dy >= 8) {
    const yHi = pyToDataY(Math.min(y0, y1))
    const yLo = pyToDataY(Math.max(y0, y1))
    if (yHi - yLo > 1e-9) {
      view.yAuto = false
      view.yMin = yLo
      view.yMax = yHi
      resetYAuto()
    }
  }
  commitViewState() // 框选缩放入历史（Z 可回退）
}

function onPointerMove(evt: PointerEvent): void {
  if (evt.pointerType === 'touch' && touchPts.has(evt.pointerId)) {
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (pinch && touchPts.size === 2) {
      updatePinch()
      return
    }
  }
  updateCursor(evt)
  if (levelDrag) {
    const p = clientToPlot(evt)
    if (!p) return
    triggerCfg.level = pyToDataY(p.py)
    trigUi.level = triggerCfg.level
    schedule()
    return
  }
  if (markerDrag >= 0) {
    const p = clientToPlot(evt)
    if (!p || !lastView) return
    // 位移超阈值视为拖拽（否则松手时按「Alt+点击标记=清除」处理）
    if (!markerMoved && Math.abs(p.px - markerDownPx.x) + Math.abs(p.py - markerDownPx.y) > 4) {
      markerMoved = true
    }
    if (markerMoved && markers[markerDrag] !== undefined) {
      markers[markerDrag] = Math.round(pxToDataX(p.px))
    }
    schedule()
    return
  }
  if (boxSel) {
    const p = clientToPlot(evt)
    if (!p) return
    boxSel.x1 = p.px
    boxSel.y1 = p.py
    schedule()
    return
  }
  if (!dragCtx) return
  const p = clientToPlot(evt)
  if (!p) return
  const dx = p.px - dragCtx.px
  const dy = p.py - dragCtx.py
  // X 平移：像素位移 → 样本位移（显示域换算后去留白回真实窗口；拖左看更老数据）
  const dsamp = -(dx * (dragCtx.xMax - dragCtx.xMin)) / dragCtx.plotW
  const rw = unpadX(dragCtx.xMin + dsamp, dragCtx.xMax + dsamp, dragCtx.xFrac)
  setFrozenX(rw.min, rw.max)
  // Y 平移：纵向拖动自动退出 autoScale
  if (!dragCtx.yAuto || Math.abs(dy) > 2) {
    if (dragCtx.yAuto) {
      dragCtx.yAuto = false
      view.yAuto = false
    }
    const dyData = (dy * (dragCtx.yMax - dragCtx.yMin)) / dragCtx.plotH
    view.yMin = dragCtx.yMin + dyData
    view.yMax = dragCtx.yMax + dyData
  }
  schedule()
}

function onPointerUp(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (pinch && touchPts.size < 2) {
      pinch = null
      emitViewportChange(true)
    }
    return
  }
  if (levelDrag) {
    levelDrag = false
    schedule()
    return
  }
  if (markerDrag >= 0) {
    // Alt+按下标记后未拖动即松手 = 清除该标记
    if (!markerMoved) markers.splice(markerDrag, 1)
    markerDrag = -1
    schedule()
    return
  }
  if (boxSel) {
    finishBoxZoom()
    boxSel = null
    schedule()
    emitViewportChange(true)
    return
  }
  if (!dragCtx) return
  dragCtx = null
  commitViewState() // 拖拽平移结束 → 历史
  emitViewportChange(true)
}

/** 取消进行中的手势（框选/拖拽/标记/电平拖拽），不产生任何视口变更 */
function onPointerCancel(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (touchPts.size < 2) pinch = null
    return
  }
  if (levelDrag) {
    levelDrag = false
    schedule()
  }
  if (boxSel) {
    boxSel = null
    schedule()
  }
  if (markerDrag >= 0) {
    markerDrag = -1
    schedule()
  }
  dragCtx = null
}

/** 左键双击：暂停 ⇆ 恢复刷新；恢复刷新时清除全部标记、保留当前缩放窗宽 */
function onDblClick(): void {
  if (view.follow) {
    const xr = resolveXRange()
    setFrozenX(xr.min, xr.max)
    // 快照冻结窗为「上一帧真实窗」：消除数据帧与重绘之间的竞态，
    // 保证暂停后首帧不被误判为视口变化而清掉余辉
    lastXrReal = { min: xr.min, max: xr.max }
    // 冻结 Y 量程为当前平滑值（显示层快照）：暂停后量程不再漂移，画面（含余辉）完全定格；
    // 不改 view.yAuto 语义——恢复跟随时自动/手动状态原样保留
    pausedY = lastView ? { min: lastView.yRange.min, max: lastView.yRange.max } : null
    resetYAuto()
    schedule()
    emitViewportChange(true)
  } else {
    resumeFollow()
  }
}

/** 恢复跟随：保留当前缩放窗宽与 Y 轴缩放状态（自动/手动），清除标记；双击/角标使用 */
function resumeFollow(): void {
  view.follow = true
  pausedY = null // 解除暂停 Y 冻结；yAuto 保持原状态（手动缩放的 Y 量程不被重置）
  markers = []
  markerDrag = -1
  menu.show = false
  persistSnapshot = null
  needsRestore = false
  lastDataAt = performance.now() // 恢复瞬间重置计时，避免误报中断
  resetYAuto()
  schedule()
  emitViewportChange(true)
}

function zoomReset(notify = true): void {
  view.follow = true
  view.span = Math.max(MIN_SPAN, props.span)
  view.yAuto = true
  pausedY = null
  markers = []
  markerDrag = -1
  menu.show = false
  resetYAuto() // 复位后直接吸附新窗口目标范围，不从旧范围滑入
  clearViewHistory() // 复位后历史重置为新基线
  schedule()
  emitSpanChange(notify)
  if (notify) emitViewportChange(true)
}

/** 跟随/暂停（程序化 API）：恢复跟随不清空标记；暂停时定格当前窗口 */
function applyFollow(v: boolean): void {
  if (v === view.follow) return
  if (v) {
    view.follow = true
    pausedY = null
    lastDataAt = performance.now()
    resetYAuto()
  } else {
    const xr = resolveXRange()
    setFrozenX(xr.min, xr.max)
    lastXrReal = { min: xr.min, max: xr.max }
    pausedY = lastView ? { min: lastView.yRange.min, max: lastView.yRange.max } : null
    resetYAuto()
  }
  schedule()
  emitViewportChange(true)
}

/** 程序化暂停：setPaused(true) = 停止跟随 */
function setPaused(v: boolean): void {
  applyFollow(!v)
}

/** 程序化设置跟随窗宽（≥16，且不超过缓冲上限） */
function setSpan(span: number): void {
  if (!Number.isFinite(span)) return
  view.span = Math.min(Math.max(MIN_SPAN, Math.round(span)), Math.max(MIN_SPAN, maxFollowSpan))
  if (view.follow) schedule()
  emitSpanChange(true)
  emitViewportChange(true)
}

/** 程序化设置 Y 轴范围（自动切手动）；传 autoScale=true 恢复自动 */
function setYRange(min: number, max: number, autoScale = false): void {
  view.yAuto = autoScale
  if (!autoScale && Number.isFinite(min) && Number.isFinite(max) && max > min) {
    view.yMin = min
    view.yMax = max
    pausedY = null
  }
  resetYAuto()
  schedule()
  emitViewportChange(true)
}

/** 当前可见窗口原始数据（拷贝） */
function getVisibleData(): IqVisibleData | null {
  const xr = resolveXRange()
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  if (e <= s) return null
  return { i: iBuf.slice(s, e), q: qBuf.slice(s, e), startIndex: dropped + s }
}

/** 运行统计（宿主诊断/性能面板） */
function getStats(): IqStats {
  return {
    length: dataLen,
    dropped,
    total: totalAbs(),
    maxPoints,
    follow: view.follow,
    span: view.span,
    sampleRate: effectiveSampleRate.value
  }
}

// ── 导出 ──
const EXPORT_MAX_ROWS = 500_000

/**
 * 合成 GL 波形层 + overlay 轴层为离屏画布（手动补绘图例，DOM 元素不入画布）。
 * 先同步 draw()：preserveDrawingBuffer=false 时，同任务内重绘+读取可确保 WebGL 帧缓冲有效
 */
function compositeCanvas(): HTMLCanvasElement {
  draw()
  const glC = canvasRef.value
  const ov = overlayRef.value
  const out = document.createElement('canvas')
  if (!glC || !ov) return out
  out.width = glC.width
  out.height = glC.height
  const ctx = out.getContext('2d')
  if (!ctx) return out
  // 按输出尺寸显式缩放：两层 backing 若因 DPR/页面缩放时序不同步，
  // 仍保证导出图完整覆盖且轴层与波形对齐（overlay CSS 宽度与 GL 画布同一布局盒）
  ctx.drawImage(glC, 0, 0, out.width, out.height)
  ctx.drawImage(ov, 0, 0, out.width, out.height)
  // 图例按 GL 画布的实测比例映射（背板 ÷ CSS 实测尺寸）：与波形同一变换基准，
  // 不用全局 devicePixelRatio 缓存（页面缩放/DPR 时序变化下会与画布实际比例脱节）
  const ratio = glC.width / Math.max(1, glC.clientWidth || glC.width)
  const cssW = glC.clientWidth || glC.width
  ctx.scale(ratio, ratio)
  ctx.font = '12px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const items = [
    { label: 'I', color: th.value.traceI, on: traceVisible.i },
    { label: 'Q', color: th.value.traceQ, on: traceVisible.q }
  ]
  if (props.envelope) items.push({ label: 'Env', color: th.value.envColor, on: traceVisible.env })
  const gap = 12
  const widths = items.map((it) => 8 + 4 + ctx.measureText(it.label).width)
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)
  let x = cssW - 10 - totalW
  const y = 15
  items.forEach((it, idx) => {
    ctx.globalAlpha = it.on ? 1 : 0.35
    ctx.fillStyle = it.color
    ctx.beginPath()
    ctx.arc(x + 4, y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = th.value.text
    ctx.fillText(it.label, x + 12, y + 0.5)
    x += widths[idx]! + gap
  })
  ctx.globalAlpha = 1
  return out
}

/** 导出当前视图为 PNG（波形 + 坐标轴 + 图例） */
function pngFilename(): string {
  return `iq-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
}
function exportPNG(): void {
  deliverExport({
    kind: 'png',
    filename: pngFilename(),
    dataUrl: compositeCanvas().toDataURL('image/png')
  })
}

/** 异步 PNG 导出：toBlob 不阻塞主线程，宿主 exportHandler 可直接持久化 blob */
async function exportPNGAsync(): Promise<void> {
  const filename = pngFilename()
  const out = compositeCanvas()
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) {
    reportError('export', tr('common.pngEncodeFailed'))
    return
  }
  deliverExport({ kind: 'png', filename, blob })
}

/** 导出当前可见窗口原始样本为 CSV；超 50 万行按等步长抽稀，sampleRate 存在时附 time_s 列 */
function exportCSV(): void {
  const xr = resolveXRange()
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = e - s
  if (len <= 0) return
  const stride = Math.max(1, Math.ceil(len / EXPORT_MAX_ROWS))
  const rate = effectiveSampleRate.value
  const parts: string[] = [rate && rate > 0 ? 'index,time_s,i,q' : 'index,i,q']
  for (let k = 0; k < len; k += stride) {
    const abs = dropped + s + k
    const i = iBuf[s + k] ?? 0
    const q = qBuf[s + k] ?? 0
    parts.push(
      rate && rate > 0 ? `${abs},${(abs / rate).toFixed(9)},${i},${q}` : `${abs},${i},${q}`
    )
  }
  const filename = `iq-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  deliverExport({ kind: 'csv', filename, text: parts.join('\n') })
}

/** 交付导出：宿主提供 exportHandler 时交其持久化，否则回退浏览器下载；完成后发 exported 供 UI 反馈 */
function deliverExport(p: ExportPayload): void {
  const handler = props.exportHandler
  if (handler) {
    Promise.resolve(handler(p)).catch((e: unknown) =>
      reportError('export', e instanceof Error ? e.message : String(e))
    )
  } else {
    const a = document.createElement('a')
    if (p.kind === 'png') {
      if (p.dataUrl) {
        a.href = p.dataUrl
      } else if (p.blob) {
        a.href = URL.createObjectURL(p.blob)
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      } else {
        reportError('export', tr('common.pngMissing'))
        return
      }
    } else {
      const blob = new Blob([p.text ?? ''], { type: 'text/csv;charset=utf-8' })
      a.href = URL.createObjectURL(blob)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    a.download = p.filename
    a.click()
  }
  emit('exported', { kind: p.kind, filename: p.filename })
}

defineExpose({
  appendData,
  setData,
  clear,
  setViewport,
  getLength: () => dataLen,
  zoomReset,
  exportPNG,
  exportPNGAsync,
  exportCSV,
  /** single 触发模式：重新武装，捕获下一次触发 */
  armTrigger: () => {
    triggerEng.arm()
    lastShownTriggerKey = ''
    schedule()
  },
  getView: (): IqViewInfo => ({
    follow: view.follow,
    yAuto: view.yAuto,
    ...doResolveViewInfo()
  }),
  // ── 程序化控制/数据（宿主集成 API）──
  setFollow: (v: boolean) => applyFollow(v),
  setPaused,
  setSpan,
  setYRange,
  getStats,
  getVisibleData,
  addMarker,
  setMarkers,
  removeMarker,
  resize: () => {
    glChartResize?.()
    schedule()
  },
  redraw: () => schedule(),
  dispose
})
function doResolveViewInfo(): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  return { xMin: xr.min, xMax: xr.max, yMin: yr.min, yMax: yr.max }
}

// 跟随状态回写（v-model:follow）；内部缩放/暂停/复位都会同步给宿主
watch(
  () => view.follow,
  (v) => emit('update:follow', v)
)
// 受控 follow prop：宿主传值即生效（未传时组件自管）
watch(
  () => props.follow,
  (v) => {
    if (typeof v === 'boolean' && v !== view.follow) applyFollow(v)
  },
  { immediate: true }
)

onMounted(async () => {
  await nextTick()
  window.addEventListener('keydown', onKeyDown)
  const canvas = canvasRef.value
  if (!canvas) return
  const backend = props.renderer ?? 'auto'
  // preserveDrawingBuffer：余辉淡出/合成快照需要保留绘图缓冲。
  // 关闭时浏览器每帧清空缓冲，余辉淡出无效；无余辉需求可传 false 降低拷贝开销。
  if (backend !== 'canvas2d') {
    gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: props.preserveDrawingBuffer !== false
    }) as WebGL2RenderingContext | null
  }
  // auto：WebGL2 不可用则回退 Canvas2D；webgl2：强制，不回退；canvas2d：直接 2D
  if (!gl && backend !== 'webgl2') {
    ctx2d = canvas.getContext('2d')
  }
  if (!gl && !ctx2d) {
    reportError('webgl', tr('iq.webglUnsupported'))
    drawUnsupported(tr('iq.webglUnsupported'))
    return
  }
  if (gl) {
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
  }
  setupRenderers()
  // 初始数据
  if (props.data !== undefined) setData(props.data)
  draw()
  emit('ready')
  // 离屏暂停：不可见时不再触发重绘（数据仍入缓冲），重新可见时补一帧
  if (typeof IntersectionObserver !== 'undefined' && rootRef.value) {
    io = new IntersectionObserver(
      (entries) => {
        const next = entries[entries.length - 1]?.isIntersecting ?? true
        if (next === visible) return
        visible = next
        if (visible) schedule()
      },
      { threshold: 0 }
    )
    io.observe(rootRef.value)
  }
})

/** 浏览器不支持 WebGL2 且 Canvas2D 也不可用时的显式错误提示 */
function drawUnsupported(msg: string): void {
  const ov = overlayRef.value
  if (!ov) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  const rect = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, rect.width)
  const sy = ov.height / Math.max(1, rect.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.font = '13px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = th.value.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(msg, rect.width / 2, rect.height / 2)
}

/** 创建/重建全部渲染器（GL 或 Canvas2D；挂载时与 GL 上下文恢复后复用） */
function setupRenderers(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  if (gl) {
    renderer = createLineRenderer(canvas, gl)
    rendererQ = createLineRenderer(canvas, gl)
    rendererEnv = createLineRenderer(canvas, gl)
    fadeRenderer = createFadeRenderer(gl)
    blitRenderer = createBlitRenderer(gl)
  } else if (ctx2d) {
    renderer = createCanvasLineRenderer(canvas)
    rendererQ = createCanvasLineRenderer(canvas)
    rendererEnv = createCanvasLineRenderer(canvas)
    fadeRenderer = null
    blitRenderer = null
  }
  // 上下文恢复/后端重建：强制重渲染冻结的触发帧（旧 GL 缓冲已失效）
  lastShownTriggerKey = ''
  needsRestore = false
}

/** 上下文丢失：preventDefault 允许浏览器自动恢复；丢失期间 draw() 直接跳过 */
function onContextLost(evt: Event): void {
  evt.preventDefault()
  contextLost = true
  emit('contextLost')
}

/** 上下文恢复：重建 renderer（旧 program/buffer 均已失效），下一帧重传数据 */
function onContextRestored(): void {
  contextLost = false
  setupRenderers()
  emit('contextRestored')
  schedule()
}

let cleanupDone = false
/** 释放监听/渲染器/rAF（宿主手动销毁时也可调用；重复调用幂等） */
function dispose(): void {
  if (cleanupDone) return
  cleanupDone = true
  disposed = true
  io?.disconnect()
  io = null
  touchPts.clear()
  pinch = null
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
  const canvas = canvasRef.value
  canvas?.removeEventListener('webglcontextlost', onContextLost)
  canvas?.removeEventListener('webglcontextrestored', onContextRestored)
  renderer?.dispose()
  rendererQ?.dispose()
  rendererEnv?.dispose()
  fadeRenderer?.dispose()
  blitRenderer?.dispose()
  renderer = null
  rendererQ = null
  rendererEnv = null
  fadeRenderer = null
  blitRenderer = null
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
  if (spanNotifyTimer) {
    clearTimeout(spanNotifyTimer)
    spanNotifyTimer = null
  }
}
onUnmounted(dispose)

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)

function setData(raw: unknown, meta?: IqFrameMeta): void {
  clear(false)
  appendData(raw, meta)
}
function appendData(raw: unknown, meta?: IqFrameMeta): void {
  if (disposed) return
  if (meta && typeof meta.sampleRate === 'number' && meta.sampleRate > 0)
    frameSampleRate.value = meta.sampleRate
  const n = normalize(raw)
  if (!n) {
    // adapter 抛异常时 normalize 已经 emit 过具体错误，这里不再补一条泛化错误
    if (adapterErrored) {
      adapterErrored = false
      return
    }
    reportError('adapter', tr('common.adapterNull'))
    return
  }
  pushNormalized(n)
}
function clear(needDraw = true): void {
  dataLen = 0
  dropped = 0
  markers = []
  markerDrag = -1
  persistSnapshot = null
  needsRestore = false
  lastDataAt = 0
  dataStale.value = false
  pyrDirty = true // 数据清空，下次推流重建金字塔
  zoomReset(false)
  if (needDraw) draw()
}
function setViewport(v: Partial<NonNullable<IqProps['viewport']>>): void {
  applyExternalViewport(v as NonNullable<IqProps['viewport']>)
}
</script>

<template>
  <div
    ref="rootRef"
    class="sig-iq"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    tabindex="0"
    role="application"
    :aria-label="props.labels?.aria ?? tr('iq.aria')"
    :style="{
      width: cssSize(props.width, '100%'),
      height: cssSize(props.height, '260px'),
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg,
      '--sig-text': th.text,
      '--sig-border': th.border,
      '--sig-trigger': th.triggerColor
    }"
    @focus="focused = true"
    @blur="focused = false"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @contextmenu.prevent="onContextMenu"
    @dblclick="onDblClick"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <!-- 宿主自定义叠加层（标注/告警框等）；组件默认样式为绝对定位铺满，内容自行定位 -->
    <div class="sig-host-overlay"><slot name="overlay" /></div>
    <div
      v-if="!view.follow"
      class="sig-follow-badge"
      :title="tr('iq.pausedTitle')"
      @click="resumeFollow()"
      @pointerdown.stop
      @dblclick.stop
    >
      {{ props.labels?.paused ?? tr('iq.paused') }}
    </div>
    <div v-if="dataStale" class="sig-stale-badge" :title="tr('common.staleTitle')">
      {{ props.labels?.stale ?? tr('common.stale') }}
    </div>
    <div v-if="trigUi.enabled" class="sig-trigger-badge" :title="tr('iq.triggerTitle')">
      ⚡ {{ trigUi.mode }} · {{ trigUi.edge }} · Lv {{ trigUi.level.toFixed(yDecimals()) }} ·
      {{ trigUi.status }}
    </div>
    <div class="sig-legend" :title="tr('iq.legendTitle')">
      <span
        class="sig-trace"
        :class="{ off: !traceVisible.i }"
        @click.stop="traceVisible.i = !traceVisible.i"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.traceI }" /> I
      </span>
      <span
        class="sig-trace"
        :class="{ off: !traceVisible.q }"
        style="margin-left: 12px"
        @click.stop="traceVisible.q = !traceVisible.q"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.traceQ }" /> Q
      </span>
      <span
        v-if="props.envelope"
        class="sig-trace"
        :class="{ off: !traceVisible.env }"
        style="margin-left: 12px"
        @click.stop="traceVisible.env = !traceVisible.env"
        @pointerdown.stop
        @dblclick.stop
      >
        <span class="sig-dot" :style="{ background: th.envColor }" /> Env
      </span>
    </div>
    <div
      v-if="menu.show"
      class="sig-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <div
        class="sig-menu-item"
        :class="{ disabled: view.follow }"
        @click.stop="menuAction('add')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('iq.menuAdd') }}
      </div>
      <div
        v-if="menu.hitIdx >= 0"
        class="sig-menu-item"
        @click.stop="menuAction('remove')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('iq.menuRemove') }}
      </div>
      <div
        v-if="markers.length > 0"
        class="sig-menu-item"
        @click.stop="menuAction('clear')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ tr('iq.menuClear') }}
      </div>
      <div class="sig-menu-sep" />
      <div
        class="sig-menu-item"
        @click.stop="menuAction('toggle')"
        @pointerdown.stop
        @dblclick.stop
      >
        {{ view.follow ? tr('iq.menuPause') : tr('iq.menuResume') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sig-iq {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--sig-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sig-bg, #fff);
  user-select: none;
  touch-action: none;
}
.sig-iq:focus-visible {
  outline: 1px solid var(--sig-border);
  outline-offset: -1px;
}
.sig-dark {
  --sig-bg: #0f1115;
  --sig-border: #2a2e39;
  --sig-text: #c9d1d9;
}
.sig-light {
  --sig-bg: #ffffff;
  --sig-border: #e6e8eb;
  --sig-text: #1f2328;
}
.sig-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.sig-overlay {
  position: absolute;
  inset: 0;
  /* canvas 为 replaced element：absolute+inset:0 不会拉伸它（会按 bitmap 固有尺寸显示，
     buffer 后段空白、文字被按 bitmap 像素显示）；显式 100% 才能与 GL 画布同盒 */
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.sig-host-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.sig-follow-badge {
  position: absolute;
  left: 10px;
  top: 8px;
  font-size: 11px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  cursor: pointer;
  z-index: 2;
}
.sig-stale-badge {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  font-size: 11px;
  color: #f08c00;
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  z-index: 2;
  pointer-events: none;
}
.sig-trigger-badge {
  position: absolute;
  right: 10px;
  top: 34px;
  font-size: 11px;
  color: var(--sig-trigger);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  z-index: 2;
  pointer-events: none;
  white-space: nowrap;
}
.sig-legend {
  position: absolute;
  right: 10px;
  top: 8px;
  font-size: 12px;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 80%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
}
.sig-trace {
  cursor: pointer;
  user-select: none;
}
.sig-trace.off {
  opacity: 0.35;
}
.sig-menu {
  position: absolute;
  z-index: 5;
  min-width: 150px;
  padding: 4px 0;
  background: color-mix(in srgb, var(--sig-bg) 96%, transparent);
  border: 1px solid var(--sig-border);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  font-size: 12px;
  color: var(--sig-text);
  user-select: none;
}
.sig-menu-item {
  padding: 5px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.sig-menu-item:hover {
  background: color-mix(in srgb, var(--sig-border) 40%, transparent);
}
.sig-menu-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.sig-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--sig-border);
}
.sig-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 4px;
}
</style>
