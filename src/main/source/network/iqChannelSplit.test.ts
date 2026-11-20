import { describe, expect, it } from 'vitest'
import { splitInterleaved } from './iqChannelSplit'

describe('splitInterleaved', () => {
  it('ci16 双通道按样本交错拆分', () => {
    const src = new Uint8Array(16) // 2 samples × 2 ch × 4B
    const view = new DataView(src.buffer)
    const values = [10, 11, 20, 21, 30, 31, 40, 41]
    values.forEach((v, k) => view.setInt16(k * 2, v, true))
    const [a, b] = splitInterleaved(src, 'ci16', 2)
    expect(a!.length).toBe(8)
    expect(b!.length).toBe(8)
    const va = new DataView(a!.buffer)
    const vb = new DataView(b!.buffer)
    expect(va.getInt16(0, true)).toBe(10)
    expect(va.getInt16(2, true)).toBe(11)
    expect(va.getInt16(4, true)).toBe(30)
    expect(va.getInt16(6, true)).toBe(31)
    expect(vb.getInt16(0, true)).toBe(20)
    expect(vb.getInt16(4, true)).toBe(40)
  })

  it('cf32 双通道拆分', () => {
    const src = new Uint8Array(32) // 2 samples × 2 ch × 8B
    const view = new DataView(src.buffer)
    ;[1.5, -2.5, 3.5, -4.5, 5.5, -6.5, 7.5, -8.5].forEach((v, k) => view.setFloat32(k * 4, v, true))
    const [a, b] = splitInterleaved(src, 'cf32', 2)
    const va = new DataView(a!.buffer)
    const vb = new DataView(b!.buffer)
    expect(va.getFloat32(0, true)).toBe(1.5)
    expect(va.getFloat32(8, true)).toBe(5.5)
    expect(vb.getFloat32(0, true)).toBe(3.5)
    expect(vb.getFloat32(8, true)).toBe(7.5)
  })

  it('单通道原样返回', () => {
    const src = new Uint8Array([1, 2, 3, 4])
    expect(splitInterleaved(src, 'ci16', 1)[0]).toBe(src)
  })
})
