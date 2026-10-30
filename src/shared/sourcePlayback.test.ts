import { describe, expect, it } from 'vitest'
import { SourcePlayback } from './sourcePlayback'
import type { SourceFrame } from './sourceEngine'

function frame(seq: number): SourceFrame {
  return {
    seq,
    timestamp: seq,
    sampleRate: 4096,
    centerFrequencyHz: 512,
    outputMode: 'complex',
    waveform: 'cw',
    modType: 'sine',
    samplesPerSymbol: 16,
    amplitude: 1,
    data: new Float32Array([seq, 0])
  }
}

describe('SourcePlayback', () => {
  it('顺序回放并循环', () => {
    const p = new SourcePlayback([frame(1), frame(2)], { loop: true })
    p.start()
    expect(p.next()?.seq).toBe(1)
    expect(p.next()?.seq).toBe(2)
    expect(p.next()?.seq).toBe(1)
    p.stop()
    expect(p.next()).toBeNull()
  })

  it('不循环时到末尾停止', () => {
    const p = new SourcePlayback([frame(1)], { loop: false })
    p.start()
    expect(p.next()?.seq).toBe(1)
    expect(p.next()).toBeNull()
    expect(p.getStatus().playing).toBe(false)
  })

  it('拒绝空回放', () => {
    expect(() => new SourcePlayback([])).toThrow(/at least one/)
  })
})
