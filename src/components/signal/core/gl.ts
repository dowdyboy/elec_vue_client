/**
 * WebGL2 薄封装（无依赖，可拷至他项目）
 * 提供：编译着色器、创建 program、绘制折线/散点、瀑布纹理
 */

export function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('Shader compile: ' + info)
  }
  return sh
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error('Program link: ' + info)
  }
  return prog
}

// ── 折线着色器（使用 gl_VertexID 简化 aIndex）──

// 修正：aIndex 需 uniform 传入，简化后直接用 gl_VertexID
const VS_LINE2 = `#version 300 es
in float aValue;
uniform float uCount;
uniform vec2 uViewport;
uniform vec2 uYRange;
void main(){
  float idx = float(gl_VertexID);
  float xRange = uViewport.y - uViewport.x;
  float x = xRange < 0.0001 ? idx / max(1.0, uCount-1.0) : (idx - uViewport.x) / xRange;
  float yRange = uYRange.y - uYRange.x;
  float y = yRange < 0.0001 ? (aValue+1.0)*0.5 : (aValue - uYRange.x) / yRange;
  gl_Position = vec4(x*2.0-1.0, y*2.0-1.0, 0.0, 1.0);
}
`
const FS_LINE = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main(){ outColor = uColor; }
`

export interface LineRenderer {
  setData(data: Float32Array): void
  draw(
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
    color: string,
    clear?: boolean,
    /** 绘图区（CSS px，y 为距顶部）；传入时折线只绘入该区域，不传则铺满 canvas */
    plotRect?: { x: number; y: number; w: number; h: number }
  ): void
  dispose(): void
  gl: WebGL2RenderingContext
}

export function hexToRgba(color: string): [number, number, number, number] {
  const c = color.trim()
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3)
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('')
    const n = parseInt(h, 16)
    if (h.length === 6) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
    if (h.length === 8)
      return [
        ((n >> 24) & 255) / 255,
        ((n >> 16) & 255) / 255,
        ((n >> 8) & 255) / 255,
        (n & 255) / 255
      ]
    return [0, 1, 1, 1]
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c)
  if (m)
    return [
      Number(m[1]) / 255,
      Number(m[2]) / 255,
      Number(m[3]) / 255,
      m[4] === undefined ? 1 : Number(m[4])
    ]
  return [0, 1, 1, 1]
}

/** 颜色加透明度：兼容 #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()，输出 rgba() 字符串 */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = hexToRgba(color)
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`
}

export function createLineRenderer(
  canvas: HTMLCanvasElement,
  gl?: WebGL2RenderingContext | null
): LineRenderer {
  const _gl =
    gl ?? (canvas.getContext('webgl2', { antialias: true }) as WebGL2RenderingContext | null)
  if (!_gl) throw new Error('WebGL2 not supported')
  const prog = createProgram(_gl, VS_LINE2, FS_LINE)
  const aValueLoc = _gl.getAttribLocation(prog, 'aValue')
  const uCountLoc = _gl.getUniformLocation(prog, 'uCount')
  const uViewportLoc = _gl.getUniformLocation(prog, 'uViewport')
  const uYRangeLoc = _gl.getUniformLocation(prog, 'uYRange')
  const uColorLoc = _gl.getUniformLocation(prog, 'uColor')
  const buf = _gl.createBuffer()
  let count = 0

  return {
    gl: _gl,
    setData(data: Float32Array) {
      count = data.length
      _gl.bindBuffer(_gl.ARRAY_BUFFER, buf)
      _gl.bufferData(_gl.ARRAY_BUFFER, data, _gl.DYNAMIC_DRAW)
    },
    draw(viewport, color, clear = true, plotRect?) {
      if (count === 0) return
      const dpr = window.devicePixelRatio || 1
      let vx = 0,
        vy = 0,
        vw = canvas.width,
        vh = canvas.height
      if (plotRect) {
        vx = Math.round(plotRect.x * dpr)
        vy = Math.round(canvas.height - (plotRect.y + plotRect.h) * dpr)
        vw = Math.max(1, Math.round(plotRect.w * dpr))
        vh = Math.max(1, Math.round(plotRect.h * dpr))
      }
      _gl.viewport(vx, vy, vw, vh)
      // viewport 只做坐标映射不裁剪，需配合 scissor 把折线限制在绘图区内
      if (plotRect) {
        _gl.enable(_gl.SCISSOR_TEST)
        _gl.scissor(vx, vy, vw, vh)
      } else {
        _gl.disable(_gl.SCISSOR_TEST)
      }
      if (clear) {
        _gl.clearColor(0, 0, 0, 0)
        _gl.clear(_gl.COLOR_BUFFER_BIT)
      }
      _gl.useProgram(prog)
      _gl.bindBuffer(_gl.ARRAY_BUFFER, buf)
      _gl.enableVertexAttribArray(aValueLoc)
      _gl.vertexAttribPointer(aValueLoc, 1, _gl.FLOAT, false, 0, 0)
      _gl.uniform1f(uCountLoc, count)
      _gl.uniform2f(uViewportLoc, viewport.xMin, viewport.xMax)
      _gl.uniform2f(uYRangeLoc, viewport.yMin, viewport.yMax)
      const [r, g, b, a] = hexToRgba(color)
      _gl.uniform4f(uColorLoc, r, g, b, a)
      _gl.drawArrays(_gl.LINE_STRIP, 0, count)
    },
    dispose() {
      _gl.deleteBuffer(buf)
      _gl.deleteProgram(prog)
    }
  }
}

