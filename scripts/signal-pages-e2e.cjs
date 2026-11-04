/**
 * 测量页 source-only 回归：PowerTime/Eye/Persistence/APD 不再有数据源切换，
 * 启动信号源后必须收到真实 source IQ/频谱数据。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
require(path.resolve(__dirname, '../out/main/index.js'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    await wait(2200)
    const win = BrowserWindow.getAllWindows()[0]
    const js = (code) => win.webContents.executeJavaScript(code, true)
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
    if (!started) throw new Error('start source failed')
    await wait(900)

    const pages = [
      ['/signal/power-time', '功率-时间'],
      ['/signal/eye', '眼图'],
      ['/signal/persistence', '持续谱'],
      ['/signal/apd', 'APD/CCDF']
    ]
    const out = []
    for (const [route, title] of pages) {
      await js(`location.hash = ${JSON.stringify('#' + route)}`)
      await wait(1000)
      const info = await js(`({
        header: document.querySelector('.header > .n-text')?.textContent || '',
        body: document.body.innerText,
        selects: document.querySelectorAll('.n-select').length,
        canvases: document.querySelectorAll('canvas').length
      })`)
      if (info.header.trim() !== title) throw new Error(`${route} header ${info.header}`)
      if (!info.body.includes('数据源固定为')) throw new Error(`${route} no source-only hint`)
      if (info.selects !== 0) throw new Error(`${route} still has ${info.selects} selects`)
      const metric = info.body.match(/(\d+)\s*(脉冲|轨迹|帧|样本)/)
      if (!metric || Number(metric[1]) <= 0) throw new Error(`${route} received no source data`)
      out.push({
        route,
        hint: info.body.includes('数据源固定为'),
        selects: info.selects,
        canvases: info.canvases,
        metric: metric[0]
      })
    }
    await js(`window.api.source.stop()`)
    console.log(JSON.stringify(out, null, 2))
    console.log('[source-only] PASS')
    app.exit(0)
  } catch (e) {
    console.error('[source-only] FAIL', e)
    app.exit(1)
  }
})
