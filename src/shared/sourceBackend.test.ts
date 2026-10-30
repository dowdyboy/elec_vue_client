import { describe, expect, it } from 'vitest'
import { PlaybackOutputBackend, SimulatedOutputBackend } from './sourceBackend'
import { SourceEngine } from './sourceEngine'
import { SourcePlayback } from './sourcePlayback'
import { defaultAnalysisConfig } from './signal'

describe('OutputBackend', () => {
  it('模拟后端输出指定帧长', () => {
    const engine = new SourceEngine(defaultAnalysisConfig())
    const backend = new SimulatedOutputBackend(engine, () => 64)
    const f = backend.next()
    expect(backend.kind).toBe('simulated')
    expect(f.data.length).toBe(128)
  })

  it('回放后端委托 SourcePlayback', () => {
    const engine = new SourceEngine(defaultAnalysisConfig())
    const frames = [engine.next(8), engine.next(8)]
    const playback = new SourcePlayback(frames, { loop: false })
    playback.start()
    const backend = new PlaybackOutputBackend(playback)
    expect(backend.kind).toBe('playback')
    expect(backend.next()?.seq).toBe(1)
    expect(backend.next()?.seq).toBe(2)
    expect(backend.next()).toBeNull()
  })
})
