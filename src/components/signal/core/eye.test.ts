import { describe, expect, it } from 'vitest'
import { EyeBuffer, cleanEyeTrace, computeEyeStats } from './eye'

function trace(value: number, n = 64): Float32Array {
  return new Float32Array(n).fill(value)
}

describe('眼图核心', () => {
  it('眼图环形缓冲保留最近轨迹', () => {
    const b = new EyeBuffer(3)
    for (let i = 0; i < 5; i++) b.append(trace(i))
    expect(b.length).toBe(3)
    expect(Array.from(b.traces[0]!.slice(0, 2))).toEqual([2, 2])
    expect(Array.from(b.traces[2]!.slice(0, 2))).toEqual([4, 4])
  })

  it('双电平稳态轨迹给出眼高/眼宽', () => {
    const traces = [trace(-1), trace(1), trace(-1), trace(1)]
    const s = computeEyeStats(traces, 2)
    expect(s.measured).toBe(true)
    expect(s.traceCount).toBe(4)
    expect(s.height).toBeCloseTo(2, 6)
    expect(s.width).toBeCloseTo(1, 6)
    expect(s.jitter).toBe(0)
  })

  it('非有限值清洗，空输入未测量', () => {
    expect(Array.from(cleanEyeTrace([1, NaN, Infinity, -Infinity]))).toEqual([1, 0, 0, 0])
    expect(computeEyeStats([]).measured).toBe(false)
  })
})
