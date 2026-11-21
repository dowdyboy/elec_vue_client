import { describe, expect, it, vi } from 'vitest'
import { createProgram, createShader, hexToRgba, withAlpha } from './gl'

/** 颜色解析：主题预置与 chartStyle 覆盖都会走这里，解析错会画成错色且很难发现 */
describe('hexToRgba：颜色解析', () => {
  it('#rrggbb', () => {
    expect(hexToRgba('#ff0000')).toEqual([1, 0, 0, 1])
    expect(hexToRgba('#0000ff')).toEqual([0, 0, 1, 1])
    expect(hexToRgba('#122436')).toEqual([0x12 / 255, 0x24 / 255, 0x36 / 255, 1])
  })

  it('#rgb 简写按半字节翻倍', () => {
    expect(hexToRgba('#fff')).toEqual([1, 1, 1, 1])
    expect(hexToRgba('#0f0')).toEqual([0, 1, 0, 1])
    expect(hexToRgba('#abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255, 1])
  })

  it('#rrggbbaa 带 alpha', () => {
    expect(hexToRgba('#ff000080')).toEqual([1, 0, 0, 0x80 / 255])
    expect(hexToRgba('#11223344')).toEqual([0x11 / 255, 0x22 / 255, 0x33 / 255, 0x44 / 255])
  })

  it('#rgba 简写按半字节翻倍（修复前会退化成默认青色）', () => {
    expect(hexToRgba('#1234')).toEqual([0x11 / 255, 0x22 / 255, 0x33 / 255, 0x44 / 255])
    expect(hexToRgba('#f00f')).toEqual([1, 0, 0, 1])
  })

  it('rgb()/rgba() 函数式写法', () => {
    expect(hexToRgba('rgb(255,128,0)')).toEqual([1, 0x80 / 255, 0, 1])
    expect(hexToRgba('rgba(0,0,0,0.25)')).toEqual([0, 0, 0, 0.25])
    expect(hexToRgba('RGBA( 10 , 20 , 30 , 0.5 )')).toEqual([10 / 255, 20 / 255, 30 / 255, 0.5])
  })

  it('两端空白容错', () => {
    expect(hexToRgba('  #00ff00  ')).toEqual([0, 1, 0, 1])
  })

  it('无法识别时回退青色（绘制代码拿到的永远不是 undefined）', () => {
    expect(hexToRgba('red')).toEqual([0, 1, 1, 1])
    expect(hexToRgba('')).toEqual([0, 1, 1, 1])
    expect(hexToRgba('#12345')).toEqual([0, 1, 1, 1]) // 长度非法的 hex
    expect(hexToRgba('hsl(0,100%,50%)')).toEqual([0, 1, 1, 1])
  })
})

describe('withAlpha：颜色 + 透明度 → rgba() 字符串', () => {
  it('从 hex 转换并保留原色的 RGB 分量', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)')
    expect(withAlpha('#fff', 1)).toBe('rgba(255,255,255,1)')
    expect(withAlpha('#123456', 0)).toBe('rgba(18,52,86,0)')
  })

  it('输入本来就是 rgba() 时，透明度以第二个参数为准', () => {
    expect(withAlpha('rgba(0,0,0,0.2)', 0.8)).toBe('rgba(0,0,0,0.8)')
  })
})

/** 着色器/程序错误路径：这两个函数是 WebGL 初始化唯一会 throw 的地方 */
function makeGl(overrides: Record<string, unknown> = {}): {
  gl: WebGL2RenderingContext
  mocks: Record<string, ReturnType<typeof vi.fn>>
} {
  const mocks: Record<string, ReturnType<typeof vi.fn>> = {
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'compile-error'),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => 'link-error'),
    deleteProgram: vi.fn()
  }
  Object.assign(mocks, overrides)
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ...mocks
  } as unknown as WebGL2RenderingContext
  return { gl, mocks }
}

describe('createShader / createProgram：编译与链接的错误路径', () => {
  it('createShader 创建失败立即抛错', () => {
    const { gl } = makeGl({ createShader: vi.fn(() => null) })
    expect(() => createShader(gl, gl.VERTEX_SHADER, 'void main(){}')).toThrow('createShader failed')
  })

  it('编译失败时抛出带 info log 的错误并释放 shader', () => {
    const { gl, mocks } = makeGl({ getShaderParameter: vi.fn(() => false) })
    expect(() => createShader(gl, gl.VERTEX_SHADER, 'bad')).toThrow('Shader compile: compile-error')
    expect(mocks.deleteShader).toHaveBeenCalledTimes(1)
  })

  it('链接失败时抛出错误并删除 program', () => {
    const { gl, mocks } = makeGl({ getProgramParameter: vi.fn(() => false) })
    expect(() => createProgram(gl, 'vs', 'fs')).toThrow('Program link: link-error')
    expect(mocks.deleteProgram).toHaveBeenCalledTimes(1)
  })

  it('成功时 attach 两个 shader，链接后释放 shader 对象', () => {
    const { gl, mocks } = makeGl()
    const prog = createProgram(gl, 'vs', 'fs')
    expect(prog).toBeTruthy()
    expect(mocks.createShader).toHaveBeenCalledTimes(2)
    expect(mocks.attachShader).toHaveBeenCalledTimes(2)
    expect(mocks.linkProgram).toHaveBeenCalledWith(prog)
    expect(mocks.deleteShader).toHaveBeenCalledTimes(2)
    expect(mocks.deleteProgram).not.toHaveBeenCalled()
  })

  it('createProgram 返回 null 时抛错', () => {
    const { gl } = makeGl({ createProgram: vi.fn(() => null) })
    expect(() => createProgram(gl, 'vs', 'fs')).toThrow('createProgram failed')
  })
})
