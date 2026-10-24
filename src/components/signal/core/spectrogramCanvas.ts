/**
 * Canvas2D 瀑布渲染器（WebGL2 不可用时的降级后端）
 *
 * 把可见行按 LUT 映射为 RGBA ImageData，再按频率窗口裁剪缩放到绘图区。
 * 行数×列数每帧一次 O(n) 映射；适合默认 512~2048 bin、128~256 行的工业面板。
 */
import { levelToByte } from './spectrogram'

export interface CanvasRenderParams {
  plot: { x: number; y: number; w: number; h: number }
  dpr: number
  /** newest→oldest 的可见行视图 */
  rows: ArrayLike<Float32Array>
  cols: number
  lut32: Uint32Array
  min: number
  max: number
  gamma: number
  freqStart: number
  freqEnd: number
  interpolation: 'nearest' | 'linear'
}

export class SpectrogramCanvasRenderer {
  private img: ImageData | null = null
  private img32: Uint32Array | null = null
  private off: HTMLCanvasElement | null = null
  private offCtx: CanvasRenderingContext2D | null = null
  private cols = 0
  private rowsN = 0

  private ensure(cols: number, rows: number): void {
    if (this.img && this.cols === cols && this.rowsN === rows) return
    this.cols = cols
    this.rowsN = rows
    this.off = this.off ?? document.createElement('canvas')
    this.off.width = cols
    this.off.height = rows
    this.offCtx = this.off.getContext('2d')
    this.img = new ImageData(cols, rows)
    this.img32 = new Uint32Array(this.img.data.buffer)
  }

  render(ctx: CanvasRenderingContext2D, p: CanvasRenderParams): void {
    const count = p.rows.length
    const cols = p.cols
    if (count <= 0 || cols <= 0 || !p.lut32) return
    this.ensure(cols, count)
    const img32 = this.img32!
    const lut = p.lut32
    for (let y = 0; y < count; y++) {
      const row = p.rows[y]
      if (!row) continue
      const base = y * cols
      for (let x = 0; x < cols; x++) {
        const idx = levelToByte(row[x]!, p.min, p.max, p.gamma, 256)
        img32[base + x] = lut[idx]!
      }
    }
    if (!this.off || !this.offCtx) return
    this.offCtx.putImageData(this.img!, 0, 0)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = p.interpolation === 'linear'
    const sx = Math.max(0, Math.min(cols - 1, p.freqStart))
    const ex = Math.max(sx + 1, Math.min(cols, p.freqEnd))
    ctx.drawImage(
      this.off,
      sx,
      0,
      ex - sx,
      count,
      p.plot.x * p.dpr,
      p.plot.y * p.dpr,
      p.plot.w * p.dpr,
      p.plot.h * p.dpr
    )
    ctx.restore()
  }

  dispose(): void {
    this.img = null
    this.img32 = null
    this.off = null
    this.offCtx = null
    this.cols = 0
    this.rowsN = 0
  }
}