// ── 散点着色器（星座）──
const VS_POINTS = `#version 300 es
in vec2 aPos;
uniform vec2 uXRange;
uniform vec2 uYRange;
uniform float uPointSize;
void main(){
  float x = (aPos.x - uXRange.x) / max(0.0001, uXRange.y - uXRange.x);
  float y = (aPos.y - uYRange.x) / max(0.0001, uYRange.y - uYRange.x);
  gl_Position = vec4(x*2.0-1.0, y*2.0-1.0, 0.0, 1.0);
  gl_PointSize = uPointSize;
}
`
const FS_POINTS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
uniform float uAlpha;
out vec4 outColor;
void main(){
  vec2 c = gl_PointCoord - vec2(0.5);
  if (dot(c,c) > 0.25) discard;
  outColor = vec4(uColor.rgb, uColor.a * uAlpha);
}
`

export interface PointsRenderer {
  setData(i: Float32Array, q: Float32Array): void
  draw(
    xRange: { min: number; max: number },
    yRange: { min: number; max: number },
    color: string,
    alpha: number,
    pointSize?: number
  ): void
  dispose(): void
}

export function createPointsRenderer(canvas: HTMLCanvasElement): PointsRenderer {
  const gl = canvas.getContext('webgl2', { antialias: true }) as WebGL2RenderingContext | null
  if (!gl) throw new Error('WebGL2 not supported')
  const prog = createProgram(gl, VS_POINTS, FS_POINTS)
  const aPosLoc = gl.getAttribLocation(prog, 'aPos')
  const uXRangeLoc = gl.getUniformLocation(prog, 'uXRange')
  const uYRangeLoc = gl.getUniformLocation(prog, 'uYRange')
  const uColorLoc = gl.getUniformLocation(prog, 'uColor')
  const uAlphaLoc = gl.getUniformLocation(prog, 'uAlpha')
  const uPointSizeLoc = gl.getUniformLocation(prog, 'uPointSize')
  const buf = gl.createBuffer()
  let count = 0
  return {
    setData(i, q) {
      const n = Math.min(i.length, q.length)
      count = n
      const inter = new Float32Array(n * 2)
      for (let k = 0; k < n; k++) {
        inter[2 * k] = i[k]
        inter[2 * k + 1] = q[k]
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, inter, gl.DYNAMIC_DRAW)
    },
    draw(xRange, yRange, color, alpha, pointSize = 3) {
      if (count === 0) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPosLoc)
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(uXRangeLoc, xRange.min, xRange.max)
      gl.uniform2f(uYRangeLoc, yRange.min, yRange.max)
      const [r, g, b, a] = hexToRgba(color)
      gl.uniform4f(uColorLoc, r, g, b, a)
      gl.uniform1f(uAlphaLoc, alpha)
      gl.uniform1f(uPointSizeLoc, pointSize)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.POINTS, 0, count)
    },
    dispose() {
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    }
  }
}

// ── 瀑布纹理（简化：Canvas2D 回退 + WebGL）──
// 为保持拷贝轻量，瀑布先以 Canvas2D ImageData 滚动实现，WebGL 纹理为可选升级（接口一致）
