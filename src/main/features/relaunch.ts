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
 *         ⚠️ dev 模式限制（electron-vite）：开发时 vite dev server 在 electron-vite
 *         进程内运行，app.relaunch() 后旧进程退出会触发 electron-vite 的
 *         ps.on('close', process.exit)，把整个 dev 进程（含 dev server）杀掉；
 *         新进程继承的 ELECTRON_RENDERER_URL 指向已死的服务器 → 白屏。
 *         因此开发模式不自动重启，返回 { devMode: true } 让页面提示手动重启 npm run dev；
 *         打包后无 dev server，自动重启正常。
 */

import { app, ipcMain } from 'electron'

export function registerRelaunch(): void {
  ipcMain.handle('app:relaunch', () => {
    // 开发模式：自动重启会连带杀掉 electron-vite 的 dev server → 新实例白屏，
    // 交给页面提示手动重启 npm run dev
    if (!app.isPackaged) return { devMode: true }
    // 生产模式：安排重启，然后立即退出进程
    app.relaunch()
    app.exit(0)
    return { devMode: false }
  })
}
