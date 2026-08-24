<script setup lang="ts">
/**
 * IqChart（可复制，零依赖，自带主题，高性能）
 * 复用：拷本文件 + core/* + composables/useGlChart.ts 到他项目即可
 * 数据：经 adapter 自转 RawInput → IqNormalized（见 core/adapters.ts）
 * 渲染：WebGL2 折线 + Canvas2D 轴层覆盖，主线程仅 rAF
 * 交互：滚轮=X 轴缩放（光标锚点）· Shift+滚轮=Y 轴缩放 · 拖拽=平移 · 双击/角标=复位跟随
 * 外观：theme 预置（light/dark/auto/spectrum 频谱仪黑底黄迹）+ style 字段级覆盖
 */
import { ref, reactive, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { createLineRenderer, withAlpha, hexToRgba, type LineRenderer } from './core/gl'
import { iqAdapters } from './core/adapters'
import {
  drawAxisOverlay,
  drawChip,
  drawPanel,
  niceTicks,
  snapRangeNice,
  CHIP_H,
  type PlotRect
} from './core/axis'
import { resolveTheme } from './core/theme'
import type { IqProps, IqNormalized, IqViewInfo, Theme } from './core/types'
import { useGlChart } from './composables/useGlChart'

const props = withDefaults(defineProps<IqProps>(), {
  theme: 'auto' as Theme,
  decimation: 'minmax',
  fpsLimit: 60,
  mode: 'line',
  lineWidth: 1,
  viewport: undefined,
  adapter: undefined,
  data: undefined,
  axis: true,
  xAxis: true,
  grid: true
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'viewportChange', v: IqViewInfo): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
let renderer: LineRenderer | null = null
let rendererQ: LineRenderer | null = null
// 单 canvas 双 program 也可，此处双 renderer 简化（Q 用第二 canvas 叠加或同一 GL 分两 draw）
// 为拷贝轻量：复用同一 canvas，绘制 I 后再绘制 Q（同一 GL 上下文分两次 draw）
let gl: WebGL2RenderingContext | null = null

// 主题解析：style 覆盖 > colors 迹线对 > 预置；spectrum 为固定观感不随系统切换
const prefersDark = computed(
  () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
)
const th = computed(() =>
  resolveTheme(props.theme, prefersDark.value, { colors: props.colors, style: props.style })
)

// ── 布局常量（CSS px）──
const GUTTER_BOTTOM = 20 // 底部 X 刻度槽；左侧刻度带宽由主题 axisWidth 提供（默认 56）
const PAD_X = 24 // 波形左右内缩留白：避免满幅波形的左/右边缘贴住绘图区形成「信号墙」
const MIN_SPAN = 16 // 最小可见样本数
const DEFAULT_SPAN = 4096 // follow 模式默认窗宽（须明显大于单帧点数）
const ZOOM_FACTOR = 1.2 // 每次滚轮缩放系数

// ── 数据缓冲（线性增长 + 环形丢老，保留最近 MAX_POINTS）──
const MAX_POINTS = 2_000_000
let iBuf = new Float32Array(0)
let qBuf = new Float32Array(0)
let dataLen = 0
// 已丢弃的最老样本数：绝对索引 = dropped + 缓冲下标。
// 视口用绝对索引表达，冻结视图不受环形丢数据影响
let dropped = 0
function totalAbs(): number {
  return dropped + dataLen
}

function ensureCapacity(n: number): void {
  if (iBuf.length >= n) return
  const next = Math.min(MAX_POINTS, Math.max(n, iBuf.length ? iBuf.length * 2 : 4096))
  const ni = new Float32Array(next)
  const nq = new Float32Array(next)
  ni.set(iBuf.subarray(0, dataLen))
  nq.set(qBuf.subarray(0, dataLen))
  iBuf = ni
  qBuf = nq
}

/** 环形丢老：保留最近 keep 条，累计 dropped */
function compact(keep: number): void {
  dropped += dataLen - keep
  iBuf.copyWithin(0, dataLen - keep, dataLen)
  qBuf.copyWithin(0, dataLen - keep, dataLen)
  dataLen = keep
}

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
    emit('error', e instanceof Error ? e.message : String(e))
    return null
  }
}

