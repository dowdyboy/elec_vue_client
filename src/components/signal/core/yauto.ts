/**
 * YAutoScaler：自动 Y 轴量程状态机（零依赖，可拷贝）
 *
 * 语义（示波器风格）：
 * - 目标 = 可见区间极值 居中 + 25% 余量，再向外吸附到 1/2/5×10^k 档位步进
 *   （档位量化：小幅极值波动被同一档位吸收，稳态下刻度完全静止）
 * - 非对称更新：出现新极值立即扩入（永不裁剪波形）；数据回落后按 Y_RELEASE 缓慢收敛
 *   （约半秒收敛，刻度轻微「呼吸」后稳定）
 * - 残差进入目标跨度 0.1% 时吸附贴合，避免无限爬行导致刻度数字微颤
 *
 * 外部事件（清空数据 / 双击复位 / 切回 autoScale）应调用 reset()，使下一帧直接吸附目标。
 */
import { snapRangeNice } from './axis'

export interface YAutoRange {
  min: number
  max: number
}

const Y_RELEASE = 0.08 // 收缩速度：每帧向目标靠拢的比例（九成幅度约半秒收敛）

export class YAutoScaler {
  private cur: YAutoRange | null = null

  /** 重置：下一帧直接吸附新目标，不从旧范围滑入 */
  reset(): void {
    this.cur = null
  }

  /**
   * @param minVal 可见区间真实最小值
   * @param maxVal 可见区间真实最大值
   */
  resolve(minVal: number, maxVal: number): YAutoRange {
    const cx = (minVal + maxVal) / 2
    const half = Math.max((maxVal - minVal) / 2, 1e-3) * 1.25
    const target = snapRangeNice(cx - half, cx + half)
    if (!this.cur) {
      this.cur = { ...target }
      return { ...target }
    }
    const cur = this.cur
    // 非对称更新：新极值即时扩入（防裁剪）；富余缓慢回落
    if (target.min < cur.min) cur.min = target.min
    else cur.min += (target.min - cur.min) * Y_RELEASE
    if (target.max > cur.max) cur.max = target.max
    else cur.max += (target.max - cur.max) * Y_RELEASE
    // 收敛吸附：残差小于目标跨度千分之一时贴合
    const tSpan = Math.abs(target.max - target.min)
    if (Math.abs(cur.min - target.min) < tSpan * 1e-3) cur.min = target.min
    if (Math.abs(cur.max - target.max) < tSpan * 1e-3) cur.max = target.max
    return { min: cur.min, max: cur.max }
  }
}
