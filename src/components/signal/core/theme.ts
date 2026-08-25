/**
 * 信号组件主题预置与解析（零依赖，可拷贝）
 * 内置 dark / light / spectrum（频谱仪经典：黑底 + 黄 I 迹 + 青 Q 迹 + 暗绿栅格）三套完整预置
 * resolveTheme：style 覆盖项 > colors 迹线对 > 预置，输出单一 ResolvedTheme
 * spectrum 为固定观感，不随系统深浅色切换；auto 按 prefersDark 取 dark/light
 */
import type { ChartStyle, Theme } from './types'

interface FullPreset {
  bg: string
  plotBg: string
  grid: string
  border: string
  text: string
  zeroLine: string
  labelChipBg: string
  traceI: string
  traceQ: string
  envColor: string
  traceAlpha: number
  axisWidth: number
  crosshair: string
}

/** 解析后的完整主题（字段全部可用，无 undefined） */
export interface ResolvedTheme {
  bg: string
  plotBg: string
  grid: string
  border: string
  text: string
  zeroLine: string
  labelChipBg: string
  traceI: string
  traceQ: string
  envColor: string
  traceAlpha: number
  axisWidth: number
  crosshair: string
  /** 容器内浮层（角标/图例）按明暗归类取文字色 */
  darkLike: boolean
}

const DARK: FullPreset = {
  bg: '#14141f',
  plotBg: 'rgba(255,255,255,0.02)',
  grid: 'rgba(139,148,158,0.18)',
  border: '#30363d',
  text: '#8b949e',
  zeroLine: 'rgba(139,148,158,0.35)',
  labelChipBg: 'rgba(15,17,21,0.72)',
  traceI: '#00bcd4',
  traceQ: '#ff4081',
  traceAlpha: 0.85,
  axisWidth: 56,
  crosshair: '#8b949e',
  envColor: '#ffa726'
}

const LIGHT: FullPreset = {
  bg: '#fafafa',
  plotBg: 'rgba(31,35,40,0.02)',
  grid: 'rgba(31,35,40,0.10)',
  border: '#d0d7de',
  text: '#57606a',
  zeroLine: 'rgba(31,35,40,0.25)',
  labelChipBg: 'rgba(255,255,255,0.78)',
  traceI: '#00bcd4',
  traceQ: '#ff4081',
  traceAlpha: 0.85,
  axisWidth: 56,
  crosshair: '#57606a',
  envColor: '#f57c00'
}

/** 频谱仪经典面板：纯黑底、暗绿栅格、亮黄/青双迹 */
const SPECTRUM: FullPreset = {
  bg: '#000000',
  // 注意：必须保持半透明 —— 轴覆盖层位于波形层之上，plotBg 每帧会重刷绘图区
  plotBg: 'rgba(0,230,118,0.04)',
  grid: 'rgba(0,230,118,0.14)',
  border: 'rgba(0,230,118,0.38)',
  text: '#7ee2a8',
  zeroLine: 'rgba(0,230,118,0.45)',
  labelChipBg: 'rgba(0,10,5,0.78)',
  traceI: '#ffd60a',
  traceQ: '#22d3ee',
  traceAlpha: 0.9,
  axisWidth: 56,
  crosshair: '#7ee2a8',
  envColor: '#ffb74d'
}

const COLOR_KEYS = [
  'bg',
  'plotBg',
  'grid',
  'border',
  'text',
  'zeroLine',
  'labelChipBg',
  'traceI',
  'traceQ',
  'envColor',
  'crosshair'
] as const

export function resolveTheme(
  theme: Theme,
  prefersDark: boolean,
  opts?: { colors?: [string, string]; style?: ChartStyle }
): ResolvedTheme {
  const base =
    theme === 'spectrum'
      ? SPECTRUM
      : theme === 'light' || (theme === 'auto' && !prefersDark)
        ? LIGHT
        : DARK
  const out: ResolvedTheme = { ...base, darkLike: base !== LIGHT }
  // colors 层：仅当调用方显式传入时覆盖预置迹线色
  if (opts?.colors) {
    if (opts.colors[0]) out.traceI = opts.colors[0]
    if (opts.colors[1]) out.traceQ = opts.colors[1]
  }
  // style 层：任意字段覆盖（最高优先级）
  const st = opts?.style
  if (st) {
    for (const k of COLOR_KEYS) {
      const v: string | undefined = st[k]
      if (v !== undefined) out[k] = v
    }
    if (st.traceAlpha !== undefined) out.traceAlpha = st.traceAlpha
    if (st.axisWidth !== undefined) out.axisWidth = Math.max(40, st.axisWidth)
  }
  return out
}
