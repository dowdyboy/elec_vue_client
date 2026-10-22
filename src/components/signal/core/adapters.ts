/**
 * 内置适配器（纯函数，可拷入 Worker）
 * 每个适配器把不确定的后端 RawInput 转为组件所需的 Normalized 形态，失败返回 null（丢帧）
 */

import type { IqNormalized, SpectrumInput, RawInput } from './types'

/** 不支持的类型告警节流（坏后端每帧都推 Int16 时避免刷屏） */
let lastUnsupportedWarnAt = 0
const warnedTypedArrays = new Set<string>()

/** 字节流 → Float32Array（先对齐拷贝，奇数长度/非 4 对齐不再抛 RangeError） */
function bytesToFloat32(bytes: Uint8Array): Float32Array | null {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) return null
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}

function toFloat32(arr: unknown): Float32Array | null {
  if (arr instanceof Float32Array) return arr
  if (Array.isArray(arr)) {
    // 允许 number[]，转为 Float32Array
    const out = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = Number(arr[i])
    return out
  }
  if (arr instanceof ArrayBuffer) return bytesToFloat32(new Uint8Array(arr))
  if (arr instanceof Uint8Array) return bytesToFloat32(arr)
  if (arr instanceof DataView)
    return bytesToFloat32(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
  if (ArrayBuffer.isView(arr as ArrayBufferView)) {
    // Int16/Int32/Float64 等：协议约定 Float32 二进制；静默 reinterpret 只会得到垃圾数据
    const name = (arr as object).constructor?.name ?? 'unknown'
    const now = Date.now()
    if (!warnedTypedArrays.has(name) || now - lastUnsupportedWarnAt > 5000) {
      warnedTypedArrays.add(name)
      lastUnsupportedWarnAt = now
      console.warn(`[signal:adapter] unsupported typed array: ${name} (expect Float32Array)`)
    }
    return null
  }
  return null
}

// ── 通用：ArrayBuffer / base64 ──
export function fromArrayBuffer(raw: RawInput): Float32Array | null {
  if (raw instanceof ArrayBuffer) return bytesToFloat32(new Uint8Array(raw))
  if (raw instanceof Uint8Array) return bytesToFloat32(raw)
  if (raw instanceof DataView)
    return bytesToFloat32(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
  if (raw instanceof Float32Array) return raw
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
    return bytesToFloat32(bytes)
  } catch {
    return null
  }
}

// ── 二进制 dtype / 字节序（硬件采集最常见 int16 交织 IQ）──
export type AdapterDtype = 'float32' | 'float64' | 'int16' | 'int8' | 'uint8'
export type AdapterEndian = 'le' | 'be'

/** 去掉 {data/samples/payload} 包装，便于适配 WebSocket/JSON 常见形态 */
function unwrapPayload(raw: RawInput): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw as ArrayBufferView)) return raw
  const o = raw as Record<string, unknown>
  return o.data ?? o.samples ?? o.payload ?? o.timeData ?? raw
}

function viewBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof DataView) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  return null
}

function alignedCopy(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/**
 * 把任意常见负载转成「数值序列」Float32Array（尚未 scale/offset）。
 * 支持 TypedArray / ArrayBuffer / Uint8Array / DataView / number[]。
 * dtype 必须与负载一致；int16/float64 的字节流按 endian 解码。
 */
export function toFloat32Samples(
  raw: RawInput,
  dtype: AdapterDtype = 'float32',
  endian: AdapterEndian = 'le'
): Float32Array | null {
  const src = unwrapPayload(raw)
  if (src instanceof Float32Array) return src
  if (Array.isArray(src)) {
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i++) out[i] = Number(src[i])
    return out
  }
  if (dtype === 'float32') return toFloat32(src)
  if (src instanceof Float64Array && dtype === 'float64') return Float32Array.from(src)
  if (src instanceof Int16Array && dtype === 'int16') return Float32Array.from(src)
  if (src instanceof Int8Array && dtype === 'int8') return Float32Array.from(src)
  if (src instanceof Uint8Array && dtype === 'uint8') return Float32Array.from(src)
  const bytes = viewBytes(src)
  if (!bytes) return null
  if (dtype === 'int8' || dtype === 'uint8') {
    const copy = alignedCopy(bytes)
    return dtype === 'int8'
      ? Float32Array.from(new Int8Array(copy.buffer))
      : Float32Array.from(copy)
  }
  if (dtype === 'int16') {
    if (bytes.byteLength % 2 !== 0) return null
    const dv = new DataView(alignedCopy(bytes).buffer)
    const out = new Float32Array(bytes.byteLength / 2)
    // DataView 第二参数是 littleEndian（不是 bigEndian）
    for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, endian === 'le')
    return out
  }
  if (dtype === 'float64') {
    if (bytes.byteLength % 8 !== 0) return null
    const dv = new DataView(alignedCopy(bytes).buffer)
    const out = new Float32Array(bytes.byteLength / 8)
    for (let i = 0; i < out.length; i++) out[i] = dv.getFloat64(i * 8, endian === 'le')
    return out
  }
  return null
}

