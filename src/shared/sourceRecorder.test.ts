import { describe, expect, it } from 'vitest'
import { SourceEngine } from './sourceEngine'
import { SourceRecorder } from './sourceRecorder'
import { defaultAnalysisConfig } from './signal'

function engine(): SourceEngine {
  return new SourceEngine({ ...defaultAnalysisConfig(), outputMode: 'complex' }, { now: () => 1 })
}

describe('SourceRecorder', () => {
  it('录制元数据与样本统计', () => {
    const e = engine()
    const r = new SourceRecorder()
    r.start()
    expect(r.push(e.next(64))).toBe(true)
    expect(r.push(e.next(32))).toBe(true)
    r.stop()
    const s = r.getStatus()
    expect(s.recording).toBe(false)
    expect(s.frames).toBe(2)
    expect(s.samples).toBe(96)
    const frames = r.getFrames()
    expect(frames[0]?.sampleCount).toBe(64)
    expect(frames[0]?.centerFrequencyHz).toBe(512)
  })

  it('超过样本上限后截断并停止', () => {
    const e = engine()
    const r = new SourceRecorder({ maxSamples: 1024 })
    r.start()
    expect(r.push(e.next(1024))).toBe(true)
    expect(r.push(e.next(8))).toBe(false)
    expect(r.getStatus().truncated).toBe(true)
    expect(r.getStatus().recording).toBe(false)
  })

  it('未开始录制时丢弃帧', () => {
    const r = new SourceRecorder()
    expect(r.push(engine().next(8))).toBe(false)
    expect(r.getStatus().frames).toBe(0)
  })
})
