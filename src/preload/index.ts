/**
 * 【文件】预加载脚本（preload）
 * 【说明】preload 是渲染进程与主进程之间的"安全桥"：
 *         - contextBridge 暴露的 API 是受控的（白名单方式，不泄露 Electron 全部能力）
 *         - 渲染进程只能调用这里暴露的方法，无法直接 require Node 模块
 * 【复制】各分组与主进程 src/main/features/*.ts 一一对应，可整段复制：
 *         - window 分组 → windowManager.ts
 *         - ipc 分组   → ipcBridge.ts
 *         - 其余分组见各 features 文件头部的【复制】说明
 */

import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ChildWindowMode } from '../main/features/windowManager'
import type { NotificationOptions } from '../main/features/notification'
import type { ThemeSource } from '../main/features/theme'
import type { ShellOpenResult } from '../main/features/shellOps'
import type { DownloadRecord } from '../main/features/download'

/** 事件监听辅助：统一封装"注册监听 + 返回取消函数" */
function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** invoke 辅助：泛型封装，把主进程 handle 的返回类型带给调用处 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

/** 串口设备信息（主进程 select-serial-port 事件推送，见 serialPort.ts） */
export interface SerialPortInfo {
  portId: string
  portName: string
  displayName: string
  vendorId: string
  productId: string
}

/** 端口选择事件载荷：token 用于回传时关联主进程对应请求（见 serialPort.ts） */
export interface SerialPortsPayload {
  token: string
  ports: SerialPortInfo[]
}

/** 录屏源（主进程 desktopCapturer 枚举后推送，见 desktopCapture.ts） */
export interface DisplaySourceInfo {
  id: string
  name: string
  thumbnail: string | null
}

/** 录屏源选择事件载荷：token 用于回传时关联主进程对应请求 */
export interface DisplaySourcesPayload {
  token: string
  sources: DisplaySourceInfo[]
}

