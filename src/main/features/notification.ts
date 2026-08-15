/**
 * 【特性】系统通知（Notification）
 * 【API】Notification / shell.writeShortcutLink（Windows AUMID 注册）
 * 【复制】1. 复制本文件到新工程 src/main/features/notification.ts
 *         2. 在 index.ts 中调用 registerNotification(getMainWindow)
 *         3. 渲染进程调用 window.api.notification.*
 * 【说明】Notification 必须在主进程创建（渲染进程的 web Notification
 *         在 Electron 中默认不可用）。支持标题/正文/图标/点击事件，
 *         以及动作按钮（actions）。
 * 【平台坑】Windows 10/11 的 toast 动作按钮要求应用的 AppUserModelID（AUMID）
 *           已通过"开始菜单快捷方式"注册（ToastNotificationManager 机制）：
 *           - 开发模式（未打包、无快捷方式）：通知能显示，但按钮被系统剥掉
 *           - 打包安装（安装程序创建快捷方式）：按钮正常
 *           本模块提供 notification:registerShortcut 在开发模式下一键创建
 *           带 AUMID 的快捷方式解锁按钮显示（见 docs/04）。
 *           macOS：通知要求应用代码签名，未签名 dev 构建通知受限。
 */

import { Notification, ipcMain, shell, app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

/** 与 index.ts 中 electronApp.setAppUserModelId 保持一致 */
const APP_USER_MODEL_ID = 'com.electron'

/** Windows 开始菜单快捷方式路径（AUMID 注册载体） */
function shortcutPath(): string {
  return join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs', 'Electron 教学.lnk')
}

/** 创建/更新带 AUMID 的开始菜单快捷方式（Windows toast 按钮的前置条件） */
function ensureAumidShortcut(): { ok: boolean; path?: string; error?: string } {
  try {
    // target：dev 指向 electron.exe；打包后 process.execPath 即应用 exe（同样适用）
    // args：dev 时给 electron 传应用路径，否则快捷方式启动的是裸 electron
    const ok = shell.writeShortcutLink(shortcutPath(), 'create', {
      target: process.execPath,
      args: app.getAppPath(),
      appUserModelId: APP_USER_MODEL_ID,
      description: 'Electron 教学项目（开发用快捷方式：注册通知 AUMID，解锁 toast 动作按钮）'
    })
    return ok
      ? { ok: true, path: shortcutPath() }
      : { ok: false, error: 'writeShortcutLink 返回 false（创建失败）' }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export interface NotificationOptions {
  title: string
  body: string
  /** 动作按钮文案列表（最多 2 个），对应点击事件返回下标 0/1 */
  actions?: string[]
}

export function registerNotification(getMainWindow: MainWindowGetter): void {
  // ── Windows 启动阶段自动注册 AUMID 快捷方式 ──
  // 关键：越早创建越好——Electron 的 toast notifier 在首次通知时才初始化，
  // 且 Windows 推送通知平台（WpnUserService）会缓存"开始菜单快捷方式表"，
  // 程序化新建的 .lnk 需等待其缓存刷新（注销/重启）才被 toast 按钮判定认可。
  // 打包安装（Squirrel 安装期创建快捷方式）天然满足，dev 由本模块兜底。
  if (process.platform === 'win32' && !app.isPackaged && !existsSync(shortcutPath())) {
    ensureAumidShortcut()
  }

  // ── 平台能力查询（演示页据此展示状态与修复按钮）──
  ipcMain.handle('notification:getPlatformInfo', () => {
    if (process.platform === 'win32') {
      const exists = existsSync(shortcutPath())
      return {
        platform: 'win32',
        aumid: APP_USER_MODEL_ID,
        shortcutExists: exists,
        actionsSupported: exists, // 快捷方式存在 → toast 按钮可显示（若仍无按钮见页面排查指引）
        hint: exists
          ? 'AUMID 已注册（开始菜单快捷方式存在）。若按钮仍未显示：① 重启应用 ② 仍无效则注销/重启一次（WpnUserService 缓存刷新）③ 注意通知右上角的展开箭头'
          : '开发模式未注册 AUMID：通知可显示但动作按钮会被系统剥掉，可点击下方按钮一键创建快捷方式'
      }
    }
    if (process.platform === 'darwin') {
      return {
        platform: 'darwin',
        actionsSupported: app.isPackaged,
        hint: app.isPackaged
          ? '已打包应用（默认带签名配置），通知与按钮可用'
          : '未签名开发构建（dev）下 macOS 通知受限：需代码签名后才能完整展示（打包后生效）'
      }
    }
    return {
      platform: 'linux',
      actionsSupported: true,
      hint: 'Linux 走 libnotify：多数桌面环境支持动作按钮（依赖通知守护进程）'
    }
  })

  // ── Windows dev 解锁：创建带 AUMID 的开始菜单快捷方式 ──
  ipcMain.handle('notification:registerShortcut', () => {
    if (process.platform !== 'win32') {
      return { ok: false, error: '仅 Windows 需要此操作' }
    }
    return ensureAumidShortcut()
  })

  ipcMain.handle('notification:show', (_event, options: NotificationOptions) => {
    const notification = new Notification({
      title: options.title || '系统通知',
      body: options.body || '',
      icon: join(__dirname, '../../resources/icon.png'),
      // 动作按钮（Electron 类型：{ type: 'button', text }）
      actions: options.actions?.map((text) => ({ type: 'button' as const, text }))
    })

    // 点击通知：聚焦主窗口（用户点击通知通常期望打开应用）
    notification.on('click', () => {
      const win = getMainWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      // 同时把"点击事件"回传给渲染进程，页面可据此做业务处理
      win.webContents.send('notification:clicked', options)
    })

    // 动作按钮被点击：回传按钮下标（0, 1, ...）
    notification.on('action', (_event, index) => {
      getMainWindow()?.webContents.send('notification:action', { options, index })
    })

    notification.show()
    return { shown: true }
  })
}
