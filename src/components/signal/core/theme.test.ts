import { describe, expect, it } from 'vitest'
import { resolveTheme, type ResolvedTheme } from './theme'
import type { Theme } from './types'

const THEMES: Theme[] = ['dark', 'light', 'spectrum', 'auto']

describe('主题预置与解析', () => {
  it('四套主题 × 明暗系统下都返回完整字段（无 undefined）', () => {
    for (const theme of THEMES) {
      for (const prefersDark of [true, false]) {
        const r = resolveTheme(theme, prefersDark)
        for (const [field, value] of Object.entries(r) as [keyof ResolvedTheme, unknown][]) {
          // 任何一个字段漏填都会让绘制代码拿到 undefined（颜色字符串拼成 'undefined'）
          expect(value, `${theme}/prefersDark=${prefersDark} 的 ${field}`).not.toBeUndefined()
        }
        expect(Array.isArray(r.tracePalette)).toBe(true)
        expect(r.tracePalette.length).toBeGreaterThan(0)
        expect(typeof r.traceAlpha).toBe('number')
        expect(r.axisWidth).toBeGreaterThanOrEqual(40)
      }
    }
  })

  it('auto 按系统深浅色取自己的预置，darkLike 同步', () => {
    expect(resolveTheme('auto', true).bg).toBe(resolveTheme('dark', true).bg)
    expect(resolveTheme('auto', false).bg).toBe(resolveTheme('light', false).bg)
    expect(resolveTheme('auto', true).darkLike).toBe(true)
    expect(resolveTheme('auto', false).darkLike).toBe(false)
    expect(resolveTheme('dark', false).darkLike).toBe(true) // 显式 dark 不受系统影响
    expect(resolveTheme('light', true).darkLike).toBe(false)
  })

  it('spectrum 是固定观感：不随系统深浅色切换', () => {
    const a = resolveTheme('spectrum', true)
    const b = resolveTheme('spectrum', false)
    expect(a).toEqual(b)
    expect(a.bg).toBe('#000000')
    expect(a.darkLike).toBe(true)
    // 三套预置的 bg 互不相同（防止预置被改串）
    const bgs = new Set(['dark', 'light', 'spectrum'].map((t) => resolveTheme(t as Theme, true).bg))
    expect(bgs.size).toBe(3)
  })

  it('优先级：style > colors > 预置', () => {
    const preset = resolveTheme('dark', true)
    const withColors = resolveTheme('dark', true, { colors: ['#111111', '#222222'] })
    expect(withColors.traceI).toBe('#111111')
    expect(withColors.traceQ).toBe('#222222')
    expect(withColors.bg).toBe(preset.bg) // 未覆盖的字段保持预置

    const withStyle = resolveTheme('dark', true, {
      colors: ['#111111', '#222222'],
      style: { traceI: '#333333' }
    })
    expect(withStyle.traceI).toBe('#333333')
    expect(withStyle.traceQ).toBe('#222222')
  })

  it('style 的数值项：axisWidth 下限 40、traceAlpha 原样、空 palette 不覆盖', () => {
    expect(resolveTheme('dark', true, { style: { axisWidth: 10 } }).axisWidth).toBe(40)
    expect(resolveTheme('dark', true, { style: { axisWidth: 72 } }).axisWidth).toBe(72)
    expect(resolveTheme('dark', true, { style: { traceAlpha: 0 } }).traceAlpha).toBe(0)
    const preset = resolveTheme('dark', true)
    expect(resolveTheme('dark', true, { style: { tracePalette: [] } }).tracePalette).toEqual(
      preset.tracePalette
    )
    expect(resolveTheme('dark', true, { style: { tracePalette: ['#abc'] } }).tracePalette).toEqual([
      '#abc'
    ])
  })

  it('colors 里的空字符串不覆盖预置（避免误传空值把迹线画成透明）', () => {
    const preset = resolveTheme('dark', true)
    const r = resolveTheme('dark', true, { colors: ['', ''] })
    expect(r.traceI).toBe(preset.traceI)
    expect(r.traceQ).toBe(preset.traceQ)
  })

  it('style 只覆盖颜色/数值字段，不污染 darkLike 判定', () => {
    const r = resolveTheme('light', true, { style: { bg: '#101010' } })
    expect(r.bg).toBe('#101010')
    expect(r.darkLike).toBe(false) // 仍按预置归类，浮层文字色不被单字段覆盖影响
  })
})
