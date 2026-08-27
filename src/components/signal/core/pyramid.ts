/**
 * MinMaxPyramid：样本极值金字塔（零依赖，可拷贝）
 *
 * 场景：流式 IQ 图冻结回看大窗时，若每帧对可见区间全量扫描（O(N)）会卡顿。
 * 本模块预聚合多层 min/max，任意区间 [start,end) 内取极值 / 按桶 minmax 抽稀
 * 均为 O(块数)（≈ O(logN) 或 O(桶数)），替代逐样本遍历。
 *
 * 每块聚合（I/Q/幅度包络 Env=√(I²+Q²)）的 min/max 值及其下标——
 * 下标用于抽稀时保持「按原始索引排序」，避免折线交叉伪影（与旧 decimate 行为一致）；
 * 另含 sum/sumSq 供窗口均值/RMS 自动测量。
 *
 * 层级：level 0 = 原始样本（不存储）；level k 块大小 = blockSize^k（默认 16）。
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
  envMin: Float32Array
  envMax: Float32Array
  envMinIdx: Float32Array
  envMaxIdx: Float32Array
  sumI: Float32Array
  sumSqI: Float32Array
  sumQ: Float32Array
  sumSqQ: Float32Array
}

export interface RangeMM {
  minI: number
  maxI: number
  minQ: number
  maxQ: number
  /** 幅度包络 √(I²+Q²) 极值（供包络通道 Y 自适应） */
  envMin: number
  envMax: number
}

/** 区间统计：极值 + 均值/RMS（供自动测量） */
export interface RangeStats extends RangeMM {
  count: number
  meanI: number
  rmsI: number
  meanQ: number
  rmsQ: number
}

