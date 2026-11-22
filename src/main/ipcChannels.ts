/**
 * 【共享】IPC 通道目录（单一事实来源）
 * 【说明】主进程、preload、本目录三处都会出现通道名，而它们都是字符串：
 *         TypeScript 抓不到拼写错误，拼错的后果是运行期静默失败
 *         （`window.api.xxx()` 的 Promise 永挂起、事件永远不来）。
 *         本文件登记全部通道，并由 ipcChannels.test.ts 在 `npm test` / CI 里强制三方一致：
 *           - preload 用到的通道，主进程必须有实现
 *           - 主进程实现/推送的通道，必须登记在这里
 *           - 这里登记的通道必须真的有实现（防死常量）
 * 【用法】调用处二选一：
 *         A. `ipcMain.handle(IPC.window.create, ...)` —— 编译期就能发现拼错（推荐）
 *         B. 继续写字符串字面量 —— 由上面那个测试兜底（本项目当前是这种方式）
 * 【复制】到新工程时整份拷贝即可；不需要的部分删掉不会影响其余特性。
 */

export const IPC = {
  window: {
    create: 'window:create',
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggleMaximize',
    toggleFullscreen: 'window:toggleFullscreen',
    toggleAlwaysOnTop: 'window:toggleAlwaysOnTop',
    close: 'window:close',
    control: 'window:control',
    setKiosk: 'window:setKiosk',
    setMinSize: 'window:setMinSize',
    setMaxSize: 'window:setMaxSize',
    setOpacity: 'window:setOpacity',
    setIgnoreMouseEvents: 'window:setIgnoreMouseEvents',
    event: 'window:event',
    getPersistedState: 'window:getPersistedState'
  },
  drag: { start: 'drag:start' },
  ipc: {
    ping: 'ipc:ping',
    event: 'ipc:event',
    eventReply: 'ipc:event-reply',
    broadcast: 'ipc:broadcast',
    broadcastReceived: 'ipc:broadcast-received',
    createChannel: 'ipc:create-channel',
    channelPort: 'ipc:channel-port'
  },
  notification: {
    show: 'notification:show',
    clicked: 'notification:clicked',
    action: 'notification:action',
    getPlatformInfo: 'notification:getPlatformInfo',
    registerShortcut: 'notification:registerShortcut'
  },
  shortcut: { setEnabled: 'shortcut:setEnabled', triggered: 'shortcut:triggered' },
  clipboard: {
    readText: 'clipboard:readText',
    writeText: 'clipboard:writeText',
    readHtml: 'clipboard:readHtml',
    writeHtml: 'clipboard:writeHtml',
    readImage: 'clipboard:readImage',
    writeImage: 'clipboard:writeImage',
    clear: 'clipboard:clear'
  },
  dialog: {
    openFile: 'dialog:openFile',
    openDirectory: 'dialog:openDirectory',
    saveFile: 'dialog:saveFile',
    showMessage: 'dialog:showMessage'
  },
  fs: {
    readFile: 'fs:readFile',
    writeFile: 'fs:writeFile',
    writeFileBase64: 'fs:writeFileBase64',
    listDir: 'fs:listDir',
    joinPath: 'fs:joinPath',
    watch: 'fs:watch',
    unwatch: 'fs:unwatch',
    watcherEvent: 'fs:watcher-event'
  },
  menu: {
    showContext: 'menu:show-context',
    itemClicked: 'menu:item-clicked',
    showAbout: 'menu:showAbout'
  },
  screen: { getInfo: 'screen:getInfo', displaysChanged: 'screen:displays-changed' },
  theme: {
    getState: 'theme:getState',
    setSource: 'theme:setSource',
    updated: 'theme:updated',
    getAccentColor: 'theme:getAccentColor'
  },
  app: {
    getInfo: 'app:getInfo',
    getLoginItem: 'app:getLoginItem',
    setLoginItem: 'app:setLoginItem',
    lifecycle: 'app:lifecycle',
    lifecycleMerged: 'app:lifecycle-merged',
    secondInstance: 'app:second-instance'
  },
  network: { httpGet: 'network:httpGet', resolveDns: 'network:resolveDns' },
  security: {
    permissionDenied: 'security:permission-denied',
    setSilentCheck: 'security:setSilentCheck'
  },
  update: {
    check: 'update:check',
    download: 'update:download',
    install: 'update:install',
    getVersion: 'update:getVersion',
    status: 'update:status'
  },
  protocol: {
    openUrl: 'protocol:openUrl',
    deepLink: 'protocol:deep-link',
    fileOpen: 'protocol:file-open',
    simulateOpenFile: 'protocol:simulateOpenFile'
  },
  view: {
    open: 'view:open',
    close: 'view:close',
    closeInternal: 'view:close-internal',
    closedByEsc: 'view:closed-by-esc',
    goBack: 'view:goBack',
    goForward: 'view:goForward',
    navigation: 'view:navigation'
  },
  capture: {
    getSources: 'capture:getSources',
    capturePage: 'capture:capturePage',
    savePng: 'capture:savePng',
    displaySources: 'capture:display-sources',
    displaySelect: 'capture:display-select',
    displayCancel: 'capture:display-cancel'
  },
  print: { toPdf: 'print:toPdf' },
  power: { getStatus: 'power:getStatus', simulate: 'power:simulate', event: 'power:event' },
  taskbar: {
    setProgress: 'taskbar:setProgress',
    setBadge: 'taskbar:setBadge',
    setJumpList: 'taskbar:setJumpList',
    setOverlay: 'taskbar:setOverlay',
    setDockMenu: 'taskbar:setDockMenu',
    addRecentDocument: 'taskbar:addRecentDocument',
    setThumbar: 'taskbar:setThumbar',
    thumbarClicked: 'taskbar:thumbar-clicked',
    flashFrame: 'taskbar:flashFrame'
  },
  error: {
    getLogs: 'error:getLogs',
    new: 'error:new',
    /** 渲染层未捕获错误上报（renderer → main，见 errorReporter.ts） */
    report: 'error:report',
    setAutoRecovery: 'error:setAutoRecovery',
    getCrashInfo: 'error:getCrashInfo',
    simulateError: 'error:simulateError',
    crashRenderer: 'error:crashRenderer'
  },
  socket: {
    tcpStartServer: 'tcp:startServer',
    tcpStopServer: 'tcp:stopServer',
    tcpConnect: 'tcp:connect',
    tcpDisconnect: 'tcp:disconnect',
    tcpSend: 'tcp:send',
    tcpLog: 'socket:tcp-log',
    udpBind: 'udp:bind',
    udpUnbind: 'udp:unbind',
    udpSend: 'udp:send',
    udpLog: 'socket:udp-log'
  },
  perf: {
    fibSync: 'perf:fibSync',
    fibInProcess: 'perf:fibInProcess',
    terminate: 'perf:terminate',
    getMetrics: 'perf:getMetrics',
    event: 'perf:event'
  },
  glass: { set: 'glass:set' },
  powerBlocker: { set: 'powerBlocker:set', getState: 'powerBlocker:getState' },
  fileIcon: { get: 'fileIcon:get' },
  splash: { replay: 'splash:replay' },
  download: {
    start: 'download:start',
    pause: 'download:pause',
    resume: 'download:resume',
    cancel: 'download:cancel',
    list: 'download:list',
    progress: 'download:progress',
    done: 'download:done',
    state: 'download:state'
  },
  session: {
    cookiesGetAll: 'cookies:getAll',
    cookiesSet: 'cookies:set',
    cookiesRemove: 'cookies:remove',
    webRequestLog: 'webRequest:log',
    clearCache: 'session:clearCache',
    clearStorage: 'session:clearStorage',
    clearAll: 'session:clearAll'
  },
  shell: {
    openPath: 'shell:openPath',
    showInFolder: 'shell:showInFolder',
    trash: 'shell:trash',
    beep: 'shell:beep'
  },
  relaunch: { now: 'app:relaunch' },
  db: {
    list: 'db:list',
    add: 'db:add',
    update: 'db:update',
    delete: 'db:delete',
    execute: 'db:execute',
    transaction: 'db:transaction',
    search: 'db:search',
    info: 'db:info',
    benchmark: 'db:benchmark'
  },
  betterDb: {
    list: 'betterDb:list',
    add: 'betterDb:add',
    update: 'betterDb:update',
    delete: 'betterDb:delete',
    search: 'betterDb:search',
    transaction: 'betterDb:transaction',
    benchmark: 'betterDb:benchmark',
    info: 'betterDb:info'
  },
  system: {
    getMediaAccessStatus: 'system:getMediaAccessStatus',
    askMediaAccess: 'system:askMediaAccess',
    getInfo: 'system:getInfo'
  },
  net: { getStatus: 'net:getStatus' },
  inputHook: { setBlockF12: 'inputHook:setBlockF12', key: 'inputHook:key' },
  zoom: { set: 'zoom:set', reset: 'zoom:reset', get: 'zoom:get', changed: 'zoom:changed' },
  sessionConfig: {
    setProxy: 'sessionConfig:setProxy',
    setProxyMode: 'sessionConfig:setProxyMode',
    resolveProxy: 'sessionConfig:resolveProxy',
    setUserAgent: 'sessionConfig:setUserAgent',
    getUserAgent: 'sessionConfig:getUserAgent'
  },
  cert: { setVerifyMode: 'cert:setVerifyMode' },
  partition: {
    openIncognito: 'partition:openIncognito',
    openPersistent: 'partition:openPersistent'
  },
  quitGuard: { setDirty: 'quitGuard:setDirty', getDirty: 'quitGuard:getDirty' },
  httpServer: {
    start: 'httpServer:start',
    stop: 'httpServer:stop',
    getStatus: 'httpServer:getStatus'
  },
  socketServer: {
    start: 'socketServer:start',
    stop: 'socketServer:stop',
    getStatus: 'socketServer:getStatus'
  },
  inject: { execute: 'inject:execute' },
  web: { getLoadState: 'web:getLoadState', loadState: 'web:load-state' },
  safeStorage: {
    isAvailable: 'safeStorage:isAvailable',
    encrypt: 'safeStorage:encrypt',
    decrypt: 'safeStorage:decrypt'
  },
  serial: { ports: 'serial:ports', select: 'serial:select', cancel: 'serial:cancel' },
  gpu: {
    getFeatureStatus: 'gpu:getFeatureStatus',
    getInfo: 'gpu:getInfo',
    setAcceleration: 'gpu:setAcceleration',
    getAccelerationState: 'gpu:getAccelerationState'
  },
  paths: { getAll: 'paths:getAll', set: 'paths:set', getAppPath: 'paths:getAppPath' },

  // ── 信号板块（不在 features/：由 main/signal、main/source、main/sweep 提供实现）──
  // 教学说明：这一组曾经漏登记在目录外，靠 ipcChannels.test.ts 才被发现。
  // 新增特性时请把通道加进来，否则 `npm test` 会报"主进程实现了但目录里没有"。
  signal: {
    /** 分析帧推送（主→渲染，只投递给订阅窗口） */
    frame: 'signal:analysis',
    /** 远程链路状态推送（主→渲染） */
    status: 'signal:analysis:status'
  },
  signalAnalysis: {
    start: 'signalAnalysis:start',
    stop: 'signalAnalysis:stop',
    getStatus: 'signalAnalysis:getStatus',
    setConfig: 'signalAnalysis:setConfig',
    trigger: 'signalAnalysis:trigger',
    subscribe: 'signalAnalysis:subscribe',
    unsubscribe: 'signalAnalysis:unsubscribe'
  },
  source: {
    // 源生命周期
    start: 'source:start',
    stop: 'source:stop',
    getStatus: 'source:getStatus',
    setConfig: 'source:setConfig',
    trigger: 'source:trigger',
    // 帧推送（主→渲染）
    frame: 'source:frame',
    dualFrame: 'source:dualFrame',
    // 订阅投递（只给订阅过的窗口发帧，防多窗口广播）
    subscribe: 'source:subscribe',
    unsubscribe: 'source:unsubscribe',
    subscribeDual: 'source:subscribeDual',
    unsubscribeDual: 'source:unsubscribeDual',
    // 录制
    recordStart: 'source:recordStart',
    recordStop: 'source:recordStop',
    recordStatus: 'source:recordStatus',
    recordExport: 'source:recordExport',
    // 回放控制
    startPlayback: 'source:startPlayback',
    stopPlayback: 'source:stopPlayback',
    pausePlayback: 'source:pausePlayback',
    resumePlayback: 'source:resumePlayback',
    stepPlayback: 'source:stepPlayback',
    seekPlayback: 'source:seekPlayback',
    playbackStatus: 'source:playbackStatus',
    setPlaybackSpeed: 'source:setPlaybackSpeed',
    setPlaybackTiming: 'source:setPlaybackTiming',
    setPlaybackLoop: 'source:setPlaybackLoop',
    // 回放数据来源（内存录制 / raw 文件 / 滚动归档 / 任意 IQ）
    loadPlayback: 'source:loadPlayback',
    loadRawPlayback: 'source:loadRawPlayback',
    loadRawArchivePlayback: 'source:loadRawArchivePlayback',
    importIq: 'source:importIq',
    // 网络源（GNU Radio / TCP IQ）
    startNetwork: 'source:startNetwork',
    stopNetwork: 'source:stopNetwork',
    networkStatus: 'source:networkStatus',
    setActiveChannel: 'source:setActiveChannel',
    // 应用内双通道合成源（无需硬件）
    startDualSim: 'source:startDualSim',
    stopDualSim: 'source:stopDualSim',
    // 本机 GNU Radio 一键启动
    localStart: 'source:localStart',
    localStop: 'source:localStop',
    localStatus: 'source:localStatus',
    localSaveSettings: 'source:localSaveSettings',
    localDefaults: 'source:localDefaults'
  },
  sweep: {
    start: 'sweep:start',
    stop: 'sweep:stop',
    getStatus: 'sweep:getStatus',
    setConfig: 'sweep:setConfig',
    trigger: 'sweep:trigger',
    /** 扫频帧推送（主→渲染） */
    frame: 'sweep:frame'
  },
  remoteMock: {
    start: 'remoteMock:start',
    stop: 'remoteMock:stop',
    getStatus: 'remoteMock:getStatus'
  }
} as const
