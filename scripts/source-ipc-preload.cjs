/** 源 IPC E2E 测试用的最小 preload；只暴露本测试需要的方法。 */
const { contextBridge, ipcRenderer } = require('electron')

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  source: {
    start: () => invoke('source:start'),
    stop: () => invoke('source:stop'),
    getStatus: () => invoke('source:getStatus'),
    setConfig: (cfg) => invoke('source:setConfig', cfg),
    recordStart: (stream) => invoke('source:recordStart', stream),
    recordStop: () => invoke('source:recordStop'),
    recordStatus: () => invoke('source:recordStatus'),
    playbackStatus: () => invoke('source:playbackStatus'),
    pausePlayback: () => invoke('source:pausePlayback'),
    resumePlayback: () => invoke('source:resumePlayback'),
    stepPlayback: () => invoke('source:stepPlayback'),
    stopPlayback: () => invoke('source:stopPlayback'),
    seekPlayback: (i) => invoke('source:seekPlayback', i),
    setPlaybackSpeed: (v) => invoke('source:setPlaybackSpeed', v),
    setPlaybackTiming: (v) => invoke('source:setPlaybackTiming', v),
    setPlaybackLoop: (v) => invoke('source:setPlaybackLoop', v),
    onFrame: (cb) => on('source:frame', cb)
  },
  sweep: {
    start: () => invoke('sweep:start'),
    stop: () => invoke('sweep:stop'),
    getStatus: () => invoke('sweep:getStatus'),
    setConfig: (cfg) => invoke('sweep:setConfig', cfg),
    trigger: () => invoke('sweep:trigger'),
    onFrame: (cb) => on('sweep:frame', cb)
  },
  signalAnalysis: {
    start: (opts) => invoke('signalAnalysis:start', opts),
    stop: () => invoke('signalAnalysis:stop'),
    getStatus: () => invoke('signalAnalysis:getStatus'),
    setConfig: (cfg) => invoke('signalAnalysis:setConfig', cfg),
    subscribe: () => invoke('signalAnalysis:subscribe'),
    unsubscribe: () => invoke('signalAnalysis:unsubscribe'),
    onFrame: (cb) => on('signal:analysis', cb)
  }
})
