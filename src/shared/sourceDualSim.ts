/** 应用内双通道合成源：不依赖 GNU Radio 的 RX0/RX1 演示数据。 */
export interface DualSimConfig {
  sampleRate: number
  pointsPerFrame: number
  /** RX0 单音频率 Hz */
  freq0: number
  /** RX1 单音频率 Hz */
  freq1: number
  amplitude0: number
  amplitude1: number
  /** RX1 相对 RX0 的相位差（度） */
  phaseDeg: number
  /** AWGN 信噪比 dB（两路共用） */
  snr: number
}

export interface DualSimResult {
  ok: boolean
  error?: string
  value?: DualSimConfig
}

export function defaultDualSimConfig(): DualSimConfig {
  return {
    sampleRate: 100_000,
    pointsPerFrame: 2048,
    freq0: 10_000,
    freq1: 15_000,
    amplitude0: 0.5,
    amplitude1: 0.35,
    phaseDeg: 30,
    snr: 35
  }
}

export function sanitizeDualSimConfig(raw: unknown): DualSimResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: '双通道模拟配置必须为对象' }
  const src = raw as Record<string, unknown>
  const base = defaultDualSimConfig()
  const num = (key: keyof DualSimConfig, min: number, max: number): number => {
    const v = typeof src[key] === 'number' ? (src[key] as number) : base[key]
    if (!Number.isFinite(v)) return base[key]
    return Math.max(min, Math.min(max, Math.trunc(v)))
  }
  const sampleRate = num('sampleRate', 1000, 20_000_000)
  const pointsPerFrame = num('pointsPerFrame', 64, 65_536)
  const freq0 = num('freq0', 0, Math.max(1, Math.floor(sampleRate / 2) - 1))
  const freq1 = num('freq1', 0, Math.max(1, Math.floor(sampleRate / 2) - 1))
  const amp = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
    return Math.max(0.01, Math.min(1, n))
  }
  const amplitude0 = amp(src.amplitude0, base.amplitude0)
  const amplitude1 = amp(src.amplitude1, base.amplitude1)
  const phaseRaw = Number(src.phaseDeg ?? base.phaseDeg)
  const phaseDeg = Number.isFinite(phaseRaw)
    ? Math.max(-180, Math.min(180, phaseRaw))
    : base.phaseDeg
  const snrRaw = Number(src.snr ?? base.snr)
  const snr = Number.isFinite(snrRaw) ? Math.max(0, Math.min(80, snrRaw)) : base.snr
  return {
    ok: true,
    value: {
      sampleRate,
      pointsPerFrame,
      freq0,
      freq1,
      amplitude0,
      amplitude1,
      phaseDeg,
      snr
    }
  }
}
