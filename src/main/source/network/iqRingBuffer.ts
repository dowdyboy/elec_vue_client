/**
 * 网络 IQ 环形缓冲（原始字节，按格式抽取读取）
 *
 * 为什么存字节而不是 Float32Array：
 * - AD9361 30 MSPS ci16 时，线上约 120 MB/s；逐样本转 Float32 会拖垮主进程；
 * - 只有「显示/分析」需要的样本才转换，全速数据保持 Buffer 原样（后续 raw 录制可直接落盘）。
 */
import { networkBytesPerSample, type NetworkFormat } from '../../../shared/sourceNetwork'

export class IqRingBuffer {
  private readonly buf: Uint8Array
  private readonly cap: number
  private readonly bps: number
  private readonly view: DataView
  private readPos = 0
  private len = 0
  private dropped = 0

  constructor(
    capacityBytes: number,
    private readonly format: NetworkFormat
  ) {
    this.bps = networkBytesPerSample(format)
    // 对齐到样本大小，避免半个样本
    this.cap = Math.max(this.bps, Math.floor(capacityBytes / this.bps) * this.bps)
    this.buf = new Uint8Array(this.cap)
    this.view = new DataView(this.buf.buffer)
  }

  get availableBytes(): number {
    return this.len
  }

  get availableSamples(): number {
    return Math.floor(this.len / this.bps)
  }

  get droppedSamples(): number {
    return this.dropped
  }

  clear(): void {
    this.readPos = 0
    this.len = 0
    this.dropped = 0
  }

  /** 追加原始字节；容量不足时丢弃最旧的数据（按样本对齐） */
  push(chunk: Uint8Array): void {
    // 防御：只接受完整样本（调用方应保留跨包的半个样本）
    const usable = chunk.length - (chunk.length % this.bps)
    if (usable <= 0) return
    const data = usable === chunk.length ? chunk : chunk.subarray(0, usable)

    // 单块就超过容量：只保留最后 cap 字节（更旧的数据全部丢弃）
    if (data.length >= this.cap) {
      const start = data.length - this.cap
      this.dropped += Math.floor((this.len + start) / this.bps)
      this.buf.set(data.subarray(start), 0)
      this.readPos = 0
      this.len = this.cap
      return
    }

    // 先丢弃最旧数据，保证 chunk 能完整放入
    if (this.len + data.length > this.cap) {
      let drop = this.len + data.length - this.cap
      const misalign = drop % this.bps
      if (misalign !== 0) drop += this.bps - misalign
      if (drop > this.len) drop = Math.floor(this.len / this.bps) * this.bps
      this.readPos = (this.readPos + drop) % this.cap
      this.len -= drop
      this.dropped += Math.floor(drop / this.bps)
    }

    const writePos = (this.readPos + this.len) % this.cap
    const first = Math.min(data.length, this.cap - writePos)
    this.buf.set(data.subarray(0, first), writePos)
    if (first < data.length) this.buf.set(data.subarray(first), 0)
    this.len += data.length
  }

  /**
   * 读取 count 个复数样本，每 stride 个原始样本取 1 个。
   * 返回交织 Float32 [I0,Q0,I1,Q1...]；数据不足返回 null（不消费）。
   */
  read(count: number, stride: number): Float32Array | null {
    const step = Math.max(1, Math.floor(stride))
    const need = count * step * this.bps
    if (count <= 0 || need > this.cap || this.len < need) return null

    const out = new Float32Array(count * 2)
    let p = this.readPos
    const sampleStep = step * this.bps
    for (let k = 0; k < count; k++) {
      this.readOne(p, out, k * 2)
      p += sampleStep
      if (p >= this.cap) p -= this.cap
    }
    this.readPos = (this.readPos + need) % this.cap
    this.len -= need
    return out
  }

  private readOne(pos: number, out: Float32Array, outIndex: number): void {
    if (this.format === 'ci16') {
      out[outIndex] = this.readInt16(pos) / 32768
      out[outIndex + 1] = this.readInt16((pos + 2) % this.cap) / 32768
      return
    }
    if (this.format === 'cf32') {
      out[outIndex] = this.readFloat32(pos)
      out[outIndex + 1] = this.readFloat32((pos + 4) % this.cap)
      return
    }
    // ci8
    out[outIndex] = this.readInt8(pos) / 128
    out[outIndex + 1] = this.readInt8((pos + 1) % this.cap) / 128
  }

  private readInt8(pos: number): number {
    return this.view.getInt8(pos)
  }

  private readInt16(pos: number): number {
    if (pos + 2 <= this.cap) return this.view.getInt16(pos, true)
    const lo = this.buf[pos]!
    const hi = this.buf[0]!
    return (((hi << 8) | lo) << 16) >> 16
  }

  private readFloat32(pos: number): number {
    if (pos + 4 <= this.cap) return this.view.getFloat32(pos, true)
    const bytes = new Uint8Array(4)
    for (let i = 0; i < 4; i++) bytes[i] = this.buf[(pos + i) % this.cap]!
    return new DataView(bytes.buffer).getFloat32(0, true)
  }
}
