/**
 * 坐标轴绘制（纯 Canvas2D，零依赖，可拷贝）
 * niceTicks：1/2/5×10^k 步进「好看」刻度
 * drawAxisOverlay：绘图区底色 → 网格 → 零线 → 边框盒（可选）→ 左轴线+刻度短线 → X 刻度短线 → Y 刻度芯片
 * Y 刻度为「内嵌芯片」：半透明底色小圆角片，左轴带模式下与竖直轴线一起钉在组件左侧，
 * 轴线与绘图区之间留 AXIS_GAP 空隙；密集波形下芯片仍可读
 * 所有坐标均为 CSS px（调用方自行清屏，并按「背板尺寸 ÷ 元素 CSS 实测尺寸」设置变换，
 * 参见 IqChart.drawOverlay 的真实比例映射——比 ctx.scale(devicePixelRatio) 更抗缩放场景）
 */

export interface AxisTheme {
  text: string // 刻度文字颜色
  grid: string // 网格线颜色
  axisLine: string // 轴线/刻度短线颜色
  plotBg?: string // 绘图区底色（可选；须半透明——轴层绘制于波形层之上）
  border?: string // 绘图区边框（可选）
  zeroLine?: string // y=0 强调虚线颜色（可选；不传则零线按普通网格处理）
  labelChipBg?: string // Y 刻度芯片底色（可选；缺省用中性灰半透明兜底）
}

export interface PlotRect {
  x: number
  y: number
  w: number
  h: number
}

/** 计算覆盖 [min,max] 的 1/2/5×10^k 步进 */
export function niceStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount)
  if (!(raw > 0) || !isFinite(raw)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step: number
  if (norm <= 1) step = 1
  else if (norm <= 2) step = 2
  else if (norm <= 5) step = 5
  else step = 10
  return step * mag
}

/**
 * 将范围向外吸附到与刻度步长一致的 1/2/5×10^k 档位（示波器 V/div 风格）
 * 把逐帧随机的原始极值波动量化掉：同一档位内的小幅波动产生恒定结果，
 * 仅跨越档位边界时离散更新；只向外扩，永不裁剪数据。
 * 步进经两遍收敛，使吸附后的跨度恰好是 niceTicks 的整倍数域——首末网格线落在绘图区边界
 */
export function snapRangeNice(
  min: number,
  max: number,
  targetCount = 5
): { min: number; max: number } {
  const span = max - min
  if (!(span > 0) || !isFinite(span)) return { min, max }
  let step = niceStep(span, targetCount)
  for (let i = 0; i < 3; i++) {
    const snappedSpan = (Math.ceil(max / step) - Math.floor(min / step)) * step
    const next = niceStep(snappedSpan, targetCount)
    if (next === step) break
    step = next
  }
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step
  }
}

/** 生成 [min,max] 内步进对齐的刻度值 */
export function niceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!(max > min) || !isFinite(min) || !isFinite(max)) return []
  const step = niceStep(max - min, targetCount)
  const eps = step * 1e-6
  const ticks: number[] = []
  for (let v = Math.ceil((min - eps) / step) * step; v <= max + eps; v += step) {
    ticks.push(Math.abs(v) < eps ? 0 : Number(v.toPrecision(12)))
  }
  return ticks
}

/** 按步长量级格式化刻度文本（步长只会是 1/2/5×10^k） */
function fmtByStep(v: number, step: number): string {
  if (step >= 1) return v.toFixed(0)
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
  return v.toFixed(decimals)
}

// ── Y 刻度芯片尺寸常量（CSS px）──
export const CHIP_H = 16 // 芯片高度
const CHIP_PAD_X = 5 // 文本左右内边距
const CHIP_R = 4 // 圆角半径
const CHIP_INSET = 6 // 无刻度带时芯片距绘图区左缘 / 有刻度带时距组件左缘的距离
const AXIS_GAP = 14 // 左轴线与绘图区之间的空隙（波形与轴的间隔来源）
const TICK_LEN = 5 // 轴线向右引出的刻度短线长度

/** 绘制半透明圆角面板（浮动读数框等），(x,y) 为左上角 */
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: string
): void {
  pathRoundRect(ctx, x, y, w, h, 6)
  ctx.fillStyle = bg
  ctx.fill()
}

/** 圆角矩形路径（arcTo 手绘，不依赖 ctx.roundRect 的浏览器兼容性） */
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * 绘制圆角读数芯片（Y 刻度/十字光标读数共用），返回芯片宽度。
 * 调用方需先设置 textAlign='center'、textBaseline='middle'、字体；x 为锚点位置，
 * anchor 决定 x 是左缘/中心/右缘；bounds 提供时芯片整体钳制在该区间内
 */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
  anchor: 'left' | 'center' | 'right' = 'left',
  bounds?: { min: number; max: number }
): number {
  const tw = Math.ceil(ctx.measureText(text).width)
  const w = tw + CHIP_PAD_X * 2
  let ax = anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x
  if (bounds) ax = Math.min(Math.max(ax, bounds.min), Math.max(bounds.min, bounds.max - w))
  pathRoundRect(ctx, ax, y, w, CHIP_H, CHIP_R)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.fillStyle = fg
  ctx.fillText(text, ax + w / 2, y + CHIP_H / 2)
  return w
}

