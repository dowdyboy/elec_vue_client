import { describe, expect, it } from 'vitest'
import {
  iqToAmplitude,
  iqToEyeTraces,
  iqToPowerDb,
  linearToDb,
  spectrumToBins
} from './sourceAdapters'

describe('源帧 → 分析组件适配', () => {
  it('功率与幅度', () => {
    const iq = new Float32Array([1, 0, 0.5, 0, 0, 0])
    expect(iqToPowerDb(iq)).toEqual(new Float32Array([0, -6.0206, -120]))
    expect(iqToAmplitude(iq)).toEqual(new Float32Array([1, 0.5, 0]))
  })

  it('眼图轨迹按 sps 切窗，限制数量', () => {
    const iq = new Float32Array(64 * 2)
    for (let i = 0; i < 64; i++) iq[2 * i] = i
    const traces = iqToEyeTraces(iq, 16, 2, 2)
    expect(traces).toHaveLength(2)
    expect(traces[0]).toHaveLength(32)
    expect(traces[0]?.[0]).toBe(0)
    expect(traces[1]?.[0]).toBe(32)
  })

  it('非法奇数长度报错', () => {
    expect(() => iqToPowerDb(new Float32Array(3))).toThrow(/even/)
    expect(() => iqToAmplitude(new Float32Array(3))).toThrow(/even/)
    expect(() => iqToEyeTraces(new Float32Array(3), 4)).toThrow(/even/)
  })

  it('频谱重采样到固定 bins', () => {
    const src = new Float32Array([-10, -20, -30, -40])
    expect(Array.from(spectrumToBins(src, 2))).toEqual([-15, -35])
    expect(Array.from(spectrumToBins(new Float32Array([-20]), 3))).toEqual([-20, -20, -20])
  })

  it('线性幅度转 dB', () => {
    const db = linearToDb(new Float32Array([1, 0.5, 0]))
    expect(db[0]).toBe(0)
    expect(db[1]).toBeCloseTo(-6.0206, 4)
    expect(db[2]).toBe(-120)
  })
})
