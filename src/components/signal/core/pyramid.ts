/**
 * MinMaxPyramid：样本极值金字塔（零依赖，可拷贝）
 *
 * 场景：流式 IQ 图冻结回看大窗时，若每帧对可见区间全量扫描（O(N)）会卡顿。
 * 本模块预聚合多层 min/max，任意区间 [start,end) 内取极值 / 按桶 minmax 抽稀
 * 均为 O(块数)（≈ O(logN) 或 O(桶数)），替代逐样本遍历。
 *
 * 层级：level 0 = 原始样本（不存储）；level k 块大小 = blockSize^k（默认 16）。
 * 每块记录 I/Q 的 min/max 值及其下标——下标用于抽稀时保持「按原始索引排序」，
 * 避免折线交叉伪影（与旧 decimate 行为一致）。
 *
 * 数据平铺于线性缓冲：本地下标 ∈ [0, len) 为有效区；绝对索引 = 本地下标 + dropped。
 * 增量维护：append 后仅更新受影响块；compact/扩容后整树重建。
 */

export const PYRAMID_BLOCK = 16

interface LevelArrays {
  bs: number // 块大小（样本数）
  minI: Float32Array
  maxI: Float32Array
  iMinIdx: Float32Array
  iMaxIdx: Float32Array
  minQ: Float32Array
  maxQ: Float32Array
  qMinIdx: Float32Array
  qMaxIdx: Float32Array
}

export interface RangeMM {
  minI: number
  maxI: number
  minQ: number
  maxQ: number
}

export class MinMaxPyramid {
  private levels: LevelArrays[] = []
  private capacity = 0
  private readonly block: number

  constructor(capacity: number, block = PYRAMID_BLOCK) {
    this.block = Math.max(2, block | 0)
    this.configure(capacity)
  }

  /** 按缓冲容量分配各级数组；扩容后调用方需 rebuild() */
  configure(capacity: number): void {
    this.capacity = Math.max(1, capacity | 0)
    this.levels = []
    let bs = this.block
    while (bs < this.capacity) {
      this.levels.push(this.allocLevel(bs))
      bs *= this.block
    }
  }

  private allocLevel(bs: number): LevelArrays {
    const n = Math.ceil(this.capacity / bs)
    const mk = (): Float32Array => new Float32Array(n)
    return {
      bs,
      minI: mk(),
      maxI: mk(),
      iMinIdx: mk(),
      iMaxIdx: mk(),
      minQ: mk(),
      maxQ: mk(),
      qMinIdx: mk(),
      qMaxIdx: mk()
    }
  }

