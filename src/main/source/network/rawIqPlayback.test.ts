import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RawIqPlayback } from './rawIqPlayback'

function ci16File(samples: Array<[number, number]>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-play-'))
  const p = path.join(dir, 'x.ci16')
  const buf = Buffer.allocUnsafe(samples.length * 4)
  samples.forEach(([i, q], k) => {
    buf.writeInt16LE(Math.round(i * 32767), k * 4)
    buf.writeInt16LE(Math.round(q * 32767), k * 4 + 2)
  })
  writeFileSync(p, buf)
  return p
}

describe('RawIqPlayback', () => {
  it('按帧读取、时间戳连续、EOF 停止', () => {
    const p = ci16File([
      [0.1, 0],
      [0.2, 0],
      [0.3, 0],
      [0.4, 0],
      [0.5, 0],
      [0.6, 0]
    ])
    const pb = new RawIqPlayback({
      path: p,
      format: 'ci16',
      sampleRate: 1000,
      centerHz: 0,
      totalSamples: 6,
      displaySampleRate: 1000,
      pointsPerFrame: 2,
      loop: false
    })
    pb.start()
    const f1 = pb.next()
    const f2 = pb.next()
    const f3 = pb.next()
    expect(f1?.data.length).toBe(4)
    expect(f1?.timestamp).toBe(0)
    expect(f2?.timestamp).toBeCloseTo(2, 6)
    expect(f3?.timestamp).toBeCloseTo(4, 6)
    expect(f1?.data[0]).toBeCloseTo(0.1, 3)
    expect(f3?.data[2]).toBeCloseTo(0.6, 3)
    expect(pb.next()).toBeNull()
    expect(pb.getStatus().playing).toBe(false)
    pb.dispose()
    rmSync(path.dirname(p), { recursive: true, force: true })
  })

  it('按 stride 抽取并循环/seek', () => {
    const p = ci16File([
      [0.1, 0],
      [0.9, 0],
      [0.2, 0],
      [0.9, 0],
      [0.3, 0],
      [0.9, 0],
      [0.4, 0],
      [0.9, 0]
    ])
    const pb = new RawIqPlayback({
      path: p,
      format: 'ci16',
      sampleRate: 1000,
      centerHz: 0,
      totalSamples: 8,
      displaySampleRate: 500,
      pointsPerFrame: 2,
      loop: true
    })
    expect(pb.getStatus().total).toBe(2)
    pb.start()
    const a = pb.next()
    const b = pb.next()
    expect(a?.data[0]).toBeCloseTo(0.1, 3)
    expect(a?.data[2]).toBeCloseTo(0.2, 3) // stride=2，取第 0、2 个样本
    expect(b?.data[0]).toBeCloseTo(0.3, 3)
    expect(b?.data[2]).toBeCloseTo(0.4, 3)
    const looped = pb.next()
    expect(looped?.data[0]).toBeCloseTo(0.1, 3)
    expect(pb.seek(1)).toBe(true)
    expect(pb.getStatus().index).toBe(1)
    pb.dispose()
    rmSync(path.dirname(p), { recursive: true, force: true })
  })

  it('双通道 raw：按 channel 选第二路', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-play-'))
    const p = path.join(dir, 'x2.ci16')
    const buf = Buffer.allocUnsafe(4 * 2 * 4) // 4 samples × 2ch × 4B
    for (let k = 0; k < 4; k++) {
      buf.writeInt16LE(Math.round((0.1 + k * 0.1) * 32767), k * 8) // ch0
      buf.writeInt16LE(0, k * 8 + 2)
      buf.writeInt16LE(Math.round((0.5 + k * 0.1) * 32767), k * 8 + 4) // ch1
      buf.writeInt16LE(0, k * 8 + 6)
    }
    writeFileSync(p, buf)
    const pb = new RawIqPlayback({
      path: p,
      format: 'ci16',
      sampleRate: 1000,
      centerHz: 0,
      totalSamples: 4,
      displaySampleRate: 1000,
      pointsPerFrame: 2,
      channels: 2,
      channel: 1,
      loop: false
    })
    pb.start()
    const f = pb.next()
    expect(f?.channel).toBe(1)
    expect(f?.data[0]).toBeCloseTo(0.5, 3)
    expect(f?.data[2]).toBeCloseTo(0.6, 3)
    pb.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('cf32/ci8 解码', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-play-'))
    const cf = path.join(dir, 'x.cf32')
    const buf = Buffer.allocUnsafe(8)
    buf.writeFloatLE(0.5, 0)
    buf.writeFloatLE(-0.25, 4)
    writeFileSync(cf, buf)
    const p1 = new RawIqPlayback({
      path: cf,
      format: 'cf32',
      sampleRate: 1000,
      centerHz: 0,
      totalSamples: 1,
      displaySampleRate: 1000,
      pointsPerFrame: 1
    })
    p1.start()
    const f = p1.next()
    expect(f?.data[0]).toBeCloseTo(0.5, 4)
    expect(f?.data[1]).toBeCloseTo(-0.25, 4)
    p1.dispose()

    const ci = path.join(dir, 'x.ci8')
    writeFileSync(ci, Buffer.from([127, -128]))
    const p2 = new RawIqPlayback({
      path: ci,
      format: 'ci8',
      sampleRate: 1000,
      centerHz: 0,
      totalSamples: 1,
      displaySampleRate: 1000,
      pointsPerFrame: 1
    })
    p2.start()
    expect(p2.next()?.data[0]).toBeCloseTo(127 / 128, 4)
    p2.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
})
