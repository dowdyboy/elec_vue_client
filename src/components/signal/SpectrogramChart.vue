<script setup lang="ts">
/**
 * SpectrogramChart（时频瀑布，生产级可复用组件）
 *
 * 数据：服务端算好的 dB 行 Float32Array（长度 = fftSize/2），按行追加；组件只做累计 + 上色 + 绘制。
 * 渲染：WebGL2 R8 纹理 + 1D RGBA LUT（默认）；无 WebGL2 时 Canvas2D LUT 降级。
 * 功能：频率缩放/平移、游标读数、冻结、色标、自动/手动电平、PNG/CSV 导出、i18n、离屏暂停。
 */
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { cssSize } from './core/css'
import { resolveTheme } from './core/theme'
import { drawPanel, drawChip, niceTicks } from './core/axis'
import { SpectrogramBuffer, colorMapLut, lutToUint32, mapRowToBytes } from './core/spectrogram'
import { SpectrogramGlRenderer } from './core/spectrogramGl'
import { SpectrogramCanvasRenderer } from './core/spectrogramCanvas'
import { translate, type ChartMessageKey } from './core/i18n'
import { spectrumAdapters } from './core/adapters'
import { useGlChart } from './composables/useGlChart'
import { usePrefersDark } from './composables/usePrefersDark'
import type {
  ExportPayload,
  SpectrogramCursorInfo,
  SpectrogramMeta,
  SpectrogramProps,
  SpectrogramStats,
  SpectrogramVisibleData,
  Theme
} from './core/types'

const props = withDefaults(defineProps<SpectrogramProps>(), {
  theme: 'auto' as Theme,
  fpsLimit: 30,
  colorMap: 'viridis',
  timeSpan: 256,
  maxRows: undefined,
  sampleRate: undefined,
  fftSize: undefined,
  freqOffsetHz: 0,
  timeStepSec: undefined,
  dbMin: -120,
  dbMax: 0,
  autoLevel: false,
  gamma: 1,
  interpolation: 'nearest',
  paused: false,
  showColorbar: true,
  showInfo: true,
  showCursor: true,
  contextMenu: true,
  unit: 'dBFS',
  ampOffsetDb: 0,
  axis: true,
  xAxis: true,
  grid: true,
  axisLabels: true,
  preserveDrawingBuffer: true,
  renderer: 'auto',
  adapter: undefined,
  data: undefined
})

const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'errorDetail', p: { code: 'adapter' | 'webgl' | 'data' | 'export'; message: string }): void
  (e: 'ready'): void
  (e: 'contextLost'): void
  (e: 'contextRestored'): void
  (e: 'cursorChange', p: SpectrogramCursorInfo | null): void
  (e: 'contextmenu', p: { x: number; y: number; bin: number; rowAge: number }): void
  (e: 'update:paused', v: boolean): void
  (e: 'update:dbMin', v: number): void
  (e: 'update:dbMax', v: number): void
  (e: 'levelChange', p: { min: number; max: number }): void
  (e: 'frequencyChange', p: { startBin: number; endBin: number; fullSpan: boolean }): void
  (e: 'metaChange', p: SpectrogramMeta): void
  (e: 'exported', p: { kind: 'png' | 'csv'; filename: string }): void
}>()

function tr(key: ChartMessageKey, vars?: Record<string, string | number>): string {
  return translate(props.locale, props.messages, key, vars)
}
function reportError(code: 'adapter' | 'webgl' | 'data' | 'export', message: string): void {
  emit('error', message)
  emit('errorDetail', { code, message })
}

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const prefersDark = usePrefersDark()
const th = computed(() => resolveTheme(props.theme, prefersDark.value, { style: props.chartStyle }))

const GUTTER_BOTTOM = 24
const TOP = 8
const COLORBAR_W = 16
const COLORBAR_GAP = 10
const MIN_FREQ_SPAN = 8
const DATA_STALE_MS = 3000

// ── 后端 ──
let gl: WebGL2RenderingContext | null = null
let ctx2d: CanvasRenderingContext2D | null = null
let glRenderer: SpectrogramGlRenderer | null = null
let canvasRenderer: SpectrogramCanvasRenderer | null = null
let contextLost = false
let glChartResize: (() => void) | null = null

// ── 数据/元数据 ──
function initialCapacity(): number {
  const spanRaw = Number.isFinite(props.timeSpan) ? Math.floor(props.timeSpan) : 256
  const span = Math.max(1, Math.min(4096, spanRaw))
  const capRaw = Number.isFinite(props.maxRows) ? Math.floor(props.maxRows!) : Math.max(span, 256)
  const cap = Math.max(span, Math.min(8192, capRaw), 1)
  return cap
}
const buffer = new SpectrogramBuffer(initialCapacity())
let frameSampleRate: number | undefined
let frameFftSize: number | undefined
let frameTimeStepSec: number | undefined
let frameTimestamp: number | undefined
let curSampleRate: number | undefined
let curFftSize: number | undefined
let curTimeStepSec: number | undefined
let curTimestamp: number | undefined
let metaInited = false

function binHz(): number | undefined {
  return curSampleRate && curFftSize ? curSampleRate / curFftSize : undefined
}
function updateDerivedMeta(): void {
  const fft = frameFftSize ?? props.fftSize ?? (buffer.cols > 0 ? buffer.cols * 2 : undefined)
  const sr = frameSampleRate ?? props.sampleRate
  const step =
    frameTimeStepSec ?? props.timeStepSec ?? (sr && fft && sr > 0 && fft > 0 ? fft / sr : undefined)
  const changed =
    fft !== curFftSize ||
    sr !== curSampleRate ||
    step !== curTimeStepSec ||
    frameTimestamp !== curTimestamp ||
    !metaInited
  curFftSize = fft
  curSampleRate = sr
  curTimeStepSec = step
  curTimestamp = frameTimestamp
  if (changed) {
    metaInited = true
    emit('metaChange', {
      sampleRate: curSampleRate,
      fftSize: curFftSize,
      dbScale: true,
      timeStepSec: curTimeStepSec,
      timestamp: frameTimestamp
    })
  }
}
function setFrameMeta(m: SpectrogramMeta | undefined): void {
  if (!m) return
  if (typeof m.sampleRate === 'number' && m.sampleRate > 0) frameSampleRate = m.sampleRate
  if (typeof m.fftSize === 'number' && m.fftSize > 0) frameFftSize = m.fftSize
  if (typeof m.timeStepSec === 'number' && m.timeStepSec > 0) frameTimeStepSec = m.timeStepSec
  if (typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)) frameTimestamp = m.timestamp
  updateDerivedMeta()
}

// ── 视图/电平/游标 ──
const pausedUi = ref(props.paused)
let paused = props.paused
let frozenRows: Float32Array[] | null = props.paused ? [] : null
let frozenTexValid = false
let lastDataAt = 0
const dataStale = ref(false)
let staleTimer: ReturnType<typeof setTimeout> | null = null
let visible = true
let disposed = false

