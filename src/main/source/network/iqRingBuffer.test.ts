import { describe, expect, it } from 'vitest'
import { IqRingBuffer } from './iqRingBuffer'

function ci16(samples: Array<[number, number]>): Uint8Array {
  const buf = Buffer.allocUnsafe(samples.length * 4)
  samples.forEach(([i, q], k) => {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(i * 32767))), k * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(q * 32767))), k * 4 + 2)
  })
  return buf
}

function cf32(samples: Array<[number, number]>): Uint8Array {
  const buf = Buffer.allocUnsafe(samples.length * 8)
  samples.forEach(([i, q], k) => {
    buf.writeFloatLE(i, k * 8)
    buf.writeFloatLE(q, k * 8 + 4)
  })
  return buf
}

describe('IqRingBuffer', () => {
  it('按 stride 抽取并消费样本', () => {
    const ring = new IqRingBuffer(32, 'ci16')
    ring.push(
      ci16([
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
        [0.7, 0.8]
      ])
    )
    expect(ring.availableSamples).toBe(4)
    const a = ring.read(2, 1)
    expect(a).not.toBeNull()
    expect(a![0]).toBeCloseTo(0.1, 4)
    expect(a![1]).toBeCloseTo(0.2, 4)
    expect(a![2]).toBeCloseTo(0.3, 4)
    expect(ring.availableSamples).toBe(2)

    ring.push(
      ci16([
        [0.9, 1.0],
        [1.1, 1.2]
      ])
    )
    const b = ring.read(2, 2)
    expect(b).not.toBeNull()
    // stride=2：取第 1、3 个样本（0.5、0.9）
    expect(b![0]).toBeCloseTo(0.5, 4)
    expect(b![2]).toBeCloseTo(0.9, 4)
    expect(ring.availableSamples).toBe(0)
  })

  it('容量不足时丢弃最旧样本并计数', () => {
    const ring = new IqRingBuffer(16, 'ci16') // 4 个样本
    ring.push(
      ci16([
        [0.1, 0],
        [0.2, 0],
        [0.3, 0],
        [0.4, 0],
        [0.5, 0],
        [0.6, 0]
      ])
    )
    expect(ring.droppedSamples).toBe(2)
    expect(ring.availableSamples).toBe(4)
    const out = ring.read(4, 1)
    expect(out).not.toBeNull()
    expect(out![0]).toBeCloseTo(0.3, 4)
    expect(out![6]).toBeCloseTo(0.6, 4)
  })

  it('cf32 环形回绕读取正确', () => {
    const ring = new IqRingBuffer(24, 'cf32') // 3 个样本
    ring.push(
      cf32([
        [1, 2],
        [3, 4]
      ])
    )
    expect(ring.read(1, 1)![0]).toBeCloseTo(1)
    ring.push(
      cf32([
        [5, 6],
        [7, 8]
      ])
    )
    // 此时缓冲里有 [3,4] [5,6] [7,8]，回绕写入
    const out = ring.read(3, 1)
    expect(out).not.toBeNull()
    expect(out![0]).toBeCloseTo(3)
    expect(out![2]).toBeCloseTo(5)
    expect(out![4]).toBeCloseTo(7)
  })

  it('数据不足时返回 null 且不消费', () => {
    const ring = new IqRingBuffer(32, 'ci16')
    ring.push(ci16([[1, 0]]))
    expect(ring.read(2, 1)).toBeNull()
    expect(ring.availableSamples).toBe(1)
  })

  it('ci8 归一化到 ±1', () => {
    const ring = new IqRingBuffer(16, 'ci8')
    const buf = Buffer.from([127, -128, 64, 0])
    ring.push(buf)
    const out = ring.read(2, 1)
    expect(out).not.toBeNull()
    expect(out![0]).toBeCloseTo(127 / 128, 4)
    expect(out![1]).toBeCloseTo(-1, 4)
    expect(out![2]).toBeCloseTo(0.5, 4)
  })
})
