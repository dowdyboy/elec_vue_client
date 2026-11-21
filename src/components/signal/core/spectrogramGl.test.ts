import { describe, expect, it, vi } from 'vitest'
import { SpectrogramGlRenderer, type GlRenderParams } from './spectrogramGl'

/**
 * 瀑布 GL 渲染器：node 环境没有 WebGL，用记录型桩验证
 * 纹理（re）分配策略、环形 slot 上传、y 翻转视口与统一变量下发。
 * 这些逻辑错一位就会表现为「瀑布上下颠倒/整屏静止」，而肉眼很难定位。
 */
interface UniformCall {
  name: string
  value: number
}

function makeGl(canvasH = 300): {
  gl: WebGL2RenderingContext
  unis: UniformCall[]
  calls: { op: string; args: unknown[] }[]
  count: (op: string) => number
} {
  const calls: { op: string; args: unknown[] }[] = []
  const unis: UniformCall[] = []
  const rec =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args })
    }
  const locOf = (name: string): { name: string } => ({ name })

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    R8: 0x8229,
    RGBA8: 0x8058,
    RED: 0x1903,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_ALIGNMENT: 0x0cf5,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    BLEND: 0x0be2,
    TRIANGLE_STRIP: 0x0005,
    drawingBufferHeight: canvasH,
    createShader: vi.fn(() => ({})),
    shaderSource: rec('shaderSource'),
    compileShader: rec('compileShader'),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: rec('deleteShader'),
    createProgram: vi.fn(() => ({})),
    attachShader: rec('attachShader'),
    linkProgram: rec('linkProgram'),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: rec('deleteProgram'),
    createVertexArray: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    bindVertexArray: rec('bindVertexArray'),
    bindBuffer: rec('bindBuffer'),
    bufferData: rec('bufferData'),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: rec('enableVertexAttribArray'),
    vertexAttribPointer: rec('vertexAttribPointer'),
    getUniformLocation: vi.fn((_p: unknown, name: string) => locOf(name)),
    uniform1i: vi.fn((loc: { name: string }, v: number) => unis.push({ name: loc.name, value: v })),
    uniform1f: vi.fn((loc: { name: string }, v: number) => unis.push({ name: loc.name, value: v })),
    pixelStorei: rec('pixelStorei'),
    createTexture: vi.fn(() => ({})),
    deleteTexture: rec('deleteTexture'),
    bindTexture: rec('bindTexture'),
    texParameteri: rec('texParameteri'),
    texImage2D: rec('texImage2D'),
    texSubImage2D: rec('texSubImage2D'),
    useProgram: rec('useProgram'),
    activeTexture: rec('activeTexture'),
    viewport: rec('viewport'),
    disable: rec('disable'),
    drawArrays: rec('drawArrays'),
    deleteBuffer: rec('deleteBuffer'),
    deleteVertexArray: rec('deleteVertexArray')
  } as unknown as WebGL2RenderingContext

  return {
    gl,
    unis,
    calls,
    count: (op: string) => calls.filter((c) => c.op === op).length
  }
}

const PARAMS: GlRenderParams = {
  plot: { x: 10, y: 20, w: 100, h: 50 },
  dpr: 2,
  rows: [],
  cols: 8,
  lut32: new Uint32Array(256),
  min: -120,
  max: 0,
  gamma: 1,
  freqStart: 0,
  freqEnd: 7,
  interpolation: 'nearest'
}