let freqStart = 0
let freqEnd = 0
let freqFull = true
let pendingFreqView: { a: number; b: number } | null = null
const level = reactive({
  min: props.dbMin,
  max: props.dbMax,
  auto: props.autoLevel
})
let lastAutoSeq = -1

let cursor: { px: number; py: number } | null = null
let hovered = false
const focused = ref(false)
let drag: { px: number; start: number; end: number } | null = null
const touchPts = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; span: number; centerBin: number } | null = null
const menu = reactive({ show: false, x: 0, y: 0, bin: 0, rowAge: 0 })
let lastView: {
  plot: { x: number; y: number; w: number; h: number }
  freqStart: number
  freqEnd: number
  count: number
  cols: number
  rows: Float32Array[]
} | null = null

// ── 色阶 ──
let lutBytes = colorMapLut(props.colorMap, 256)
let lut32 = lutToUint32(lutBytes)
let lutMapKey = props.colorMap
let lutDirty = true

// ── 纹理状态（WebGL）──
let texValid = false
let texCount = 0
let texNewest = 0
let texRowBytes = new Uint8Array(0)
let texLevelMin = Number.NaN
let texLevelMax = Number.NaN
let texGamma = Number.NaN
let texInterp: 'nearest' | 'linear' = props.interpolation

// ── rAF ──
let raf = 0
let overlayRaf = 0
let lastDrawAt = 0

function schedule(): void {
  if (raf || disposed || !visible) return
  if (typeof requestAnimationFrame === 'undefined') return
  raf = requestAnimationFrame((now) => {
    raf = 0
    glChartResize?.()
    if (now - lastDrawAt < 1000 / Math.max(1, props.fpsLimit) - 1) {
      schedule()
      return
    }
    lastDrawAt = now
    draw()
  })
}
function scheduleOverlay(): void {
  if (overlayRaf || disposed) return
  if (typeof requestAnimationFrame === 'undefined') return
  overlayRaf = requestAnimationFrame(() => {
    overlayRaf = 0
    drawOverlay()
  })
}

// ── 布局/坐标 ──
function computePlot(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  const cw = canvas.clientWidth || canvas.width
  const ch = canvas.clientHeight || canvas.height
  const left = props.axis ? Math.max(44, th.value.axisWidth ?? 56) : 10
  const right = props.showColorbar ? COLORBAR_GAP + COLORBAR_W + 72 : 12
  const bottom = props.axis ? GUTTER_BOTTOM : 10
  return {
    x: left,
    y: TOP,
    w: Math.max(16, cw - left - right),
    h: Math.max(16, ch - TOP - bottom)
  }
}
function clampFreqView(): void {
  const cols = buffer.cols
  if (cols <= 0) {
    freqStart = 0
    freqEnd = 0
    freqFull = true
    return
  }
  const full = cols - 1
  let a = freqFull ? 0 : Math.min(freqStart, freqEnd)
  let b = freqFull ? full : Math.max(freqStart, freqEnd)
  const span = Math.min(full, Math.max(MIN_FREQ_SPAN, b - a))
  if (span >= full - 1e-6) {
    freqStart = 0
    freqEnd = full
    freqFull = true
    return
  }
  if (a < 0) a = 0
  if (a + span > full) a = full - span
  freqStart = a
  freqEnd = a + span
  freqFull = false
}
function resetFreqView(): void {
  freqFull = true
  freqStart = 0
  freqEnd = Math.max(0, buffer.cols - 1)
  emit('frequencyChange', { startBin: freqStart, endBin: freqEnd, fullSpan: true })
  schedule()
}
/** 频率视图（bin 索引域）；双目/宿主 API 共用 */
function setFrequencyView(a: number, b: number): void {
  if (buffer.cols <= 0) return
  freqFull = false
  freqStart = Math.min(a, b)
  freqEnd = Math.max(a, b)
  clampFreqView()
  emit('frequencyChange', { startBin: freqStart, endBin: freqEnd, fullSpan: freqFull })
  schedule()
}

function startPinch(): void {
  if (!lastView || touchPts.size !== 2 || buffer.cols <= 0) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const cx = (a.x + b.x) / 2
  const { plot, freqStart: f0, freqEnd: f1 } = lastView
  pinch = {
    dist,
    span: Math.max(MIN_FREQ_SPAN, f1 - f0),
    centerBin: f0 + ((cx - plot.x) / plot.w) * (f1 - f0)
  }
  drag = null
}
function updatePinch(): void {
  if (!pinch || touchPts.size !== 2 || !lastView) return
  const [a, b] = [...touchPts.values()]
  if (!a || !b) return
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist < 4) return
  const full = buffer.cols - 1
  const span = Math.min(Math.max(MIN_FREQ_SPAN, (pinch.span * pinch.dist) / dist), full)
  if (span >= full) {
    freqFull = true
    freqStart = 0
    freqEnd = full
  } else {
    freqFull = false
    let a0 = pinch.centerBin - span / 2
    if (a0 < 0) a0 = 0
    if (a0 + span > full) a0 = full - span
    freqStart = a0
    freqEnd = a0 + span
  }
  emit('frequencyChange', { startBin: freqStart, endBin: freqEnd, fullSpan: freqFull })
  schedule()
}

/** 自动电平：抽样直方图取 p1/p99，避免单个尖峰把色阶拉满 */
function autoLevelRange(): { min: number; max: number } {
  const count = buffer.displayCount(props.timeSpan)
  const cols = buffer.cols
  if (count <= 0 || cols <= 0) return { min: level.min, max: level.max }
  const rowStep = Math.max(1, Math.ceil(count / 48))
  const colStep = Math.max(1, Math.ceil(cols / 96))
  const hist = new Uint32Array(256)
  const lo = -150
  const hi = 20
  const scale = 255 / (hi - lo)
  let samples = 0
  for (let age = 0; age < count; age += rowStep) {
    const row = buffer.rowAt(age)
    if (!row) continue
    for (let x = 0; x < cols; x += colStep) {
      const v = row[x]!
      if (!Number.isFinite(v)) continue
      const k = Math.max(0, Math.min(255, Math.round((v - lo) * scale)))
      hist[k]!++
      samples++
    }
  }
  if (samples < 16) return { min: level.min, max: level.max }
  let acc = 0
  let p1 = lo
  let p99 = hi
  const target1 = samples * 0.01
  const target99 = samples * 0.99
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!
    if (acc >= target1 && p1 === lo) p1 = lo + i / scale
    if (acc >= target99) {
      p99 = lo + i / scale
      break
    }
  }
  if (!(p99 > p1)) return { min: level.min, max: level.max }
  const margin = Math.max(2, (p99 - p1) * 0.03)
  return { min: p1 - margin, max: p99 + margin }
}
function currentLevel(): { min: number; max: number } {
  let min = level.auto ? level.min : props.dbMin
  let max = level.auto ? level.max : props.dbMax
  if (!(max > min)) {
    min = props.dbMin
    max = props.dbMax
  }
  return { min, max }
}
function refreshAutoLevel(force = false): boolean {
  if (!level.auto) return false
  const seq = buffer.seq
  if (!force && seq - lastAutoSeq < 8) return false
  lastAutoSeq = seq
  const r = autoLevelRange()
  if (!(r.max > r.min)) return false
  if (Math.abs(r.min - level.min) < 0.5 && Math.abs(r.max - level.max) < 0.5) return false
  level.min = r.min
  level.max = r.max
  emit('update:dbMin', r.min)
  emit('update:dbMax', r.max)
  emit('levelChange', { min: r.min, max: r.max })
  return true
}

