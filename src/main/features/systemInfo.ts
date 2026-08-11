/**
 * 【特性】系统信息（语言 / 字体 / 平台）
 * 【API】app.getLocale / getPreferredSystemLanguages / getFonts
 * 【复制】1. 复制本文件到新工程 src/main/features/systemInfo.ts
 *         2. 在 index.ts 中调用 registerSystemInfo()
 *         3. 渲染进程调用 window.api.system.getInfo()
 * 【说明】系统语言与字体查询的典型用途：
 *         - 多语言应用初始化：根据系统语言选择默认界面语言
 *         - 字体选择器：列出系统可用字体（编辑器/设计类应用）
 *         - 平台/架构判断：决定下载哪个平台的资源
 */

import { app, ipcMain } from 'electron'

export function registerSystemInfo(): void {
  ipcMain.handle('system:getInfo', () => {
    // app.getFonts 在部分类型声明中缺失，按官方 API 使用（Linux 上不可用）
    const getFonts = (app as unknown as { getFonts?: () => string[] }).getFonts
    return {
      locale: app.getLocale(), // 当前界面语言，如 zh-CN / en-US
      languages: app.getPreferredSystemLanguages(), // 系统语言偏好列表（按优先级）
      platform: process.platform,
      arch: process.arch,
      // 系统字体列表（Linux 上 getFonts 不可用）
      fonts: process.platform === 'linux' || !getFonts ? [] : getFonts().slice(0, 30)
    }
  })
}
