import { describe, it, expect } from 'vitest'
import { translate } from './i18n'

describe('i18n 文案解析', () => {
  it('默认中文', () => {
    expect(translate(undefined, undefined, 'iq.axisY')).toBe('幅度')
    expect(translate('zh-CN', undefined, 'spectrum.legendClear')).toBe('实时')
  })

  it('en-US 内置英文', () => {
    expect(translate('en-US', undefined, 'iq.axisY')).toBe('Amplitude')
    expect(translate('en-US', undefined, 'spectrum.legendMaxHold')).toBe('Max hold')
  })

  it('messages 覆盖优先于 locale', () => {
    expect(translate('en-US', { 'common.stale': 'Offline' }, 'common.stale')).toBe('Offline')
    expect(translate('zh-CN', { 'iq.statusLocked': '已同步' }, 'iq.statusLocked')).toBe('已同步')
  })

  it('{name} 插值', () => {
    expect(translate('en-US', undefined, 'iq.windowSamples', { n: 42 })).toBe('Window 42 samples')
    expect(translate('en-US', undefined, 'spectrum.axisYDb', { unit: 'dBFS' })).toBe(
      'Amplitude (dBFS)'
    )
    expect(translate('zh-CN', undefined, 'spectrum.limitFail', { n: 3 })).toBe('限制超限 ×3')
  })

  it('未知 key 原样返回（运行时自定义 key 的兜底）', () => {
    expect(translate('en-US', undefined, 'custom.unknown' as never)).toBe('custom.unknown')
  })
})