// ── 数据 ──
function armStaleTimer(): void {
  if (staleTimer) {
    clearTimeout(staleTimer)
    staleTimer = null
  }
  if (paused || disposed || lastDataAt <= 0) {
    dataStale.value = false
    return
  }
  const remain = DATA_STALE_MS - (performance.now() - lastDataAt)
  if (remain <= 0) {
    dataStale.value = true
    return
  }
  staleTimer = setTimeout(() => {
    staleTimer = null
    if (!paused && !disposed) {
      dataStale.value = true
      scheduleOverlay()
    }
  }, remain)
}
function normalize(raw: unknown): Float32Array | null {
  const fn = props.adapter ?? spectrumAdapters.passthrough
  try {
    const v = fn(raw)
    if (v) return v
    return (
      spectrumAdapters.json(raw) ??
      spectrumAdapters.arrayBuffer(raw) ??
      spectrumAdapters.base64(raw)
    )
  } catch (e) {
    reportError('adapter', e instanceof Error ? e.message : String(e))
    return null
  }
}
function sanitizeRow(row: Float32Array): Float32Array {
  let dirty = false
  for (let i = 0; i < row.length; i++) {
    if (!Number.isFinite(row[i]!)) {
      dirty = true
      break
    }
  }
  if (!dirty) return row
  const copy = new Float32Array(row.length)
  for (let i = 0; i < row.length; i++) copy[i] = Number.isFinite(row[i]!) ? row[i]! : -160
  return copy
}
function applyCols(cols: number): void {
  if (buffer.cols !== cols) {
    buffer.configure(cols, initialCapacity())
    frameFftSize = cols * 2 // 行宽是强契约；频率轴以实际行长为准
    lastAutoSeq = -1
    freqFull = true
    freqStart = 0
    freqEnd = Math.max(0, cols - 1)
    frozenRows = null
    texValid = false
    if (pendingFreqView) {
      const p = pendingFreqView
      pendingFreqView = null
      setFrequencyView(p.a, p.b)
    }
  }
}
function appendData(raw: unknown, meta?: SpectrogramMeta): void {
  if (disposed) return
  setFrameMeta(meta)
  const n0 = normalize(raw)
  if (!n0) {
    reportError('adapter', tr('common.adapterNull'))
    return
  }
  if (n0.length === 0) return
  const n = sanitizeRow(n0)
  if (buffer.cols > 0 && n.length !== buffer.cols) {
    // 行长变化（fftSize 调整）：旧瀑布不能混行
    buffer.clear()
    lastAutoSeq = -1
    frozenRows = null
    frozenTexValid = false
    texValid = false
  }
  applyCols(n.length)
  if (!buffer.push(n)) {
    reportError('data', `invalid row length ${n.length}`)
    return
  }
  if (!frameFftSize) frameFftSize = n.length * 2 // 缺省推导，供频率轴
  updateDerivedMeta()
  lastDataAt = performance.now()
  dataStale.value = false
  armStaleTimer()
  if (!paused) {
    const autoChanged = refreshAutoLevel()
    if (autoChanged) texValid = false
    // 增量上传一行（纹理未重建时）
    if (gl && glRenderer && !contextLost) {
      if (!texValid) {
        rebuildTexture()
      } else {
        const slot = (texNewest + 1) % buffer.capacity
        const bytes = rowBytes(n.length)
        mapRowToBytes(n, currentLevel().min, currentLevel().max, props.gamma, bytes)
        glRenderer.uploadRow(slot, bytes)
        texNewest = slot
        texCount = Math.min(props.timeSpan, texCount + 1)
      }
    }
    schedule()
  }
}
function setData(raw: unknown, meta?: SpectrogramMeta): void {
  clear()
  appendData(raw, meta)
}
function clear(): void {
  buffer.clear()
  lastAutoSeq = -1
  frozenRows = null
  frozenTexValid = false
  texValid = false
  freqFull = true
  freqStart = 0
  freqEnd = 0
  lastDataAt = 0
  dataStale.value = false
  if (staleTimer) {
    clearTimeout(staleTimer)
    staleTimer = null
  }
  if (cursor) {
    cursor = null
    emit('cursorChange', null)
  }
  schedule()
}

// ── 纹理/绘制 ──
function rowBytes(cols: number): Uint8Array {
  if (texRowBytes.length !== cols) texRowBytes = new Uint8Array(cols)
  return texRowBytes
}

function visibleRows(): Float32Array[] {
  const count = buffer.displayCount(props.timeSpan)
  const out: Float32Array[] = []
  for (let age = 0; age < count; age++) {
    const row = buffer.rowAt(age)
    if (row) out.push(row)
  }
  return out
}

function rebuildTexture(): void {
  if (!gl || !glRenderer) return
  const rows = paused ? (frozenRows ?? []) : visibleRows()
  const cols = buffer.cols
  if (cols <= 0) {
    texValid = false
    return
  }
  glRenderer.configure(cols, buffer.capacity)
  glRenderer.setLut(lutBytes)
  const count = Math.min(rows.length, buffer.capacity)
  const bytes = rowBytes(cols)
  const lv = currentLevel()
  for (let age = count - 1; age >= 0; age--) {
    const slot = count - 1 - age
    mapRowToBytes(rows[age]!, lv.min, lv.max, props.gamma, bytes)
    glRenderer.uploadRow(slot, bytes)
  }
  texNewest = Math.max(0, count - 1)
  texCount = count
  texValid = true
  texLevelMin = lv.min
  texLevelMax = lv.max
  texGamma = props.gamma
  frozenTexValid = paused
}

function ensureTexture(): void {
  if (!gl || !glRenderer) return
  const cols = buffer.cols
  if (cols <= 0) {
    texValid = false
    return
  }
  if (texInterp !== props.interpolation) {
    glRenderer.setInterpolation(props.interpolation)
    texInterp = props.interpolation
  }
  if (lutDirty) {
    glRenderer.setLut(lutBytes)
    lutDirty = false
  }
  if (!texValid) {
    rebuildTexture()
    return
  }
  if (
    texLevelMin !== currentLevel().min ||
    texLevelMax !== currentLevel().max ||
    texGamma !== props.gamma
  ) {
    rebuildTexture()
  }
}

