/** 双通道跨通道测量：幅度比、平均相位差、归一化相关系数。 */
export interface DualChannelMetrics {
  ampRatio: number
  phaseDeg: number
  corr: number
}

export function computeDualChannelMetrics(
  a: Float32Array,
  b: Float32Array
): DualChannelMetrics | null {
  const n = Math.min(a.length, b.length) & ~1
  if (n < 4) return null
  let p0 = 0
  let p1 = 0
  let dot = 0
  let cross = 0
  for (let i = 0; i < n; i += 2) {
    const i0 = a[i]!
    const q0 = a[i + 1]!
    const i1 = b[i]!
    const q1 = b[i + 1]!
    p0 += i0 * i0 + q0 * q0
    p1 += i1 * i1 + q1 * q1
    dot += i0 * i1 + q0 * q1
    cross += i0 * q1 - q0 * i1
  }
  if (p0 <= 0 || p1 <= 0) return null
  return {
    ampRatio: Math.sqrt(p1 / p0),
    phaseDeg: (Math.atan2(cross, dot) * 180) / Math.PI,
    corr: Math.max(-1, Math.min(1, dot / Math.sqrt(p0 * p1)))
  }
}
