import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RawIqRecorder } from './rawIqRecorder'

describe('RawIqRecorder', () => {
  it('全速写盘、状态、导出与元数据', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-test-'))
    const target = path.join(dir, 'out.ci16')
    const rec = new RawIqRecorder('ci16', 100000, 1000)
    await rec.start({ segmentBytes: 8 }) // 2 个样本一段，强制轮转
    rec.push(Buffer.from([1, 0, 2, 0]), null)
    rec.push(Buffer.from([3, 0, 4, 0]), null)
    rec.push(Buffer.from([5, 0, 6, 0]), null)
    expect(rec.getStatus().frames).toBe(3)
    expect(rec.getStatus().samples).toBe(3)
    await rec.stop()
    const status = rec.getStatus()
    expect(status.recording).toBe(false)
    expect(status.segments).toBeGreaterThanOrEqual(1)
    expect(status.hasUnexported).toBe(true)
    const out = await rec.exportTo(target)
    expect(out.bytes).toBe(12)
    expect(out.samples).toBe(3)
    expect(readFileSync(target).length).toBe(12)
    expect(existsSync(out.metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(out.metaPath, 'utf8')) as Record<string, unknown>
    expect(meta.sampleFormat).toBe('ci16')
    expect(meta.sampleRate).toBe(100000)
    expect(rec.getStatus().hasUnexported).toBe(false)
    await rec.dispose()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('双通道：samples 按每通道计，sidecar channels=2', async () => {
    const rec = new RawIqRecorder('ci16', 1000, 0, 2)
    await rec.start({ segmentBytes: 1024 * 1024 })
    rec.push(Buffer.alloc(4 * 2 * 4), null) // 4 samples/ch × 2ch
    const st = rec.getStatus()
    expect(st.channels).toBe(2)
    expect(st.samples).toBe(4)
    expect(st.bytes).toBe(32)
    await rec.stop()
    await rec.dispose()
  })

  it('滚动归档：写满段自动落到 archiveDir', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'raw-archive-test-'))
    const rec = new RawIqRecorder('ci16', 1000, 0, 2)
    await rec.start({ segmentBytes: 1024 * 1024, maxBytes: 0, archiveDir: dir })
    // 第一段 1.5 MB，第二段 0.5 MB；第二段写入会触发第一段归档
    rec.push(Buffer.alloc(1.5 * 1024 * 1024), null)
    rec.push(Buffer.alloc(0.5 * 1024 * 1024), null)
    await rec.stop()
    const st = rec.getStatus()
    expect(st.archivedFiles).toBe(1)
    expect(st.archivedBytes).toBeGreaterThan(0)
    expect(st.archiveDir).toBe(dir)
    const files = await fs.readdir(dir)
    expect(files.some((f) => f.endsWith('.ci16'))).toBe(true)
    expect(files.some((f) => f.endsWith('.json'))).toBe(true)
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8')) as {
      segments?: unknown[]
    }
    expect(index.segments?.length).toBe(1)
    await rec.dispose()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('超过 maxBytes 时截断', async () => {
    const rec = new RawIqRecorder('ci16', 1000, 0)
    await rec.start({ segmentBytes: 1024 * 1024, maxBytes: 1024 * 1024 })
    // 直接喂 2MB，超过 1MB 上限
    const chunk = Buffer.alloc(2 * 1024 * 1024)
    rec.push(chunk, null)
    const st = rec.getStatus()
    expect(st.truncated).toBe(true)
    expect(st.recording).toBe(false)
    await rec.dispose()
  })
})
