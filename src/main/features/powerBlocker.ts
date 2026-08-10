/**
 * 【特性】阻止系统睡眠（powerSaveBlocker）
 * 【API】powerSaveBlocker
 * 【复制】1. 复制本文件到新工程 src/main/features/powerBlocker.ts
 *         2. 在 index.ts 中调用 registerPowerBlocker()
 *         3. 渲染进程调用 window.api.powerBlocker.set(true/false)
 * 【说明】阻止系统进入睡眠/息屏，典型场景：
 *         - 视频播放、下载任务进行中（防止断网）
 *         - 演示/直播时保持屏幕常亮
 *         返回的 id 用于停止；start 后系统不再自动睡眠（直到 stop）。
 */

import { ipcMain, powerSaveBlocker } from 'electron'

let blockerId: number | null = null

export function registerPowerBlocker(): void {
  ipcMain.handle('powerBlocker:set', (_e, enabled: boolean) => {
    if (enabled && blockerId === null) {
      // 'prevent-app-suspension'：阻止应用挂起（保持运行）
      // 另有 'prevent-display-sleep'：连屏幕都不让休眠
      blockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!enabled && blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
    return { active: blockerId !== null && powerSaveBlocker.isStarted(blockerId) }
  })

  ipcMain.handle('powerBlocker:getState', () => ({
    active: blockerId !== null && powerSaveBlocker.isStarted(blockerId)
  }))
}
