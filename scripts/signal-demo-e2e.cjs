/**
 * 信号分析演示页回归（IQ / 频谱 / 时频 / 星座）
 *
 * 为什么单独一套：这 4 个页面是信号板块里最复杂的（合计 2000+ 行），但既不在
 * section-sweep（只扫 30 个 Electron 教学页 + 13 个 TS 页）里，也不在
 * signal-pages-e2e（只测 power-time/eye/persistence/apd）里——属于"回归盲区"。
 *
 * 断言（每页）：
 *   1. 卡片标题正确（页面确实渲染了这张图，而不是白屏/报错页）
 *   2. 两个 canvas（波形层 + 轴层）都存在且 CSS 尺寸 > 100（布局没塌）
 *   3. 轴层有实际绘制（非透明像素 > 1 万）——证明 overlay 真的画了
 *   4. 两次采样的像素指纹不同——证明"画面在随帧更新"（数据通路活着）
 *   5. 无 console error、页面文本无 NaN/undefined
 *
 * 全局断言：
 *   6. 源帧与信号分析帧都到达渲染层（订阅计数 > 0）
 *   7. 渲染层未捕获错误会上报到主进程日志（error:report 链路），且同一条被去重
 */

const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PAGES = [
  { route: '/signal/iq', title: 'IQ 时域（可复制组件演示）' },
  { route: '/signal/spectrum', title: '频谱仪（Spectrum Analyzer）' },
  { route: '/signal/spectrogram', title: '时频图（瀑布）' },
  { route: '/signal/constellation', title: '星座图' }
]

/** 轴层像素统计：ink = alpha>8 的像素数（证明轴/刻度真的画了） */
const OVERLAY_STATS = `(() => {
  const cvs = [...document.querySelectorAll('canvas')]
  const overlay = cvs.find((c) => c.className && c.className.includes('overlay')) || cvs[1]
  if (!overlay) return null
  const ctx = overlay.getContext('2d')
  if (!ctx) return null
  const x0 = 50, y0 = 20
  const w = Math.max(1, Math.min(overlay.width - x0, 700))
  const h = Math.max(1, Math.min(overlay.height - y0, 400))
  let data
  try { data = ctx.getImageData(x0, y0, w, h).data } catch (e) { return { err: String(e) } }
  let ink = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) ink++
  return { ink, w: overlay.width, h: overlay.height, cssW: overlay.clientWidth, cssH: overlay.clientHeight }
})()`

/** 图表区域在页面中的 CSS 矩形（用于截图比对"画面是否在动"） */
const CHART_RECT = `(() => {
  const c = document.querySelector('canvas')
  if (!c) return null
  const r = c.getBoundingClientRect()
  if (!(r.width > 100 && r.height > 100)) return null
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
})()`

/** 位图抽样指纹（FNV-1a；跨步取样，只为判断"是否变化"，不追求抗碰撞） */
function hashBitmap(buf) {
  let hash = 2166136261
  const stride = Math.max(4, Math.floor(buf.length / 20000))
  for (let i = 0; i < buf.length; i += stride) {
    hash ^= buf[i]
    hash = (hash * 16777619) >>> 0
  }
  return `${buf.length}:${hash}`
}

/** 把图表矩形裁进内容区，避免 capturePage 越界 */
function clampRect(rect, contentSize) {
  const [cw, ch] = contentSize
  const x = Math.max(0, Math.min(rect.x, cw - 2))
  const y = Math.max(0, Math.min(rect.y, ch - 2))
  return {
    x,
    y,
    width: Math.max(2, Math.min(rect.width, cw - x)),
    height: Math.max(2, Math.min(rect.height, ch - y))
  }
}

const PAGE_INFO = `(() => {
  const cards = [...document.querySelectorAll('.n-card-header__main')].map((e) => e.textContent.trim())
  const body = document.body.innerText
  return {
    cards,
    canvas: document.querySelectorAll('canvas').length,
    bodyLen: body.length,
    hasNaN: body.includes('NaN'),
    hasUndefined: body.includes('undefined'),
    body
  }
})()`

