import { describe, expect, it } from 'vitest'
import { KeyboardArbiter } from './keyboardFocus'

describe('KeyboardArbiter（多图键盘仲裁）', () => {
  it('只有最后认领的实例响应键盘', () => {
    const a = new KeyboardArbiter()
    const b = new KeyboardArbiter()
    expect(a.active).toBe(false)
    expect(b.active).toBe(false)
    a.claim()
    expect(a.active).toBe(true)
    expect(b.active).toBe(false)
    b.claim()
    expect(b.active).toBe(true)
    expect(a.active).toBe(false)
  })

  it('重复认领保持幂等', () => {
    const e = new KeyboardArbiter()
    e.claim()
    e.claim()
    expect(e.active).toBe(true)
  })
})