function clearGlBackground(): void {
  if (!gl) return
  const c = hexToRgb(th.value.bg)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.disable(gl.SCISSOR_TEST)
  gl.clearColor(c[0], c[1], c[2], 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
}
function hexToRgb(color: string): [number, number, number] {
  const c = color.trim()
  const rgba = c.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i)
  if (rgba) {
    return [
      Math.min(1, Math.max(0, Number(rgba[1]) / 255)),
      Math.min(1, Math.max(0, Number(rgba[2]) / 255)),
      Math.min(1, Math.max(0, Number(rgba[3]) / 255))
    ]
  }
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map((x) => x + x)
        .join('')
    }
    if (h.length >= 6) {
      const n = parseInt(h.slice(0, 6), 16)
      if (Number.isFinite(n)) {
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
      }
    }
  }
  return [0.06, 0.07, 0.08]
}
function clear2dBackground(): void {
  if (!ctx2d) return
  const canvas = canvasRef.value
  if (!canvas) return
  ctx2d.save()
  ctx2d.setTransform(1, 0, 0, 1, 0, 0)
  ctx2d.fillStyle = th.value.bg
  ctx2d.fillRect(0, 0, canvas.width, canvas.height)
  ctx2d.restore()
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas || disposed) return
  if (!gl && !ctx2d) return
  if (contextLost) return
  const plot = computePlot(canvas)
  const usingFrozen = paused
  const rows = paused ? (frozenRows ?? []) : visibleRows()
  const count = rows.length
  if (freqFull || freqEnd <= freqStart) {
    freqStart = 0
    freqEnd = Math.max(0, buffer.cols - 1)
    freqFull = true
  }
  lastView = {
    plot,
    freqStart,
    freqEnd,
    count,
    cols: buffer.cols,
    rows
  }
  const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width)

  if (gl) {
    clearGlBackground()
    if (count > 0) {
      if (usingFrozen) {
        if (!frozenTexValid) {
          rebuildTexture()
          frozenTexValid = true
        }
        ensureTexture()
        glRenderer?.render({
          plot,
          dpr,
          count: texCount,
          newest: texNewest,
          cols: buffer.cols,
          capacity: buffer.capacity,
          freqStart,
          freqEnd
        })
      } else {
        ensureTexture()
        glRenderer?.render({
          plot,
          dpr,
          count: Math.min(texCount, props.timeSpan),
          newest: texNewest,
          cols: buffer.cols,
          capacity: buffer.capacity,
          freqStart,
          freqEnd
        })
      }
    }
  } else if (ctx2d) {
    clear2dBackground()
    if (count > 0) {
      if (props.colorMap !== lutMapKey) {
        lutBytes = colorMapLut(props.colorMap, 256)
        lut32 = lutToUint32(lutBytes)
        lutMapKey = props.colorMap
      }
      const lv = currentLevel()
      canvasRenderer?.render(ctx2d, {
        plot,
        dpr,
        rows,
        cols: buffer.cols,
        lut32,
        min: lv.min,
        max: lv.max,
        gamma: props.gamma,
        freqStart,
        freqEnd,
        interpolation: props.interpolation
      })
    }
  }
  drawOverlay()
}

// ── 轴/色标/游标 ──
function fmtFreq(hz: number): string {
  const a = Math.abs(hz)
  if (a >= 1e9) return `${(hz / 1e9).toFixed(a >= 1e10 ? 1 : 2)} GHz`
  if (a >= 1e6) return `${(hz / 1e6).toFixed(a >= 1e7 ? 1 : 2)} MHz`
  if (a >= 1e3) return `${(hz / 1e3).toFixed(a >= 1e4 ? 1 : 2)} kHz`
  return `${hz.toFixed(a >= 100 ? 0 : 1)} Hz`
}
function fmtDuration(sec: number): string {
  const a = Math.abs(sec)
  if (a >= 1) return `${sec.toFixed(a >= 10 ? 1 : 2)} s`
  if (a >= 1e-3) return `${(sec * 1e3).toFixed(a >= 1e-2 ? 1 : 2)} ms`
  if (a >= 1e-6) return `${(sec * 1e6).toFixed(1)} µs`
  return `${(sec * 1e9).toFixed(0)} ns`
}
function freqAtBin(bin: number): number | undefined {
  const b = binHz()
  return b ? bin * b + props.freqOffsetHz : undefined
}
function rowTimeSec(age: number): number | undefined {
  return curTimeStepSec ? -age * curTimeStepSec : undefined
}
function levelText(db: number): string {
  return `${(db + props.ampOffsetDb).toFixed(1)} ${props.unit}`
}

