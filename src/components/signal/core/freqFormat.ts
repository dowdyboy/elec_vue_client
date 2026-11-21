/**
 * 坐标轴刻度/读数的格式化（纯函数，无 DOM/组件依赖）
 *
 * 从 SpectrumChart 抽出：频率刻度要按"步长量级"统一选 Hz/kHz/MHz，
 * 且小数位必须由步长决定（否则同屏刻度会出现 0.1/0.15 两种精度）。
 * 这类规则用单测钉住，比在 3000 行组件里靠肉眼看刻度便宜得多。
 */

/** 去掉定点小数尾部的 0（并按步长量级自动定小数位） */
export function trimZeros(v: number, step: number): string {
  const dec = Math.min(6, Math.max(0, Math.ceil(-Math.log10(Math.max(Math.abs(step), 1e-12)))))
  const s = v.toFixed(dec)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** 频率刻度单位倍率：按"步长"选，保证整屏刻度用同一个单位 */
export function freqUnitScale(stepHz: number): number {
  const a = Math.abs(stepHz)
  return a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1
}

export function freqUnitName(stepHz: number): string {
  const a = Math.abs(stepHz)
  return a >= 1e6 ? 'MHz' : a >= 1e3 ? 'kHz' : 'Hz'
}

/** 刻度标签：值 + 单位（单位由步长决定，整屏一致） */
export function fmtFreqStep(hz: number, stepHz: number): string {
  return `${trimZeros(hz / freqUnitScale(stepHz), stepHz / freqUnitScale(stepHz))} ${freqUnitName(stepHz)}`
}

/**
 * 单点频率读数：单位按"值"的绝对量级选（读数关注可读性，不要求与刻度同单位）。
 * 注意与 fmtFreqStep 的分工：读数是 `1.234 GHz` 这种，刻度是整屏统一单位。
 */
export function fmtFreqReadout(hz: number, binHz = 1): string {
  const step = binHz > 0 ? binHz : 1
  const a = Math.abs(hz)
  const unit = a >= 1e6 ? 1e6 : a >= 1e4 ? 1e3 : 1
  return `${trimZeros(hz / unit, step / unit)} ${freqUnitName(unit)}`
}

/** 带符号数值（正数显式带 +，负号用 U+2212 与仪器面板一致） */
export function fmtSigned(v: number, decimals = 2): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(decimals)}`
}

/**
 * 由"刻度步长"反推小数位（步长越小位数越多，1~6 位）。
 * 注意入参必须是 niceStep 之后的步长，而不是"跨度 ÷ 格数"——两者取值可能不同。
 */
export function decimalsForStep(step: number): number {
  return Math.min(6, Math.max(1, Math.ceil(-Math.log10(Math.max(step, 1e-9))) + 1))
}
