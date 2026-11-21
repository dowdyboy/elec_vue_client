import { describe, expect, it } from 'vitest'
import { createConstellationCanvasRenderer } from './constellationCanvas'

interface Rec {
  op: string
  args: unknown[]
}

function makeSetup(opts: { cssW?: number; cssH?: number; noContext?: boolean } = {}): {
  canvas: HTMLCanvasElement
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
    fillRect: push('fillRect'),
    globalAlpha: 1,
    fillStyle: ''
  } as unknown as CanvasRenderingContext2D
  const canvas = {
    width: 200,
    height: 200,
    clientWidth: opts.cssW ?? 100,
    clientHeight: opts.cssH ?? 100,
    getContext: (kind: string) => (kind === '2d' && !opts.noContext ? ctx : null)
  } as unknown as HTMLCanvasElement
  return { canvas, recs, ctx }
}

const PLOT = { x: 0, y: 0, w: 100, h: 100 }
const UNIT = { min: -1, max: 1 }

describe('Canvas2D 星座散点渲染器（WebGL2 降级后端）', () => {
  it('拿不到 2d 上下文时直接抛错（构造期就失败，便于组件回退）', () => {
    const { canvas } = makeSetup({ noContext: true })
    expect(() => createConstellationCanvasRenderer(canvas)).toThrow('Canvas2D not supported')
  })

  it('每帧先整幅清屏，再按绘图区裁剪', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    r.setData(new Float32Array([0]), new Float32Array([0]))
    r.draw(UNIT, UNIT, '#0ff', 1, 2, PLOT)
    expect(recs.filter((o) => o.op === 'clearRect')[0]?.args).toEqual([0, 0, 200, 200])
    expect(recs.filter((o) => o.op === 'rect')[0]?.args).toEqual([0, 0, 100, 100])
    expect(recs.some((o) => o.op === 'clip')).toBe(true)
  })

  it('I/Q 线性映射：中心点落在绘图区中心，Q 轴向上为正', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    r.setData(new Float32Array([0]), new Float32Array([0]))
    r.draw(UNIT, UNIT, '#0ff', 1, 1, PLOT)
    const f = recs.filter((o) => o.op === 'fillRect')[0]
    expect(f?.args).toEqual([49.5, 49.5, 1, 1])

    // Q = +1（顶部）与 Q = -1（底部）；fillRect 传左上角，故中心 ± half
    const up = makeSetup()
    const r2 = createConstellationCanvasRenderer(up.canvas)
    r2.setData(new Float32Array([0, 0]), new Float32Array([1, -1]))
    r2.draw(UNIT, UNIT, '#0ff', 1, 1, PLOT)
    const f2 = up.recs.filter((o) => o.op === 'fillRect')
    expect(f2[0]?.args[1]).toBe(-0.5)
    expect(f2[1]?.args[1]).toBe(99.5)
  })

  it('超出绘图区的点被剔除（只画可视范围，避免大点数拖慢）', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    // i = 0（可视）、i = 10（远在右侧，剔除）、q = 10（远在上方，剔除）
    r.setData(new Float32Array([0, 10, 0]), new Float32Array([0, 0, 10]))
    r.draw(UNIT, UNIT, '#0ff', 1, 1, PLOT)
    expect(recs.filter((o) => o.op === 'fillRect')).toHaveLength(1)
  })

  it('I/Q 长度不一致时按较短长度绘制', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    r.setData(new Float32Array([0, 0, 0]), new Float32Array([0]))
    r.draw(UNIT, UNIT, '#0ff', 1, 1, PLOT)
    expect(recs.filter((o) => o.op === 'fillRect')).toHaveLength(1)
  })

  it('alpha 钳制到 [0,1]', () => {
    const over = makeSetup()
    const r1 = createConstellationCanvasRenderer(over.canvas)
    r1.setData(new Float32Array([0]), new Float32Array([0]))
    r1.draw(UNIT, UNIT, '#0ff', 5, 1, PLOT)
    expect(over.ctx.globalAlpha).toBe(1)

    const under = makeSetup()
    const r2 = createConstellationCanvasRenderer(under.canvas)
    r2.setData(new Float32Array([0]), new Float32Array([0]))
    r2.draw(UNIT, UNIT, '#0ff', -3, 1, PLOT)
    expect(under.ctx.globalAlpha).toBe(0)
  })

  it('跨度非正或绘图区为空时不画点（防除零）', () => {
    const zeroSpan = makeSetup()
    const r1 = createConstellationCanvasRenderer(zeroSpan.canvas)
    r1.setData(new Float32Array([0]), new Float32Array([0]))
    r1.draw({ min: 1, max: 1 }, UNIT, '#0ff', 1, 1, PLOT)
    expect(zeroSpan.recs.some((o) => o.op === 'fillRect')).toBe(false)

    const emptyPlot = makeSetup()
    const r2 = createConstellationCanvasRenderer(emptyPlot.canvas)
    r2.setData(new Float32Array([0]), new Float32Array([0]))
    r2.draw(UNIT, UNIT, '#0ff', 1, 1, { x: 0, y: 0, w: 0, h: 100 })
    expect(emptyPlot.recs.some((o) => o.op === 'fillRect')).toBe(false)
  })

  it('点尺寸最小为 1px（pointSize 传 0 或负数时）', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    r.setData(new Float32Array([0]), new Float32Array([0]))
    r.draw(UNIT, UNIT, '#0ff', 1, 0, PLOT)
    expect(recs.filter((o) => o.op === 'fillRect')[0]?.args[2]).toBe(1)
  })

  it('dispose 后清空数据，再画无 fillRect', () => {
    const { canvas, recs } = makeSetup()
    const r = createConstellationCanvasRenderer(canvas)
    r.setData(new Float32Array([0]), new Float32Array([0]))
    r.dispose()
    r.draw(UNIT, UNIT, '#0ff', 1, 1, PLOT)
    expect(recs.some((o) => o.op === 'fillRect')).toBe(false)
  })
})
