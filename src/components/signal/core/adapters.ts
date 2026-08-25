/**
 * 内置适配器（纯函数，可拷入 Worker）
 * 每个适配器把不确定的后端 RawInput 转为组件所需的 Normalized 形态，失败返回 null（丢帧）
 */

import type { IqNormalized, SpectrumInput, RawInput } from './types'

function toFloat32(arr: unknown): Float32Array | null {
  if (arr instanceof Float32Array) return arr
  if (Array.isArray(arr)) {
    // 允许 number[]，转为 Float32Array
    const out = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = Number(arr[i])
    return out
  }
  if (arr instanceof ArrayBuffer) return new Float32Array(arr)
  if (ArrayBuffer.isView(arr as ArrayBufferView)) {
    const v = arr as ArrayBufferView
    return new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4)
  }
  return null
}

// ── 通用：ArrayBuffer / base64 ──
export function fromArrayBuffer(raw: RawInput): Float32Array | null {
  if (raw instanceof ArrayBuffer) return new Float32Array(raw)
  if (ArrayBuffer.isView(raw as ArrayBufferView)) {
    const v = raw as ArrayBufferView
    return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
  }
  return null
}

export function fromBase64(raw: RawInput): Float32Array | null {
  // raw: { data: "base64..." } 或 直接 base64 字符串
  let b64: string | null = null
  if (typeof raw === 'string') b64 = raw
  else if (raw && typeof raw === 'object' && typeof (raw as { data?: unknown }).data === 'string')
    b64 = (raw as { data: string }).data
  if (!b64) return null
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Float32Array(bytes.buffer)
  } catch {
    return null
  }
}

// ── IQ 适配器 ──
export const iqAdapters = {
  /** 已是 Float32Array 交织或 {i,q} 直接透传 */
  passthrough: (raw: RawInput): IqNormalized | null => {
    if (raw instanceof Float32Array) return raw
    if (raw && typeof raw === 'object') {
      const o = raw as { i?: unknown; q?: unknown; interleaved?: unknown }
      if (o.interleaved instanceof Float32Array) return o.interleaved
      const si = toFloat32(o.i)
      const sq = toFloat32(o.q)
      if (si && sq && si.length === sq.length) return { i: si, q: sq }
      // 兼容 {iData,qData}
      const si2 = toFloat32((o as { iData?: unknown }).iData)
      const sq2 = toFloat32((o as { qData?: unknown }).qData)
      if (si2 && sq2) return { i: si2, q: sq2 }
    }
    return null
  },
  /** JSON: {i:[], q:[]} 或 {iData:[], qData:[]} */
  jsonInterleaved: (raw: RawInput): IqNormalized | null => {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const arrI = o.i ?? o.iData ?? o.I ?? o.ch0
    const arrQ = o.q ?? o.qData ?? o.Q ?? o.ch1
    const fi = toFloat32(arrI)
    const fq = toFloat32(arrQ)
    if (fi && fq) return { i: fi, q: fq }
    // 单数组交织
    const inter = toFloat32(o.data ?? o.samples ?? o.payload)
    if (inter) return inter
    return null
  },
  /** ArrayBuffer 交织 */
  arrayBuffer: (raw: RawInput): IqNormalized | null => {
    const f = fromArrayBuffer(raw)
    return f
  },
  /** base64 交织 */
  base64: (raw: RawInput): IqNormalized | null => {
    const f = fromBase64(raw)
    return f
  }
}

// ── 频谱/时频 适配器（时域）──
export const spectrumAdapters = {
  passthrough: (raw: RawInput): SpectrumInput | null => {
    const f = toFloat32(raw)
    if (f) return f
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      const cand = o.data ?? o.samples ?? o.payload ?? o.timeData ?? o.i ?? o.iData
      const ff = toFloat32(cand)
      if (ff) return ff
    }
    return null
  },
  json: (raw: RawInput): SpectrumInput | null => {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const cand = o.data ?? o.samples ?? o.timeData ?? o.payload
    return toFloat32(cand)
  },
  arrayBuffer: (raw: RawInput): SpectrumInput | null => fromArrayBuffer(raw),
  base64: (raw: RawInput): SpectrumInput | null => fromBase64(raw)
}

// 星座复用 IQ 适配器
export const constellationAdapters = iqAdapters

// ── 工具：自动尝试多适配器 ──
export function tryAdapters<T>(
  raw: RawInput,
  adapters: Array<(r: RawInput) => T | null>
): T | null {
  for (const fn of adapters) {
    const v = fn(raw)
    if (v) return v
  }
  return null
}