app.whenReady().then(async () => {
  try {
    await wait(2200)
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('主窗口未创建')

    /** 每个页面阶段内的 console error（level >= 3） */
    const consoleErrors = []
    win.webContents.on('console-message', (event) => {
      const level = typeof event?.level === 'number' ? event.level : 0
      const message = typeof event?.message === 'string' ? event.message : String(event)
      if (level >= 3) consoleErrors.push({ at: Date.now(), message })
    })
    const js = (code) => win.webContents.executeJavaScript(code, true)

    // ── 启动信号源（工作台的"启动"按钮同时拉起本地分析消费者）──
    await js(`location.hash = '#/source'`)
    await wait(700)
    await js(`window.api.source.setConfig({
      waveform: 'pulse', outputMode: 'complex', freq: 512, sampleRate: 4096,
      pointsPerFrame: 2048, pulsePeriod: 0.01, pulseDuty: 0.5
    })`)
    await wait(200)
    await js(`location.hash = '#/'`)
    await wait(300)
    await js(`location.hash = '#/source'`)
    await wait(700)
    const started = await js(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('启动'))
      if (!b) return false
      b.click()
      return true
    })()`)
    if (!started) throw new Error('未找到源工作台的"启动"按钮')
    await wait(1500)

    // ── 在渲染层挂两个计数器，证明"帧确实到了渲染进程"──
    // 注意：signal:analysis 只投递给"订阅过"的窗口，所以计数器必须同时调用 subscribe()
    // （页面自己通过 useSignalAnalysis 订阅；这里独立订阅一份用于统计）
    await js(`(() => {
      window.__frameCount = { source: 0, analysis: 0 }
      window.__frameDisposers = []
      window.__frameDisposers.push(window.api.source.onFrame(() => { window.__frameCount.source++ }))
      window.__frameDisposers.push(window.api.signalAnalysis.onFrame(() => { window.__frameCount.analysis++ }))
      void window.api.source.subscribe()
      void window.api.signalAnalysis.subscribe()
      return true
    })()`)
    await wait(1200)
    const frames = await js(`window.__frameCount`)
    if (!(frames.source > 0)) throw new Error(`源帧未到达渲染层: ${JSON.stringify(frames)}`)
    if (!(frames.analysis > 0)) throw new Error(`分析帧未到达渲染层: ${JSON.stringify(frames)}`)
    console.log(`[signal-demo] 帧计数 source=${frames.source} analysis=${frames.analysis}`)

    // ── 逐页断言 ──
    const results = []
    for (const page of PAGES) {
      const errBefore = consoleErrors.length
      await js(`location.hash = ${JSON.stringify('#' + page.route)}`)
      await wait(1600)

      const info = await js(PAGE_INFO)
      const statA = await js(OVERLAY_STATS)
      // 活体检测：对图表区域截图两次，画面必须变化（GL/2D 都能覆盖到）
      const rect = await js(CHART_RECT)
      if (!rect) throw new Error(`${page.route} 找不到图表 canvas 矩形`)
      const shotA = await win.webContents.capturePage(clampRect(rect, win.getContentSize()))
      const hashA = hashBitmap(shotA.toBitmap())
      await wait(1200)
      const shotB = await win.webContents.capturePage(clampRect(rect, win.getContentSize()))
      const hashB = hashBitmap(shotB.toBitmap())
      const errs = consoleErrors.length - errBefore

      if (!info.cards.some((c) => c.includes(page.title))) {
        throw new Error(`${page.route} 卡片标题不符，实际=${JSON.stringify(info.cards)}`)
      }
      if (info.canvas < 2) throw new Error(`${page.route} canvas 数量=${info.canvas}（期望 ≥2）`)
      if (!statA || statA.err)
        throw new Error(`${page.route} 读不到轴层像素: ${JSON.stringify(statA)}`)
      if (!(statA.cssW > 100 && statA.cssH > 100)) {
        throw new Error(`${page.route} 图表尺寸异常 cssW=${statA.cssW} cssH=${statA.cssH}`)
      }
      if (!(statA.ink > 10000)) throw new Error(`${page.route} 轴层几乎空白 ink=${statA.ink}`)
      if (hashA === hashB) {
        throw new Error(`${page.route} 画面未随帧更新（两次截图一致，数据通路可能断了）`)
      }
      if (errs > 0) {
        throw new Error(
          `${page.route} 有 ${errs} 条 console error: ${consoleErrors
            .slice(errBefore)
            .map((e) => e.message)
            .join(' | ')
            .slice(0, 300)}`
        )
      }
      if (info.hasNaN) throw new Error(`${page.route} 页面文本出现 NaN`)
      if (info.hasUndefined) throw new Error(`${page.route} 页面文本出现 undefined`)

      // 页面专属特征
      if (page.route === '/signal/spectrogram') {
        const m = /(\d+)\s*行\s*\/\s*(\d+)\s*bin/.exec(info.body)
        if (!m) throw new Error(`${page.route} 未显示"行/bin"统计`)
        if (Number(m[1]) <= 0) throw new Error(`${page.route} 瀑布行数=0（没收到数据）`)
      }
      if (page.route === '/signal/constellation' && !/webgl2|canvas2d/.test(info.body)) {
        throw new Error(`${page.route} 未显示渲染后端`)
      }
      if (page.route === '/signal/spectrum' && /Ref\s*—/.test(info.body)) {
        throw new Error(`${page.route} 帧元数据未到货（Ref 仍是占位符）`)
      }

      results.push({
        route: page.route,
        title: page.title,
        canvas: info.canvas,
        ink: statA.ink,
        cssW: statA.cssW,
        cssH: statA.cssH,
        live: hashA !== hashB
      })
      console.log(
        `[signal-demo] ${page.route} canvas=${info.canvas} ink=${statA.ink} ` +
          `${statA.cssW}x${statA.cssH} live=${hashA !== hashB}`
      )
    }

    // ── 渲染层错误上报链路（error:report）──
    await js(`(() => {
      // 不返回被拒绝的 Promise，否则 executeJavaScript 自己会 reject
      Promise.reject(new Error('e2e-renderer-rejection'))
      return 1
    })()`)
    await wait(600)
    let logs = await js(`window.api.error.getLogs()`)
    const hits = logs.filter((r) => String(r.message).includes('e2e-renderer-rejection'))
    if (hits.length !== 1) {
      throw new Error(`渲染层错误上报异常：期望 1 条日志，实际 ${hits.length} 条`)
    }
    if (hits[0].type !== 'unhandledrejection') {
      throw new Error(`渲染层错误类型不符：${hits[0].type}（期望 unhandledrejection）`)
    }

    // 去重：同一错误立刻再抛一次，窗口期内不应重复入账
    await js(`(() => { Promise.reject(new Error('e2e-renderer-rejection')); return 1 })()`)
    await wait(300)
    logs = await js(`window.api.error.getLogs()`)
    const dupHits = logs.filter((r) => String(r.message).includes('e2e-renderer-rejection'))
    if (dupHits.length !== 1) {
      throw new Error(`渲染层错误去重失效：重复上报后日志有 ${dupHits.length} 条`)
    }
    console.log('[signal-demo] 渲染层错误上报 + 去重 OK')

    await js(`window.__frameDisposers.forEach((d) => d && d())`)
    await js(`window.api.source.stop()`)
    console.log(
      `[signal-demo] PASS pages=${results.length} frames=${frames.source}/${frames.analysis}`
    )
    console.log(JSON.stringify(results, null, 2))
    app.exit(0)
  } catch (e) {
    console.error('[signal-demo] FAIL', e && e.stack ? e.stack : e)
    app.exit(1)
  }
})
