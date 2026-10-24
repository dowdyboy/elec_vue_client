import { describe, it, expect } from 'vitest'
import {
  SpectrogramBuffer,
  colorAt,
  colorMapLut,
  levelToByte,
  lutToUint32,
  mapRowToBytes
} from './spectrogram'

describe('时频核心：色阶 LUT', () => {
  it('色阶端点与裁剪', () => {
    expect(colorAt(0, 'viridis')).toEqual([68, 1, 84])
    expect(colorAt(1, 'viridis')).toEqual([253, 231, 37])
    expect(colorAt(-1, 'turbo')).toEqual(colorAt(0, 'turbo'))
    expect(colorAt(2, 'turbo')).toEqual(colorAt(1, 'turbo'))
    expect(colorAt(Number.NaN, 'jet')).toEqual(colorAt(0, 'jet'))
  })

  it('LUT 长度/RGBA/单调端点', () => {
    const lut = colorMapLut('viridis', 256)
    expect(lut.length).toBe(256 * 4)
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([68, 1, 84, 255])
    expect([lut[1020], lut[1021], lut[1022], lut[1023]]).toEqual([253, 231, 37, 255])
    const u32 = lutToUint32(lut)
    expect(u32.length).toBe(256)
    const bytes = new Uint8Array(u32.buffer)
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(lut.subarray(0, 4)))
  })
})

describe('时频核心：电平映射', () => {
  it('范围/边界/gamma/NaN', () => {
    expect(levelToByte(-120, -120, 0)).toBe(0)
    expect(levelToByte(0, -120, 0)).toBe(255)
    expect(levelToByte(-60, -120, 0)).toBe(128)
    expect(levelToByte(10, -120, 0)).toBe(255)
    expect(levelToByte(Number.NaN, -120, 0)).toBe(0)
    expect(levelToByte(-60, -120, 0, 2)).toBeGreaterThan(128) // 提亮
    expect(levelToByte(-60, -120, 0, 0.5)).toBeLessThan(128) // 压暗
  })

  it('整行映射复用输出', () => {
    const row = new Float32Array([-120, -60, 0])
    const out = new Uint8Array(3)
    const ret = mapRowToBytes(row, -120, 0, 1, out)
    expect(ret).toBe(out)
    expect(Array.from(out)).toEqual([0, 128, 255])
  })
})

describe('时频核心：环形缓冲', () => {
  const row = (v: number): Float32Array => new Float32Array([v, v + 1, v + 2])

  it('追加/换行/最新顺序/容量', () => {
    const b = new SpectrogramBuffer(3)
    b.push(row(1))
    b.push(row(2))
    b.push(row(3))
    expect(b.count).toBe(3)
    expect(Array.from(b.rowAt(0)!)).toEqual([3, 4, 5])
    expect(Array.from(b.rowAt(2)!)).toEqual([1, 2, 3])
    b.push(row(4)) // 覆盖最老
    expect(b.count).toBe(3)
    expect(Array.from(b.rowAt(0)!)).toEqual([4, 5, 6])
    expect(Array.from(b.rowAt(2)!)).toEqual([2, 3, 4])
    expect(b.newestSlot()).toBe((b.seq - 1) % b.capacity)
  })

  it('行长变化拒绝；配置列数重置', () => {
    const b = new SpectrogramBuffer(4)
    expect(b.push(new Float32Array([1, 2]))).toBe(true)
    expect(b.push(new Float32Array([1, 2, 3]))).toBe(false)
    expect(b.cols).toBe(2)
    b.configure(4, 4)
    expect(b.count).toBe(0)
    expect(b.cols).toBe(4)
  })

  it('容量缩小时保留最新行', () => {
    const b = new SpectrogramBuffer(5)
    for (let i = 0; i < 5; i++) b.push(row(i))
    b.configure(3, 2)
    expect(b.count).toBe(2)
    expect(Array.from(b.rowAt(0)!)).toEqual([4, 5, 6])
    expect(Array.from(b.rowAt(1)!)).toEqual([3, 4, 5])
  })

  it('冻结拷贝按 newest→oldest', () => {
    const b = new SpectrogramBuffer(3)
    for (let i = 0; i < 4; i++) b.push(new Float32Array([i]))
    const rows = b.copyRows(2)
    expect(rows.map((r) => r[0])).toEqual([3, 2])
    // 拷贝与内部脱离
    rows[0]![0] = 99
    expect(b.rowAt(0)![0]).toBe(3)
  })
})
