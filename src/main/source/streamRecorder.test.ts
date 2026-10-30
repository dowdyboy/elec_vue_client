import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SourceFrame } from '../../shared/sourceEngine'
import { SourceStreamRecorder } from './streamRecorder'

function frame(seq: number): SourceFrame {
  return {
    seq,
    timestamp: seq * 10,
    sampleRate: 4096,
    centerFrequencyHz: 512,
    outputMode: 'complex',
    waveform: 'cw',
    modType: 'sine',
    samplesPerSymbol: 16,
    amplitude: 1,
    data: new Float32Array(16).fill(seq)
  }
}

describe('SourceStreamRecorder', () => {
  it('按段写入并拼接导出', async () => {
    const r = new SourceStreamRecorder({ segmentBytes: 128 })
    const target = path.join(os.tmpdir(), `dsh-stream-${Date.now()}.f32`)
    r.start()
    for (let i = 1; i <= 4; i++) r.push(frame(i))
    await r.stop()
    const status = r.getStatus()
    expect(status.frames).toBe(4)
    expect(status.samples).toBe(32)
    await r.copyTo(target)
    const stat = await fs.stat(target)
    expect(stat.size).toBe(4 * 16 * 4)
    await fs.unlink(target).catch(() => {})
    r.dispose()
  })

  it('超过待写上限时截断', async () => {
    const r = new SourceStreamRecorder({ maxPendingBytes: 1 })
    r.start()
    r.push(frame(1))
    expect(r.getStatus().truncated).toBe(true)
    expect(r.getStatus().frames).toBe(0)
    await r.stop()
    r.dispose()
  })
})