function pushNormalized(n: IqNormalized): void {
  // 完全暂停：冻结（非跟随）期间在入口丢弃新帧——
  // 缓冲零增长、环形淘汰永不发生，冻结窗内容像素级静止；恢复跟随（zoomReset）后自动继续接收
  if (!view.follow) return
  if (n instanceof Float32Array) {
    // 交织 [I0,Q0,I1,Q1...]
    const pairs = Math.floor(n.length / 2)
    ensureCapacity(dataLen + pairs)
    for (let k = 0; k < pairs; k++) {
      if (dataLen >= MAX_POINTS) compact(Math.floor(MAX_POINTS * 0.9))
      iBuf[dataLen] = n[2 * k]
      qBuf[dataLen] = n[2 * k + 1]
      dataLen++
    }
  } else {
    const len = Math.min(n.i.length, n.q.length)
    ensureCapacity(dataLen + len)
    for (let k = 0; k < len; k++) {
      if (dataLen >= MAX_POINTS) compact(Math.floor(MAX_POINTS * 0.9))
      iBuf[dataLen] = n.i[k]
      qBuf[dataLen] = n.q[k]
      dataLen++
    }
  }
  schedule()
}

// ── 视口状态机 ──
// follow=true：窗口吸附最新数据；任何缩放/平移后 follow=false（冻结），数据从视图下方流过
const view = reactive({
  follow: true,
  span: DEFAULT_SPAN, // 当前窗宽（样本数），follow 与缩放共用
  xMin: 0, // 冻结时的绝对索引范围
  xMax: DEFAULT_SPAN,
  yAuto: true,
  yMin: -1,
  yMax: 1
})

// 迹线可见性：点击图例切换；隐藏的通道不参与绘制与 Y 轴自适应统计
const traceVisible = reactive({ i: true, q: true })

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
watch([() => props.theme, () => props.style], () => schedule(), { deep: true })

/** 冻结 X 视口并钳制到可保留范围 [dropped, total]，保持窗宽 */
function setFrozenX(min: number, max: number): void {
  const total = totalAbs()
  const span = Math.max(MIN_SPAN, max - min)
  min = Math.min(Math.max(min, dropped), Math.max(dropped, total - span))
  view.follow = false
  view.span = span
  view.xMin = min
  view.xMax = min + span
}

