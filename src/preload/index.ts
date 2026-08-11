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

/** 事件监听辅助：统一封装"注册监听 + 返回取消函数" */
function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
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
    /** ④ MessageChannel 双向管道 */
    createChannel: () => ipcRenderer.send('ipc:create-channel'),
    onChannelPort: (cb: (port: MessagePort) => void) => {
      // MessagePort 通过事件的 ports 字段传递，需单独处理
      const listener = (event: IpcRendererEvent): void => {
        const port = event.ports[0]
        if (port) cb(port)
      }
      ipcRenderer.on('ipc:channel-port', listener)
      return () => ipcRenderer.removeListener('ipc:channel-port', listener)
    }
  },

  /** ── 系统通知（主进程: notification.ts）── */
  notification: {
    show: (options: NotificationOptions) => ipcRenderer.invoke('notification:show', options),
    onClicked: (cb: (options: NotificationOptions) => void) => on('notification:clicked', cb),
    onAction: (cb: (data: { options: NotificationOptions; index: number }) => void) =>
      on('notification:action', cb)
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
    onUpdated: (cb: (data: { shouldUseDarkColors: boolean }) => void) => on('theme:updated', cb)
  },

  /** ── 应用信息 / 生命周期（主进程: appLifecycle.ts）── */
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    setLoginItem: (openAtLogin: boolean) => ipcRenderer.invoke('app:setLoginItem', openAtLogin),
    onLifecycle: (cb: (data: { event: string }) => void) => on('app:lifecycle', cb),
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
    openView: (url: string) => ipcRenderer.invoke('view:open', url),
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
    savePng: (dataUrl: string) => ipcRenderer.invoke('capture:savePng', dataUrl)
  },

  /** ── 打印（主进程: print.ts）── */
  print: {
    toPdf: (options?: { defaultName?: string }) => ipcRenderer.invoke('print:toPdf', options)
  },

  /** ── 电源监控（主进程: powerMonitor.ts）── */
  power: {
    getStatus: () => ipcRenderer.invoke('power:getStatus'),
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
    addRecentDocument: () => ipcRenderer.invoke('taskbar:addRecentDocument')
  },

  /** ── 全局错误处理（主进程: errorHandler.ts）── */
  error: {
    getLogs: () => ipcRenderer.invoke('error:getLogs'),
    onNew: (cb: (record: unknown) => void) => on('error:new', cb),
    setAutoRecovery: (enabled: boolean) => ipcRenderer.invoke('error:setAutoRecovery', enabled)
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
    onProgress: (cb: (data: unknown) => void) => on('download:progress', cb),
    onDone: (cb: (data: unknown) => void) => on('download:done', cb)
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
    openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target),
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
    info: () => ipcRenderer.invoke('db:info')
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

export type Api = typeof api
