/**
 * 【特性】闪屏页（Splash Screen）
 * 【API】BrowserWindow（无边框 + skipTaskbar + 置顶）
 * 【复制】1. 复制本文件与 src/renderer/splash.html 到新工程
 *         2. electron.vite.config.ts 的 renderer.rollupOptions.input 增加 splash 入口
 *         3. 主进程入口中：创建主窗口前 showSplash()，主窗口 ready-to-show 后 closeSplash()
 * 【说明】启动闪屏：应用冷启动（尤其打包后）需要 1~3 秒，
 *         闪屏让用户第一时间看到反馈。实现要点：
 *         - 无边框、不占任务栏（skipTaskbar）、置顶
 *         - 主窗口 ready-to-show 后立即关闭（避免闪烁）
 *         本工程默认开启（教学演示），生产可按需调用。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

let splash: BrowserWindow | null = null

/** 显示闪屏窗口 */
export function showSplash(): BrowserWindow | null {
  if (splash) return splash
  splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false, // 无边框
    resizable: false,
    movable: false,
    alwaysOnTop: true, // 置顶
    skipTaskbar: true, // 不占任务栏
    center: true,
    webPreferences: {
      sandbox: false
    }
  })
  // dev 模式加载 dev server 的 splash.html；生产加载打包文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    splash.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/splash.html`)
  } else {
    splash.loadFile(join(__dirname, '../renderer/splash.html'))
  }
  return splash
}

/** 关闭闪屏窗口 */
export function closeSplash(): void {
  splash?.close()
  splash = null
}

/** 注册"重放闪屏"接口（演示页按钮用：显示 2.5 秒后自动关闭） */
export function registerSplashReplay(): void {
  ipcMain.handle('splash:replay', () => {
    showSplash()
    setTimeout(() => closeSplash(), 2500)
    return true
  })
}