function resolveXRange(): { min: number; max: number } {
  const total = totalAbs()
  if (view.follow) {
    const span = Math.min(view.span, Math.max(MIN_SPAN, total))
    return { min: Math.max(dropped, total - span), max: total }
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

// 抽稀（主线程简版 minmax，按原索引排序避免折线交叉伪影；大数据可移入 Worker）
function decimate(arr: Float32Array, len: number, target: number): Float32Array {
  if (!props.decimation || len <= target) return arr.subarray(0, len)
  const bucket = len / target
  const out = new Float32Array(target * 2)
  let oi = 0
  for (let i = 0; i < target; i++) {
    const s = Math.floor(i * bucket)
    const e = Math.floor((i + 1) * bucket)
    let min = Infinity,
      max = -Infinity
    let minIdx = s,
      maxIdx = s
    for (let j = s; j < e && j < len; j++) {
      const v = arr[j]
      if (v < min) {
        min = v
        minIdx = j
      }
      if (v > max) {
        max = v
        maxIdx = j
      }
    }
    if (minIdx < maxIdx) {
      out[oi++] = min
      out[oi++] = max
    } else {
      out[oi++] = max
      out[oi++] = min
    }
  }
  return out.subarray(0, oi)
}

// ── 自动 Y 轴平滑（即时扩张 / 慢速收缩）──
// 流式数据下逐帧精确自适应会导致刻度值与网格行每帧跳动；
// 示波器通用解法：出现新极值立即扩入当前范围（永不裁剪波形），数据回落后缓慢收敛
const Y_RELEASE = 0.08 // 收缩速度：每帧向目标靠拢的比例（九成幅度约半秒内收敛，刻度轻微呼吸后稳定）
let yAutoCur: { min: number; max: number } | null = null // 平滑后的当前自动范围；null=待初始化/需重置

function computeAutoYTarget(s: number, e: number): { min: number; max: number } {
  if (e <= s) return { min: -1, max: 1 }
  let mn = Infinity,
    mx = -Infinity
  for (let i = s; i < e; i++) {
    if (traceVisible.i) {
      const a = iBuf[i]
      if (a < mn) mn = a
      if (a > mx) mx = a
    }
    if (traceVisible.q) {
      const b = qBuf[i]
      if (b < mn) mn = b
      if (b > mx) mx = b
    }
  }
  if (!isFinite(mn) || !isFinite(mx)) return { min: -1, max: 1 }
  // 居中 + 25% 余量后做档位量化：向外吸附到刻度步进族，
  // 吸收逐帧随机的极值波动（稳态下目标恒定 → 刻度完全静止，跨档时才离散更新）
  const cx = (mn + mx) / 2
  const half = Math.max((mx - mn) / 2, 1e-3) * 1.25
  return snapRangeNice(cx - half, cx + half)
}

/** 重置自动 Y 轴平滑状态（清空数据/切换 yAuto 等），下一帧直接吸附目标 */
function resetYAuto(): void {
  yAutoCur = null
}

function resolveYRange(s: number, e: number): { min: number; max: number } {
  if (!view.yAuto) return { min: view.yMin, max: view.yMax }
  const target = computeAutoYTarget(s, e)
  if (!yAutoCur) {
    yAutoCur = { ...target }
    return { ...target }
  }
  const cur = yAutoCur
  // 非对称更新：新极值即时扩入（含目标自带的 25% 余量，保证不裁剪）；富余则缓慢回落
  if (target.min < cur.min) cur.min = target.min
  else cur.min += (target.min - cur.min) * Y_RELEASE
  if (target.max > cur.max) cur.max = target.max
  else cur.max += (target.max - cur.max) * Y_RELEASE
  // 收敛吸附：残差小于目标跨度千分之一时贴合，避免无限爬行导致刻度数字微颤
  const tSpan = Math.abs(target.max - target.min)
  if (Math.abs(cur.min - target.min) < tSpan * 1e-3) cur.min = target.min
  if (Math.abs(cur.max - target.max) < tSpan * 1e-3) cur.max = target.max
  return { min: cur.min, max: cur.max }
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

// 十字光标状态：绘图区内悬停位置；null=不显示
let cursor: { px: number; py: number } | null = null

// Shift+拖拽框选状态：像素坐标矩形；null=未框选
let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null

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
  if (!canvas || !gl || !renderer) return
  const xr = resolveXRange()
  // 绝对索引 → 缓冲下标
  const s = Math.max(0, Math.floor(xr.min) - dropped)
  const e = Math.min(dataLen, Math.ceil(xr.max) - dropped)
  const len = Math.max(0, e - s)
  // 先解析最终 Y 范围（决定网格/零线与刻度芯片位置）
  const yr = len > 0 ? resolveYRange(s, e) : { min: -1, max: 1 }
  const plot = computePlot(canvas)
  // 背景（全画布；先关 scissor 再清屏；颜色由主题 bg 驱动）
  gl.disable(gl.SCISSOR_TEST)
  const bgRgb = hexToRgba(th.value.bg)
  gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  if (len <= 0) {
    lastView = null
    clearOverlay()
    return
  }
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
  const iSlice = iBuf.subarray(s, e)
  const qSlice = qBuf.subarray(s, e)
  const iDec = decimate(iSlice, len, targetPoints)
  const qDec = decimate(qSlice, len, targetPoints)
  // 抽稀索引空间同变换：idx=0 / idx=N-1 对齐 f 与 1-f 像素分数（与采样值域严格一致）
  const nIdx = Math.max(1, iDec.length - 1)
  const vpX = { xMin: (-xFrac * nIdx) / kS, xMax: nIdx + (xFrac * nIdx) / kS }
  // 绘制 I（背景已自绘，不再清屏；限制在绘图区；微透明让网格透出）
  if (traceVisible.i) {
    renderer.setData(iDec)
    renderer.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceI, th.value.traceAlpha),
      false,
      plot
    )
  }
  // 绘制 Q（叠加，不再清空）
  if (traceVisible.q && rendererQ) {
    rendererQ.setData(qDec)
    rendererQ.draw(
      { xMin: vpX.xMin, xMax: vpX.xMax, yMin: yr.min, yMax: yr.max },
      withAlpha(th.value.traceQ, th.value.traceAlpha),
      false,
      plot
    )
  }
  drawOverlay(xrView, yr, plot)
}