  /** 由原始数据整树重建（compact / 扩容 / clear 后调用） */
  rebuild(i: Float32Array, q: Float32Array, len: number): void {
    const n = Math.min(len, i.length)
    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L]!
      const bs = lv.bs
      const child = L === 0 ? null : this.levels[L - 1]!
      const nBlocks = Math.ceil(n / bs)
      for (let b = 0; b < nBlocks; b++) {
        const s = b * bs
        const e = Math.min(n, s + bs)
        let mnI = Infinity
        let mxI = -Infinity
        let mnQ = Infinity
        let mxQ = -Infinity
        let mnIi = 0
        let mxIi = 0
        let mnQi = 0
        let mxQi = 0
        if (child === null) {
          for (let j = s; j < e; j++) {
            const v = i[j] ?? 0
            if (v < mnI) {
              mnI = v
              mnIi = j
            }
            if (v > mxI) {
              mxI = v
              mxIi = j
            }
            const w = q[j] ?? 0
            if (w < mnQ) {
              mnQ = w
              mnQi = j
            }
            if (w > mxQ) {
              mxQ = w
              mxQi = j
            }
          }
        } else {
          const cs = child.bs
          for (let b0 = Math.floor(s / cs); b0 < Math.ceil(e / cs); b0++) {
            if (b0 >= child.minI.length) break
            const c0 = child.minI[b0] ?? 0
            const c1 = child.maxI[b0] ?? 0
            if (c0 < mnI) {
              mnI = c0
              mnIi = child.iMinIdx[b0] ?? 0
            }
            if (c1 > mxI) {
              mxI = c1
              mxIi = child.iMaxIdx[b0] ?? 0
            }
            const d0 = child.minQ[b0] ?? 0
            const d1 = child.maxQ[b0] ?? 0
            if (d0 < mnQ) {
              mnQ = d0
              mnQi = child.qMinIdx[b0] ?? 0
            }
            if (d1 > mxQ) {
              mxQ = d1
              mxQi = child.qMaxIdx[b0] ?? 0
            }
          }
        }
        lv.minI[b] = mnI
        lv.maxI[b] = mxI
        lv.iMinIdx[b] = mnIi
        lv.iMaxIdx[b] = mxIi
        lv.minQ[b] = mnQ
        lv.maxQ[b] = mxQ
        lv.qMinIdx[b] = mnQi
        lv.qMaxIdx[b] = mxQi
      }
    }
  }

  /**
   * 追加后增量更新受影响块：prevLen 为追加前有效长度，newLen 为追加后有效长度。
   * 每个层级仅重算与 [prevLen,newLen) 相交的块；L1 从原始样本、L>1 组合下级块
   */
  appendRange(i: Float32Array, q: Float32Array, prevLen: number, newLen: number): void {
    const len = Math.min(newLen, i.length)
    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L]!
      const bs = lv.bs
      const first = Math.floor(prevLen / bs)
      const last = Math.ceil(len / bs) - 1
      if (last < 0) continue
      const child = L === 0 ? null : this.levels[L - 1]!
      for (let b = Math.max(0, first); b <= last; b++) {
        const s = b * bs
        const e = Math.min(len, s + bs)
        let mnI = Infinity
        let mxI = -Infinity
        let mnQ = Infinity
        let mxQ = -Infinity
        let mnIi = 0
        let mxIi = 0
        let mnQi = 0
        let mxQi = 0
        if (child === null) {
          for (let j = s; j < e; j++) {
            const v = i[j] ?? 0
            if (v < mnI) {
              mnI = v
              mnIi = j
            }
            if (v > mxI) {
              mxI = v
              mxIi = j
            }
            const w = q[j] ?? 0
            if (w < mnQ) {
              mnQ = w
              mnQi = j
            }
            if (w > mxQ) {
              mxQ = w
              mxQi = j
            }
          }
        } else {
          const cs = child.bs
          for (let b0 = Math.floor(s / cs); b0 < Math.ceil(e / cs); b0++) {
            if (b0 >= child.minI.length) break
            const c0 = child.minI[b0] ?? 0
            const c1 = child.maxI[b0] ?? 0
            if (c0 < mnI) {
              mnI = c0
              mnIi = child.iMinIdx[b0] ?? 0
            }
            if (c1 > mxI) {
              mxI = c1
              mxIi = child.iMaxIdx[b0] ?? 0
            }
            const d0 = child.minQ[b0] ?? 0
            const d1 = child.maxQ[b0] ?? 0
            if (d0 < mnQ) {
              mnQ = d0
              mnQi = child.qMinIdx[b0] ?? 0
            }
            if (d1 > mxQ) {
              mxQ = d1
              mxQi = child.qMaxIdx[b0] ?? 0
            }
          }
        }
        lv.minI[b] = mnI
        lv.maxI[b] = mxI
        lv.iMinIdx[b] = mnIi
        lv.iMaxIdx[b] = mxIi
        lv.minQ[b] = mnQ
        lv.maxQ[b] = mxQ
        lv.qMinIdx[b] = mnQi
        lv.qMaxIdx[b] = mxQi
      }
    }
  }

  /** 区间极值：精确 min/max；区间无效返回 null */
  query(i: Float32Array, q: Float32Array, start: number, end: number): RangeMM | null {
    if (end <= start) return null
    const s = Math.max(0, start | 0)
    const e = Math.min(i.length, end | 0)
    if (e <= s) return null
    let minI = Infinity
    let maxI = -Infinity
    let minQ = Infinity
    let maxQ = -Infinity
    this.fold(s, e, (lo, hi, lv) => {
      if (lv) {
        const b = Math.floor(lo / lv.bs)
        if (lv.minI[b]! < minI) minI = lv.minI[b]!
        if (lv.maxI[b]! > maxI) maxI = lv.maxI[b]!
        if (lv.minQ[b]! < minQ) minQ = lv.minQ[b]!
        if (lv.maxQ[b]! > maxQ) maxQ = lv.maxQ[b]!
      } else {
        for (let j = lo; j < hi; j++) {
          const v = i[j]!
          if (v < minI) minI = v
          if (v > maxI) maxI = v
          const w = q[j]!
          if (w < minQ) minQ = w
          if (w > maxQ) maxQ = w
        }
      }
    })
    if (!isFinite(minI)) return null
    return { minI, maxI, minQ, maxQ }
  }

  /**
   * 按桶 minmax 抽稀（channel=0 取 I、channel=1 取 Q）：
   * 每桶聚合块级 (值,下标)，保持原始索引顺序（先出现者在前），输出 Float32Array
   */
  bucketChannel(
    i: Float32Array,
    q: Float32Array,
    start: number,
    end: number,
    buckets: number,
    channel: 0 | 1
  ): Float32Array {
    const s = Math.max(0, start | 0)
    const e = Math.min(i.length, end | 0)
    const len = e - s
    if (len <= 0) return new Float32Array(0)
    const n = Math.max(1, Math.min(buckets, len) | 0)
    const out = new Float32Array(n * 2)
    let oi = 0
    const bucketSize = len / n
    for (let b = 0; b < n; b++) {
      const bS = s + Math.floor(b * bucketSize)
      const bE = Math.min(e, s + Math.max(bS - s + 1, Math.floor((b + 1) * bucketSize)))
      let mn = Infinity
      let mx = -Infinity
      let mnIdx = 0
      let mxIdx = 0
      this.fold(bS, bE, (lo, hi, lv) => {
        if (lv) {
          const bi = Math.floor(lo / lv.bs)
          if (channel === 0) {
            const v0 = lv.minI[bi]!
            const v1 = lv.maxI[bi]!
            if (v0 < mn) {
              mn = v0
              mnIdx = lv.iMinIdx[bi]!
            }
            if (v1 > mx) {
              mx = v1
              mxIdx = lv.iMaxIdx[bi]!
            }
          } else {
            const v0 = lv.minQ[bi]!
            const v1 = lv.maxQ[bi]!
            if (v0 < mn) {
              mn = v0
              mnIdx = lv.qMinIdx[bi]!
            }
            if (v1 > mx) {
              mx = v1
              mxIdx = lv.qMaxIdx[bi]!
            }
          }
        } else {
          for (let j = lo; j < hi; j++) {
            const v = (channel === 0 ? i[j] : q[j])!
            if (v < mn) {
              mn = v
              mnIdx = j
            }
            if (v > mx) {
              mx = v
              mxIdx = j
            }
          }
        }
      })
      if (!isFinite(mn)) continue
      if (mx > mn) {
        if (mnIdx <= mxIdx) {
          out[oi++] = mn
          out[oi++] = mx
        } else {
          out[oi++] = mx
          out[oi++] = mn
        }
      } else {
        out[oi++] = mn
      }
    }
    return out.subarray(0, oi)
  }

  /**
   * 把 [s,e) 分解为「高层整块 + 原始边缘」，从左到右顺序回调。
   * lv 非空：整块（块起点须与当前游标对齐且整体在区间内）；lv 为空：需逐样本读原始
   */
  private fold(
    s: number,
    e: number,
    visit: (lo: number, hi: number, lv: LevelArrays | null) => void
  ): void {
    let cur = s
    const maxL = this.levels.length - 1
    while (cur < e) {
      // 当前游标对齐且块整体在区间内 → 用该层整块（从最高层优先）
      let used = false
      for (let L = maxL; L >= 0; L--) {
        const lv = this.levels[L]!
        const bs = lv.bs
        if (cur % bs === 0 && cur + bs <= e) {
          visit(cur, cur + bs, lv)
          cur += bs
          used = true
          break
        }
      }
      if (used) continue
      // 无法对齐任何整块：前进到最近的层级对齐边界（或 e），这段按原始样本读取
      let next = e
      for (let L = maxL; L >= 0; L--) {
        const bs = this.levels[L]!.bs
        const nb = Math.ceil((cur + 1) / bs) * bs
        if (nb > cur && nb < next) next = nb
      }
      const hi = Math.min(next, e)
      visit(cur, hi, null)
      cur = hi
    }
  }
}
