/**
 * 【用途】主进程共享类型定义
 * 【说明】各特性模块统一通过 MainWindowGetter 获取主窗口引用，
 *         避免模块之间直接耦合，便于单独复制到其他工程
 */

import type { BrowserWindow } from 'electron'

/** 获取主窗口引用的函数类型（可能为 null，窗口关闭后返回 null） */
export type MainWindowGetter = () => BrowserWindow | null
