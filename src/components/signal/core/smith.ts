/**
 * Smith 圆图核心：
 * - 复反射系数 Γ → 阻抗/VSWR/回波损耗
 * - 轨迹统计
 * 网格绘制在组件层；本文件只做数学与常量。
 */

import type { SmithTrace } from './types'

export interface SmithStats {
  points: number
  maxGamma: number
  minReturnLossDb: number
  maxVswr: number
  meanVswr: number
}

/** 归一化阻抗 z = (1+Γ)/(1-Γ)，再乘 Z0 */
export function gammaToImpedance(
  i: number,
  q: number,
  z0 = 50
): { r: number; x: number; z0: number } {
  const den = (1 - i) * (1 - i) + q * q
  if (!(den > 1e-18)) return { r: Infinity, x: Infinity, z0 }
  return {
    r: (z0 * (1 - i * i - q * q)) / den,
    x: (z0 * 2 * q) / den,
    z0
  }
}

export function gammaToVswr(i: number, q: number): number {
  const g = Math.min(1, Math.hypot(i, q))
  return (1 + g) / Math.max(1e-12, 1 - g)
}

export function gammaToReturnLossDb(i: number, q: number): number {
  const g = Math.hypot(i, q)
  return g > 1e-12 ? -20 * Math.log10(g) : Infinity
}

export function computeSmithStats(traces: SmithTrace[], z0 = 50): SmithStats {
  let points = 0
  let maxGamma = 0
  let minRl = Infinity
  let maxVswr = 0
  let sumVswr = 0
  for (const t of traces) {
    const n = Math.min(t.i.length, t.q.length)
    for (let k = 0; k < n; k++) {
      const iv = t.i[k]!
      const qv = t.q[k]!
      if (!Number.isFinite(iv) || !Number.isFinite(qv)) continue
      const g = Math.hypot(iv, qv)
      if (g > maxGamma) maxGamma = g
      const rl = gammaToReturnLossDb(iv, qv)
      if (rl < minRl) minRl = rl
      const vswr = gammaToVswr(iv, qv)
      if (vswr > maxVswr) maxVswr = vswr
      sumVswr += vswr
      points++
    }
  }
  void z0
  return {
    points,
    maxGamma,
    minReturnLossDb: Number.isFinite(minRl) ? minRl : Infinity,
    maxVswr,
    meanVswr: points > 0 ? sumVswr / points : 0
  }
}

/** 常用等电阻圆（归一化） */
export const SMITH_RESISTANCES = [0, 0.2, 0.5, 1, 2, 5, 10]
/** 常用等电抗圆（归一化 |x|） */
export const SMITH_REACTANCES = [0.2, 0.5, 1, 2, 5, 10]
