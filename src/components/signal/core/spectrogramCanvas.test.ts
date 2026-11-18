import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpectrogramCanvasRenderer } from './spectrogramCanvas'

// Canvas2D 降级路径依赖 ImageData / 离屏 canvas：node 环境用最小桩验证裁剪窗口
class FakeImageData {
  data: Uint8ClampedArray
  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

interface DrawCall {
  args: unknown[]
}

function makeCtx(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = []
  const ctx = {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    imageSmoothingEnabled: false,
    drawImage: (...args: unknown[]) => {
      calls.push({ args })
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('时频 Canvas2D 降级：频率窗口裁剪', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('freqEnd 按闭区间处理：全带宽画满 cols 列（不少最后一列）', () => {
    vi.stubGlobal('ImageData', FakeImageData)
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData: () => {} }) })
    })
    const cols = 8
    const rows = [new Float32Array(cols)]
    const { ctx, calls } = makeCtx()
    const renderer = new SpectrogramCanvasRenderer()
    renderer.render(ctx, {
      plot: { x: 0, y: 0, w: 100, h: 50 },
      dpr: 1,
      rows,
      cols,
      lut32: new Uint32Array(256),
      min: -120,
      max: 0,
      gamma: 1,
      freqStart: 0,
      freqEnd: cols - 1,
      interpolation: 'nearest'
    })
    expect(calls.length).toBe(1)
    expect(calls[0]!.args[1]).toBe(0) // sx
    expect(calls[0]!.args[3]).toBe(cols) // sw = freqEnd + 1
  })
  it('局部窗口宽度 = freqEnd - freqStart + 1', () => {
    vi.stubGlobal('ImageData', FakeImageData)
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData: () => {} }) })
    })
    const cols = 16
    const rows = [new Float32Array(cols)]
    const { ctx, calls } = makeCtx()
    const renderer = new SpectrogramCanvasRenderer()
    renderer.render(ctx, {
      plot: { x: 0, y: 0, w: 100, h: 50 },
      dpr: 1,
      rows,
      cols,
      lut32: new Uint32Array(256),
      min: -120,
      max: 0,
      gamma: 1,
      freqStart: 2,
      freqEnd: 6,
      interpolation: 'nearest'
    })
    expect(calls[0]!.args[1]).toBe(2)
    expect(calls[0]!.args[3]).toBe(5) // 6 - 2 + 1
  })
})