export function drawAxisOverlay(
  ctx: CanvasRenderingContext2D,
  opts: {
    plot: PlotRect
    xMin: number
    xMax: number
    yMin: number
    yMax: number
    showX?: boolean
    showGrid?: boolean
    /** 是否绘制四边边框盒；左轴带模式传 false，改用独立竖直轴线 */
    frame?: boolean
    theme: AxisTheme
  }
): void {
  const { plot, xMin, xMax, yMin, yMax, showX = true, showGrid = true, frame = true, theme } = opts
  if (plot.w <= 0 || plot.h <= 0 || !(xMax > xMin) || !(yMax > yMin)) return
  ctx.lineWidth = 1
  ctx.font = '11px system-ui, -apple-system, sans-serif'

  // ── 绘图区底色 ──
  if (theme.plotBg) {
    ctx.fillStyle = theme.plotBg
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h)
  }

  const yTicks = niceTicks(yMin, yMax, 5)
  const xTicks = showX ? niceTicks(xMin, xMax, 6) : []
  const toPxY = (t: number): number => plot.y + plot.h - ((t - yMin) / (yMax - yMin)) * plot.h
  const toPxX = (t: number): number => plot.x + ((t - xMin) / (xMax - xMin)) * plot.w

  // ── 网格 + 零线 ──
  for (const t of yTicks) {
    const ty = toPxY(t)
    if (ty < plot.y - 0.5 || ty > plot.y + plot.h + 0.5) continue
    const py = Math.round(ty) + 0.5
    if (t === 0 && theme.zeroLine) {
      // 零基准线：虚线、比网格亮一档
      ctx.strokeStyle = theme.zeroLine
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(plot.x, py)
      ctx.lineTo(plot.x + plot.w, py)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (showGrid) {
      ctx.strokeStyle = theme.grid
      ctx.beginPath()
      ctx.moveTo(plot.x, py)
      ctx.lineTo(plot.x + plot.w, py)
      ctx.stroke()
    }
  }

  // ── X 网格 + 标签（首尾防碰撞）──
  if (showX) {
    const xStep = niceStep(xMax - xMin, 6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const labelL = plot.x + 20
    const labelR = plot.x + plot.w - 20
    for (const t of xTicks) {
      const tx = toPxX(t)
      if (tx < plot.x - 0.5 || tx > plot.x + plot.w + 0.5) continue
      if (showGrid) {
        ctx.strokeStyle = theme.grid
        ctx.beginPath()
        ctx.moveTo(Math.round(tx) + 0.5, plot.y)
        ctx.lineTo(Math.round(tx) + 0.5, plot.y + plot.h)
        ctx.stroke()
      }
      if (tx >= labelL && tx <= labelR) {
        ctx.fillStyle = theme.text
        ctx.fillText(fmtByStep(t, xStep), tx, plot.y + plot.h + 4)
      }
    }
  }

  // ── 绘图区边框盒 ──
  if (frame && theme.border) {
    ctx.strokeStyle = theme.border
    ctx.strokeRect(
      Math.round(plot.x) + 0.5,
      Math.round(plot.y) + 0.5,
      Math.round(plot.w) - 1,
      Math.round(plot.h) - 1
    )
  }

  // ── 左轴线 + 向右引出的刻度短线 ──
  // 轴线与芯片作为整体钉在组件左侧，与绘图区之间留 AXIS_GAP 空隙（波形与轴的间隔来源）
  if (plot.x > AXIS_GAP) {
    const axX = Math.round(plot.x - AXIS_GAP) + 0.5
    ctx.strokeStyle = theme.axisLine
    ctx.beginPath()
    ctx.moveTo(axX, Math.round(plot.y) + 0.5)
    ctx.lineTo(axX, Math.round(plot.y + plot.h) + 0.5)
    for (const t of yTicks) {
      const ty = toPxY(t)
      if (ty < plot.y - 0.5 || ty > plot.y + plot.h + 0.5) continue
      // 刻度短线从轴线向右引出，指向对应网格行
      ctx.moveTo(axX, Math.round(ty) + 0.5)
      ctx.lineTo(axX + TICK_LEN, Math.round(ty) + 0.5)
    }
    ctx.stroke()
  }

  // ── 刻度短线（下轴外伸 4px）──
  ctx.strokeStyle = theme.axisLine
  ctx.beginPath()
  const ay = Math.round(plot.y + plot.h) + 0.5
  if (showX) {
    for (const t of xTicks) {
      const tx = toPxX(t)
      if (tx < plot.x - 0.5 || tx > plot.x + plot.w + 0.5) continue
      ctx.moveTo(Math.round(tx) + 0.5, ay)
      ctx.lineTo(Math.round(tx) + 0.5, ay + 4)
    }
  }
  ctx.stroke()

  // ── Y 刻度芯片（最后绘制，浮于网格/波形之上；半透明底色保证密集信号下可读）──
  const yStep = niceStep(yMax - yMin, 5)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chipBg = theme.labelChipBg ?? 'rgba(127,127,127,0.35)'
  for (const t of yTicks) {
    const ty = toPxY(t)
    if (ty < plot.y - 0.5 || ty > plot.y + plot.h + 0.5) continue
    let cy = Math.round(ty - CHIP_H / 2) + 0.5
    // 首尾刻度钳制在绘图区内，避免芯片被裁切
    cy = Math.min(Math.max(cy, plot.y + 2), plot.y + plot.h - CHIP_H - 2)
    // 轴钉在组件最左缘：有左刻度带时锚定画布左侧（与波形间留出整段带距）；无刻度带时内嵌绘图区左缘
    const cx = plot.x > 0 ? 2 : plot.x + CHIP_INSET
    drawChip(ctx, cx, cy, fmtByStep(t, yStep), chipBg, theme.text)
  }
}
