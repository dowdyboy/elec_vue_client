/**
 * 源工作台路由 UI smoke：用构建后的 renderer + 真实 preload 加载 #/source。
 * 不启动主进程 IPC 服务，只验证页面能渲染、无同步崩溃、截图非空。
 */
if (!process.versions.electron) {
  console.error('[source-ui] must run under Electron')
  process.exit(1)
}

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const renderer = path.join(root, 'out/renderer/index.html')
const preload = path.join(root, 'scripts/source-preload.cjs')
const out = path.join(root, 'playground/dist/source-workbench.png')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu-sandbox')

async function run() {
  const win = new BrowserWindow({
    width: 1500,
    height: 1000,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(String(message))
  })
  await win.loadFile(renderer, { hash: '/source' })
  await wait(1200)
  const text = await win.webContents.executeJavaScript('document.body.innerText || ""')
  if (!text.includes('信号源工作台')) throw new Error(`source page text missing: ${text.slice(0, 300)}`)
  await win.webContents.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('启动'))
      if (b) b.click()
    })()
  `)
  await wait(400)
  const started = await win.webContents.executeJavaScript('document.body.innerText.includes("运行中")')
  if (!started) throw new Error('source start did not switch UI to running')
  const img = await win.webContents.capturePage()
  fs.writeFileSync(out, img.toPNG())
  if (errors.length) throw new Error(`console errors: ${errors.join('; ')}`)
  console.log(`[source-ui] PASS ${out}`)
}

app
  .whenReady()
  .then(async () => {
    try {
      await run()
      app.exit(0)
    } catch (e) {
      console.error(e && e.stack ? e.stack : String(e))
      app.exit(1)
    }
  })
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
