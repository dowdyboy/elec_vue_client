import { describe, expect, it } from 'vitest'
import { IqStreamParser, type IqPacketMeta } from './iqStreamParser'

function frame(
  seq: number,
  payload: Uint8Array,
  opts: { formatCode?: number; sampleRate?: number; centerHz?: number; msgType?: number } = {}
): Buffer {
  const h = Buffer.alloc(48)
  h.write('ELIQ', 0, 'ascii')
  h.writeUInt8(1, 4)
  h.writeUInt8(opts.msgType ?? 1, 5)
  h.writeUInt16LE(48, 6)
  h.writeUInt32LE(seq, 8)
  h.writeBigUInt64LE(123456789n, 12)
  h.writeUInt32LE(opts.sampleRate ?? 100000, 20)
  h.writeDoubleLE(opts.centerHz ?? 0, 24)
  h.writeUInt8(opts.formatCode ?? 1, 32) // 1=ci16
  h.writeUInt8(1, 33)
  h.writeUInt32LE(payload.length, 36)
  return Buffer.concat([h, Buffer.from(payload)])
}

describe('IqStreamParser', () => {
  it('裸流：只输出完整样本，半样本留到下一包', () => {
    const parser = new IqStreamParser('ci16')
    const payloads: Uint8Array[] = []
    const raw = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0])
    parser.push(raw.subarray(0, 5), (p) => payloads.push(p))
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.length).toBe(4)
    parser.push(raw.subarray(5), (p) => payloads.push(p))
    expect(payloads).toHaveLength(2)
    expect(payloads[1]!.length).toBe(8)
    expect(parser.isFramed).toBe(false)
  })

  it('帧头：跨包拆分也能还原 payload 与元数据', () => {
    const parser = new IqStreamParser('ci16')
    const payload = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88])
    const packet = frame(1, payload, { sampleRate: 200000, centerHz: 1000 })
    const out: Uint8Array[] = []
    const metas: Array<IqPacketMeta | null> = []
    const onPayload = (p: Uint8Array, m: IqPacketMeta | null): void => {
      out.push(p)
      metas.push(m)
    }
    parser.push(packet.subarray(0, 10), onPayload)
    expect(out).toHaveLength(0)
    parser.push(packet.subarray(10, 30), onPayload)
    expect(out).toHaveLength(0)
    parser.push(packet.subarray(30), onPayload)
    expect(out).toHaveLength(1)
    expect(Buffer.from(out[0]!).equals(payload)).toBe(true)
    expect(metas[0]?.seq).toBe(1)
    expect(metas[0]?.sampleRate).toBe(200000)
    expect(metas[0]?.centerHz).toBe(1000)
    expect(metas[0]?.format).toBe('ci16')
    expect(parser.isFramed).toBe(true)
  })

  it('多个帧头包连续解析，并统计 seq 丢包', () => {
    const parser = new IqStreamParser('ci16')
    const out: Uint8Array[] = []
    const onPayload = (p: Uint8Array): void => {
      out.push(p)
    }
    parser.push(frame(1, Buffer.from([1, 2, 3, 4])), onPayload)
    parser.push(frame(3, Buffer.from([5, 6, 7, 8])), onPayload)
    expect(out).toHaveLength(2)
    expect(parser.packetCount).toBe(2)
    expect(parser.droppedPackets).toBe(1)
  })

  it('以 ELIQ 开头但头部非法时回退为裸流', () => {
    const parser = new IqStreamParser('ci16')
    const out: Uint8Array[] = []
    const bad = Buffer.alloc(48, 0)
    bad.write('ELIQ', 0, 'ascii')
    bad.writeUInt8(9, 4) // version 非法
    parser.push(Buffer.concat([bad, Buffer.alloc(8, 1)]), (p) => out.push(p))
    expect(parser.isFramed).toBe(false)
    expect(out).toHaveLength(1)
  })

  it('帧头格式原样交给下游（格式校验由 TcpIqSource 负责）', () => {
    const parser = new IqStreamParser('ci16')
    let called = 0
    let format = ''
    parser.push(
      frame(1, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), { formatCode: 0 }), // cf32
      (_p, meta) => {
        called++
        format = meta?.format ?? ''
      }
    )
    expect(called).toBe(1)
    expect(format).toBe('cf32')
    expect(parser.packetCount).toBe(1)
  })

  it('双流：msgType=1/4 分别计数，元数据带 msgType', () => {
    const parser = new IqStreamParser('ci16')
    const types: number[] = []
    parser.push(frame(1, Buffer.from([1, 2, 3, 4]), { msgType: 1, sampleRate: 120000 }), (_p, m) =>
      types.push(m?.msgType ?? 0)
    )
    parser.push(frame(2, Buffer.from([5, 6, 7, 8]), { msgType: 4, sampleRate: 60000 }), (_p, m) =>
      types.push(m?.msgType ?? 0)
    )
    expect(types).toEqual([1, 4])
    expect(parser.packetCount).toBe(2)
    expect(parser.rawPacketCount).toBe(1)
    expect(parser.displayPacketCount).toBe(1)
    expect(parser.metadata?.sampleRate).toBe(60000)
    expect(parser.droppedPackets).toBe(0)
  })

  it('reset 后重新识别裸流', () => {
    const parser = new IqStreamParser('ci16')
    parser.push(frame(1, Buffer.from([1, 2, 3, 4])), () => {})
    expect(parser.isFramed).toBe(true)
    parser.reset()
    expect(parser.isFramed).toBe(false)
    expect(parser.packetCount).toBe(0)
  })
})