describe('瀑布 GL 渲染器', () => {
  it('构造时创建 program/VAO/VBO，并上传 4 个顶点（TRIANGLE_STRIP 全屏四边形）', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    expect(r).toBeTruthy()
    const buf = calls.find((c) => c.op === 'bufferData')
    expect((buf?.args[1] as Float32Array).length).toBe(8) // 4 顶点 × 2 分量
  })

  it('configure：列数/容量不变时不重建纹理（避免每帧 realloc）', () => {
    const { gl, count } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    const afterFirst = count('texImage2D')
    r.configure(8, 32)
    expect(count('texImage2D')).toBe(afterFirst)
    r.configure(16, 32)
    expect(count('texImage2D')).toBe(afterFirst + 1)
    expect(count('deleteTexture')).toBe(1) // 旧纹理先删
  })

  it('configure：非整数/0 列被规整为 ≥1', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(0, 0)
    const tex = calls.filter((c) => c.op === 'texImage2D')[0]
    expect(tex?.args[3]).toBe(1) // width
    expect(tex?.args[4]).toBe(1) // height
  })

  it('setInterpolation：只在模式变化时改纹理参数，且 MIN/MAG 同步', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    const before = calls.filter((c) => c.op === 'texParameteri').length
    r.setInterpolation('linear')
    const after = calls.filter((c) => c.op === 'texParameteri').length
    expect(after - before).toBe(2)
    r.setInterpolation('linear') // 同一模式：不再下发
    expect(calls.filter((c) => c.op === 'texParameteri').length).toBe(after)
  })

  it('setLut：按 length/4 作为宽度上传 RGBA8，空 LUT 直接忽略', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.setLut(new Uint8ClampedArray(0))
    expect(calls.some((c) => c.op === 'texImage2D')).toBe(false)
    r.setLut(new Uint8ClampedArray(256 * 4))
    const tex = calls.filter((c) => c.op === 'texImage2D')[0]
    expect(tex?.args[3]).toBe(256)
    expect(tex?.args[4]).toBe(1)
  })

  it('uploadRow：y = slot（环形行号），宽度取 min(bytes, cols)', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    r.uploadRow(5, new Uint8Array(8))
    let sub = calls.filter((c) => c.op === 'texSubImage2D')[0]
    expect(sub?.args[3]).toBe(5) // y
    expect(sub?.args[4]).toBe(8) // width

    r.uploadRow(6, new Uint8Array(20))
    sub = calls.filter((c) => c.op === 'texSubImage2D')[1]
    expect(sub?.args[4]).toBe(8) // 超出 cols 被裁到 8
  })

  it('uploadRow：非法 slot / 未 configure 时静默丢弃', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.uploadRow(0, new Uint8Array(8)) // 还没 configure（无纹理）
    expect(calls.some((c) => c.op === 'texSubImage2D')).toBe(false)

    r.configure(8, 32)
    r.uploadRow(-1, new Uint8Array(8))
    r.uploadRow(32, new Uint8Array(8))
    r.uploadRow(1.5, new Uint8Array(8))
    expect(calls.some((c) => c.op === 'texSubImage2D')).toBe(false)
  })

  it('render：视口做 y 翻转并按 dpr 缩放（绘图区上下位置不能反）', () => {
    const { gl, calls } = makeGl(300)
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    r.setLut(new Uint8ClampedArray(256 * 4))
    r.render({ ...PARAMS, count: 4, capacity: 32, newest: 3 })
    const vp = calls.filter((c) => c.op === 'viewport')[0]
    // x=10*2=20, y=300-(20+50)*2=160, w=100*2=200, h=50*2=100
    expect(vp?.args).toEqual([20, 160, 200, 100])
  })

  it('render：无数据（count<=0）时只设置视口，不下发绘制', () => {
    const { gl, count } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    r.setLut(new Uint8ClampedArray(256 * 4))
    r.render({ ...PARAMS, count: 0, capacity: 32, newest: 0 })
    expect(count('viewport')).toBe(1)
    expect(count('drawArrays')).toBe(0)
    expect(count('useProgram')).toBe(0)
  })

  it('render：统一变量逐个下发，绘制后复位活动纹理单元', () => {
    const { gl, unis, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    r.setLut(new Uint8ClampedArray(256 * 4))
    r.render({ ...PARAMS, count: 4, capacity: 32, newest: 3 })
    const get = (name: string): number | undefined => unis.find((u) => u.name === name)?.value
    expect(get('uCapacity')).toBe(32)
    expect(get('uNewest')).toBe(3)
    expect(get('uCount')).toBe(4)
    expect(get('uCols')).toBe(8)
    expect(get('uFreqStart')).toBe(0)
    expect(get('uFreqEnd')).toBe(7)
    expect(calls.filter((c) => c.op === 'drawArrays')[0]?.args).toEqual([gl.TRIANGLE_STRIP, 0, 4])
    const active = calls.filter((c) => c.op === 'activeTexture').map((c) => c.args[0])
    expect(active[active.length - 1]).toBe(gl.TEXTURE0) // 复位
  })

  it('render：绘图区宽高至少 1px（缩到看不见时不传 0 给 viewport）', () => {
    const { gl, calls } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.render({
      ...PARAMS,
      plot: { x: 0, y: 0, w: 0, h: 0 },
      count: 1,
      capacity: 8,
      newest: 0
    })
    const vp = calls.filter((c) => c.op === 'viewport')[0]
    expect(vp?.args[2]).toBe(1)
    expect(vp?.args[3]).toBe(1)
  })

  it('dispose：释放纹理/缓冲/VAO/program，重复调用不抛错', () => {
    const { gl, count } = makeGl()
    const r = new SpectrogramGlRenderer(gl)
    r.configure(8, 32)
    r.setLut(new Uint8ClampedArray(256 * 4))
    r.dispose()
    expect(count('deleteTexture')).toBe(2)
    expect(count('deleteBuffer')).toBe(1)
    expect(count('deleteVertexArray')).toBe(1)
    expect(count('deleteProgram')).toBe(1)
    expect(() => r.dispose()).not.toThrow() // 已置空，再来一次不应重复删除
    expect(count('deleteTexture')).toBe(2)
  })
})