/** 按 dtype 自动的默认缩放：int16 归一化到 [-1,1)，int8/uint8 同理 */
function defaultScale(dtype: AdapterDtype): number {
  if (dtype === 'int16') return 1 / 32768
  if (dtype === 'int8') return 1 / 127
  if (dtype === 'uint8') return 1 / 255
  return 1
}

export interface IqAdapterOptions {
  /** 负载数值类型；默认 float32 */
  dtype?: AdapterDtype
  /** 内存布局：interleaved [I0,Q0,...] 或 planar { i, q }；默认 interleaved */
  layout?: 'interleaved' | 'planar'
  /** 数值缩放（默认 int16→1/32768，int8→1/127，uint8→1/255，float→1） */
  scale?: number
  /** 数值偏移（默认 0） */
  offset?: number
  /** 字节序（仅 ArrayBuffer/字节流有效；默认 le） */
  endian?: AdapterEndian
}

/**
 * IQ 适配器工厂：
 * ```ts
 * const adapter = createIqAdapter({ dtype: 'int16', layout: 'interleaved' })
 * <IqChart :adapter="adapter" />
 * ```
 */
export function createIqAdapter(
  opts: IqAdapterOptions = {}
): (raw: RawInput) => IqNormalized | null {
  const dtype = opts.dtype ?? 'float32'
  const layout = opts.layout ?? 'interleaved'
  const scale = opts.scale ?? defaultScale(dtype)
  const offset = opts.offset ?? 0
  const endian = opts.endian ?? 'le'
  const isIdentity = scale === 1 && offset === 0

  return (raw: RawInput): IqNormalized | null => {
    if (layout === 'planar') {
      const src = unwrapPayload(raw)
      if (!src || typeof src !== 'object' || Array.isArray(src)) return null
      const o = src as Record<string, unknown>
      const iRaw = o.i ?? o.iData ?? o.I ?? o.ch0
      const qRaw = o.q ?? o.qData ?? o.Q ?? o.ch1
      const iVals = toFloat32Samples(iRaw, dtype, endian)
      const qVals = toFloat32Samples(qRaw, dtype, endian)
      if (!iVals || !qVals) return null
      const n = Math.min(iVals.length, qVals.length)
      const i = new Float32Array(n)
      const q = new Float32Array(n)
      for (let k = 0; k < n; k++) {
        i[k] = iVals[k]! * scale + offset
        q[k] = qVals[k]! * scale + offset
      }
      return { i, q }
    }
    const vals = toFloat32Samples(raw, dtype, endian)
    if (!vals) return null
    if (isIdentity) return vals
    // 不能原地改宿主 buffer：dtype=float32 时 toFloat32 可能直接返回原数组
    const out = new Float32Array(vals.length)
    for (let k = 0; k < vals.length; k++) out[k] = vals[k]! * scale + offset
    return out
  }
}

export interface SpectrumAdapterOptions {
  dtype?: AdapterDtype
  scale?: number
  offset?: number
  endian?: AdapterEndian
  /** uint8 映射区间：0 → min，255 → max（默认 -120 ~ 0 dB） */
  min?: number
  max?: number
}

/**
 * 频谱适配器工厂（dB / 线性均可，由 dtype/scale/offset 决定）。
 * 常见 `Uint8Array` dB 数据：0..255 映射到 `min..max`（默认 -120..0 dB）。
 */
export function createSpectrumAdapter(
  opts: SpectrumAdapterOptions = {}
): (raw: RawInput) => SpectrumInput | null {
  const dtype = opts.dtype ?? 'float32'
  const endian = opts.endian ?? 'le'
  let scale = opts.scale
  let offset = opts.offset
  if (dtype === 'uint8' && scale === undefined) {
    const min = opts.min ?? -120
    const max = opts.max ?? 0
    scale = (max - min) / 255
    offset = min
  }
  const k = scale ?? (dtype === 'int16' ? 0.01 : 1)
  const b = offset ?? 0
  return (raw: RawInput): SpectrumInput | null => {
    const vals = toFloat32Samples(raw, dtype, endian)
    if (!vals) return null
    if (k === 1 && b === 0) return vals
    const out = new Float32Array(vals.length)
    for (let i = 0; i < vals.length; i++) out[i] = vals[i]! * k + b
    return out
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
  },
  /** int16 交织（默认 1/32768 归一化；scale/offset 可用 createIqAdapter 覆盖） */
  int16Interleaved: createIqAdapter({ dtype: 'int16' }),
  /** int16 平面 { i, q } / { iData, qData } */
  int16Planar: createIqAdapter({ dtype: 'int16', layout: 'planar' }),
  /** float64 交织 */
  float64Interleaved: createIqAdapter({ dtype: 'float64' })
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
  base64: (raw: RawInput): SpectrumInput | null => fromBase64(raw),
  /** Uint8 dB 数据：0..255 → -120..0 dB（可用 createSpectrumAdapter 改 min/max） */
  uint8: createSpectrumAdapter({ dtype: 'uint8' }),
  /** int16 dB 数据：默认 0.01 dB/LSB（可用 createSpectrumAdapter 覆盖 scale/offset） */
  int16: createSpectrumAdapter({ dtype: 'int16', scale: 0.01 }),
  /** float64 频谱 */
  float64: createSpectrumAdapter({ dtype: 'float64' })
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
