/**
 * 场景预设（源 + 分析 + 工作台显示选项）的纯数据层。
 *
 * - 不依赖 Electron/DOM，便于单测；
 * - 存储在 localStorage 时只保存校验后的结构；
 * - 导入/导出共用同一校验逻辑，避免坏 JSON 污染工作台。
 */
import { sanitizeConfigPatch, type SignalAnalysisConfig } from './signal'

export const SOURCE_PRESET_VERSION = 1
export const SOURCE_PRESET_STORAGE_KEY = 'sig-source-presets-v1'

/** 源输出域字段（与 SourceService 的配置边界一致） */
export const SOURCE_PRESET_KEYS = [
  'waveform',
  'modType',
  'outputMode',
  'freq',
  'amplitude',
  'snr',
  'sampleRate',
  'pointsPerFrame',
  'samplesPerSymbol',
  'modFreq',
  'amDepth',
  'fmDeviation',
  'pulsePeriod',
  'pulseDuty',
  'toneSpacing',
  'ofdmSubcarriers',
  'ofdmCpRatio',
  'enabled',
  'imageDb'
] as const satisfies ReadonlyArray<keyof SignalAnalysisConfig>

/** 分析参数（FFT/窗/dB/重叠/频谱语义） */
export const ANALYSIS_PRESET_KEYS = [
  'fftSize',
  'window',
  'dbScale',
  'overlap',
  'spectrumMode'
] as const satisfies ReadonlyArray<keyof SignalAnalysisConfig>

export type SourcePresetSource = Pick<SignalAnalysisConfig, (typeof SOURCE_PRESET_KEYS)[number]>
export type SourcePresetAnalysis = Pick<SignalAnalysisConfig, (typeof ANALYSIS_PRESET_KEYS)[number]>

export interface SourcePresetUi {
  /** 源工作台频谱预览模式（分析配置无关） */
  previewSpectrum?: 'auto' | 'real' | 'complex'
}

export interface SourcePreset {
  version: typeof SOURCE_PRESET_VERSION
  name: string
  createdAt: string
  source: SourcePresetSource
  analysis: SourcePresetAnalysis
  ui: SourcePresetUi
}

export type SourcePresetValidation =
  { ok: true; value: SourcePreset } | { ok: false; error: string }

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const key of keys) out[key] = obj[key]
  return out
}

export function buildSourcePreset(
  name: string,
  config: SignalAnalysisConfig,
  ui: SourcePresetUi = {},
  createdAt = new Date().toISOString()
): SourcePreset {
  return {
    version: SOURCE_PRESET_VERSION,
    name: name.trim().slice(0, 64) || '未命名预设',
    createdAt,
    source: pick(config, SOURCE_PRESET_KEYS),
    analysis: pick(config, ANALYSIS_PRESET_KEYS),
    ui: { ...ui }
  }
}

/** 预设中源 + 分析字段合并成一份可直接下发的配置补丁 */
export function presetToConfig(preset: SourcePreset): Partial<SignalAnalysisConfig> {
  return { ...preset.source, ...preset.analysis }
}

/** 校验任意 JSON（localStorage / 导入文件）→ 规范化预设 */
export function validateSourcePreset(raw: unknown): SourcePresetValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: '预设必须是对象' }
  const obj = raw as Record<string, unknown>
  if (obj.version !== SOURCE_PRESET_VERSION)
    return { ok: false, error: `预设版本不受支持: ${String(obj.version)}` }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0)
    return { ok: false, error: '预设名称不能为空' }
  if (!obj.source || typeof obj.source !== 'object' || Array.isArray(obj.source))
    return { ok: false, error: '预设缺少 source' }
  if (!obj.analysis || typeof obj.analysis !== 'object' || Array.isArray(obj.analysis))
    return { ok: false, error: '预设缺少 analysis' }

  const sourceRaw = obj.source as Record<string, unknown>
  const analysisRaw = obj.analysis as Record<string, unknown>
  for (const key of SOURCE_PRESET_KEYS) {
    if (!(key in sourceRaw)) return { ok: false, error: `预设 source 缺少 ${key}` }
  }
  for (const key of ANALYSIS_PRESET_KEYS) {
    if (!(key in analysisRaw)) return { ok: false, error: `预设 analysis 缺少 ${key}` }
  }

  const clean = sanitizeConfigPatch({ ...sourceRaw, ...analysisRaw })
  if (!clean.ok || !clean.value) return { ok: false, error: clean.error ?? '配置校验失败' }
  for (const key of [...SOURCE_PRESET_KEYS, ...ANALYSIS_PRESET_KEYS]) {
    if (!(key in clean.value)) return { ok: false, error: `配置字段校验失败: ${key}` }
  }

  const uiRaw = (obj.ui ?? {}) as Record<string, unknown>
  const preview = uiRaw.previewSpectrum
  const ui: SourcePresetUi = {}
  if (preview === 'auto' || preview === 'real' || preview === 'complex')
    ui.previewSpectrum = preview

  return {
    ok: true,
    value: {
      version: SOURCE_PRESET_VERSION,
      name: obj.name.trim().slice(0, 64),
      createdAt:
        typeof obj.createdAt === 'string' && obj.createdAt
          ? obj.createdAt
          : new Date().toISOString(),
      // 上面已逐字段确认存在；sanitizeConfigPatch 的返回类型是 Partial，这里收窄为完整配置
      source: pick(clean.value as SignalAnalysisConfig, SOURCE_PRESET_KEYS),
      analysis: pick(clean.value as SignalAnalysisConfig, ANALYSIS_PRESET_KEYS),
      ui
    }
  }
}

/** 校验预设集合（localStorage 读取）：坏条目跳过，返回可用集合与错误数 */
export function validatePresetMap(raw: unknown): {
  presets: Record<string, SourcePreset>
  invalid: number
} {
  const presets: Record<string, SourcePreset> = {}
  let invalid = 0
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { presets, invalid: 1 }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const r = validateSourcePreset(value)
    if (!r.ok) {
      invalid++
      continue
    }
    presets[name] = r.value
  }
  return { presets, invalid }
}

export function serializePresets(presets: Record<string, SourcePreset>): string {
  return JSON.stringify({ version: SOURCE_PRESET_VERSION, presets }, null, 2)
}

export function parsePresets(text: string): {
  ok: boolean
  presets?: Record<string, SourcePreset>
  error?: string
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'JSON 解析失败' }
  }
  const container =
    raw && typeof raw === 'object' && !Array.isArray(raw) && 'presets' in (raw as object)
      ? (raw as { presets: unknown }).presets
      : raw
  const { presets, invalid } = validatePresetMap(container)
  if (Object.keys(presets).length === 0)
    return { ok: false, error: invalid > 0 ? '没有可用的预设（字段校验失败）' : '没有预设' }
  return { ok: true, presets }
}