function drawOverlay(): void {
  const ov = overlayRef.value
  if (!ov || !lastView) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  const rect = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, rect.width)
  const sy = ov.height / Math.max(1, rect.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  const { plot, freqStart: f0, freqEnd: f1, count, cols } = lastView
  const text = th.value.text
  const grid = th.value.grid
  const border = th.value.border
  const font = '10px system-ui, -apple-system, sans-serif'
  ctx.font = font
  ctx.textBaseline = 'middle'

  if (count <= 0) {
    ctx.fillStyle = text
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.7
    ctx.fillText(tr('spectrogram.noData'), plot.x + plot.w / 2, plot.y + plot.h / 2)
    ctx.globalAlpha = 1
    drawColorbar(ctx, plot)
    drawAxisLabels(ctx, plot)
    return
  }

  // 网格/刻度（频率 X，时间 Y）
  const bHz = binHz()
  const freqMin = bHz ? f0 * bHz + props.freqOffsetHz : f0
  const freqMax = bHz ? f1 * bHz + props.freqOffsetHz : f1
  if (props.axis !== false) {
    ctx.strokeStyle = grid
    ctx.lineWidth = 1
    if (props.xAxis !== false) {
      const xTicks = niceTicks(freqMin, freqMax, 6)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = text
      for (const v of xTicks) {
        const px = plot.x + ((v - freqMin) / Math.max(1e-9, freqMax - freqMin)) * plot.w
        if (px < plot.x - 1 || px > plot.x + plot.w + 1) continue
        if (props.grid !== false) {
          ctx.globalAlpha = 0.35
          ctx.beginPath()
          ctx.moveTo(Math.round(px) + 0.5, plot.y)
          ctx.lineTo(Math.round(px) + 0.5, plot.y + plot.h)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        // 边缘刻度贴边对齐，避免与右侧色标/左侧轴标题互相覆盖
        ctx.textAlign = px > plot.x + plot.w - 30 ? 'right' : px < plot.x + 30 ? 'left' : 'center'
        ctx.globalAlpha = 0.85
        ctx.fillText(bHz ? fmtFreq(v) : String(Math.round(v)), px, plot.y + plot.h + 4)
        ctx.globalAlpha = 1
      }
    }

    const tickCount = 5
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < tickCount; i++) {
      const frac = i / (tickCount - 1)
      const py = plot.y + frac * plot.h
      if (props.grid !== false) {
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.moveTo(plot.x, Math.round(py) + 0.5)
        ctx.lineTo(plot.x + plot.w, Math.round(py) + 0.5)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.globalAlpha = 0.85
      const age = Math.round(frac * (count - 1))
      const t = rowTimeSec(age)
      const label = age === 0 ? '0' : t === undefined ? `-${age}` : `-${fmtDuration(Math.abs(t))}`
      ctx.fillStyle = text
      ctx.fillText(label, plot.x - 6, py)
      ctx.globalAlpha = 1
    }

    // 边框
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.8
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)
    ctx.globalAlpha = 1
  }

  // 轴标题
  drawAxisLabels(ctx, plot)

  // 参数栏
  if (props.showInfo !== false) {
    const info = tr('spectrogram.info', { rows: count, cols })
    const step = curTimeStepSec ? ` · Δt ${fmtDuration(curTimeStepSec)}` : ''
    const bw = bHz ? ` · Δf ${fmtFreq(bHz)}` : ''
    const label = `${info}${bw}${step} · ${props.colorMap}`
    ctx.font = '10px system-ui, -apple-system, sans-serif'
    const w = ctx.measureText(label).width + 12
    const infoY = plot.y + 6 + (paused ? 24 : 0)
    drawPanel(ctx, plot.x + 6, infoY, w, 18, th.value.labelChipBg)
    ctx.fillStyle = text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = 0.85
    ctx.fillText(label, plot.x + 12, infoY + 9)
    ctx.globalAlpha = 1
  }

  drawColorbar(ctx, plot)

  // 游标
  if (props.showCursor !== false && cursor) {
    const cx = Math.round(cursor.px) + 0.5
    const cy = Math.round(cursor.py) + 0.5
    ctx.strokeStyle = th.value.crosshair ?? border
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(cx, plot.y)
    ctx.lineTo(cx, plot.y + plot.h)
    ctx.moveTo(plot.x, cy)
    ctx.lineTo(plot.x + plot.w, cy)
    ctx.stroke()
    ctx.setLineDash([])
    const fracX = (cursor.px - plot.x) / plot.w
    const fracY = (cursor.py - plot.y) / plot.h
    const bin = Math.max(0, Math.min(cols - 1, Math.round(f0 + fracX * (f1 - f0))))
    const age = Math.max(0, Math.min(count - 1, Math.round(fracY * (count - 1))))
    const row = lastView.rows[age]
    if (row) {
      const db = row[bin] ?? -160
      const f = freqAtBin(bin)
      const t = rowTimeSec(age)
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      drawChip(
        ctx,
        cx,
        plot.y + plot.h + 3,
        bHz && f !== undefined ? fmtFreq(f) : `bin ${bin}`,
        th.value.labelChipBg,
        text
      )
      drawChip(ctx, Math.max(plot.x + 30, cx), cy, levelText(db), th.value.labelChipBg, text)
      const lines = [
        `${t !== undefined ? `t ${fmtDuration(t)}` : `row -${age}`}`,
        `${bHz && f !== undefined ? `f ${fmtFreq(f)}` : `bin ${bin}`}`,
        `L ${levelText(db)}`
      ]
      const panelW = 146
      const panelX = plot.x + plot.w - panelW - 8
      const panelY = plot.y + plot.h - lines.length * 15 - 12
      drawPanel(ctx, panelX, panelY, panelW, lines.length * 15 + 8, th.value.labelChipBg)
      ctx.textAlign = 'left'
      ctx.fillStyle = text
      lines.forEach((ln, i) => ctx.fillText(ln, panelX + 8, panelY + 10 + i * 15))
    }
  }
}

function drawAxisLabels(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number }
): void {
  if (props.axisLabels === false || props.axis === false) return
  const text = th.value.text
  ctx.save()
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = text
  ctx.globalAlpha = 0.55
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(plot.x + 8, plot.y + 14)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(props.labels?.y ?? tr('spectrogram.axisY'), 0, 0)
  ctx.restore()
  ctx.save()
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = text
  ctx.globalAlpha = 0.55
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(props.labels?.x ?? tr('spectrogram.axisX'), plot.x + plot.w - 6, plot.y + plot.h - 4)
  ctx.restore()
}

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number }
): void {
  if (props.showColorbar === false) return
  const x = plot.x + plot.w + COLORBAR_GAP
  const y = plot.y
  const w = COLORBAR_W
  const h = plot.h
  if (w <= 0 || h <= 0) return
  const n = lutBytes.length / 4
  for (let i = 0; i < h; i++) {
    const t = 1 - i / Math.max(1, h - 1)
    const k = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))
    ctx.fillStyle = `rgb(${lutBytes[k * 4]},${lutBytes[k * 4 + 1]},${lutBytes[k * 4 + 2]})`
    ctx.fillRect(x, y + i, w, 1)
  }
  ctx.strokeStyle = th.value.border
  ctx.globalAlpha = 0.9
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.globalAlpha = 1
  const lv = currentLevel()
  ctx.font = '10px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = th.value.text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(levelText(lv.max), x + w + 5, y + 6)
  ctx.fillText(levelText((lv.min + lv.max) / 2), x + w + 5, y + h / 2)
  ctx.fillText(levelText(lv.min), x + w + 5, y + h - 6)
}