// ── 坐标轴覆盖层 ──
function drawOverlay(
  xv: { min: number; max: number },
  yr: { min: number; max: number },
  plot: PlotRect
): void {
  const ov = overlayRef.value
  if (!ov || !props.axis) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ov.width, ov.height)
  // 真实比例映射：背板设备像素 ÷ 元素当前 CSS 实测尺寸。
  // 不信任全局 DPR 缓存——页面缩放/系统非整数缩放/监听时序差下，
  // overlay 全部绘制仍与鼠标位置严格贴合（修复「越远越偏」的比例错位）
  const rect = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, rect.width)
  const sy = ov.height / Math.max(1, rect.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  const t = th.value
  // X 轴时间单位（sampleRate > 0）：刻度值仍为样本索引域，标签换算为时间
  const rate = props.sampleRate
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
  const yText = pyToDataY(cursor.py).toFixed(3)
  const yChipY = Math.min(Math.max(cyp - CHIP_H / 2, plot.y + 2), plot.y + plot.h - CHIP_H - 2)
  drawChip(ctx, 2, yChipY, yText, chipBg, t.text)

  // 浮动读数框：样本索引 + 最近采样点实际 I/Q 值（贴近右/下边缘时自动翻转避让）
  const smp = sampleAt(cursor.px)
  if (!smp) return
  const fmtVal = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`
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

useGlChart(canvasRef, {
  fpsLimit: props.fpsLimit,
  onResize: (w, h) => {
    // 覆盖层与 GL canvas 尺寸同步（device px）
    const ov = overlayRef.value
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w
      ov.height = h
    }
  },
  onDraw: draw
})

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
  const rate = props.sampleRate
  if (!rate || rate <= 0 || !(max > min)) return undefined
  const times = niceTicks(min / rate, max / rate, 6)
  if (!times.length) return undefined
  const stepT = times.length > 1 ? times[1]! - times[0]! : Math.max((max - min) / rate / 6, 1e-9)
  return {
    values: times.map((t) => t * rate),
    labels: times.map((t) => fmtTime(t, stepT))
  }
}

// ── 十字光标 ──
function updateCursor(evt: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || !lastView) {
    if (cursor !== null) {
      cursor = null
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
  cursor = next
  if (changed) schedule()
}
function onPointerLeave(): void {
  if (cursor !== null) {
    cursor = null
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

function onPointerDown(evt: PointerEvent): void {
  if (!lastView || evt.button !== 0) return
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  // Shift+拖拽：框选放大（与拖拽平移互斥）
  if (evt.shiftKey) {
    boxSel = { x0: p.px, y0: p.py, x1: p.px, y1: p.py }
    return
  }
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

/** 框选放大：像素矩形 → 数据域窗口（X 去留白回真实窗口；Y 直接映射）；矩形过小则忽略 */
function finishBoxZoom(): void {
  if (!boxSel || !lastView) return
  const { x0, y0, x1, y1 } = boxSel
  if (Math.abs(x1 - x0) < 8 || Math.abs(y1 - y0) < 8) return
  const rw = unpadX(pxToDataX(Math.min(x0, x1)), pxToDataX(Math.max(x0, x1)), lastView.xFrac)
  setFrozenX(rw.min, rw.max)
  const yHi = pyToDataY(Math.min(y0, y1))
  const yLo = pyToDataY(Math.max(y0, y1))
  if (yHi - yLo > 1e-9) {
    view.yAuto = false
    view.yMin = yLo
    view.yMax = yHi
    resetYAuto()
  }
}

function onPointerMove(evt: PointerEvent): void {
  updateCursor(evt)
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
  if (boxSel) {
    finishBoxZoom()
    boxSel = null
    schedule()
    emitViewportChange(true)
    return
  }
  if (!dragCtx) return
  dragCtx = null
  emitViewportChange(true)
}

/** 取消进行中的手势（框选/拖拽），不产生任何视口变更 */
function onPointerCancel(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (boxSel) {
    boxSel = null
    schedule()
  }
  dragCtx = null
}

function zoomReset(notify = true): void {
  view.follow = true
  view.span = DEFAULT_SPAN
  view.yAuto = true
  resetYAuto() // 复位后直接吸附新窗口目标范围，不从旧范围滑入
  schedule()
  if (notify) emitViewportChange(true)
}

defineExpose({
  appendData,
  setData,
  clear,
  setViewport,
  getLength: () => dataLen,
  zoomReset,
  getView: (): IqViewInfo => ({
    follow: view.follow,
    yAuto: view.yAuto,
    ...doResolveViewInfo()
  })
})
function doResolveViewInfo(): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xr = resolveXRange()
  const yr = view.yAuto && lastView ? lastView.yRange : { min: view.yMin, max: view.yMax }
  return { xMin: xr.min, xMax: xr.max, yMin: yr.min, yMax: yr.max }
}

onMounted(async () => {
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  gl = canvas.getContext('webgl2', { antialias: true }) as WebGL2RenderingContext | null
  if (!gl) {
    emit('error', 'WebGL2 not supported, fallback to Canvas2D (降低性能)')
    return
  }
  renderer = createLineRenderer(canvas, gl)
  rendererQ = createLineRenderer(canvas, gl)
  // 初始数据
  if (props.data !== undefined) setData(props.data)
  draw()
})

onUnmounted(() => {
  renderer?.dispose()
  rendererQ?.dispose()
  if (raf) cancelAnimationFrame(raf)
  if (viewportNotifyTimer) {
    clearTimeout(viewportNotifyTimer)
    viewportNotifyTimer = null
  }
})

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)

function setData(raw: unknown): void {
  clear(false)
  appendData(raw)
}
function appendData(raw: unknown): void {
  const n = normalize(raw)
  if (!n) {
    emit('error', 'adapter 返回 null，无法解析数据')
    return
  }
  pushNormalized(n)
}
function clear(needDraw = true): void {
  dataLen = 0
  dropped = 0
  zoomReset(false)
  if (needDraw) draw()
}
function setViewport(v: Partial<NonNullable<IqProps['viewport']>>): void {
  applyExternalViewport(v as NonNullable<IqProps['viewport']>)
}
</script>

<template>
  <div
    class="sig-iq"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    :style="{
      width: props.width ? props.width + 'px' : '100%',
      height: props.height ? props.height + 'px' : '260px',
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg
    }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="onPointerLeave"
    @dblclick="zoomReset()"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <div v-if="!view.follow" class="sig-follow-badge" title="恢复跟随最新数据" @click="zoomReset()">
      已暂停跟随 · 双击恢复
    </div>
    <div class="sig-legend" title="点击切换迹线显隐">
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
  pointer-events: none;
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
.sig-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 4px;
}
</style>
