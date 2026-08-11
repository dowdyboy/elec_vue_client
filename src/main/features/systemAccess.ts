/**
 * 【特性】系统权限询问（systemPreferences）
 * 【API】systemPreferences.askForMediaAccess / getMediaAccessStatus
 * 【复制】1. 复制本文件到新工程 src/main/features/systemAccess.ts
 *         2. 在 index.ts 中调用 registerSystemAccess()
 *         3. 渲染进程调用 window.api.system.*
 * 【说明】摄像头/麦克风等敏感权限的授权流程：
 *         - macOS：必须在主进程调用 askForMediaAccess 发起系统授权弹窗，
 *           授权状态用 getMediaAccessStatus 查询（'not-determined' | 'granted' | 'denied' | 'restricted'）
 *         - Windows/Linux：由 Chromium 权限弹窗处理（配合 security.ts 的白名单）
 *         典型场景：会议/录制类应用启动时检查并引导授权。
 */

import { ipcMain, systemPreferences } from 'electron'

export function registerSystemAccess(): void {
  // 查询媒体权限状态（macOS）
  ipcMain.handle('system:getMediaAccessStatus', () => {
    if (process.platform !== 'darwin') {
      return { platform: process.platform, supported: false }
    }
    return {
      platform: 'darwin',
      supported: true,
      camera: systemPreferences.getMediaAccessStatus('camera'),
      microphone: systemPreferences.getMediaAccessStatus('microphone')
    }
  })

  // 发起授权询问（macOS；返回用户是否授予）
  ipcMain.handle('system:askMediaAccess', async (_e, type: 'camera' | 'microphone') => {
    if (process.platform !== 'darwin') {
      return {
        ok: false,
        error: '当前平台由 Chromium 权限弹窗处理（见 security.ts 权限白名单）'
      }
    }
    const granted = await systemPreferences.askForMediaAccess(type)
    return { ok: true, granted }
  })
}
