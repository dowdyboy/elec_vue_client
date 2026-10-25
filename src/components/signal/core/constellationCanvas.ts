/**
 * Canvas2D 星座散点渲染器（WebGL2 不可用/被强制禁用时的降级后端）
 * - 与 WebGL Points 使用相同的 viewport/xRange/yRange/plotRect 语义
 * - 逐点 fillRect，避免 3 万点级别的 arc 路径开销
 */
export interface ConstellationCanvasRenderer {
  setData(i: Float32Array, q: Float32Array): void
  draw(
    xRange: { min: number; max: number },
    yRange: { min: number; max: number },
    color: string,
    alpha: number,
    pointSize: number,
    plotRect?: { x: number; y: number; w: number; h: number }
  ): void
  clear(): void
  dispose(): void
}

export function createConstellationCanvasRenderer(
  canvas: HTMLCanvasElement
): ConstellationCanvasRenderer {
  const ctxMaybe = canvas.getContext('2d')
  if (!ctxMaybe) throw new Error('Canvas2D not supported')
  const ctx: CanvasRenderingContext2D = ctxMaybe
  let iData: Float32Array = new Float32Array(0)
  let qData: Float32Array = new Float32Array(0)

  function clear(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  return {
    setData(i, q) {
      iData = i
      qData = q
    },
    clear,
    draw(xRange, yRange, color, alpha, pointSize, plotRect) {
      clear()
      const n = Math.min(iData.length, qData.length)
      if (n === 0) return
      const cssW = canvas.clientWidth || canvas.width
      const cssH = canvas.clientHeight || canvas.height
      const sx = canvas.width / Math.max(1, cssW)
      const sy = canvas.height / Math.max(1, cssH)
      const plot = plotRect ?? { x: 0, y: 0, w: cssW, h: cssH }
      const xSpan = xRange.max - xRange.min
      const ySpan = yRange.max - yRange.min
      if (!(xSpan > 0) || !(ySpan > 0) || plot.w <= 0 || plot.h <= 0) return
      const size = Math.max(1, pointSize)
      const half = size / 2
      ctx.save()
      ctx.setTransform(sx, 0, 0, sy, 0, 0)
      ctx.beginPath()
      ctx.rect(plot.x, plot.y, plot.w, plot.h)
      ctx.clip()
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha))
      ctx.fillStyle = color
      for (let k = 0; k < n; k++) {
        const px = plot.x + ((iData[k]! - xRange.min) / xSpan) * plot.w
        const py = plot.y + plot.h - ((qData[k]! - yRange.min) / ySpan) * plot.h
        if (px < plot.x - half || px > plot.x + plot.w + half) continue
        if (py < plot.y - half || py > plot.y + plot.h + half) continue
        ctx.fillRect(px - half, py - half, size, size)
      }
      ctx.restore()
    },
    dispose() {
      iData = new Float32Array(0)
      qData = new Float32Array(0)
    }
  }
}