// ── 交互 ──
function clientToPlot(evt: MouseEvent): { px: number; py: number } | null {
  const canvas = canvasRef.value
  if (!canvas || !lastView) return null
  const r = canvas.getBoundingClientRect()
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  const { plot } = lastView
  if (px < plot.x || px > plot.x + plot.w || py < plot.y || py > plot.y + plot.h) return null
  return { px, py }
}
function updateCursor(evt: MouseEvent): void {
  const p = clientToPlot(evt)
  const was = cursor
  cursor = p
  if ((was === null) !== (p === null) || (was && p && (was.px !== p.px || was.py !== p.py))) {
    if (p && lastView) {
      const { plot, freqStart: f0, freqEnd: f1, count, cols, rows } = lastView
      const fi = (p.px - plot.x) / plot.w
      const fy = (p.py - plot.y) / plot.h
      const bin = Math.max(0, Math.min(cols - 1, Math.round(f0 + fi * (f1 - f0))))
      const age = Math.max(0, Math.min(count - 1, Math.round(fy * (count - 1))))
      const row = rows[age]
      if (row) {
        const db = row[bin] ?? -160
        emit('cursorChange', {
          rowAge: age,
          bin,
          freqHz: freqAtBin(bin),
          timeSec: rowTimeSec(age),
          levelDb: db
        })
      } else {
        emit('cursorChange', null)
      }
    } else {
      emit('cursorChange', null)
    }
    scheduleOverlay()
  }
}
function onPointerEnter(): void {
  hovered = true
}
function onPointerLeave(): void {
  hovered = false
  if (cursor) {
    cursor = null
    emit('cursorChange', null)
    scheduleOverlay()
  }
}
function onWheel(evt: WheelEvent): void {
  if (!lastView || buffer.cols <= 0) return
  evt.preventDefault()
  const p = clientToPlot(evt)
  if (!p) return
  const { plot, freqStart: f0, freqEnd: f1 } = lastView
  const frac = (p.px - plot.x) / plot.w
  const anchor = f0 + frac * (f1 - f0)
  const factor = evt.deltaY > 0 ? 1.25 : 1 / 1.25
  const full = buffer.cols - 1
  let span = Math.max(MIN_FREQ_SPAN, (f1 - f0) * factor)
  span = Math.min(full, span)
  if (span >= full) {
    freqFull = true
    freqStart = 0
    freqEnd = full
  } else {
    freqFull = false
    let a = anchor - frac * span
    if (a < 0) a = 0
    if (a + span > full) a = full - span
    freqStart = a
    freqEnd = a + span
  }
  emit('frequencyChange', { startBin: freqStart, endBin: freqEnd, fullSpan: freqFull })
  schedule()
}
function onPointerDown(evt: PointerEvent): void {
  menu.show = false
  if (evt.button !== 0 || !lastView || buffer.cols <= 0) return
  if (evt.pointerType === 'touch') {
    ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (touchPts.size === 2) startPinch()
    return
  }
  const p = clientToPlot(evt)
  if (!p) return
  ;(evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId)
  drag = { px: p.px, start: lastView.freqStart, end: lastView.freqEnd }
  cursor = p
}
function onPointerMove(evt: PointerEvent): void {
  if (evt.pointerType === 'touch' && touchPts.has(evt.pointerId)) {
    touchPts.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    if (pinch && touchPts.size === 2) {
      updatePinch()
      return
    }
  }
  if (drag && lastView) {
    const r = canvasRef.value?.getBoundingClientRect()
    if (!r) return
    const px = evt.clientX - r.left
    const dx = px - drag.px
    const span = drag.end - drag.start
    const full = buffer.cols - 1
    if (span >= full - 1e-6) return
    let a = drag.start - (dx / lastView.plot.w) * span
    if (a < 0) a = 0
    if (a + span > full) a = full - span
    freqFull = false
    freqStart = a
    freqEnd = a + span
    emit('frequencyChange', { startBin: freqStart, endBin: freqEnd, fullSpan: false })
    schedule()
    return
  }
  updateCursor(evt)
}
function onPointerUp(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (pinch && touchPts.size < 2) pinch = null
    return
  }
  drag = null
}
function onPointerCancel(evt: PointerEvent): void {
  ;(evt.currentTarget as HTMLElement).releasePointerCapture?.(evt.pointerId)
  if (evt.pointerType === 'touch') {
    touchPts.delete(evt.pointerId)
    if (touchPts.size < 2) pinch = null
    return
  }
  drag = null
}
function onDblClick(): void {
  setPaused(!paused)
}
function setPaused(v: boolean): void {
  if (paused === v) return
  paused = v
  pausedUi.value = v
  if (v) {
    frozenRows = buffer.copyRows(buffer.displayCount(props.timeSpan))
    frozenTexValid = false
    if (staleTimer) {
      clearTimeout(staleTimer)
      staleTimer = null
    }
    dataStale.value = false
  } else {
    frozenRows = null
    frozenTexValid = false
    texValid = false
    armStaleTimer()
  }
  emit('update:paused', v)
  schedule()
}

function onContextMenu(evt: MouseEvent): void {
  evt.preventDefault()
  const root = rootRef.value
  if (!root || !lastView) return
  const rr = root.getBoundingClientRect()
  const px = evt.clientX - rr.left
  const py = evt.clientY - rr.top
  menu.x = Math.min(Math.max(4, px), Math.max(4, rr.width - 190))
  menu.y = Math.min(Math.max(4, py), Math.max(4, rr.height - 190))
  if (lastView.count > 0) {
    const bin = Math.round(
      lastView.freqStart +
        ((px - lastView.plot.x) / lastView.plot.w) * (lastView.freqEnd - lastView.freqStart)
    )
    const age = Math.round(((py - lastView.plot.y) / lastView.plot.h) * (lastView.count - 1))
    menu.bin = Math.max(0, Math.min(lastView.cols - 1, bin))
    menu.rowAge = Math.max(0, Math.min(lastView.count - 1, age))
  }
  emit('contextmenu', { x: px, y: py, bin: menu.bin, rowAge: menu.rowAge })
  if (props.contextMenu === false) return
  menu.show = true
  scheduleOverlay()
}

function menuAction(act: 'pause' | 'clear' | 'reset' | 'png' | 'csv'): void {
  menu.show = false
  if (act === 'pause') setPaused(!paused)
  else if (act === 'clear') clear()
  else if (act === 'reset') resetFreqView()
  else if (act === 'png') exportPNG()
  else if (act === 'csv') exportCSV()
  scheduleOverlay()
}

