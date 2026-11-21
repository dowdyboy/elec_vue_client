import { describe, expect, it } from 'vitest'
import {
  decimalsForStep,
  fmtFreqReadout,
  fmtFreqStep,
  fmtSigned,
  freqUnitName,
  freqUnitScale,
  trimZeros
} from './freqFormat'

describe('刻度数值格式化', () => {
  it('trimZeros：按步长定小数位并去掉尾部 0', () => {
    expect(trimZeros(1, 0.5)).toBe('1') // 1.0 → 去掉尾部 0
    expect(trimZeros(1.5, 0.5)).toBe('1.5')
    expect(trimZeros(2, 1)).toBe('2') // 步长 1 → 0 位，不带小数点
    expect(trimZeros(0.1234, 0.0001)).toBe('0.1234')
    expect(trimZeros(-0.25, 0.005)).toBe('-0.25')
  })

  it('trimZeros：小数位上限 6 位、下限 0 位', () => {
    expect(trimZeros(1 / 3, 1e-12)).toBe('0.333333')
    expect(trimZeros(100, 1e9)).toBe('100')
  })

  it('频率刻度单位由步长决定（整屏统一）', () => {
    expect(freqUnitScale(2e6)).toBe(1e6)
    expect(freqUnitScale(5e3)).toBe(1e3)
    expect(freqUnitScale(50)).toBe(1)
    expect(freqUnitName(2e6)).toBe('MHz')
    expect(freqUnitName(5e3)).toBe('kHz')
    expect(freqUnitName(50)).toBe('Hz')
    // 负频率（复谱）按绝对值判断
    expect(freqUnitName(-2e6)).toBe('MHz')
  })

  it('fmtFreqStep：同一组刻度用同一单位，小数位随步长', () => {
    // 单位阈值看「步长」：2e5 < 1e6 仍走 kHz（所以是 1200 kHz，不是 1.2 MHz）
    expect(fmtFreqStep(1.2e6, 2e5)).toBe('1200 kHz')
    expect(fmtFreqStep(1.2e6, 2e6)).toBe('1 MHz') // 步长 2 个单位 → 0 位小数（整数刻度）
    expect(fmtFreqStep(2e6, 2e6)).toBe('2 MHz')
    expect(fmtFreqStep(5e3, 1e3)).toBe('5 kHz')
    expect(fmtFreqStep(300, 100)).toBe('300 Hz')
    // 复谱负频
    expect(fmtFreqStep(-1.2e6, 2e5)).toBe('-1200 kHz')
  })

  it('fmtFreqReadout：单位按读数本身量级选（与刻度可不同）', () => {
    // 内置单位只到 MHz（射频习惯），没有 GHz 档
    expect(fmtFreqReadout(1.234e9, 1e3)).toBe('1234 MHz')
    expect(fmtFreqReadout(2e4, 100)).toBe('20 kHz') // >=1e4 才切 kHz
    expect(fmtFreqReadout(900, 10)).toBe('900 Hz')
    expect(fmtFreqReadout(-2e4, 100)).toBe('-20 kHz')
  })

  it('fmtFreqReadout：binHz 非法时按 1 Hz 处理，不产生 NaN', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const s = fmtFreqReadout(1000, bad)
      expect(s).not.toContain('NaN')
    }
  })

  it('fmtSigned：正数带 +，负号用 U+2212', () => {
    expect(fmtSigned(3.14159, 2)).toBe('+3.14')
    expect(fmtSigned(-3.14159, 2)).toBe('−3.14')
    expect(fmtSigned(0, 1)).toBe('+0.0')
    expect(fmtSigned(-0.05, 1)).toBe('−0.1')
  })

  it('decimalsForStep：步长越小位数越多，钳制在 1~6', () => {
    expect(decimalsForStep(10)).toBe(1)
    expect(decimalsForStep(1)).toBe(1)
    expect(decimalsForStep(0.1)).toBe(2)
    expect(decimalsForStep(0.01)).toBe(3)
    expect(decimalsForStep(1e-9)).toBe(6) // 上限
  })
})
