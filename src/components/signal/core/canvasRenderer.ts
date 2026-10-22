/**
 * Canvas2D 折线渲染器（WebGL2 不可用/被禁用时的降级后端）
 *
 * 与 `gl.ts` 的 `LineRenderer` 同接口：
 * - 输入为已抽稀的 Float32Array（索引即 x 轴数据域）
 * - `draw(viewport, color, clear, plotRect, noBlend, pointSize, lineWidth)`
 * - `plotRect` 使用 CSS px；内部按「背板像素 ÷ CSS 尺寸」设置变换，保证与轴层对齐
 *
 * 性能：适合默认 minmax 抽稀后的 ~2×像素宽点数；`decimation:false` 的 2M 点不建议走此后端。
 */
import type { LineRenderer } from './gl'

export function createCanvasLineRenderer(canvas: HTMLCanvasElement): LineRenderer {
  const ctx = canvas.getContext('2d')
  let data: Float32Array = new Float32Array(0)

  return {
    gl: null,
    setData(d: Float32Array): void {
      data = d
    },
    draw(
      viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
      color: string,
      clear = false,
      plotRect?: { x: number; y: number; w: number; h: number },
      _noBlend = false,
      pointSize = 0,
      lineWidth = 1
    ): void {
      if (!ctx) return
      // Canvas2D 没有“禁用混合直写”的等价语义：折线本身按 source-over 合成，
      // 冻结帧由组件停止绘制来保证幂等；这里显式消费参数以满足统一接口。
      void _noBlend
      const n = data.length
      if (n === 0) return
      const cssW = canvas.clientWidth || canvas.width
      const cssH = canvas.clientHeight || canvas.height
      const sx = canvas.width / Math.max(1, cssW)
      const sy = canvas.height / Math.max(1, cssH)
      const plot = plotRect ?? { x: 0, y: 0, w: cssW, h: cssH }
      const xRange = viewport.xMax - viewport.xMin
      const yRange = viewport.yMax - viewport.yMin
      const toX = (idx: number): number =>
        plot.x +
        (xRange < 1e-9 ? idx / Math.max(1, n - 1) : (idx - viewport.xMin) / xRange) * plot.w
      const toY = (v: number): number =>
        plot.y + plot.h - (yRange < 1e-9 ? (v + 1) / 2 : (v - viewport.yMin) / yRange) * plot.h

      ctx.save()
      ctx.setTransform(sx, 0, 0, sy, 0, 0)
      ctx.beginPath()
      ctx.rect(plot.x, plot.y, plot.w, plot.h)
      ctx.clip()
      if (clear) {
        ctx.clearRect(plot.x, plot.y, plot.w, plot.h)
      }
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = Math.max(1, lineWidth)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (pointSize > 0) {
        const r = Math.max(0.5, pointSize / 2)
        for (let i = 0; i < n; i++) {
          const x = toX(i)
          const y = toY(data[i]!)
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const x = toX(i)
          const y = toY(data[i]!)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.restore()
    },
    dispose(): void {
      data = new Float32Array(0)
    }
  }
}