// ── 导出 ──
function compositeCanvas(): HTMLCanvasElement {
  const savedCursor = cursor
  cursor = null
  const out = document.createElement('canvas')
  try {
    draw()
    const main = canvasRef.value
    const ov = overlayRef.value
    if (main && ov) {
      out.width = main.width
      out.height = main.height
      const c = out.getContext('2d')
      if (c) {
        c.drawImage(main, 0, 0, out.width, out.height)
        c.drawImage(ov, 0, 0, out.width, out.height)
      }
    }
    return out
  } finally {
    cursor = savedCursor
    scheduleOverlay()
  }
}
function pngFilename(): string {
  return `spectrogram-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
}
function exportPNG(): void {
  try {
    deliverExport({
      kind: 'png',
      filename: pngFilename(),
      dataUrl: compositeCanvas().toDataURL('image/png')
    })
  } catch (e) {
    reportError('export', e instanceof Error ? e.message : String(e))
  }
}
async function exportPNGAsync(): Promise<void> {
  try {
    const filename = pngFilename()
    const out = compositeCanvas()
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (!blob) {
      reportError('export', tr('common.pngEncodeFailed'))
      return
    }
    deliverExport({ kind: 'png', filename, blob })
  } catch (e) {
    reportError('export', e instanceof Error ? e.message : String(e))
  }
}
function exportCSV(opts?: { maxRows?: number }): void {
  try {
    const rows = paused ? (frozenRows ?? []) : visibleRows()
    if (rows.length === 0 || buffer.cols === 0) {
      reportError('export', tr('spectrogram.exportEmpty'))
      return
    }
    const cols = buffer.cols
    const maxCells = 1_000_000
    const maxRows = Math.max(
      1,
      Math.min(rows.length, opts?.maxRows ?? rows.length, Math.floor(maxCells / Math.max(1, cols)))
    )
    const b = binHz()
    const header = ['time_s']
    for (let i = 0; i < cols; i++)
      header.push(b ? String((freqAtBin(i) ?? 0).toFixed(6)) : String(i))
    const lines = [header.join(',')]
    for (let age = 0; age < maxRows; age++) {
      const row = rows[age]!
      const t = rowTimeSec(age)
      const line = [t !== undefined ? t.toFixed(6) : String(-age)]
      for (let i = 0; i < cols; i++) line.push(String(row[i] ?? ''))
      lines.push(line.join(','))
    }
    deliverExport({
      kind: 'csv',
      filename: `spectrogram-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      text: lines.join('\n')
    })
  } catch (e) {
    reportError('export', e instanceof Error ? e.message : String(e))
  }
}
function deliverExport(p: ExportPayload): void {
  const handler = props.exportHandler
  if (handler) {
    try {
      Promise.resolve(handler(p)).catch((e: unknown) =>
        reportError('export', e instanceof Error ? e.message : String(e))
      )
    } catch (e) {
      reportError('export', e instanceof Error ? e.message : String(e))
    }
  } else {
    const a = document.createElement('a')
    if (p.kind === 'png') {
      if (p.dataUrl) a.href = p.dataUrl
      else if (p.blob) {
        a.href = URL.createObjectURL(p.blob)
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      } else {
        reportError('export', tr('common.pngMissing'))
        return
      }
    } else {
      const blob = new Blob([p.text ?? ''], { type: 'text/csv;charset=utf-8' })
      a.href = URL.createObjectURL(blob)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    a.download = p.filename
    a.click()
  }
  emit('exported', { kind: p.kind, filename: p.filename })
}

// ── 运行时 API ──
function getStats(): SpectrogramStats {
  return {
    rows: buffer.count,
    capacity: buffer.capacity,
    cols: buffer.cols,
    fftSize: curFftSize,
    sampleRate: curSampleRate,
    timeStepSec: curTimeStepSec,
    dbMin: currentLevel().min,
    dbMax: currentLevel().max,
    paused
  }
}
function getVisibleData(): SpectrogramVisibleData | null {
  if (buffer.cols === 0 || buffer.count === 0) return null
  const rows = paused
    ? (frozenRows ?? []).map((r) => r.slice())
    : buffer.copyRows(buffer.displayCount(props.timeSpan))
  if (rows.length === 0) return null
  return {
    rows,
    cols: buffer.cols,
    newestSeq: buffer.seq,
    fftSize: curFftSize,
    sampleRate: curSampleRate,
    timeStepSec: curTimeStepSec,
    freqOffsetHz: props.freqOffsetHz
  }
}
function setLevelRange(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return
  level.auto = false
  level.min = min
  level.max = max
  emit('update:dbMin', min)
  emit('update:dbMax', max)
  emit('levelChange', { min, max })
  texValid = false
  schedule()
}

// ── 生命周期/后端 ──
function setupGl(): boolean {
  const canvas = canvasRef.value
  if (!canvas) return false
  gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: props.preserveDrawingBuffer !== false
  }) as WebGL2RenderingContext | null
  if (!gl) return false
  glRenderer = new SpectrogramGlRenderer(gl)
  glRenderer.setLut(lutBytes)
  glRenderer.setInterpolation(props.interpolation)
  texInterp = props.interpolation
  texValid = false
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  return true
}
function setupCanvas2d(): boolean {
  const canvas = canvasRef.value
  if (!canvas) return false
  ctx2d = canvas.getContext('2d')
  if (!ctx2d) return false
  canvasRenderer = new SpectrogramCanvasRenderer()
  return true
}
function onContextLost(evt: Event): void {
  evt.preventDefault()
  contextLost = true
  emit('contextLost')
}
function onContextRestored(): void {
  contextLost = false
  try {
    glRenderer?.dispose()
    glRenderer = null
    if (gl) {
      glRenderer = new SpectrogramGlRenderer(gl)
      glRenderer.setLut(lutBytes)
      glRenderer.setInterpolation(props.interpolation)
      texInterp = props.interpolation
      lutDirty = false
    }
    texValid = false
    emit('contextRestored')
    schedule()
  } catch (e) {
    reportError('webgl', e instanceof Error ? e.message : String(e))
  }
}
function drawUnsupported(msg: string): void {
  const ov = overlayRef.value
  if (!ov) return
  const ctx = ov.getContext('2d')
  if (!ctx) return
  const r = ov.getBoundingClientRect()
  const sx = ov.width / Math.max(1, r.width)
  const sy = ov.height / Math.max(1, r.height)
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.clearRect(0, 0, r.width, r.height)
  ctx.fillStyle = th.value.text
  ctx.font = '13px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(msg, r.width / 2, r.height / 2)
}

let ioRef: IntersectionObserver | null = null

const glChart = useGlChart(canvasRef, {
  fpsLimit: () => props.fpsLimit,
  onResize: (w, h) => {
    const ov = overlayRef.value
    if (ov && (ov.width !== w || ov.height !== h)) {
      ov.width = w
      ov.height = h
    }
    schedule()
  },
  onDraw: schedule
})
glChartResize = glChart.resize

onMounted(async () => {
  await nextTick()
  const canvas = canvasRef.value
  const ov = overlayRef.value
  if (!canvas || !ov) return
  glChartResize?.()
  ov.width = canvas.width
  ov.height = canvas.height
  const backend = props.renderer ?? 'auto'
  let ok = false
  if (backend !== 'canvas2d') {
    try {
      ok = setupGl()
    } catch (e) {
      reportError('webgl', e instanceof Error ? e.message : String(e))
      gl = null
      ok = false
    }
  }
  if (!ok && backend !== 'webgl2') ok = setupCanvas2d()
  if (!ok) {
    reportError('webgl', tr('spectrogram.webglUnsupported'))
    drawUnsupported(tr('spectrogram.webglUnsupported'))
    return
  }
  ov.width = canvas.width
  ov.height = canvas.height
  if (props.autoLevel) {
    refreshAutoLevel(true)
  }
  if (props.data !== undefined) setData(props.data)
  draw()
  emit('ready')
  if (typeof IntersectionObserver !== 'undefined' && rootRef.value) {
    const io = new IntersectionObserver(
      (entries) => {
        const next = entries[entries.length - 1]?.isIntersecting ?? true
        if (next === visible) return
        visible = next
        if (visible) schedule()
      },
      { threshold: 0 }
    )
    io.observe(rootRef.value)
    ioRef = io
  }
  window.addEventListener('keydown', onKeyDown)
})

function onKeyDown(evt: KeyboardEvent): void {
  if (!hovered && !focused.value) return
  const t = evt.target as HTMLElement | null
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  if (evt.key === 'f' || evt.key === 'F') {
    evt.preventDefault()
    setPaused(!paused)
  } else if (evt.key === '0') {
    evt.preventDefault()
    resetFreqView()
  } else if (evt.key === 'Escape') {
    menu.show = false
    scheduleOverlay()
  }
}

let cleanupDone = false
function dispose(): void {
  if (cleanupDone) return
  cleanupDone = true
  disposed = true
  if (raf) cancelAnimationFrame(raf)
  if (overlayRaf) cancelAnimationFrame(overlayRaf)
  raf = 0
  overlayRaf = 0
  if (staleTimer) clearTimeout(staleTimer)
  staleTimer = null
  ioRef?.disconnect()
  ioRef = null
  touchPts.clear()
  pinch = null
  const canvas = canvasRef.value
  canvas?.removeEventListener('webglcontextlost', onContextLost)
  canvas?.removeEventListener('webglcontextrestored', onContextRestored)
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
  glRenderer?.dispose()
  glRenderer = null
  canvasRenderer?.dispose()
  canvasRenderer = null
  ctx2d = null
  gl = null
}

