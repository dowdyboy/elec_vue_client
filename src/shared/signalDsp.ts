/**
 * 信号处理纯函数（无 DOM / Vue 依赖，可在主进程、Worker、远程后端复用）
 * 由服务端调用以生成「显示就绪」帧（幅度谱 / dB / 抽稀）。
 */

import type { WindowType } from './signal'

// ── 窗函数 ──
export function getWindow(type: WindowType, n: number): Float32Array {
  const w = new Float32Array(n)
  if (type === 'rect') {
    w.fill(1)
    return w
  }
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / (n - 1)
    if (type === 'hann') w[i] = 0.5 * (1 - Math.cos(a))
    else if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(a)
    else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
  }
  return w
}

export function applyWindow(data: Float32Array, win: Float32Array): void {
  const n = Math.min(data.length, win.length)
  for (let i = 0; i < n; i++) data[i] *= win[i]
}

// ── 简易 FFT（复数输入 → 正频率幅度谱）──
// 返回线性幅度（已除以 n），长度 n/2
export function magnitudeSpectrum(input: Float32Array, imIn?: Float32Array): Float32Array {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two')
  const re = new Float32Array(n)
  const imm = new Float32Array(n)
  re.set(input)
  if (imIn && imIn.length === n) imm.set(imIn)
  // bit reversal
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tmpR = re[i]
      re[i] = re[j]
      re[j] = tmpR
      const tmpI = imm[i]
      imm[i] = imm[j]
      imm[j] = tmpI
    }
  }
  // Cooley-Tukey
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len
    const wlenR = Math.cos(ang)
    const wlenI = -Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1
      let wi = 0
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k]
        const uI = imm[i + k]
        const vR = re[i + k + len / 2] * wr - imm[i + k + len / 2] * wi
        const vI = re[i + k + len / 2] * wi + imm[i + k + len / 2] * wr
        re[i + k] = uR + vR
        imm[i + k] = uI + vI
        re[i + k + len / 2] = uR - vR
        imm[i + k + len / 2] = uI - vI
        const nxtR = wr * wlenR - wi * wlenI
        const nxtI = wr * wlenI + wi * wlenR
        wr = nxtR
        wi = nxtI
      }
    }
  }
  const out = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], imm[i]) / n
  return out
}

export function toDB(mag: Float32Array, floor = -120): Float32Array {
  const out = new Float32Array(mag.length)
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i] <= 1e-12 ? floor : 20 * Math.log10(mag[i])
    out[i] = Math.max(floor, v)
  }
  return out
}
