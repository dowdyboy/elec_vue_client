import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RawArchivePlayback } from './rawArchivePlayback'

describe('RawArchivePlayback', () => {
  it('跨段 next、seek、总时长', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'archive-play-'))
    const make = (name: string, base: number): void => {
      const p = path.join(dir, name)
      const buf = Buffer.allocUnsafe(4 * 4)
      for (let k = 0; k < 4; k++) {
        buf.writeInt16LE(Math.round((base + k * 0.1) * 32767), k * 4)
        buf.writeInt16LE(0, k * 4 + 2)
      }
      writeFileSync(p, buf)
      writeFileSync(
        `${p}.json`,
        JSON.stringify({
          format: 'raw-iq-v1',
          sampleFormat: 'ci16',
          bytesPerSample: 4,
          channels: 1,
          sampleRate: 1000,
          centerHz: 0,
          bytes: 16,
          samples: 4,
          frames: 1
        })
      )
    }
    make('a.ci16', 0.1)
    make('b.ci16', 0.5)
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        version: 1,
        segments: [
          { path: path.join(dir, 'a.ci16'), metaPath: path.join(dir, 'a.ci16.json') },
          { path: path.join(dir, 'b.ci16'), metaPath: path.join(dir, 'b.ci16.json') }
        ]
      })
    )
    const pb = new RawArchivePlayback({
      dir,
      channel: 0,
      fullRate: true,
      pointsPerFrame: 2,
      loop: false
    })
    expect(pb.getStatus().total).toBe(4)
    pb.start()
    const f1 = pb.next()
    const f2 = pb.next()
    // 段边界：peek 必须切到下一段，否则 SourceService 会在边界停掉回放
    expect(pb.peek()?.data[0]).toBeCloseTo(0.5, 3)
    const f3 = pb.next()
    const f4 = pb.next()
    expect(f1?.data[0]).toBeCloseTo(0.1, 3)
    expect(f2?.data[0]).toBeCloseTo(0.3, 3)
    expect(f3?.data[0]).toBeCloseTo(0.5, 3)
    expect(f3?.timestamp).toBeCloseTo(4, 5)
    expect(f4?.data[0]).toBeCloseTo(0.7, 3)
    expect(pb.next()).toBeNull()
    pb.start()
    expect(pb.seek(2)).toBe(true)
    expect(pb.next()?.data[0]).toBeCloseTo(0.5, 3)
    pb.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
})