/** 抽稀通道：0=I、1=Q、2=幅度包络 √(I²+Q²) */
export type BucketChannel = 0 | 1 | 2

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
      qMaxIdx: mk(),
      envMin: mk(),
      envMax: mk(),
      envMinIdx: mk(),
      envMaxIdx: mk(),
      sumI: mk(),
      sumSqI: mk(),
      sumQ: mk(),
      sumSqQ: mk()
    }
  }

  /** 由原始数据整树重建（compact / 扩容 / clear 后调用） */
  rebuild(i: Float32Array, q: Float32Array, len: number): void {
    const n = Math.min(len, i.length)
    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L]!
      const child = L === 0 ? null : this.levels[L - 1]!
      const nBlocks = Math.ceil(n / lv.bs)
      for (let b = 0; b < nBlocks; b++) {
        this.computeBlock(lv, child, i, q, b, Math.min(n, (b + 1) * lv.bs))
      }
    }
  }

  /**
   * 环形淘汰增量更新：数据前移 evicted 样本（须为 block 整数倍，调用方保证）。
   * 被保留块的极值/和值不变、仅整体平移（level0 块值 copyWithin，极值下标 -evicted），
   * level1.. 再从子层重聚合——避免整树重建（1.8M 约 38ms → 增量约 3ms）。
   */
  compactShift(len: number, evicted: number): void {
    if (this.levels.length === 0 || evicted <= 0) return
    const s = Math.floor(evicted / this.block)
    if (s <= 0) return
    const lv0 = this.levels[0]!
    const nBlocks = Math.ceil(len / this.block)
    // 1) level0 值块平移（块 b ← 旧块 b+s）；下标块平移后再整体 -evicted
    const valKeys = [
      'minI',
      'maxI',
      'minQ',
      'maxQ',
      'envMin',
      'envMax',
      'sumI',
      'sumSqI',
      'sumQ',
      'sumSqQ'
    ] as const
    for (const k of valKeys) lv0[k].copyWithin(0, s, s + nBlocks)
    const idxKeys = ['iMinIdx', 'iMaxIdx', 'qMinIdx', 'qMaxIdx', 'envMinIdx', 'envMaxIdx'] as const
    for (const k of idxKeys) {
      const arr = lv0[k]
      arr.copyWithin(0, s, s + nBlocks)
      for (let b = 0; b < nBlocks; b++) arr[b] = (arr[b] ?? 0) - evicted
    }
    // 2) 高层从子层重聚合（computeBlock 子层分支不读 i/q，传空数组即可）
    const empty = new Float32Array(0)
    for (let L = 1; L < this.levels.length; L++) {
      const lv = this.levels[L]!
      const child = this.levels[L - 1]!
      const nB = Math.ceil(len / lv.bs)
      for (let b = 0; b < nB; b++) {
        this.computeBlock(lv, child, empty, empty, b, Math.min(len, (b + 1) * lv.bs))
      }
    }
  }

  /**
   * 追加后增量更新受影响块：prevLen 为追加前有效长度，newLen 为追加后有效长度。
   * 每个层级仅重算与 [prevLen,newLen) 相交的块
   */
  appendRange(i: Float32Array, q: Float32Array, prevLen: number, newLen: number): void {
    const len = Math.min(newLen, i.length)
    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L]!
      const first = Math.floor(prevLen / lv.bs)
      const last = Math.ceil(len / lv.bs) - 1
      if (last < 0) continue
      const child = L === 0 ? null : this.levels[L - 1]!
      for (let b = Math.max(0, first); b <= last; b++) {
        this.computeBlock(lv, child, i, q, b, Math.min(len, (b + 1) * lv.bs))
      }
    }
  }

  /** 聚合单个块 [s,e) 的 I/Q/Env 极值与和/平方和，写入 lv 的第 b 块 */
  private computeBlock(
    lv: LevelArrays,
    child: LevelArrays | null,
    i: Float32Array,
    q: Float32Array,
    b: number,
    e: number
  ): void {
    const s = b * lv.bs
    if (e <= s) return
    let mnI = Infinity
    let mxI = -Infinity
    let mnQ = Infinity
    let mxQ = -Infinity
    let mnE = Infinity
    let mxE = -Infinity
    let mnIi = 0
    let mxIi = 0
    let mnQi = 0
    let mxQi = 0
    let mnEi = 0
    let mxEi = 0
    let sumI = 0
    let sumSqI = 0
    let sumQ = 0
    let sumSqQ = 0
    if (child === null) {
      for (let j = s; j < e; j++) {
        const v = i[j] ?? 0
        const w = q[j] ?? 0
        if (v < mnI) {
          mnI = v
          mnIi = j
        }
        if (v > mxI) {
          mxI = v
          mxIi = j
        }
        if (w < mnQ) {
          mnQ = w
          mnQi = j
        }
        if (w > mxQ) {
          mxQ = w
          mxQi = j
        }
        const ev = Math.hypot(v, w)
        if (ev < mnE) {
          mnE = ev
          mnEi = j
        }
        if (ev > mxE) {
          mxE = ev
          mxEi = j
        }
        sumI += v
        sumSqI += v * v
        sumQ += w
        sumSqQ += w * w
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
        const e0 = child.envMin[b0] ?? 0
        const e1 = child.envMax[b0] ?? 0
        if (e0 < mnE) {
          mnE = e0
          mnEi = child.envMinIdx[b0] ?? 0
        }
        if (e1 > mxE) {
          mxE = e1
          mxEi = child.envMaxIdx[b0] ?? 0
        }
        sumI += child.sumI[b0] ?? 0
        sumSqI += child.sumSqI[b0] ?? 0
        sumQ += child.sumQ[b0] ?? 0
        sumSqQ += child.sumSqQ[b0] ?? 0
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
    lv.envMin[b] = mnE
    lv.envMax[b] = mxE
    lv.envMinIdx[b] = mnEi
    lv.envMaxIdx[b] = mxEi
    lv.sumI[b] = sumI
    lv.sumSqI[b] = sumSqI
    lv.sumQ[b] = sumQ
    lv.sumSqQ[b] = sumSqQ
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
    let envMin = Infinity
    let envMax = -Infinity
    this.fold(s, e, (lo, hi, lv) => {
      if (lv) {
        const b = Math.floor(lo / lv.bs)
        if (lv.minI[b]! < minI) minI = lv.minI[b]!
        if (lv.maxI[b]! > maxI) maxI = lv.maxI[b]!
        if (lv.minQ[b]! < minQ) minQ = lv.minQ[b]!
        if (lv.maxQ[b]! > maxQ) maxQ = lv.maxQ[b]!
        if (lv.envMin[b]! < envMin) envMin = lv.envMin[b]!
        if (lv.envMax[b]! > envMax) envMax = lv.envMax[b]!
      } else {
        for (let j = lo; j < hi; j++) {
          const v = i[j]!
          if (v < minI) minI = v
          if (v > maxI) maxI = v
          const w = q[j]!
          if (w < minQ) minQ = w
          if (w > maxQ) maxQ = w
          const ev = Math.hypot(v, w)
          if (ev < envMin) envMin = ev
          if (ev > envMax) envMax = ev
        }
      }
    })
    if (!isFinite(minI)) return null
    return { minI, maxI, minQ, maxQ, envMin, envMax }
  }

  /** 区间统计：极值 + 均值/RMS（供自动测量）；区间无效返回 null */
  queryStats(i: Float32Array, q: Float32Array, start: number, end: number): RangeStats | null {
    if (end <= start) return null
    const s = Math.max(0, start | 0)
    const e = Math.min(i.length, end | 0)
    if (e <= s) return null
    let minI = Infinity
    let maxI = -Infinity
    let minQ = Infinity
    let maxQ = -Infinity
    let sumI = 0
    let sumSqI = 0
    let sumQ = 0
    let sumSqQ = 0
    let envMin = Infinity
    let envMax = -Infinity
    let count = 0
    this.fold(s, e, (lo, hi, lv) => {
      if (lv) {
        const b = Math.floor(lo / lv.bs)
        if (lv.minI[b]! < minI) minI = lv.minI[b]!
        if (lv.maxI[b]! > maxI) maxI = lv.maxI[b]!
        if (lv.minQ[b]! < minQ) minQ = lv.minQ[b]!
        if (lv.maxQ[b]! > maxQ) maxQ = lv.maxQ[b]!
        if (lv.envMin[b]! < envMin) envMin = lv.envMin[b]!
        if (lv.envMax[b]! > envMax) envMax = lv.envMax[b]!
        sumI += lv.sumI[b] ?? 0
        sumSqI += lv.sumSqI[b] ?? 0
        sumQ += lv.sumQ[b] ?? 0
        sumSqQ += lv.sumSqQ[b] ?? 0
        count += lv.bs
      } else {
        for (let j = lo; j < hi; j++) {
          const v = i[j]!
          const w = q[j]!
          if (v < minI) minI = v
          if (v > maxI) maxI = v
          if (w < minQ) minQ = w
          if (w > maxQ) maxQ = w
          const ev = Math.hypot(v, w)
          if (ev < envMin) envMin = ev
          if (ev > envMax) envMax = ev
          sumI += v
          sumSqI += v * v
          sumQ += w
          sumSqQ += w * w
          count++
        }
      }
    })
    if (!isFinite(minI) || count <= 0) return null
    const n = count
    return {
      minI,
      maxI,
      minQ,
      maxQ,
      envMin,
      envMax,
      count: n,
      meanI: sumI / n,
      rmsI: Math.sqrt(Math.max(0, sumSqI / n)),
      meanQ: sumQ / n,
      rmsQ: Math.sqrt(Math.max(0, sumSqQ / n))
    }
  }

  /**
   * 按桶 minmax 抽稀（channel=0 I、1 Q、2 幅度包络）：
   * 每桶聚合块级 (值,下标)，保持原始索引顺序（先出现者在前），输出 Float32Array
   */
  bucketChannel(
    i: Float32Array,
    q: Float32Array,
    start: number,
    end: number,
    buckets: number,
    channel: BucketChannel
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
          } else if (channel === 1) {
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
          } else {
            const v0 = lv.envMin[bi]!
            const v1 = lv.envMax[bi]!
            if (v0 < mn) {
              mn = v0
              mnIdx = lv.envMinIdx[bi]!
            }
            if (v1 > mx) {
              mx = v1
              mxIdx = lv.envMaxIdx[bi]!
            }
          }
        } else {
          for (let j = lo; j < hi; j++) {
            const v =
              channel === 0
                ? (i[j] ?? 0)
                : channel === 1
                  ? (q[j] ?? 0)
                  : Math.hypot(i[j] ?? 0, q[j] ?? 0)
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
