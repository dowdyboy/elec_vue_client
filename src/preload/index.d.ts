import type { Api, ElectronBridge } from './index'

declare global {
  interface Window {
    /** 最小平台信息（platform/versions）；不暴露 ipcRenderer/process.env */
    electron: ElectronBridge
    /** 自定义 API：window.api.<分组>.<方法>，分组与主进程 features 模块一一对应 */
    api: Api
  }
}
