/**
 * 【特性】应用重启（app.relaunch）
 * 【API】app.relaunch / app.exit
 * 【复制】1. 复制本文件到新工程 src/main/features/relaunch.ts
 *         2. 在 index.ts 中调用 registerRelaunch()
 *         3. 渲染进程调用 window.api.relaunch.now()
 * 【说明】主动重启场景：设置项"重启生效"、自动更新安装（配合 docs/15）、
 *         崩溃后自恢复。注意：
 *         - app.relaunch() 只是"安排重启"，需要配合退出才生效
 *         - app.exit(0) 立即退出（不触发 before-quit 等事件），
 *           若希望走正常退出流程（保存数据等）用 app.quit()
 */

import { app, ipcMain } from 'electron'

export function registerRelaunch(): void {
  ipcMain.handle('app:relaunch', () => {
    // 安排重启，然后立即退出进程
    app.relaunch()
    app.exit(0)
    return true
  })
}
