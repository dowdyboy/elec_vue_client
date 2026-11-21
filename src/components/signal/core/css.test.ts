import { describe, expect, it } from 'vitest'
import { cssSize } from './css'

describe('cssSize：尺寸 prop → CSS 值', () => {
  it('数字补 px', () => {
    expect(cssSize(320, '100%')).toBe('320px')
    expect(cssSize(0, '100%')).toBe('0px') // 0 是合法尺寸，不能当"未传"
  })

  it('字符串原样返回（flex/grid 宿主常用）', () => {
    expect(cssSize('100%', 'auto')).toBe('100%')
    expect(cssSize('calc(100% - 8px)', 'auto')).toBe('calc(100% - 8px)')
    expect(cssSize('auto', '1px')).toBe('auto')
  })

  it('未传/空串回退默认值', () => {
    expect(cssSize(undefined, '320px')).toBe('320px')
    expect(cssSize(null, '240px')).toBe('240px')
    expect(cssSize('', '200px')).toBe('200px')
  })
})
