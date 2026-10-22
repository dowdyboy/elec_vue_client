/**
 * TriggerEngine：边沿触发引擎（零依赖，可拷贝）
 *
 * 触发显示模式：在数据流中检测满足「通道 + 边沿 + 电平」的触发点，
 * 以触发点对齐绘制窗口（触发点固定在屏上 preTrigger 比例处）——
 * 周期信号因此稳定对齐显示，配合余辉形成磷光眼图。
 *
 * 模式：
 * - auto：有触发则对齐，无触发回退滚动（避免死屏）
 * - normal：仅触发才更新显示窗，无触发时保持上次窗口
 * - single：单次捕获——armed 时检测到一次触发后进入 fired，需重新 arm
 *
 * auto/normal 的命中不会立即写入 lastTriggerAbs：先进入 pendingAbs 等待调用方
 * 确认触发窗右侧数据已补齐（组件按 `(1-preTrigger)×span` 判断）后 promote()，
 * 避免周期信号下每帧新边沿覆盖捕获点导致对齐窗口永远不可达。
 *
 * 数据平铺于线性缓冲（本地下标 0..len-1）；绝对索引 = 本地下标 + dropped。
 * 检测只在「新增数据段」上做，O(段长)。
 */

export type TriggerEdge = 'rising' | 'falling'
export type TriggerSource = 'i' | 'q'
export type TriggerMode = 'auto' | 'normal' | 'single'

export interface TriggerConfig {
  enabled: boolean
  source: TriggerSource
  edge: TriggerEdge
  level: number
  mode: TriggerMode
  /** 触发点在屏幕上的水平位置比例 0~1（窗口起点在触发点左侧的比例） */
  preTrigger: number
}

export interface TriggerState {
  /** 最近一次触发点的绝对样本索引；-1=尚无触发 */
  lastTriggerAbs: number
  /** single 模式：armed=false 表示已捕获（fired），需重新武装 */
  armed: boolean
  /** 最近一次触发命中时间（ms 时间戳）；-1=从未触发（auto 模式用于「触发失联超时 → free-run」） */
  lastTriggerAt: number
  /**
   * auto/normal：已命中但右侧数据尚未补齐（触发窗右端超出总样本）的待渲染触发点；
   * -1=无。等待调用方确认数据到位后 promote() 提升为 lastTriggerAbs——
   * 若命中即写 lastTriggerAbs，周期信号每帧的新边沿会不断覆盖捕获点，
   * 右侧门控（`(1-preTrigger)×span`）将永远无法满足，对齐显示失效
   */
  pendingAbs: number
}

/** 扫描数据段 [s,e) 中第一个跨电平边沿，返回绝对索引；未命中返回 -1 */
export function findEdge(
  arr: Float32Array,
  s: number,
  e: number,
  level: number,
  edge: TriggerEdge,
  dropped: number
): number {
  if (e - s < 1) return -1
  let prev = arr[s] ?? 0
  for (let i = s + 1; i < e; i++) {
    const cur = arr[i] ?? 0
    if (edge === 'rising' ? prev <= level && cur > level : prev >= level && cur < level) {
      return i + dropped
    }
    prev = cur
  }
  return -1
}

/** 由触发点 + 窗宽计算触发显示窗（绝对样本索引域） */
export function triggerWindow(
  triggerAbs: number,
  span: number,
  preTrigger: number,
  dropped: number,
  total: number
): { min: number; max: number } {
  const min = triggerAbs - Math.floor(preTrigger * span)
  const max = min + span
  const cMin = Math.max(dropped, min)
  const cMax = Math.min(total, max)
  if (cMax <= cMin) {
    // 触发窗已被环形淘汰整体吞掉：锚定最老可用 span 窗（避免退化为 1 样本窗导致黑屏）
    return { min: dropped, max: Math.min(total, dropped + span) }
  }
  return { min: cMin, max: Math.max(cMin + 1, cMax) }
}

/**
 * 触发窗右侧所需的已到位样本数：触发点锚定屏上 preTrigger 处，
 * 右侧 (1-preTrigger)×span 必须全部到位才能渲染对齐帧（否则触发点偏离屏位）。
 * 组件以 `pendingAbs + triggerRightNeed(pre, span) <= total` 作为 promote 门控
 */
export function triggerRightNeed(preTrigger: number, span: number): number {
  return Math.ceil((1 - preTrigger) * span)
}

export class TriggerEngine {
  state: TriggerState = { lastTriggerAbs: -1, armed: true, lastTriggerAt: -1, pendingAbs: -1 }
  /** 最近一次 feed 是否找到了触发（用于 auto 模式回退判断） */
  lastFeedHit = false

  reset(): void {
    this.state = { lastTriggerAbs: -1, armed: true, lastTriggerAt: -1, pendingAbs: -1 }
    this.lastFeedHit = false
  }

  /** 传入「新增数据段」的源通道数组与范围（本地下标），推进触发状态机 */
  feed(
    cfg: TriggerConfig,
    srcArr: Float32Array,
    segS: number,
    segE: number,
    dropped: number
  ): void {
    if (!cfg.enabled) return
    if (cfg.mode === 'single' && !this.state.armed) {
      this.lastFeedHit = false
      return
    }
    const hit = findEdge(srcArr, segS, segE, cfg.level, cfg.edge, dropped)
    this.lastFeedHit = hit >= 0
    if (hit < 0) return
    if (cfg.mode === 'single') {
      // 单次捕获：命中即生效并进入 fired；后续 feed 被 armed 门控拦截
      this.state.lastTriggerAbs = hit
      this.state.lastTriggerAt = Date.now()
      this.state.armed = false
      return
    }
    // auto/normal：先记为待渲染触发点；待右侧数据补齐后由调用方 promote()，
    // 期间新边沿不覆盖——否则 lastTriggerAbs 永远停留在最新帧内，对齐窗口不可达
    if (this.state.pendingAbs < 0) this.state.pendingAbs = hit
  }

  /** 右侧数据补齐后提升待渲染触发点；无待渲染触发返回 false */
  promote(): boolean {
    const p = this.state.pendingAbs
    if (p < 0) return false
    this.state.lastTriggerAbs = p
    this.state.pendingAbs = -1
    this.state.lastTriggerAt = Date.now()
    return true
  }

  /** single 模式重新武装：清空上次触发点，等待下一次触发 */
  arm(): void {
    this.state.armed = true
    this.state.lastTriggerAbs = -1
    this.state.lastTriggerAt = -1
    this.state.pendingAbs = -1
  }
}