// ──────────────────────────────────────────────────
// 自定义 API：按特性分组，类型定义见 index.d.ts
// ──────────────────────────────────────────────────
const api = {
  /** ── 窗口管理（主进程: windowManager.ts / windowState.ts）── */
  window: {
    create: (mode: ChildWindowMode = 'normal') => ipcRenderer.invoke('window:create', mode),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
    close: () => ipcRenderer.send('window:close'),
    /** 通用窗口控制：作用于发起请求的窗口（无边框自定义标题栏用） */
    control: (channel: 'minimize' | 'maximize' | 'close') =>
      ipcRenderer.send('window:control', channel),
    /** kiosk 模式（自助终端：锁定全屏） */
    setKiosk: (enabled: boolean) => ipcRenderer.invoke('window:setKiosk', enabled),
    /** 尺寸限制与透明度 */
    setMinSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setMinSize', width, height),
    setMaxSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setMaxSize', width, height),
    setOpacity: (opacity: number) => ipcRenderer.invoke('window:setOpacity', opacity),
    /** 点击穿透：窗口对鼠标事件"视而不见"，事件落到下层应用（forward 时页面仍收 mousemove） */
    setIgnoreMouseEvents: (ignore: boolean, forward = true) =>
      ipcRenderer.invoke('window:setIgnoreMouseEvents', ignore, forward),
    /** 窗口移动/缩放事件 */
    onEvent: (cb: (data: { event: string; time: string; bounds: string }) => void) =>
      on('window:event', cb),
    /** 窗口状态持久化：查询上次保存的位置/大小 */
    getPersistedState: () => ipcRenderer.invoke('window:getPersistedState')
  },

  /** ── 拖拽文件出窗口（主进程: windowManager.ts）── */
  drag: {
    start: (filePath: string) => ipcRenderer.send('drag:start', filePath)
  },

  /** ── IPC 通信（主进程: ipcBridge.ts）── */
  ipc: {
    /** ① 请求-响应 */
    ping: (payload: string) => ipcRenderer.invoke('ipc:ping', payload),
    /** ② 单向消息 + 原路回复监听 */
    sendEvent: (payload: string) => ipcRenderer.send('ipc:event', payload),
    onEventReply: (cb: (data: string) => void) => on('ipc:event-reply', cb),
    /** ③ 广播（所有窗口都会收到） */
    broadcast: (payload: string) => ipcRenderer.send('ipc:broadcast', payload),
    onBroadcastReceived: (cb: (data: string) => void) => on('ipc:broadcast-received', cb),
    /** ④ MessageChannel 双向管道：createChannel 后端口经下方预注册监听转移（见文件底部） */
    createChannel: () => ipcRenderer.send('ipc:create-channel')
  },

  /** ── 系统通知（主进程: notification.ts）── */
  notification: {
    show: (options: NotificationOptions) => ipcRenderer.invoke('notification:show', options),
    onClicked: (cb: (options: NotificationOptions) => void) => on('notification:clicked', cb),
    onAction: (cb: (data: { options: NotificationOptions; index: number }) => void) =>
      on('notification:action', cb),
    getPlatformInfo: () => ipcRenderer.invoke('notification:getPlatformInfo'),
    registerShortcut: () => ipcRenderer.invoke('notification:registerShortcut')
  },

  /** ── 全局快捷键（主进程: globalShortcut.ts）── */
  shortcut: {
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('shortcut:setEnabled', enabled),
    onTriggered: (cb: (data: { accelerator: string }) => void) => on('shortcut:triggered', cb)
  },

  /** ── 剪贴板（主进程: clipboard.ts）── */
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readHtml: () => ipcRenderer.invoke('clipboard:readHtml'),
    writeHtml: (html: string) => ipcRenderer.invoke('clipboard:writeHtml', html),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
    writeImage: (dataUrl: string) => ipcRenderer.invoke('clipboard:writeImage', dataUrl),
    clear: () => ipcRenderer.invoke('clipboard:clear')
  },

  /** ── 文件对话框（主进程: dialog.ts）── */
  dialog: {
    openFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:openFile', filters),
    /** 目录选择框（properties: ['openDirectory']，目录监听等场景用） */
    openDirectory: (title?: string) => ipcRenderer.invoke('dialog:openDirectory', title),
    saveFile: (options?: { defaultName?: string }) =>
      ipcRenderer.invoke('dialog:saveFile', options),
    showMessage: (options?: { title?: string; message?: string; buttons?: string[] }) =>
      ipcRenderer.invoke('dialog:showMessage', options)
  },

  /** ── 文件系统（主进程: fileSystem.ts）── */
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    /** 写入二进制文件（base64 输入，自动创建父目录；PNG 导出等场景） */
    writeFileBase64: (filePath: string, base64: string) =>
      ipcRenderer.invoke('fs:writeFileBase64', filePath, base64),
    listDir: (dirPath: string) => ipcRenderer.invoke('fs:listDir', dirPath),
    joinPath: (base: string, name: string) => ipcRenderer.invoke('fs:joinPath', base, name),
    /** 拖拽文件 → 真实系统路径（webUtils 在 preload 中可用） */
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    /** 目录监听（fs.watch）：开始/停止 + 变化事件 */
    watch: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
    unwatch: (id: number) => ipcRenderer.invoke('fs:unwatch', id),
    onWatcherEvent: (cb: (data: unknown) => void) => on('fs:watcher-event', cb)
  },

  /** ── 原生菜单（主进程: menu.ts）── */
  menu: {
    showContext: () => ipcRenderer.send('menu:show-context'),
    onItemClicked: (cb: (label: string) => void) => on('menu:item-clicked', cb),
    showAbout: () => ipcRenderer.invoke('menu:showAbout')
  },

  /** ── 屏幕信息（主进程: screenInfo.ts）── */
  screen: {
    getInfo: () => ipcRenderer.invoke('screen:getInfo'),
    onDisplaysChanged: (cb: (info: unknown) => void) => on('screen:displays-changed', cb)
  },

  /** ── 系统主题（主进程: theme.ts）── */
  theme: {
    getState: () => ipcRenderer.invoke('theme:getState'),
    setSource: (source: ThemeSource) => ipcRenderer.invoke('theme:setSource', source),
    onUpdated: (cb: (data: { shouldUseDarkColors: boolean }) => void) => on('theme:updated', cb),
    getAccentColor: () => ipcRenderer.invoke('theme:getAccentColor')
  },

  /** ── 应用信息 / 生命周期（主进程: appLifecycle.ts）── */
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    getLoginItem: () => ipcRenderer.invoke('app:getLoginItem'),
    setLoginItem: (openAtLogin: boolean) => ipcRenderer.invoke('app:setLoginItem', openAtLogin),
    onLifecycle: (cb: (data: { event: string }) => void) => on('app:lifecycle', cb),
    /** 合并降噪版生命周期事件（300ms 窗口内同一操作联动的事件去重合并为一条） */
    onLifecycleMerged: (cb: (data: { events: string[] }) => void) => on('app:lifecycle-merged', cb),
    onSecondInstance: (cb: () => void) => on('app:second-instance', cb)
  },

  /** ── 网络（主进程: network.ts）── */
  network: {
    httpGet: (url: string) => ipcRenderer.invoke('network:httpGet', url),
    resolveDns: (hostname: string) => ipcRenderer.invoke('network:resolveDns', hostname)
  },

  /** ── 安全（主进程: security.ts）── */
  security: {
    onPermissionDenied: (cb: (permission: string) => void) => on('security:permission-denied', cb),
    setSilentCheck: (enabled: boolean) => ipcRenderer.invoke('security:setSilentCheck', enabled)
  },

  /** ── 自动更新（主进程: autoUpdater.ts）── */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getVersion: () => ipcRenderer.invoke('update:getVersion'),
    onStatus: (cb: (status: unknown) => void) => on('update:status', cb)
  },

  /** ── 自定义协议 + 内嵌网页（主进程: protocol.ts）── */
  protocol: {
    openUrl: (url: string) => ipcRenderer.invoke('protocol:openUrl', url),
    onDeepLink: (cb: (url: string) => void) => on('protocol:deep-link', cb),
    openView: (url: string, options?: { topInset?: number }) =>
      ipcRenderer.invoke('view:open', url, options),
    closeView: () => ipcRenderer.invoke('view:close'),
    /** 导航历史控制 + 状态事件 */
    goBack: () => ipcRenderer.invoke('view:goBack'),
    goForward: () => ipcRenderer.invoke('view:goForward'),
    onNavigation: (
      cb: (data: { url: string; canGoBack: boolean; canGoForward: boolean }) => void
    ) => on('view:navigation', cb),
    /** 内嵌视图被 ESC 关闭时通知（同步按钮状态） */
    onViewClosed: (cb: () => void) => on('view:closed-by-esc', cb),
    /** 文件关联：模拟"双击文件唤起应用" */
    simulateOpenFile: (filePath: string) =>
      ipcRenderer.invoke('protocol:simulateOpenFile', filePath),
    onFileOpen: (cb: (filePath: string) => void) => on('protocol:file-open', cb)
  },

  /** ── 桌面捕获（主进程: desktopCapture.ts）── */
  capture: {
    getSources: () => ipcRenderer.invoke('capture:getSources'),
    capturePage: () => ipcRenderer.invoke('capture:capturePage'),
    savePng: (dataUrl: string) => ipcRenderer.invoke('capture:savePng', dataUrl),
    /** 录屏源选择事件：getDisplayMedia 触发，主进程推送 { token, sources } */
    onDisplaySources: (cb: (payload: DisplaySourcesPayload) => void) =>
      on('capture:display-sources', cb),
    selectDisplaySource: (token: string, sourceId: string, sourceName: string) =>
      ipcRenderer.send('capture:display-select', token, sourceId, sourceName),
    cancelDisplaySource: (token: string) => ipcRenderer.send('capture:display-cancel', token)
  },

  /** ── 打印（主进程: print.ts）── */
  print: {
    toPdf: (options?: { defaultName?: string }) => ipcRenderer.invoke('print:toPdf', options)
  },

  /** ── 电源监控（主进程: powerMonitor.ts）── */
  power: {
    getStatus: () => ipcRenderer.invoke('power:getStatus'),
    /** 模拟推送电源事件（教学演示，与 OS 事件同一通道） */
    simulate: (event: string) => ipcRenderer.invoke('power:simulate', event),
    onEvent: (cb: (data: { event: string; time: string }) => void) => on('power:event', cb)
  },

  /** ── 任务栏 + 角标（主进程: taskbar.ts）── */
  taskbar: {
    setProgress: (value: number | null, mode?: 'normal' | 'error' | 'paused' | 'indeterminate') =>
      ipcRenderer.invoke('taskbar:setProgress', value, mode),
    setBadge: (count: number) => ipcRenderer.invoke('taskbar:setBadge', count),
    setJumpList: (files: string[]) => ipcRenderer.invoke('taskbar:setJumpList', files),
    setOverlay: (enabled: boolean) => ipcRenderer.invoke('taskbar:setOverlay', enabled),
    setDockMenu: () => ipcRenderer.invoke('taskbar:setDockMenu'),
    addRecentDocument: () => ipcRenderer.invoke('taskbar:addRecentDocument'),
    /** Windows 任务栏缩略图按钮（Thumbar） */
    setThumbar: (enabled: boolean) => ipcRenderer.invoke('taskbar:setThumbar', enabled),
    onThumbarClicked: (cb: (action: string) => void) => on('taskbar:thumbar-clicked', cb),
    /** 任务栏图标闪烁提醒（Windows/Linux） */
    flashFrame: () => ipcRenderer.invoke('taskbar:flashFrame')
  },

  /** ── 全局错误处理（主进程: errorHandler.ts）── */
  error: {
    getLogs: () => ipcRenderer.invoke('error:getLogs'),
    onNew: (cb: (record: unknown) => void) => on('error:new', cb),
    setAutoRecovery: (enabled: boolean) => ipcRenderer.invoke('error:setAutoRecovery', enabled),
    getCrashInfo: () => ipcRenderer.invoke('error:getCrashInfo'),
    /** 模拟触发主进程错误（教学演示，走真实 uncaughtException 捕获链路） */
    simulateError: () => ipcRenderer.invoke('error:simulateError'),
    /** 模拟渲染进程崩溃（触发 render-process-gone + 自动恢复 reload） */
    crashRenderer: () => ipcRenderer.invoke('error:crashRenderer')
  },

  /** ── TCP / UDP 通信（主进程: socket.ts）── */
  socket: {
    tcp: {
      startServer: (port: number) => ipcRenderer.invoke('tcp:startServer', port),
      stopServer: () => ipcRenderer.invoke('tcp:stopServer'),
      connect: (options: { host: string; port: number }) =>
        ipcRenderer.invoke('tcp:connect', options),
      disconnect: () => ipcRenderer.invoke('tcp:disconnect'),
      send: (message: string) => ipcRenderer.invoke('tcp:send', message)
    },
    udp: {
      bind: (port: number) => ipcRenderer.invoke('udp:bind', port),
      unbind: (port: number) => ipcRenderer.invoke('udp:unbind', port),
      send: (options: { fromPort: number; targetPort: number; message: string }) =>
        ipcRenderer.invoke('udp:send', options)
    },
    onTcpLog: (cb: (log: { tag: string; msg: string }) => void) => on('socket:tcp-log', cb),
    onUdpLog: (cb: (log: { tag: string; msg: string }) => void) => on('socket:udp-log', cb)
  },

  /** ── 计算密集型任务 + 资源监控（主进程: utilityProcess.ts）── */
  perf: {
    /** 主进程同步计算（教学演示：会阻塞 UI） */
    fibSync: (n: number) => ipcRenderer.invoke('perf:fibSync', n),
    /** utilityProcess 子进程计算（不阻塞） */
    fibInProcess: (n: number) => ipcRenderer.invoke('perf:fibInProcess', n),
    terminate: () => ipcRenderer.invoke('perf:terminate'),
    getMetrics: () => ipcRenderer.invoke('perf:getMetrics'),
    onEvent: (cb: (data: unknown) => void) => on('perf:event', cb)
  },

  /** ── 毛玻璃效果（主进程: glassEffect.ts）── */
  glass: {
    set: (enabled: boolean) => ipcRenderer.invoke('glass:set', enabled)
  },

  /** ── 阻止系统睡眠（主进程: powerBlocker.ts）── */
  powerBlocker: {
    set: (enabled: boolean) => ipcRenderer.invoke('powerBlocker:set', enabled),
    getState: () => ipcRenderer.invoke('powerBlocker:getState')
  },

  /** ── 系统文件图标（主进程: fileIcon.ts）── */
  fileIcon: {
    get: (filePath: string) => ipcRenderer.invoke('fileIcon:get', filePath)
  },

  /** ── 闪屏页（主进程: splash.ts）── */
  splash: {
    replay: () => ipcRenderer.invoke('splash:replay')
  },

  /** ── 下载管理（主进程: download.ts）── */
  download: {
    start: (url: string) => ipcRenderer.invoke('download:start', url),
    pause: (id: string) => ipcRenderer.invoke('download:pause', id),
    resume: (id: string) => ipcRenderer.invoke('download:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('download:cancel', id),
    /** 回放下载列表（活动 + 历史缓存，页面挂载时拉取，见 download.ts） */
    list: () => invoke<DownloadRecord[]>('download:list'),
    onProgress: (cb: (data: unknown) => void) => on('download:progress', cb),
    onDone: (cb: (data: unknown) => void) => on('download:done', cb),
    /** 暂停/恢复状态推送（Electron 事件不映射 paused，主进程主动推送，见 download.ts） */
    onState: (cb: (data: { id: string; state: string }) => void) => on('download:state', cb)
  },

  /** ── 网络会话：Cookie + 请求拦截（主进程: cookies.ts / webRequest.ts / sessionCleanup.ts）── */
  session: {
    getAllCookies: () => ipcRenderer.invoke('cookies:getAll'),
    setCookie: (options: { url: string; name: string; value: string }) =>
      ipcRenderer.invoke('cookies:set', options),
    removeCookie: (options: { url: string; name: string }) =>
      ipcRenderer.invoke('cookies:remove', options),
    onRequestLog: (cb: (data: unknown) => void) => on('webRequest:log', cb),
    clearCache: () => ipcRenderer.invoke('session:clearCache'),
    clearStorage: () => ipcRenderer.invoke('session:clearStorage'),
    clearAll: () => ipcRenderer.invoke('session:clearAll')
  },

  /** ── 自定义协议内容（主进程: protocolContent.ts，渲染进程直接用 fetch）── */
  protocolContent: {
    /** 读取 elec-fs:// 虚拟文件（fetch 封装，CSP 已放行 connect-src elec-fs:） */
    read: async (path: string): Promise<string> => {
      const response = await fetch(`elec-fs://demo${path}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    }
  },

  /** ── shell 文件操作（主进程: shellOps.ts）── */
  shell: {
    openPath: (target: string) => invoke<ShellOpenResult>('shell:openPath', target),
    showInFolder: (target: string) => ipcRenderer.invoke('shell:showInFolder', target),
    trash: (target: string) => ipcRenderer.invoke('shell:trash', target),
    beep: () => ipcRenderer.invoke('shell:beep')
  },

  /** ── 应用重启（主进程: relaunch.ts）── */
  relaunch: {
    now: () => ipcRenderer.invoke('app:relaunch')
  },

  /** ── SQLite 数据库（主进程: sqlite.ts，node:sqlite 内置模块）── */
  db: {
    list: () => ipcRenderer.invoke('db:list'),
    add: (note: { title: string; content: string }) => ipcRenderer.invoke('db:add', note),
    update: (note: { id: number; title: string; content: string }) =>
      ipcRenderer.invoke('db:update', note),
    remove: (id: number) => ipcRenderer.invoke('db:delete', id),
    execute: (sql: string) => ipcRenderer.invoke('db:execute', sql),
    transaction: () => ipcRenderer.invoke('db:transaction'),
    /** safe=true 参数化查询（正确）；safe=false 字符串拼接（演示注入漏洞） */
    search: (keyword: string, safe: boolean) => ipcRenderer.invoke('db:search', keyword, safe),
    info: () => ipcRenderer.invoke('db:info'),
    benchmark: (rows: number) => ipcRenderer.invoke('db:benchmark', rows)
  },

  /** ── 第三方 SQLite（主进程: betterSqlite.ts，better-sqlite3 原生模块）── */
  betterDb: {
    list: () => ipcRenderer.invoke('betterDb:list'),
    add: (note: { title: string; content: string }) => ipcRenderer.invoke('betterDb:add', note),
    update: (note: { id: number; title: string; content: string }) =>
      ipcRenderer.invoke('betterDb:update', note),
    remove: (id: number) => ipcRenderer.invoke('betterDb:delete', id),
    /** safe=true 参数化查询（正确）；safe=false 字符串拼接（演示注入漏洞） */
    search: (keyword: string, safe: boolean) =>
      ipcRenderer.invoke('betterDb:search', keyword, safe),
    transaction: () => ipcRenderer.invoke('betterDb:transaction'),
    benchmark: (rows: number) => ipcRenderer.invoke('betterDb:benchmark', rows),
    info: () => ipcRenderer.invoke('betterDb:info')
  },

  /** ── 系统权限（主进程: systemAccess.ts）── */
  system: {
    getMediaAccessStatus: () => ipcRenderer.invoke('system:getMediaAccessStatus'),
    askMediaAccess: (type: 'camera' | 'microphone') =>
      ipcRenderer.invoke('system:askMediaAccess', type),
    getInfo: () => ipcRenderer.invoke('system:getInfo')
  },

  /** ── 网络在线状态（主进程: netStatus.ts + 渲染进程浏览器事件）── */
  net: {
    getStatus: () => ipcRenderer.invoke('net:getStatus'),
    /** 在线/离线事件：浏览器原生（window 事件），这里封装为统一 API */
    onStatus: (cb: (data: { online: boolean; time: string }) => void) => {
      const handler = (): void =>
        cb({ online: navigator.onLine, time: new Date().toLocaleTimeString() })
      window.addEventListener('online', handler)
      window.addEventListener('offline', handler)
      return () => {
        window.removeEventListener('online', handler)
        window.removeEventListener('offline', handler)
      }
    }
  },

  /** ── 按键拦截（主进程: inputHook.ts）── */
  inputHook: {
    setBlockF12: (enabled: boolean) => ipcRenderer.invoke('inputHook:setBlockF12', enabled),
    onKey: (cb: (data: { key: string }) => void) => on('inputHook:key', cb)
  },

  /** ── 页面缩放（主进程: zoom.ts）── */
  zoom: {
    set: (factor: number) => ipcRenderer.invoke('zoom:set', factor),
    reset: () => ipcRenderer.invoke('zoom:reset'),
    get: () => ipcRenderer.invoke('zoom:get'),
    onChanged: (cb: (factor: number) => void) => on('zoom:changed', cb)
  },

  /** ── 会话配置：代理 + UA（主进程: sessionConfig.ts）── */
  sessionConfig: {
    setProxy: (proxyRules: string) => ipcRenderer.invoke('sessionConfig:setProxy', proxyRules),
    setProxyMode: (mode: 'direct' | 'system') =>
      ipcRenderer.invoke('sessionConfig:setProxyMode', mode),
    resolveProxy: (url: string) => ipcRenderer.invoke('sessionConfig:resolveProxy', url),
    setUserAgent: (ua: string) => ipcRenderer.invoke('sessionConfig:setUserAgent', ua),
    getUserAgent: () => ipcRenderer.invoke('sessionConfig:getUserAgent')
  },

  /** ── 证书校验（主进程: certificate.ts）── */
  cert: {
    setVerifyMode: (mode: 'default' | 'trustAll') => ipcRenderer.invoke('cert:setVerifyMode', mode)
  },

  /** ── 会话分区（主进程: partition.ts）── */
  partition: {
    openIncognito: () => ipcRenderer.invoke('partition:openIncognito'),
    openPersistent: () => ipcRenderer.invoke('partition:openPersistent')
  },

  /** ── 退出前未保存询问（主进程: quitGuard.ts）── */
  quitGuard: {
    setDirty: (dirty: boolean) => ipcRenderer.invoke('quitGuard:setDirty', dirty),
    getDirty: () => ipcRenderer.invoke('quitGuard:getDirty')
  },

  /** ── HTTP 服务器（主进程: httpServer.ts，node:http）── */
  httpServer: {
    start: (port?: number) => ipcRenderer.invoke('httpServer:start', port),
    stop: () => ipcRenderer.invoke('httpServer:stop'),
    getStatus: () => ipcRenderer.invoke('httpServer:getStatus')
  },

  /** ── WebSocket 服务器（主进程: socketServer.ts，socket.io 自闭环演示）── */
  socketServer: {
    start: (port?: number) => ipcRenderer.invoke('socketServer:start', port),
    stop: () => ipcRenderer.invoke('socketServer:stop'),
    getStatus: () => ipcRenderer.invoke('socketServer:getStatus')
  },

  /** ── 脚本注入（主进程: scriptInjection.ts）── */
  inject: {
    execute: (code: string) => ipcRenderer.invoke('inject:execute', code)
  },

  /** ── 页面加载状态（主进程: loadState.ts）── */
  web: {
    getLoadState: () => ipcRenderer.invoke('web:getLoadState'),
    onLoadState: (cb: (data: unknown) => void) => on('web:load-state', cb)
  },

  /** ── 加密存储（主进程: safeStorage.ts）── */
  safeStorage: {
    isAvailable: () => ipcRenderer.invoke('safeStorage:isAvailable'),
    encrypt: (plainText: string) => ipcRenderer.invoke('safeStorage:encrypt', plainText),
    decrypt: (base64Cipher: string) => ipcRenderer.invoke('safeStorage:decrypt', base64Cipher)
  },

  /** ── 串口通信（主进程: serialPort.ts；数据读写用浏览器 navigator.serial）── */
  serial: {
    /** 端口选择事件：requestPort() 触发，主进程推送 { token, ports }（token 用于回传关联） */
    onPorts: (cb: (payload: SerialPortsPayload) => void) => on('serial:ports', cb),
    selectPort: (token: string, portId: string) => ipcRenderer.send('serial:select', token, portId),
    cancel: (token: string) => ipcRenderer.send('serial:cancel', token)
  },

  /** ── GPU 信息与硬件加速（主进程: gpuInfo.ts）── */
  gpu: {
    getFeatureStatus: () => ipcRenderer.invoke('gpu:getFeatureStatus'),
    getInfo: () => ipcRenderer.invoke('gpu:getInfo'),
    setAcceleration: (enabled: boolean) => ipcRenderer.invoke('gpu:setAcceleration', enabled),
    getAccelerationState: () => ipcRenderer.invoke('gpu:getAccelerationState')
  },

  /** ── 应用数据目录（主进程: appPaths.ts）── */
  paths: {
    getAll: () => ipcRenderer.invoke('paths:getAll'),
    set: (key: string, value: string) => ipcRenderer.invoke('paths:set', key, value),
    getAppPath: () => ipcRenderer.invoke('paths:getAppPath')
  },

  /** ── 信号分析服务端（本地计算 / 远程后端，仅演示；配置重启生效，状态由 SignalConfigPage 统一）── */
  signalAnalysis: {
    start: (opts?: { mode?: 'local' | 'remote'; port?: number; remoteUrl?: string }) =>
      invoke<{ ok: boolean; mode?: string; port?: number; remoteUrl?: string; error?: string }>(
        'signalAnalysis:start',
        opts
      ),
    stop: () => invoke<{ ok: boolean }>('signalAnalysis:stop'),
    getStatus: () =>
      invoke<{ running: boolean; mode: string; port: number; remoteUrl?: string; config: unknown }>(
        'signalAnalysis:getStatus'
      ),
    setConfig: (cfg: unknown) =>
      invoke<{ ok: boolean; remoteUrl?: string; config?: unknown }>(
        'signalAnalysis:setConfig',
        cfg
      ),
    trigger: () => invoke<{ ok: boolean }>('signalAnalysis:trigger'),
    onFrame: (cb: (frame: unknown) => void) => on('signal:analysis', cb),
    onStatus: (cb: (s: { connected: boolean; error?: string; url?: string }) => void) =>
      on('signal:analysis:status', cb)
  },

  /** ── 远端Mock内置（与本地同端口互斥，演示一键远程）── */
  remoteMock: {
    start: (opts?: { port?: number; config?: unknown }) =>
      invoke<{ ok: boolean; port?: number; error?: string }>('remoteMock:start', opts),
    stop: () => invoke<{ ok: boolean }>('remoteMock:stop'),
    getStatus: () =>
      invoke<{ running: boolean; port: number; config: unknown }>('remoteMock:getStatus')
  }
}

// ──────────────────────────────────────────────────
// 暴露给渲染进程：window.electron（官方 API）+ window.api（自定义 API）
// contextIsolation 开启时用 contextBridge，否则挂到 window 上
// ──────────────────────────────────────────────────
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

// ──────────────────────────────────────────────────
// ④ MessageChannel 端口转移（contextIsolation 专用，见 ipcBridge.ts ④）
// 关键坑：MessagePort 不能作为参数经 contextBridge 传给页面——
// contextBridge 的参数会做结构化克隆，端口会被克隆成"断开连接"的新对象
// （postMessage 发出去无人接收）。正确做法是"转移"（transfer）：
// 在 preload 收到端口后，用 window.postMessage 把它转移到主世界，
// 页面用 window.addEventListener('message') 接收（官方推荐模式，见 docs/02）。
// 预注册时机：preload 加载即注册，早于页面任何点击，无时序问题。
// 轻量化安全：生产建议将 '*' 收紧为 window.location.origin；file:// 下 origin 为 'null' 需保留 '*'
// ──────────────────────────────────────────────────
ipcRenderer.on('ipc:channel-port', (event) => {
  const port = event.ports[0]
  if (port) {
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin
    window.postMessage('ipc:channel-port', targetOrigin, [port])
  }
})

export type Api = typeof api
