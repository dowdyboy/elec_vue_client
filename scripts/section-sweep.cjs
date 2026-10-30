/**
 * 真实应用路由巡检：加载生产构建的完整 main + preload，逐页导航
 * Electron 教学 / TypeScript 惯用法，检查标题、菜单、页面内容与 renderer 异常。
 * 运行：npx electron scripts/section-sweep.cjs
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

require(path.resolve(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const ELECTRON = [
  ['/window', '窗口管理'],
  ['/ipc', 'IPC 通信'],
  ['/tray', '系统托盘'],
  ['/notification', '系统通知'],
  ['/shortcut', '全局快捷键'],
  ['/clipboard', '剪贴板'],
  ['/dialog', '文件对话框'],
  ['/fs', '文件系统'],
  ['/paths', '数据目录'],
  ['/menu', '原生菜单'],
  ['/screen', '屏幕信息'],
  ['/theme', '系统主题'],
  ['/sockets', 'TCP/UDP 通信'],
  ['/serial', '串口通信'],
  ['/network', '网络通信'],
  ['/download', '下载管理'],
  ['/session', '会话管理'],
  ['/database', 'SQLite 数据库'],
  ['/better-sqlite', '第三方 SQLite'],
  ['/safe-storage', '加密存储'],
  ['/platform', '平台特性'],
  ['/capture', '桌面捕获'],
  ['/media', '媒体捕获'],
  ['/print', '打印 PDF'],
  ['/protocol', '协议与深链接'],
  ['/update', '自动更新'],
  ['/performance', '计算性能'],
  ['/gpu', 'GPU 信息'],
  ['/security', '安全实践'],
  ['/lifecycle', '生命周期']
]

const TS = [
  ['/ts', 'TS 总览'],
  ['/ts/intro', '类型标注与推断'],
  ['/ts/interface-type', 'interface vs type'],
  ['/ts/narrowing', '联合类型与收窄'],
  ['/ts/generics', '泛型'],
  ['/ts/utility', '工具类型'],
  ['/ts/mapped-conditional', '映射与条件类型'],
  ['/ts/function', '函数惯用法'],
  ['/ts/enum-literal', '枚举与常量断言'],
  ['/ts/async', '异步惯用法'],
  ['/ts/module', '模块与导入导出'],
  ['/ts/oop', '类与面向对象'],
  ['/ts/electron-bridge', '与 Electron 结合']
]

const errors = []
const results = []
let currentRoute = '/'

function attach(win) {
  win.webContents.on('console-message', (event) => {
    const level = event?.level ?? 0
    const message = event?.message ?? ''
    if (level >= 3) errors.push({ route: currentRoute, message: String(message) })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push({ route: currentRoute, message: `render-process-gone: ${JSON.stringify(details)}` })
  })
}

const js = (win, code) => win.webContents.executeJavaScript(code, true)

async function waitHeader(win, title, timeout = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const h = await js(win, 'document.querySelector(".header > .n-text")?.textContent || ""')
    if (h.trim() === title) return
    await wait(80)
  }
  throw new Error(`header timeout for ${title}`)
}

async function go(win, route, title) {
  await js(win, `location.hash = ${JSON.stringify('#' + route)}`)
  await waitHeader(win, title)
  await wait(300)
}

async function clickText(win, text, selector = 'button') {
  const ok = await js(
    win,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) =>
        x.textContent.includes(${JSON.stringify(text)})
      )
      if (!el) return false
      el.click()
      return true
    })()`
  )
  if (!ok) throw new Error(`click target not found: ${selector} ${text}`)
  await wait(350)
}

async function interactions(win) {
  // IPC invoke/handle
  await go(win, '/ipc', 'IPC 通信')
  await clickText(win, '发送并等待返回')
  const ipcText = await js(win, 'document.body.innerText')
  if (!ipcText.includes('主进程回复')) throw new Error('IPC ping produced no reply')
  console.log('[interaction] IPC ping PASS')

  // safeStorage encrypt/decrypt
  await go(win, '/safe-storage', '加密存储')
  const disabled = await js(
    win,
    `[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '加密')?.disabled ?? true`
  )
  if (disabled) {
    console.log('[interaction] safeStorage SKIP (unavailable)')
  } else {
    await clickText(win, '加密')
    await clickText(win, '解密')
    const safeText = await js(win, 'document.body.innerText')
    if (!safeText.includes('解密结果')) throw new Error('safeStorage decrypt result missing')
    console.log('[interaction] safeStorage roundtrip PASS')
  }

  // nativeTheme light + restore
  await go(win, '/theme', '系统主题')
  await clickText(win, '强制亮色', 'label,button')
  await wait(250)
  const light = await js(win, 'document.querySelector(".theme-switch")?.innerText || ""')
  if (!light.includes('当前亮色')) throw new Error('theme light switch failed')
  await clickText(win, '跟随系统', 'label,button')
  await wait(250)
  console.log('[interaction] theme light/restore PASS')

  // TypeScript runnable example
  await go(win, '/ts/generics', '泛型')
  const runButtons = await js(
    win,
    `[...document.querySelectorAll('button')].filter((x) => x.textContent.includes('运行示例')).length`
  )
  if (!runButtons) throw new Error('TS run buttons missing')
  await clickText(win, '运行示例')
  const output = await js(win, 'document.querySelector(".ts-output")?.textContent || ""')
  if (!output.trim()) throw new Error('TS run output empty')
  const highlight = await js(
    win,
    `document.querySelectorAll('.hljs-keyword, .hljs-title, .hljs-string, .hljs-built_in').length`
  )
  if (!highlight) throw new Error('TS code highlight missing')
  console.log(
    `[interaction] TS run PASS output=${JSON.stringify(output.trim().slice(0, 60))} highlight=${highlight}`
  )
}

async function sweep(win, routes, group) {
  for (const [route, title] of routes) {
    currentRoute = route
    const before = errors.length
    await js(win, `location.hash = ${JSON.stringify('#' + route)}`)
    await waitHeader(win, title)
    await wait(300)
    const info = await js(
      win,
      `(() => {
        const body = document.body.innerText || ''
        const headers = [...document.querySelectorAll('.n-menu-item-content-header')]
        const selected = document.querySelector('.n-menu-item-content--selected')?.innerText || ''
        const menu = document.querySelector('.n-menu')?.innerText || ''
        const item = headers.find((x) => x.textContent.includes(${JSON.stringify(title)}))
        return {
          header: document.querySelector('.header > .n-text')?.textContent || '',
          bodyLength: body.length,
          selected,
          menuHasTitle: menu.includes(${JSON.stringify(title)}),
          menuItemFit: !!item && item.scrollWidth <= item.clientWidth + 1,
          blankMenuItems: headers.filter((x) => !x.textContent.trim()).length,
          cards: document.querySelectorAll('.n-card').length,
          codeBlocks: document.querySelectorAll('.n-code, pre code, pre').length,
          bodyStart: body.slice(0, 160)
        }
      })()`
    )
    const routeErrors = errors.slice(before)
    results.push({ group, route, title, ...info, errors: routeErrors.map((e) => e.message) })
    if (info.bodyLength < 120) throw new Error(`${route} appears blank (${info.bodyLength})`)
    if (!info.menuHasTitle) throw new Error(`${route} menu item missing: ${title}`)
    if (!info.menuItemFit) throw new Error(`${route} menu label truncated: ${title}`)
    if (info.blankMenuItems) throw new Error(`${route} has blank menu items`)
    console.log(
      `[${group}] ${route} ${title} body=${info.bodyLength} cards=${info.cards} code=${info.codeBlocks} errors=${routeErrors.length}`
    )
  }
}

app.whenReady().then(async () => {
  try {
    await wait(2200)
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('main window not found')
    attach(win)
    await wait(800)

    // 菜单分组可展开
    await js(win, `location.hash = '#/'`)
    await waitHeader(win, '项目导览')
    await sweep(win, ELECTRON, 'Electron')
    await sweep(win, TS, 'TypeScript')
    await interactions(win)

    // 菜单点击导航（TS 泛型）
    const clicked = await js(
      win,
      `(() => {
        const el = [...document.querySelectorAll('.n-menu-item-content-header')].find(
          (x) => x.textContent.trim() === '🧩 泛型'
        )
        if (!el) return false
        el.click()
        return true
      })()`
    )
    if (!clicked) throw new Error('menu item 泛型 not found/clickable')
    await waitHeader(win, '泛型')

    const electronClicked = await js(
      win,
      `(() => {
        const el = [...document.querySelectorAll('.n-menu-item-content-header')].find(
          (x) => x.textContent.trim() === '🔗 IPC 通信'
        )
        if (!el) return false
        el.click()
        return true
      })()`
    )
    if (!electronClicked) throw new Error('menu item IPC 通信 not found/clickable')
    await waitHeader(win, 'IPC 通信')

    const tsWithCode = results.filter((r) => r.group === 'TypeScript' && r.codeBlocks > 0).length
    console.log(
      `[section-sweep] PASS pages=${results.length} electron=${ELECTRON.length} ts=${TS.length} tsCodePages=${tsWithCode} consoleErrors=${errors.length}`
    )
    if (errors.length) {
      console.log(
        '[section-sweep] console errors:\n' +
          errors.map((e) => `${e.route}: ${e.message}`).join('\n')
      )
      process.exitCode = 1
    }
    app.exit(process.exitCode ?? 0)
  } catch (e) {
    console.error('[section-sweep] FAIL', e)
    app.exit(1)
  }
})
