/**
 * 源帧 → 新分析组件的轻量适配（仅渲染进程 Demo 使用，不进入组件库）。
 * 组件仍保持纯显示；是否使用源数据由页面显式选择。
 */

/** 交织 IQ → 每采样功率 dB（20log10|IQ|） */
export function iqToPowerDb(data: Float32Array, floor = -120): Float32Array {
  if (data.length % 2 !== 0) throw new Error('IQ length must be even')
  const n = data.length / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const mag = Math.hypot(data[2 * i]!, data[2 * i + 1]!)
    out[i] = mag <= 1e-12 ? floor : Math.max(floor, 20 * Math.log10(mag))
  }
  return out
}

/** 交织 IQ → 幅度（用于 APD/CCDF 样本统计） */
export function iqToAmplitude(data: Float32Array): Float32Array {
  if (data.length % 2 !== 0) throw new Error('IQ length must be even')
  const n = data.length / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.hypot(data[2 * i]!, data[2 * i + 1]!)
  return out
}

/**
 * 交织 IQ → I 路眼图轨迹。
 * 不做时钟恢复，只按帧内固定 sps 切窗；spanSymbols=2 时每 trace 覆盖 2 UI。
 */
export function iqToEyeTraces(
  data: Float32Array,
  samplesPerSymbol: number,
  spanSymbols = 2,
  maxTraces = 8
): Float32Array[] {
  if (data.length % 2 !== 0) throw new Error('IQ length must be even')
  const sps = Math.max(2, Math.floor(samplesPerSymbol))
  const span = Math.max(1, Math.floor(spanSymbols))
  const traceLen = sps * span
  const samples = data.length / 2
  const traces: Float32Array[] = []
  const limit = Math.min(maxTraces, Math.floor(samples / traceLen))
  for (let t = 0; t < limit; t++) {
    const out = new Float32Array(traceLen)
    const start = t * traceLen
    for (let k = 0; k < traceLen; k++) out[k] = data[2 * (start + k)]!
    traces.push(out)
  }
  return traces
}
