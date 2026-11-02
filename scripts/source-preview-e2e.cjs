/**
 * 源工作台频谱预览回归：
 * 源输出 complex 时，预览必须是双边复谱；修改分析配置 spectrumMode=real
 * 不得改变源工作台预览。
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

app.whenReady().then(async () => {
  try {
    await wait(2200)
    const win = BrowserWindow.getAllWindows()[0]
    assert(win, 'main window not found')
    const js = (code) => win.webContents.executeJavaScript(code, true)

    await js(`location.hash = '#/source'`)
    await wait(600)
    await js(`window.api.source.setConfig({ outputMode: 'complex' })`)
    await wait(200)
    // 重新进入页面以回填 complex
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
    assert(started, 'start button not found')
    await wait(1000)
    const tabbed = await js(`(() => {
      const tab = [...document.querySelectorAll('.n-tabs-tab')].find((x) => x.textContent.trim() === '频谱')
      if (!tab) return false
      tab.click()
      return true
    })()`)
    assert(tabbed, 'spectrum tab not found')
    await wait(400)

    const before = await js(`document.querySelector('.preview-note')?.innerText || ''`)
    assert(before.includes('复谱双边'), `source preview not complex: ${before}`)
    assert(before.includes('不受「分析配置」影响'), 'source preview independence hint missing')

    await js(`window.api.signalAnalysis.setConfig({ spectrumMode: 'real' })`)
    await wait(500)
    const after = await js(`document.querySelector('.preview-note')?.innerText || ''`)
    const analysis = await js(`window.api.signalAnalysis.getStatus()`)
    assert(analysis.config?.spectrumMode === 'real', 'analysis spectrumMode did not become real')
    assert(after.includes('复谱双边'), `analysis config changed source preview: ${after}`)
    assert(after === before, 'source preview note changed after analysis config')

    await js(`window.api.signalAnalysis.stop()`)
    await js(`window.api.source.stop()`)
    console.log(`[source-preview] PASS before=${JSON.stringify(before)}`)
    app.exit(0)
  } catch (e) {
    console.error('[source-preview] FAIL', e)
    app.exit(1)
  }
})
