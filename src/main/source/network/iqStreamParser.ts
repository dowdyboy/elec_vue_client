/**
 * TCP IQ 流解析器：自动识别「裸流」与「ELIQ 帧头」。
 *
 * 裸流：直接按配置格式输出完整样本（不足一个样本的尾部留到下一包）。
 * 帧头（48 字节，小端）：
 *   magic 'ELIQ' | ver u8 | msgType u8 | headerLen u16 | seq u32 | timestampNs u64
 *   sampleRate u32 | centerHz f64 | format u8 | channels u8 | reserved u16
 *   payloadBytes u32 | reserved2 u32 | reserved3 u32
 *
 * 解析器只负责拆包/校验/元数据，不转换样本；转换仍由 IqRingBuffer 按显示率完成。
 */
import { networkBytesPerSample, type NetworkFormat } from '../../../shared/sourceNetwork'

export interface IqPacketMeta {
  msgType: number
  seq: number
  timestampNs: number
  sampleRate: number
  centerHz: number
  format: NetworkFormat
  /** 通道数（1/2）；payload 按样本交错 */
  channels: number
  payloadBytes: number
}

export type IqPayloadHandler = (payload: Uint8Array, meta: IqPacketMeta | null) => void

const MAGIC = new Uint8Array([0x45, 0x4c, 0x49, 0x51]) // 'ELIQ'
const HEADER_LEN = 48
const MAX_PAYLOAD = 32 * 1024 * 1024
const FORMAT_BY_CODE: Array<NetworkFormat | undefined> = ['cf32', 'ci16', 'ci8']

function isMagic(buf: Uint8Array, offset: number): boolean {
  return (
    buf[offset] === MAGIC[0] &&
    buf[offset + 1] === MAGIC[1] &&
    buf[offset + 2] === MAGIC[2] &&
    buf[offset + 3] === MAGIC[3]
  )
}

export class IqStreamParser {
  private buf: Uint8Array = new Uint8Array(0)
  private mode: 'detect' | 'framed' | 'raw' = 'detect'
  private readonly configBps: number
  private packets = 0
  private displayPackets = 0
  private rawPackets = 0
  private dropped = 0
  private lastSeq = -1
  private framedMeta: IqPacketMeta | null = null

  constructor(format: NetworkFormat) {
    this.configBps = networkBytesPerSample(format)
  }

  get isFramed(): boolean {
    return this.mode === 'framed'
  }

  get packetCount(): number {
    return this.packets
  }

  get displayPacketCount(): number {
    return this.displayPackets
  }

  get rawPacketCount(): number {
    return this.rawPackets
  }

  get droppedPackets(): number {
    return this.dropped
  }

  get metadata(): IqPacketMeta | null {
    return this.framedMeta
  }

  reset(): void {
    this.buf = new Uint8Array(0)
    this.mode = 'detect'
    this.packets = 0
    this.displayPackets = 0
    this.rawPackets = 0
    this.dropped = 0
    this.lastSeq = -1
    this.framedMeta = null
  }

  push(chunk: Uint8Array, onPayload: IqPayloadHandler): void {
    if (chunk.length === 0) return
    this.buf = this.buf.length === 0 ? chunk : concat(this.buf, chunk)

    if (this.mode === 'detect') {
      if (this.buf.length < 4) return
      if (!isMagic(this.buf, 0)) {
        this.mode = 'raw'
      } else if (this.buf.length >= HEADER_LEN && !this.validHeader(this.buf, 0)) {
        // 以 ELIQ 开头但头部不合法：按裸流处理，避免误判后卡死
        this.mode = 'raw'
      } else {
        this.mode = 'framed'
      }
    }

    if (this.mode === 'raw') {
      this.drainRaw(onPayload)
      return
    }
    this.drainFramed(onPayload)
  }

  private drainRaw(onPayload: IqPayloadHandler): void {
    const usable = this.buf.length - (this.buf.length % this.configBps)
    if (usable <= 0) return
    const payload = this.buf.subarray(0, usable)
    this.buf = this.buf.subarray(usable)
    onPayload(payload, null)
  }

  private drainFramed(onPayload: IqPayloadHandler): void {
    while (this.buf.length >= 4) {
      if (!isMagic(this.buf, 0)) {
        // 失步：查找下一个 magic；找不到就保留最后 3 字节
        const idx = findMagic(this.buf)
        if (idx < 0) {
          const keep = Math.min(3, this.buf.length)
          this.buf = this.buf.subarray(this.buf.length - keep)
          return
        }
        this.buf = this.buf.subarray(idx)
        if (this.buf.length < HEADER_LEN) return
      }
      if (this.buf.length < HEADER_LEN) return

      const meta = this.parseHeader(this.buf)
      if (!meta) {
        // 非法头：丢弃 1 字节继续找 magic
        this.buf = this.buf.subarray(1)
        continue
      }
      const total = HEADER_LEN + meta.payloadBytes
      if (this.buf.length < total) return
      const payload = this.buf.subarray(HEADER_LEN, total)
      this.buf = this.buf.subarray(total)
      this.packets++
      if (meta.msgType === 4) this.displayPackets++
      else this.rawPackets++
      this.trackSeq(meta.seq)
      this.framedMeta = meta
      onPayload(payload, meta)
    }
  }

  private parseHeader(buf: Uint8Array): IqPacketMeta | null {
    const view = new DataView(buf.buffer, buf.byteOffset, HEADER_LEN)
    const version = view.getUint8(4)
    const msgType = view.getUint8(5)
    const headerLen = view.getUint16(6, true)
    const payloadBytes = view.getUint32(36, true)
    const format = FORMAT_BY_CODE[view.getUint8(32)]
    const channels = view.getUint8(33)
    if (version !== 1 || (msgType !== 1 && msgType !== 4)) return null
    if (headerLen !== HEADER_LEN) return null
    if (!format || (channels !== 1 && channels !== 2)) return null
    if (payloadBytes === 0 || payloadBytes > MAX_PAYLOAD) return null
    return {
      msgType,
      seq: view.getUint32(8, true),
      timestampNs: Number(view.getBigUint64(12, true)),
      sampleRate: view.getUint32(20, true),
      centerHz: view.getFloat64(24, true),
      format,
      channels,
      payloadBytes
    }
  }

  private validHeader(buf: Uint8Array, offset: number): boolean {
    if (buf.length < offset + HEADER_LEN) return true // 还看不全，先假定是帧头
    const view = new DataView(buf.buffer, buf.byteOffset + offset, HEADER_LEN)
    const version = view.getUint8(4)
    const msgType = view.getUint8(5)
    const headerLen = view.getUint16(6, true)
    const payloadBytes = view.getUint32(36, true)
    return (
      version === 1 &&
      (msgType === 1 || msgType === 4) &&
      headerLen === HEADER_LEN &&
      (view.getUint8(33) === 1 || view.getUint8(33) === 2) &&
      payloadBytes > 0 &&
      payloadBytes <= MAX_PAYLOAD
    )
  }

  private trackSeq(seq: number): void {
    if (this.lastSeq >= 0) {
      const expected = (this.lastSeq + 1) >>> 0
      if (seq !== expected) {
        const gap = (seq - expected) >>> 0
        // 只统计合理的前向丢包；乱序/重置按 0 处理
        if (gap > 0 && gap < 0x7fffffff) this.dropped += gap
      }
    }
    this.lastSeq = seq
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function findMagic(buf: Uint8Array): number {
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (isMagic(buf, i)) return i
  }
  return -1
}
