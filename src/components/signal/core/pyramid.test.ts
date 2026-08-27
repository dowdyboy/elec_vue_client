import { describe, it, expect } from 'vitest'
import { MinMaxPyramid } from './pyramid'

// 确定性伪随机
function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

interface MM {
  minI: number
  maxI: number
  minQ: number
  maxQ: number
}

function brute(i: Float32Array, q: Float32Array, s: number, e: number): MM {
  let mnI = Infinity
  let mxI = -Infinity
  let mnQ = Infinity
  let mxQ = -Infinity
  for (let j = s; j < e; j++) {
    const v = i[j]!
    const w = q[j]!
    if (v < mnI) mnI = v
    if (v > mxI) mxI = v
    if (w < mnQ) mnQ = w
    if (w > mxQ) mxQ = w
  }
  return { minI: mnI, maxI: mxI, minQ: mnQ, maxQ: mxQ }
}

function oldDecimate(arr: Float32Array, s: number, e: number, target: number): number[] {
  const len = e - s
  if (len <= target) return Array.from(arr.subarray(s, e))
  const bucket = len / target
  const out: number[] = []
  for (let b = 0; b < target; b++) {
    const a = Math.floor(b * bucket)
    const c = Math.floor((b + 1) * bucket)
    let mn = Infinity
    let mx = -Infinity
    let mnIdx = -1
    let mxIdx = -1
    for (let j = s + a; j < s + c && j < e; j++) {
      const v = arr[j]!
      if (v < mn) {
        mn = v
        mnIdx = j
      }
      if (v > mx) {
        mx = v
        mxIdx = j
      }
    }
    if (mnIdx < 0) continue
    if (mnIdx < mxIdx) out.push(mn, mx)
    else out.push(mx, mn)
  }
  return out
}

