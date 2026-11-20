/**
 * 双通道 IQ 解交织：ELIQ payload 按样本交错 [ch0,ch1,ch0,ch1...]，
 * 拆成每个通道连续字节，供各自的 IqRingBuffer / RawIqRecorder 使用。
 */
import { networkBytesPerSample, type NetworkFormat } from '../../../shared/sourceNetwork'

export function splitInterleaved(
  payload: Uint8Array,
  format: NetworkFormat,
  channels: number
): Uint8Array[] {
  const count = Math.max(1, Math.floor(channels))
  if (count === 1) return [payload]
  const bps = networkBytesPerSample(format)
  const samples = Math.floor(payload.length / (bps * count))
  const outs = Array.from({ length: count }, () => new Uint8Array(samples * bps))
  if (samples === 0) return outs

  const aligned16 = payload.byteOffset % 2 === 0
  const aligned32 = payload.byteOffset % 4 === 0
  if (format === 'ci16' && aligned16) {
    const src = new Uint16Array(payload.buffer, payload.byteOffset, samples * count * 2)
    const dst = outs.map((o) => new Uint16Array(o.buffer, o.byteOffset, samples * 2))
    for (let k = 0; k < samples; k++) {
      for (let ch = 0; ch < count; ch++) {
        const s = (k * count + ch) * 2
        dst[ch]![k * 2] = src[s]!
        dst[ch]![k * 2 + 1] = src[s + 1]!
      }
    }
    return outs
  }
  if (format === 'cf32' && aligned32) {
    const src = new Float32Array(payload.buffer, payload.byteOffset, samples * count * 2)
    const dst = outs.map((o) => new Float32Array(o.buffer, o.byteOffset, samples * 2))
    for (let k = 0; k < samples; k++) {
      for (let ch = 0; ch < count; ch++) {
        const s = (k * count + ch) * 2
        dst[ch]![k * 2] = src[s]!
        dst[ch]![k * 2 + 1] = src[s + 1]!
      }
    }
    return outs
  }
  if (format === 'ci8') {
    for (let k = 0; k < samples; k++) {
      for (let ch = 0; ch < count; ch++) {
        const s = (k * count + ch) * 2
        outs[ch]![k * 2] = payload[s]!
        outs[ch]![k * 2 + 1] = payload[s + 1]!
      }
    }
    return outs
  }
  // 未对齐兜底：逐字节拷贝
  for (let k = 0; k < samples; k++) {
    for (let ch = 0; ch < count; ch++) {
      const s = (k * count + ch) * bps
      outs[ch]!.set(payload.subarray(s, s + bps), k * bps)
    }
  }
  return outs
}
