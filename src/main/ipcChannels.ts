/**
 * 【共享】IPC 通道常量（轻量化）
 * 【说明】为避免魔法字符串分散在 main/preload 两侧导致 typo 无法被 TS 捕获，
 *         这里集中声明所有通道名。各 features 模块与 preload 按需导入使用。
 *         复制到新工程时：可直接拷贝本文件，或仅复制需要的常量到目标文件的顶部。
 *         本文件为"可选"依赖——教学上也可保留字符串写法，仅在追求可维护时引入。
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
  paths: { getAll: 'paths:getAll', set: 'paths:set', getAppPath: 'paths:getAppPath' }
} as const
