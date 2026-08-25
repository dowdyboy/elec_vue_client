/**
 * 【模板】新特性模块可复制模板（轻量化封装示例）
 * 【说明】以本文件为起点创建新特性：复制 → 改名 → 实现 → 在 index.ts 注册 → 在 preload 暴露
 *         设计目标：简单、独立、安全、易于被他项目复用
 *
 * 【复制到新工程 3 步】
 *   1. 复制本文件到新工程 src/main/features/yourFeature.ts（改名）
 *   2. 在新工程 src/main/index.ts 中：import { registerYourFeature } from './features/yourFeature'
 *      并在 app.whenReady 内调用 registerYourFeature(getMainWindow)
 *   3. 如需渲染进程调用：在新工程 src/preload/index.ts 对应分组暴露 window.api.yourFeature.*
 *
 * 【轻量化封装要点】
 *   - 每个模块只做一件事，对外仅暴露 registerX(getMainWindow): Disposer
 *   - 通道名建议从 src/main/ipcChannels.ts 导入（可选，不引入也不影响运行）
 *   - 敏感操作（写文件、执行代码、打开路径）在 handle 顶部校验 isTrustedSender(event)
 *   - 返回 Disposer 供 index.ts 统一在 before-quit 释放资源（定时器/Server/监听）
 *   - 教学注释保留【特性】【API】【复制】三段，便于他人理解与复制
 */

import { ipcMain } from 'electron'
import type { MainWindowGetter } from '../types'
import type { Disposer } from '../utils/disposable'
// 可选：按需导入通道常量与校验
// import { IPC } from '../ipcChannels'
// import { isTrustedSender, FORBIDDEN } from '../utils/validateSender'

/** 特性名称：改为你的特性名 */
const FEATURE = 'template'

export function registerTemplate(getMainWindow: MainWindowGetter): Disposer {
  void getMainWindow // 占位避免未使用告警；实际按需使用 getMainWindow()?.webContents.send(...)
  // ── 示例：请求-响应通道 ──
  ipcMain.handle('template:ping', (_e, payload: string) => {
    // 敏感通道示例：if (!isTrustedSender(_e)) return FORBIDDEN
    return { ok: true, echo: payload, feature: FEATURE }
  })

  // ── 示例：事件推送（主→渲染）──
  // getMainWindow()?.webContents.send('template:event', { time: new Date().toISOString() })

  // ── 示例：资源（定时器/Server）需在返回的 Disposer 中释放 ──
  // const timer = setInterval(() => {}, 1000)

  // 返回释放函数（无资源时返回空函数）
  return () => {
    // clearInterval(timer)
    ipcMain.removeHandler('template:ping')
  }
}
