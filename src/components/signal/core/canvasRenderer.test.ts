import { describe, expect, it } from 'vitest'
import { createCanvasLineRenderer } from './canvasRenderer'

/**
 * Canvas2D 降级后端：node 环境没有真实 canvas，用记录型桩验证
 * 坐标映射、裁剪、散点/折线分支与清屏。
 */
interface Rec {
  op: string
  args: unknown[]
}

function makeRenderer(
  opts: {
    cssW?: number
    cssH?: number
    w?: number
    h?: number
    noContext?: boolean
  } = {}
): {
  renderer: ReturnType<typeof createCanvasLineRenderer>
  recs: Rec[]
  ctx: CanvasRenderingContext2D
} {
  const recs: Rec[] = []
  const push =
    (op: string) =>
    (...args: unknown[]): void => {
      recs.push({ op, args })
    }
  const ctx = {
    save: push('save'),
    restore: push('restore'),
    setTransform: push('setTransform'),
    beginPath: push('beginPath'),
    rect: push('rect'),
    clip: push('clip'),
    clearRect: push('clearRect'),
    moveTo: push('moveTo'),
    lineTo: push('lineTo'),
    arc: push('arc'),
    stroke: push('stroke'),
    fill: push('fill'),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: ''
  } as unknown as CanvasRenderingContext2D

  const canvas = {
    width: opts.w ?? 200,
    height: opts.h ?? 200,
    clientWidth: opts.cssW ?? 100,
    clientHeight: opts.cssH ?? 100,
    getContext: (kind: string) => (kind === '2d' && !opts.noContext ? ctx : null)
  } as unknown as HTMLCanvasElement

  return { renderer: createCanvasLineRenderer(canvas), recs, ctx }
}

const PLOT = { x: 0, y: 0, w: 100, h: 100 }

describe('Canvas2D 折线渲染器（WebGL2 降级后端）', () => {
  it('空数据不产生任何绘制调用', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array(0))
    renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', true, PLOT)
    expect(recs).toEqual([])
  })

  it('按「背板像素 ÷ CSS 尺寸」设置变换（轴层对齐依赖它）', () => {
    const { renderer, recs } = makeRenderer({ cssW: 100, cssH: 50, w: 200, h: 200 })
    renderer.setData(new Float32Array([0]))
    renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', false, PLOT)
    const t = recs.find((r) => r.op === 'setTransform')
    expect(t?.args).toEqual([2, 0, 0, 4, 0, 0])
  })

  it('折线模式：数据域线性映射到绘图区，y 轴上下翻转', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array([-1, 0, 1]))
    renderer.draw({ xMin: 0, xMax: 2, yMin: -1, yMax: 1 }, '#fff', false, PLOT)
    expect(recs.filter((r) => r.op === 'moveTo')[0]?.args).toEqual([0, 100])
    const lineTos = recs.filter((r) => r.op === 'lineTo').map((r) => r.args)
    expect(lineTos).toEqual([
      [50, 50],
      [100, 0]
    ])
    expect(recs.some((r) => r.op === 'stroke')).toBe(true)
    expect(recs.some((r) => r.op === 'fill')).toBe(false)
  })

  it('散点模式（pointSize > 0）逐点画圆并填充，不画折线', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array([-1, 1]))
    renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', false, PLOT, false, 4)
    const arcs = recs.filter((r) => r.op === 'arc')
    expect(arcs).toHaveLength(2)
    expect(arcs[0]?.args[2]).toBe(2) // 半径 = pointSize / 2
    expect(arcs[0]?.args[0]).toBe(0)
    expect(arcs[0]?.args[1]).toBe(100)
    expect(arcs[1]?.args[1]).toBe(0)
    expect(recs.some((r) => r.op === 'stroke')).toBe(false)
  })

  it('clear=true 时先清空绘图区；clear=false 不清', () => {
    const a = makeRenderer()
    a.renderer.setData(new Float32Array([0]))
    a.renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', true, PLOT)
    expect(a.recs.filter((r) => r.op === 'clearRect')[0]?.args).toEqual([0, 0, 100, 100])

    const b = makeRenderer()
    b.renderer.setData(new Float32Array([0]))
    b.renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', false, PLOT)
    expect(b.recs.some((r) => r.op === 'clearRect')).toBe(false)
  })

  it('零跨度视口（x/y 上下限相等）退化为全幅映射，不产生 NaN', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array([-1, 0, 1]))
    renderer.draw({ xMin: 5, xMax: 5, yMin: 0, yMax: 0 }, '#fff', false, PLOT)
    const xs = recs.filter((r) => r.op === 'moveTo' || r.op === 'lineTo').map((r) => r.args[0])
    expect(xs).toEqual([0, 50, 100])
    for (const r of recs) for (const a of r.args) expect(Number.isNaN(a as number)).toBe(false)
  })

  it('绘图区始终先被 rect+clip 约束，避免折线溢出到轴区', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array([0, 1]))
    renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', false, PLOT)
    expect(recs.filter((r) => r.op === 'rect')[0]?.args).toEqual([0, 0, 100, 100])
    const clipIdx = recs.findIndex((r) => r.op === 'clip')
    const strokeIdx = recs.findIndex((r) => r.op === 'stroke')
    expect(clipIdx).toBeGreaterThan(-1)
    expect(strokeIdx).toBeGreaterThan(clipIdx)
  })

  it('拿不到 2d 上下文时静默跳过（不抛错，保持与 LineRenderer 接口一致）', () => {
    const { renderer, recs } = makeRenderer({ noContext: true })
    renderer.setData(new Float32Array([0, 1]))
    expect(() =>
      renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', true, PLOT)
    ).not.toThrow()
    expect(recs).toEqual([])
  })

  it('dispose 后数据清空，再画不产生调用', () => {
    const { renderer, recs } = makeRenderer()
    renderer.setData(new Float32Array([0, 1]))
    renderer.dispose()
    renderer.draw({ xMin: 0, xMax: 1, yMin: -1, yMax: 1 }, '#fff', true, PLOT)
    expect(recs).toEqual([])
  })
})