watch(
  () => props.data,
  (v) => {
    if (v !== undefined) setData(v)
  }
)
watch(
  () => props.paused,
  (v) => setPaused(v)
)
watch(
  () => [props.timeSpan, props.maxRows],
  () => {
    buffer.configure(buffer.cols, initialCapacity())
    texValid = false
    if (!paused) {
      frozenRows = null
    } else if (frozenRows) {
      const span = Number.isFinite(props.timeSpan)
        ? Math.max(1, Math.floor(props.timeSpan))
        : frozenRows.length
      const limit = Math.max(1, Math.min(initialCapacity(), span))
      if (frozenRows.length > limit) frozenRows = frozenRows.slice(0, limit)
    }
    frozenTexValid = false
    clampFreqView()
    schedule()
  }
)
watch(
  () => [props.sampleRate, props.fftSize, props.timeStepSec],
  () => {
    updateDerivedMeta()
    schedule()
  }
)
watch(
  () => [props.dbMin, props.dbMax],
  ([a, b]) => {
    if (!level.auto) {
      level.min = Number(a)
      level.max = Number(b)
      texValid = false
      schedule()
    }
  }
)
watch(
  () => props.autoLevel,
  (v) => {
    level.auto = v
    if (v) {
      refreshAutoLevel(true)
    } else {
      level.min = props.dbMin
      level.max = props.dbMax
    }
    texValid = false
    schedule()
  }
)
watch(
  () => props.gamma,
  () => {
    texValid = false
    schedule()
  }
)
watch(
  () => props.colorMap,
  () => {
    lutBytes = colorMapLut(props.colorMap, 256)
    lut32 = lutToUint32(lutBytes)
    lutMapKey = props.colorMap
    lutDirty = true
    if (glRenderer) glRenderer.setLut(lutBytes)
    schedule()
  }
)
watch(
  () => props.theme,
  () => schedule()
)
watch(prefersDark, () => schedule())
watch(
  () => props.chartStyle,
  () => schedule(),
  { deep: true }
)
watch(
  () => props.interpolation,
  () => {
    if (glRenderer) {
      glRenderer.setInterpolation(props.interpolation)
      texInterp = props.interpolation
    }
    schedule()
  }
)
watch(
  () => props.viewport,
  (v) => {
    if (!v) return
    if (typeof v.xMin === 'number' && typeof v.xMax === 'number' && v.xMax > v.xMin) {
      if (buffer.cols > 0) setFrequencyView(v.xMin, v.xMax)
      else pendingFreqView = { a: v.xMin, b: v.xMax }
    }
  },
  { immediate: true, deep: true }
)
watch(
  () => props.showColorbar,
  () => schedule()
)
watch(
  [
    () => props.unit,
    () => props.ampOffsetDb,
    () => props.freqOffsetHz,
    () => props.showInfo,
    () => props.showCursor,
    () => props.axis,
    () => props.xAxis,
    () => props.grid,
    () => props.axisLabels,
    () => props.labels,
    () => props.locale,
    () => props.messages
  ],
  () => schedule(),
  { deep: true }
)
onUnmounted(dispose)

defineExpose({
  appendData,
  setData,
  clear,
  setPaused,
  setLevelRange,
  setFrequencyRange: setFrequencyView,
  resetView: resetFreqView,
  getStats,
  getVisibleData,
  getRows: () => buffer.count,
  getView: () => ({ freqStart, freqEnd, fullSpan: freqFull, paused }),
  resize: () => {
    glChartResize?.()
    schedule()
  },
  redraw: () => schedule(),
  exportPNG,
  exportPNGAsync,
  exportCSV,
  dispose
})
</script>

<template>
  <div
    ref="rootRef"
    class="sig-specgram"
    :class="th.darkLike ? 'sig-dark' : 'sig-light'"
    tabindex="0"
    role="application"
    :aria-label="props.labels?.aria ?? tr('spectrogram.aria')"
    :style="{
      width: cssSize(props.width, '100%'),
      height: cssSize(props.height, '300px'),
      background: th.bg,
      borderColor: th.border,
      '--sig-bg': th.bg,
      '--sig-text': th.text,
      '--sig-border': th.border
    }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @contextmenu.prevent="onContextMenu"
    @dblclick="onDblClick"
    @focus="focused = true"
    @blur="focused = false"
  >
    <canvas ref="canvasRef" class="sig-canvas" />
    <canvas ref="overlayRef" class="sig-overlay" />
    <div class="sig-host-overlay"><slot name="overlay" /></div>
    <div
      v-if="pausedUi"
      class="sig-frozen-badge"
      :title="tr('spectrogram.pausedTitle')"
      @click="setPaused(false)"
      @pointerdown.stop
      @dblclick.stop
    >
      {{ props.labels?.paused ?? tr('spectrogram.paused') }}
    </div>
    <div
      v-if="dataStale"
      class="sig-stale-badge"
      :title="tr('common.staleTitle')"
      @pointerdown.stop
    >
      {{ props.labels?.stale ?? tr('common.stale') }}
    </div>
    <div
      v-if="menu.show"
      class="sig-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <div class="sig-menu-item" @click.stop="menuAction('pause')" @pointerdown.stop @dblclick.stop>
        {{ paused ? tr('spectrogram.menuResume') : tr('spectrogram.menuPause') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('reset')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrogram.menuReset') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('clear')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrogram.menuClear') }}
      </div>
      <div class="sig-menu-sep" />
      <div class="sig-menu-item" @click.stop="menuAction('png')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrogram.menuExportPng') }}
      </div>
      <div class="sig-menu-item" @click.stop="menuAction('csv')" @pointerdown.stop @dblclick.stop>
        {{ tr('spectrogram.menuExportCsv') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sig-specgram {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--sig-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sig-bg, #fff);
  user-select: none;
  touch-action: none;
}
.sig-specgram:focus-visible {
  outline: 1px solid var(--sig-border);
  outline-offset: -1px;
}
.sig-dark {
  --sig-bg: #0f1115;
  --sig-border: #2a2e39;
  --sig-text: #c9d1d9;
}
.sig-light {
  --sig-bg: #fff;
  --sig-border: #e6e8eb;
  --sig-text: #1f2328;
}
.sig-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.sig-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.sig-host-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.sig-frozen-badge,
.sig-stale-badge {
  position: absolute;
  top: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--sig-text);
  background: color-mix(in srgb, var(--sig-bg) 82%, transparent);
  border: 1px solid var(--sig-border);
}
.sig-frozen-badge {
  left: 10px;
}
.sig-stale-badge {
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  cursor: default;
  color: #d9822b;
  border-color: #d9822b;
}
.sig-menu {
  position: absolute;
  z-index: 10;
  min-width: 150px;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--sig-border);
  background: color-mix(in srgb, var(--sig-bg) 96%, transparent);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
}
.sig-menu-item {
  padding: 5px 10px;
  font-size: 12px;
  color: var(--sig-text);
  border-radius: 4px;
  cursor: pointer;
}
.sig-menu-item:hover {
  background: rgba(127, 127, 127, 0.16);
}
.sig-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--sig-border);
}
</style>
