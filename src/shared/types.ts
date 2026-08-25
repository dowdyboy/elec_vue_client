/**
 * 【共享】跨进程通用类型（轻量化）
 * 【说明】收敛 main/preload 中重复定义的通用类型，供两侧共用。
 *         复制到新工程时可直接拷贝本文件，或按需复制需要的类型。
 */

// ── 通用结果包装 ──
export type Ok<T> = { ok: true; data?: T } & T extends void ? object : object
export type Fail = { ok: false; error: string }
export type Result<T = unknown> = ({ ok: true } & T) | Fail

/** 文件/路径操作结果 */
export type FsResult = { ok: boolean; error?: string; data?: string; entries?: string[] }

/** shell.openPath 结果（判别联合） */
export type ShellOpenResult = { ok: true; path: string } | { ok: false; error: string }

/** 通知选项（与 Electron Notification 保持一致的最小子集） */
export interface NotificationOptions {
  title: string
  body: string
}

/** 主题来源 */
export type ThemeSource = 'system' | 'light' | 'dark'

/** 子窗口模式 */
export type ChildWindowMode = 'normal' | 'transparent'

/** 下载记录（与 download.ts 保持一致） */
export interface DownloadRecord {
  id: string
  url: string
  filename: string
  state: string
  receivedBytes: number
  totalBytes: number
}

// ── 通用工具类型 ──
export type Disposer = () => void
