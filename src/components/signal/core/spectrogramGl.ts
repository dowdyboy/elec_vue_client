/**
 * WebGL2 瀑布纹理渲染器（生产路径）
 *
 * - 数据纹理 R8：每行一个 texel（dB 已由 CPU 映射为 0..255 强度）
 * - 色阶 1D RGBA LUT（256×1），片段着色器按强度取色
 * - 行环形纹理：上传到 slot，uniform 记录 newest/count，shader 做环形寻址
 * - 频率范围用 uniform 做 bin 轴缩放（不重传纹理）
 *
 * Canvas2D 回退由 core/spectrogramCanvas 实现；两者输出同一套色阶/电平语义。
 */

export interface GlRenderParams {
  /** 绘图区 CSS px */
  plot: { x: number; y: number; w: number; h: number }
  /** 背板像素 / CSS 像素 */
  dpr: number
  count: number
  newest: number
  cols: number
  capacity: number
  freqStart: number
  freqEnd: number
}

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // 画布顶部 = 最新行（vUv.y=0）
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
uniform sampler2D uData;
uniform sampler2D uLut;
uniform int uCapacity;
uniform int uNewest;
uniform int uCount;
uniform int uCols;
uniform float uFreqStart;
uniform float uFreqEnd;
in vec2 vUv;
out vec4 outColor;
void main() {
  int maxAge = max(uCount - 1, 0);
  int age = int(clamp(vUv.y, 0.0, 1.0) * float(maxAge) + 0.5);
  int slot = (uNewest - age + uCapacity) % uCapacity;
  float bin = mix(uFreqStart, uFreqEnd, vUv.x);
  float u = (bin + 0.5) / float(uCols);
  float v = (float(slot) + 0.5) / float(uCapacity);
  float idx = texture(uData, vec2(u, v)).r;
  outColor = texture(uLut, vec2(idx, 0.5));
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? ''
    gl.deleteShader(sh)
    throw new Error(`spectrogram shader compile failed: ${log}`)
  }
  return sh
}

export class SpectrogramGlRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private dataTex: WebGLTexture | null = null
  private lutTex: WebGLTexture | null = null
  private cols = 0
  private capacity = 0
  private interpolation: 'nearest' | 'linear' = 'nearest'
  private loc: Record<string, WebGLUniformLocation | null>

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const vs = compile(gl, gl.VERTEX_SHADER, VS)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS)
    const p = gl.createProgram()
    if (!p) throw new Error('createProgram failed')
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.linkProgram(p)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) ?? ''
      gl.deleteProgram(p)
      throw new Error(`spectrogram program link failed: ${log}`)
    }
    this.program = p
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(p, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.loc = {}
    for (const name of [
      'uData',
      'uLut',
      'uCapacity',
      'uNewest',
      'uCount',
      'uCols',
      'uFreqStart',
      'uFreqEnd'
    ]) {
      this.loc[name] = gl.getUniformLocation(p, name)
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  /** 配置数据纹理尺寸；列数/容量变化才重建纹理 */
  configure(cols: number, capacity: number): void {
    const c = Math.max(1, Math.floor(cols))
    const r = Math.max(1, Math.floor(capacity))
    if (c === this.cols && r === this.capacity && this.dataTex) return
    const gl = this.gl
    if (this.dataTex) gl.deleteTexture(this.dataTex)
    const tex = gl.createTexture()
    if (!tex) throw new Error('create texture failed')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    const filter = this.interpolation === 'linear' ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, c, r, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.dataTex = tex
    this.cols = c
    this.capacity = r
  }

  /** 数据纹理采样模式（不影响 LUT 的线性插值） */
  setInterpolation(mode: 'nearest' | 'linear'): void {
    if (mode === this.interpolation) return
    this.interpolation = mode
    if (!this.dataTex) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex)
    const filter = mode === 'linear' ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  setLut(lut: Uint8ClampedArray): void {
    const width = Math.floor(lut.length / 4)
    if (width <= 0) return
    const gl = this.gl
    if (!this.lutTex) this.lutTex = gl.createTexture()
    if (!this.lutTex) return
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  /** 上传一行强度字节到环形 slot */
  uploadRow(slot: number, bytes: Uint8Array): void {
    if (!this.dataTex || !Number.isInteger(slot) || slot < 0 || slot >= this.capacity) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      slot,
      Math.min(bytes.length, this.cols),
      1,
      gl.RED,
      gl.UNSIGNED_BYTE,
      bytes
    )
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  render(p: GlRenderParams): void {
    const gl = this.gl
    const canvasH = gl.drawingBufferHeight
    const x = Math.round(p.plot.x * p.dpr)
    const y = Math.round(canvasH - (p.plot.y + p.plot.h) * p.dpr)
    const w = Math.max(1, Math.round(p.plot.w * p.dpr))
    const h = Math.max(1, Math.round(p.plot.h * p.dpr))
    gl.viewport(x, y, w, h)
    if (!this.dataTex || !this.lutTex || p.count <= 0) return
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex)
    gl.uniform1i(this.loc.uData!, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex)
    gl.uniform1i(this.loc.uLut!, 1)
    gl.uniform1i(this.loc.uCapacity!, p.capacity)
    gl.uniform1i(this.loc.uNewest!, p.newest)
    gl.uniform1i(this.loc.uCount!, p.count)
    gl.uniform1i(this.loc.uCols!, p.cols)
    gl.uniform1f(this.loc.uFreqStart!, p.freqStart)
    gl.uniform1f(this.loc.uFreqEnd!, p.freqEnd)
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    // 复位活动纹理单元，避免影响后续 Canvas/GL 操作
    gl.activeTexture(gl.TEXTURE0)
  }

  dispose(): void {
    const gl = this.gl
    if (this.dataTex) gl.deleteTexture(this.dataTex)
    if (this.lutTex) gl.deleteTexture(this.lutTex)
    gl.deleteBuffer(this.vbo)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    this.dataTex = null
    this.lutTex = null
  }
}
