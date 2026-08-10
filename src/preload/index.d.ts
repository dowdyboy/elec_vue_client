import { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

/** 剪贴板/通知等 IPC 载荷类型（与主进程 features 模块一致） */
export interface NotificationOptions {
  title: string
  body: string
}

export type ThemeSource = 'system' | 'light' | 'dark'

export type ChildWindowMode = 'normal' | 'transparent'

declare global {
  interface Window {
    electron: ElectronAPI
    /** 自定义 API：window.api.<分组>.<方法>，分组与主进程 features 模块一一对应 */
    api: Api
  }
}
