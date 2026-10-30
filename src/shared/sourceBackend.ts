/**
 * OutputBackend：源输出后端的统一适配层。
 * 当前提供模拟源与录制回放两个实现；硬件 RF/DAC 后端后续按同一接口接入。
 */
import type { SourceEngine, SourceFrame } from './sourceEngine'
import type { SourcePlayback } from './sourcePlayback'

export type SourceBackendKind = 'simulated' | 'playback'

export interface SourceOutputBackend {
  readonly kind: SourceBackendKind
  next(): SourceFrame | null
}

export class SimulatedOutputBackend implements SourceOutputBackend {
  readonly kind = 'simulated' as const

  constructor(
    private readonly engine: SourceEngine,
    private readonly pointsPerFrame: () => number
  ) {}

  next(): SourceFrame {
    return this.engine.next(Math.max(1, Math.floor(this.pointsPerFrame())))
  }
}

export class PlaybackOutputBackend implements SourceOutputBackend {
  readonly kind = 'playback' as const

  constructor(private readonly playback: SourcePlayback) {}

  next(): SourceFrame | null {
    return this.playback.next()
  }
}
