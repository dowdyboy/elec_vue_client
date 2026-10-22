/**
 * YAutoScaler：自动 Y 轴量程状态机（零依赖，可拷贝）
 *
 * 语义（示波器风格）：
 * - 目标 = 可见区间极值 居中 + 25% 余量，再向外吸附到 1/2/5×10^k 档位步进
 *   （档位量化：小幅极值波动被同一档位吸收，稳态下刻度完全静止）
 * - 非对称更新：出现新极值立即扩入（永不裁剪波形）；数据回落后缓慢收敛
 * - 残差进入目标跨度 0.1% 时吸附贴合，避免无限爬行导致刻度数字微颤
 *
 * 稳定性参数（可选，默认 0 = 原语义）：
 * - hysteresis：换档滞回比例——候选跨度 ≤ 当前目标跨度 ×(1−hysteresis) 才考虑收窄
 * - holdFrames：收窄驻留帧数——满足滞回条件需连续 N 次才真正换档
 * 两者用于抑制「极值在档位边界附近来回导致目标档位逐帧翻转」的抖动
 * （随机调制信号/QAM 过冲起伏常见）。扩张仍即时，保证不裁切。
 *
 * 外部事件（清空数据 / 双击复位 / 切回 autoScale）应调用 reset()，使下一帧直接吸附目标。
 */
import { snapRangeNice } from './axis'

export interface YAutoRange {
  min: number
  max: number
}

export interface YAutoOptions {
  /** 换档滞回比例（0~0.9，默认 0） */
  hysteresis?: number
  /** 收窄所需连续稳定次数（默认 0） */
  holdFrames?: number
  /** 收缩方向缓动比例（默认 0.08） */
  shrinkRelease?: number
}

const Y_RELEASE = 0.08 // 默认收缩速度：每帧向目标靠拢的比例（九成幅度约半秒收敛）

export class YAutoScaler {
  private cur: YAutoRange | null = null
  /** 已提交的目标档位（滞回/驻留判断基准） */
  private tgt: YAutoRange | null = null
  private streak = 0
  private readonly hysteresis: number
  private readonly holdFrames: number
  private readonly release: number

  constructor(opts: YAutoOptions = {}) {
    this.hysteresis = Math.min(0.9, Math.max(0, opts.hysteresis ?? 0))
    this.holdFrames = Math.max(0, Math.round(opts.holdFrames ?? 0))
    this.release = Math.min(0.9, Math.max(0.01, opts.shrinkRelease ?? Y_RELEASE))
  }

  /** 重置：下一帧直接吸附新目标，不从旧范围滑入 */
  reset(): void {
    this.cur = null
    this.tgt = null
    this.streak = 0
  }

  /**
   * @param minVal 可见区间真实最小值
   * @param maxVal 可见区间真实最大值
   */
  resolve(minVal: number, maxVal: number): YAutoRange {
    const cx = (minVal + maxVal) / 2
    const half = Math.max((maxVal - minVal) / 2, 1e-3) * 1.25
    const cand = snapRangeNice(cx - half, cx + half)
    if (!this.tgt) {
      this.tgt = { ...cand }
      if (!this.cur) {
        this.cur = { ...cand }
        return { ...cand }
      }
    } else {
      const widen = cand.min < this.tgt.min || cand.max > this.tgt.max
      const candSpan = cand.max - cand.min
      const tgtSpan = this.tgt.max - this.tgt.min
      if (widen) {
        // 扩张即时（不裁切）
        this.tgt = { ...cand }
        this.streak = 0
      } else if (candSpan <= tgtSpan * (1 - this.hysteresis)) {
        this.streak++
        if (this.streak > this.holdFrames) {
          this.tgt = { ...cand }
          this.streak = 0
        }
      } else {
        this.streak = 0
      }
    }
    const cur = this.cur!
    const target = this.tgt!
    // 非对称更新：新极值即时扩入（防裁剪）；富余缓慢回落
    if (target.min < cur.min) cur.min = target.min
    else cur.min += (target.min - cur.min) * this.release
    if (target.max > cur.max) cur.max = target.max
    else cur.max += (target.max - cur.max) * this.release
    // 收敛吸附：残差小于目标跨度千分之一时贴合
    const tSpan = Math.abs(target.max - target.min)
    if (Math.abs(cur.min - target.min) < tSpan * 1e-3) cur.min = target.min
    if (Math.abs(cur.max - target.max) < tSpan * 1e-3) cur.max = target.max
    return { min: cur.min, max: cur.max }
  }
}