describe('MinMaxPyramid', () => {
  it('整树重建后随机区间 query 与暴力一致', () => {
    const CAP = 1 << 20
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(12345)
    const N = 900000
    for (let j = 0; j < N; j++) {
      i[j] = rnd() * 2 - 1
      q[j] = rnd() * 2 - 1
    }
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, N)
    for (let t = 0; t < 200; t++) {
      const a = Math.floor(rnd() * N * 0.8)
      const b = Math.min(N, a + 1 + Math.floor(rnd() * 50000))
      const got = pyr.query(i, q, a, b)
      const exp = brute(i, q, a, b)
      expect(got).not.toBeNull()
      expect(got!.minI).toBeCloseTo(exp.minI, 5)
      expect(got!.maxI).toBeCloseTo(exp.maxI, 5)
      expect(got!.minQ).toBeCloseTo(exp.minQ, 5)
      expect(got!.maxQ).toBeCloseTo(exp.maxQ, 5)
    }
  })

  it('增量 appendRange 与全量结果一致', () => {
    const CAP = 1 << 20
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(7)
    const pyr = new MinMaxPyramid(CAP)
    let len = 0
    for (let c = 0; c < 12; c++) {
      const n = 1000 + Math.floor(rnd() * 20000)
      for (let j = 0; j < n; j++) {
        i[len + j] = rnd() * 2 - 1
        q[len + j] = rnd() * 2 - 1
      }
      pyr.appendRange(i, q, len, len + n)
      len += n
      // 抽查若干区间
      for (let t = 0; t < 10; t++) {
        const a = Math.floor(rnd() * len * 0.9)
        const b = Math.min(len, a + 1 + Math.floor(rnd() * 20000))
        const got = pyr.query(i, q, a, b)
        const exp = brute(i, q, a, b)
        expect(got).not.toBeNull()
        expect(got!.maxI).toBeCloseTo(exp.maxI, 5)
        expect(got!.minQ).toBeCloseTo(exp.minQ, 5)
      }
    }
  })

  it('bucketChannel 与旧 decimate 逐值一致（含索引顺序）', () => {
    const CAP = 1 << 16
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(99)
    const N = 60000
    for (let j = 0; j < N; j++) {
      i[j] = Math.sin(j * 0.03) + rnd() * 0.4
      q[j] = Math.cos(j * 0.02) + rnd() * 0.4
    }
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, N)
    const s = 8000
    for (const target of [800, 500, 137]) {
      const got = Array.from(pyr.bucketChannel(i, q, s, N, target, 0))
      const exp = oldDecimate(i, s, N, target)
      expect(got).toEqual(exp)
      const gotQ = Array.from(pyr.bucketChannel(i, q, s, N, target, 1))
      expect(gotQ).toEqual(oldDecimate(q, s, N, target))
    }
  })

  it('窗口小于桶数时返回原始切片', () => {
    const CAP = 1 << 10
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const N = 200
    for (let j = 0; j < N; j++) {
      i[j] = j
      q[j] = -j
    }
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, N)
    const got = pyr.bucketChannel(i, q, 0, N, 500, 0)
    expect(Array.from(got)).toEqual(Array.from(i.subarray(0, N)))
  })

  it('扩容 configure 后重建仍正确', () => {
    const CAP = 1 << 12
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(5)
    const N = 4000
    for (let j = 0; j < N; j++) {
      i[j] = rnd() * 2 - 1
      q[j] = rnd() * 2 - 1
    }
    const pyr = new MinMaxPyramid(1 << 10)
    pyr.configure(CAP)
    pyr.rebuild(i, q, N)
    const got = pyr.query(i, q, 0, N)
    const exp = brute(i, q, 0, N)
    expect(got!.maxI).toBeCloseTo(exp.maxI, 5)
    expect(got!.minQ).toBeCloseTo(exp.minQ, 5)
  })

  it('queryStats 均值/RMS 与暴力一致', () => {
    const CAP = 1 << 16
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(2024)
    const N = 50000
    for (let j = 0; j < N; j++) {
      i[j] = Math.sin(j * 0.01) + rnd() * 0.3
      q[j] = Math.cos(j * 0.013) + rnd() * 0.3
    }
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, N)
    for (let t = 0; t < 30; t++) {
      const a = Math.floor(rnd() * N * 0.7)
      const b = Math.min(N, a + 1 + Math.floor(rnd() * 20000))
      const st = pyr.queryStats(i, q, a, b)
      // 暴力均值/RMS
      let sumI = 0
      let sumSqI = 0
      let sumQ = 0
      let sumSqQ = 0
      let mnI = Infinity
      let mxI = -Infinity
      for (let j = a; j < b; j++) {
        const v = i[j]!
        const w = q[j]!
        sumI += v
        sumSqI += v * v
        sumQ += w
        sumSqQ += w * w
        if (v < mnI) mnI = v
        if (v > mxI) mxI = v
      }
      const n = b - a
      expect(st!.count).toBe(n)
      expect(st!.minI).toBeCloseTo(mnI, 4)
      expect(st!.maxI).toBeCloseTo(mxI, 4)
      expect(st!.meanI).toBeCloseTo(sumI / n, 4)
      expect(st!.rmsI).toBeCloseTo(Math.sqrt(sumSqI / n), 4)
      expect(st!.meanQ).toBeCloseTo(sumQ / n, 4)
      expect(st!.rmsQ).toBeCloseTo(Math.sqrt(sumSqQ / n), 4)
    }
  })

  it('无效区间返回 null / 空数组', () => {
    const i = new Float32Array(64)
    const q = new Float32Array(64)
    const pyr = new MinMaxPyramid(64)
    expect(pyr.query(i, q, 5, 5)).toBeNull()
    expect(pyr.bucketChannel(i, q, 0, 0, 4, 0).length).toBe(0)
  })

  it('包络通道 env 抽稀与暴力一致（含索引顺序）', () => {
    const CAP = 1 << 16
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(55)
    const N = 50000
    for (let j = 0; j < N; j++) {
      i[j] = Math.sin(j * 0.02) + rnd() * 0.3
      q[j] = Math.cos(j * 0.02) + rnd() * 0.3
    }
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, N)
    const s = 5000
    for (const target of [600, 250]) {
      const got = Array.from(pyr.bucketChannel(i, q, s, N, target, 2))
      // 暴力：每桶 env min/max（含顺序）
      const len = N - s
      const bucket = len / target
      const exp: number[] = []
      for (let b = 0; b < target; b++) {
        const a = s + Math.floor(b * bucket)
        const c = Math.min(N, s + Math.floor((b + 1) * bucket))
        let mn = Infinity
        let mx = -Infinity
        let mnIdx = -1
        let mxIdx = -1
        for (let j = a; j < c; j++) {
          const v = Math.hypot(i[j]!, q[j]!)
          if (v < mn) {
            mn = v
            mnIdx = j
          }
          if (v > mx) {
            mx = v
            mxIdx = j
          }
        }
        if (mnIdx < 0) continue
        if (mnIdx < mxIdx) exp.push(mn, mx)
        else exp.push(mx, mn)
      }
      // float32 存储 vs float64 暴力存在 ~1e-7 舍入，逐元素容差比较
      expect(got.length).toBe(exp.length)
      for (let k = 0; k < got.length; k++) {
        expect(got[k]!).toBeCloseTo(exp[k]!, 5)
      }
    }
  })

  it('compactShift（环形淘汰增量）与整树重建结果一致', () => {
    const CAP = 1 << 21
    const i = new Float32Array(CAP)
    const q = new Float32Array(CAP)
    const rnd = makeRng(123)
    const N = 600000
    for (let j = 0; j < N; j++) {
      i[j] = Math.sin(j * 0.01) + rnd() * 0.2
      q[j] = Math.cos(j * 0.01) + rnd() * 0.2
    }
    // 模拟多轮淘汰：每轮保留 keep，淘汰量取 16 的整数倍（与组件 compact 对齐）
    let keep = N
    const ev = 65536 // 淘汰量（16 的整数倍）
    const pyr = new MinMaxPyramid(CAP)
    pyr.rebuild(i, q, keep)
    for (let round = 0; round < 6; round++) {
      // 模拟环形淘汰：数据前移 ev，金字塔 compactShift
      i.copyWithin(0, ev, keep)
      q.copyWithin(0, ev, keep)
      keep -= ev
      pyr.compactShift(keep, ev)
      // 与全新重建对比
      const ref = new MinMaxPyramid(CAP)
      ref.rebuild(i, q, keep)
      // 抽查多个区间：query 的 I/Q 极值应一致
      for (let t = 0; t < 15; t++) {
        const a = Math.floor(rnd() * keep * 0.9)
        const b = Math.min(keep, a + 1 + Math.floor(rnd() * 30000))
        const g = pyr.query(i, q, a, b)
        const r = ref.query(i, q, a, b)
        expect(g).not.toBeNull()
        expect(r).not.toBeNull()
        expect(g!.minI).toBeCloseTo(r!.minI, 4)
        expect(g!.maxI).toBeCloseTo(r!.maxI, 4)
        expect(g!.minQ).toBeCloseTo(r!.minQ, 4)
        expect(g!.maxQ).toBeCloseTo(r!.maxQ, 4)
      }
      // bucketChannel 全范围抽稀亦一致
      const gb = Array.from(pyr.bucketChannel(i, q, 0, keep, 500, 0))
      const rb = Array.from(ref.bucketChannel(i, q, 0, keep, 500, 0))
      expect(gb.length).toBe(rb.length)
      for (let k = 0; k < gb.length; k++) {
        expect(gb[k]!).toBeCloseTo(rb[k]!, 4)
      }
    }
  })
})
