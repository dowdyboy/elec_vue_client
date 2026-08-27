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

export class TriggerEngine {
  state: TriggerState = { lastTriggerAbs: -1, armed: true, lastTriggerAt: -1 }
  /** 最近一次 feed 是否找到了触发（用于 auto 模式回退判断） */
  lastFeedHit = false

  reset(): void {
    this.state = { lastTriggerAbs: -1, armed: true, lastTriggerAt: -1 }
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
    if (hit >= 0) {
      this.state.lastTriggerAbs = hit
      this.state.lastTriggerAt = Date.now()
      if (cfg.mode === 'single') this.state.armed = false // 单次捕获完成
    }
  }

  /** single 模式重新武装：清空上次触发点，等待下一次触发 */
  arm(): void {
    this.state.armed = true
    this.state.lastTriggerAbs = -1
    this.state.lastTriggerAt = -1
  }
}
