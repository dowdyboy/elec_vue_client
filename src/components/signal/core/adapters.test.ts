import { describe, it, expect } from 'vitest'
import {
  fromArrayBuffer,
  iqAdapters,
  spectrumAdapters,
  createIqAdapter,
  createSpectrumAdapter,
  toFloat32Samples
} from './adapters'

describe('adapters 对齐与类型守卫', () => {
  it('ArrayBuffer 长度不是 4 的倍数时返回 null（不再抛 RangeError）', () => {
    expect(fromArrayBuffer(new ArrayBuffer(6))).toBeNull()
  })

  it('非 4 对齐的 Uint8Array 视图：先拷贝到对齐缓冲，数值正确', () => {
    const bytes = new Uint8Array(16)
    const f = new Float32Array([1.5, -2.25])
    bytes.set(new Uint8Array(f.buffer), 1) // 起点 byteOffset = 1
    const view = new Uint8Array(bytes.buffer, 1, 8)
    expect(Array.from(fromArrayBuffer(view)!)).toEqual([1.5, -2.25])
  })

  it('Int16Array 不再被静默 reinterpret 成 float32', () => {
    expect(iqAdapters.arrayBuffer(new Int16Array([1, 2, 3, 4]))).toBeNull()
  })

  it('Float32Array / ArrayBuffer / 交织 JSON 正常路径不受影响', () => {
    const f = new Float32Array([1, 2, 3, 4])
    expect(iqAdapters.passthrough(f)).toBe(f)
    const ab = f.buffer.slice(0)
    expect(Array.from(iqAdapters.arrayBuffer(ab)!)).toEqual([1, 2, 3, 4])
    expect(iqAdapters.jsonInterleaved({ data: [1, 2, 3, 4] })!.length).toBe(4)
    expect(iqAdapters.jsonInterleaved({ i: [1, 2], q: [3, 4] })).toEqual({
      i: expect.any(Float32Array),
      q: expect.any(Float32Array)
    })
  })

  it('base64 长度非 4 倍数时返回 null', () => {
    // 5 字节 base64
    expect(iqAdapters.base64({ data: btoa('hello') })).toBeNull()
  })
})

describe('int16 / float64 / 工厂适配器', () => {
  it('int16 交织 Int16Array：按 1/32768 归一化', () => {
    const raw = new Int16Array([32767, -32768, 16384, 0])
    const out = iqAdapters.int16Interleaved(raw) as Float32Array
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(32767 / 32768, 6)
    expect(out[1]).toBeCloseTo(-1, 6)
    expect(out[2]).toBeCloseTo(0.5, 6)
    expect(out[3]).toBe(0)
  })

  it('int16 交织 ArrayBuffer（小端）解码正确', () => {
    const src = new Int16Array([100, -100, 200, -200])
    const out = iqAdapters.int16Interleaved(src.buffer) as Float32Array
    expect(out[0]).toBeCloseTo(100 / 32768, 6)
    expect(out[1]).toBeCloseTo(-100 / 32768, 6)
    expect(out[2]).toBeCloseTo(200 / 32768, 6)
    expect(out[3]).toBeCloseTo(-200 / 32768, 6)
  })

  it('int16 平面 {i,q} 与自定义 scale/offset', () => {
    const out = iqAdapters.int16Planar({
      i: new Int16Array([32767, 0]),
      q: new Int16Array([0, -32768])
    }) as { i: Float32Array; q: Float32Array }
    expect(out.i[0]).toBeCloseTo(32767 / 32768, 6)
    expect(out.i[1]).toBe(0)
    expect(out.q[0]).toBe(0)
    expect(out.q[1]).toBe(-1)

    const custom = createIqAdapter({ dtype: 'int16', scale: 1 / 100, offset: 10 })
    const v = custom(new Int16Array([100, -100])) as Float32Array
    expect(v[0]).toBeCloseTo(11, 6)
    expect(v[1]).toBeCloseTo(9, 6)
  })

  it('float64 交织', () => {
    const out = iqAdapters.float64Interleaved(new Float64Array([1.5, -2.5, 3, -4])) as Float32Array
    expect(Array.from(out)).toEqual([1.5, -2.5, 3, -4])
  })

  it('大端 int16 字节流', () => {
    const dv = new DataView(new ArrayBuffer(4))
    dv.setInt16(0, 1, false)
    dv.setInt16(2, -1, false)
    const out = toFloat32Samples(dv, 'int16', 'be')!
    expect(Array.from(out)).toEqual([1, -1])
  })

  it('频谱 uint8 → dB 映射与 int16 scale', () => {
    const u8 = spectrumAdapters.uint8(new Uint8Array([0, 127, 255]))!
    expect(u8[0]).toBe(-120)
    expect(u8[2]).toBe(0)
    expect(u8[1]).toBeCloseTo((127 * 120) / 255 - 120, 4)

    const i16 = spectrumAdapters.int16(new Int16Array([-1000, 0, 100]))!
    expect(i16[0]).toBeCloseTo(-10, 6)
    expect(i16[1]).toBe(0)
    expect(i16[2]).toBeCloseTo(1, 6)

    const custom = createSpectrumAdapter({ dtype: 'uint8', min: -100, max: 0 })
    expect(custom(new Uint8Array([255]))![0]).toBe(0)
  })
})
