/**
 * 【特性】任务栏与平台特性（Windows 任务栏 / macOS Dock）
 * 【API】BrowserWindow.setProgressBar / app.setBadgeCount / app.setJumpList /
 *        win.setOverlayIcon / app.dock.setMenu / app.addRecentDocument /
 *        win.setThumbarButtons / win.flashFrame
 * 【复制】1. 复制本文件到新工程 src/main/features/taskbar.ts
 *         2. 在 index.ts 中调用 registerTaskbar(getMainWindow)
 *         3. 渲染进程调用 window.api.taskbar.*
 * 【说明】桌面应用的"存在感"细节（按平台区分）：
 *         Windows：进度条、跳转列表（JumpList 最近文件）、图标叠加角标、
 *                  缩略图按钮（Thumbar，播放器式控制）、任务栏闪烁提醒
 *         macOS：Dock 角标数字、Dock 右键菜单、最近文档、bounce 动画
 */

import { app, ipcMain, Menu, nativeImage } from 'electron'
import { basename, join } from 'path'
import type { MainWindowGetter } from '../types'

export function registerTaskbar(getMainWindow: MainWindowGetter): void {
  // ── 任务栏进度条 ──
  // value: 0 ~ 1 表示进度；null 清除进度条；'error'/'paused' 切换颜色模式
  ipcMain.handle(
    'taskbar:setProgress',
    (_e, value: number | null, mode?: 'normal' | 'error' | 'paused' | 'indeterminate') => {
      const win = getMainWindow()
      if (!win) return false
      if (value === null) {
        win.setProgressBar(-1) // -1 移除进度条
      } else {
        win.setProgressBar(value, { mode: mode ?? 'normal' })
      }
      return true
    }
  )

  // ── 应用角标（macOS Dock / Linux）──
  ipcMain.handle('taskbar:setBadge', (_e, count: number) => {
    app.setBadgeCount(Math.max(0, Math.floor(count)))
    return app.getBadgeCount()
  })

  // ── Windows 跳转列表（JumpList：右键任务栏图标的最近文件/任务）──
  // ⚠️ API 语义（Electron 39 类型定义/源码确认）：
  //   ① recent/frequent 分类不能带 items（由 Windows 自己管理，内容来自
  //      app.addRecentDocument 写入的系统"最近使用"），带 items 会被整体拒绝
  //   ② setJumpList 返回结果码（ok/error/invalidSeparatorError/
  //      fileTypeRegistrationError/customCategoryAccessDeniedError），必须检查
  //   ③ file 类型条目要求应用注册对应扩展名（否则 fileTypeRegistrationError，
  //      dev 下 electron.exe 未注册 .txt），task 类型（program+args）无此要求，最稳定
  //   ④ customCategoryAccessDeniedError = Windows 隐私设置（"让 Windows 通过跟踪
  //      应用启动来改进'开始'菜单和搜索结果"被关闭/组策略）拒绝自定义分类
  //      （AppendCategory 返回 E_ACCESSDENIED）；标准 tasks 分类走 AddUserTasks，
  //      不受此限制 → 可回退
  ipcMain.handle('taskbar:setJumpList', (_e, files: string[]) => {
    if (process.platform !== 'win32') return { ok: false, error: '仅 Windows 支持' }
    if (!files.length) return { ok: false, error: '请先输入文件路径' }
    // ① 写入系统"最近使用"（资源管理器最近文档 / JumpList"最近"区）
    files.forEach((file) => app.addRecentDocument(file))
    const items = files.map((file) => ({
      type: 'task' as const,
      title: `打开 ${basename(file)}`,
      program: process.execPath,
      args: `"${file}"`
    }))
    // ② 优先自定义分类"最近文件"
    let result = app.setJumpList([{ type: 'custom', name: '最近文件', items }])
    if (result === 'ok') return { ok: true }
    if (result === 'customCategoryAccessDeniedError') {
      // ③ 隐私设置禁止自定义分类 → 回退标准"任务"分类（AddUserTasks 不受该限制）
      result = app.setJumpList([{ type: 'tasks', items }])
      if (result === 'ok') return { ok: true, fallback: 'tasks' }
      return {
        ok: false,
        error:
          'Windows 隐私设置禁止添加 JumpList 分类：请打开"设置 → 隐私和安全性 → 常规 → ' +
          `让 Windows 通过跟踪应用启动来改进"开始"菜单和搜索结果"（组策略关闭需管理员解除）。${result}`
      }
    }
    // ④ 其他失败把结果码透出给页面（如 fileTypeRegistrationError 需要注册文件关联）
    return { ok: false, error: `setJumpList 失败: ${result}` }
  })

  // ── Windows 任务栏图标叠加角标（OverlayIcon）──
  ipcMain.handle('taskbar:setOverlay', (_e, enabled: boolean) => {
    const win = getMainWindow()
    if (!win) return false
    if (enabled) {
      const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
      win.setOverlayIcon(icon, '演示叠加图标')
    } else {
      win.setOverlayIcon(null, '')
    }
    // 返回实际应用状态（而非恒 true）：关闭时若返回 true，页面开关会被弹回"开"位
    return enabled
  })

  // ── macOS Dock 右键菜单 ──
  ipcMain.handle('taskbar:setDockMenu', () => {
    if (process.platform !== 'darwin' || !app.dock) return { ok: false, error: '仅 macOS 支持' }
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => getMainWindow()?.show() },
        {
          label: '添加最近文档',
          click: () => app.addRecentDocument(join(app.getPath('documents'), '示例文档.txt'))
        }
      ])
    )
    return { ok: true }
  })

  // ── 最近文档 + Dock 弹跳动画（macOS）──
  ipcMain.handle('taskbar:addRecentDocument', () => {
    app.addRecentDocument(join(app.getPath('documents'), '最近文档示例.txt'))
    app.dock?.bounce('informational') // Dock 图标弹跳提示
    return true
  })

  // ── Windows 任务栏缩略图按钮（Thumbar：悬停任务栏图标时出现）──
  // 典型场景：媒体播放器的 播放/暂停/下一首，或下载器的 暂停/继续
  ipcMain.handle('taskbar:setThumbar', (_e, enabled: boolean) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '窗口不存在' }
    if (process.platform !== 'win32') return { ok: false, error: '仅 Windows 支持' }
    if (!enabled) {
      win.setThumbarButtons([]) // 传空数组移除按钮
      return { ok: true }
    }
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    win.setThumbarButtons([
      {
        tooltip: '播放 / 暂停',
        icon,
        click: () => {
          if (!win.isDestroyed()) win.webContents.send('taskbar:thumbar-clicked', 'playpause')
        }
      },
      {
        tooltip: '下一首',
        icon,
        click: () => {
          if (!win.isDestroyed()) win.webContents.send('taskbar:thumbar-clicked', 'next')
        }
      }
    ])
    return { ok: true }
  })

  // ── 任务栏图标闪烁（新消息提醒：应用在后台时引起注意）──
  ipcMain.handle('taskbar:flashFrame', () => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '窗口不存在' }
    if (process.platform === 'darwin') {
      // macOS 没有任务栏闪烁，等价物是 Dock bounce（本页"添加最近文档"已演示）
      return { ok: false, error: 'macOS 无任务栏闪烁，等价物为 Dock bounce' }
    }
    win.flashFrame(true)
    // 3 秒后自动熄灭（教学演示；真实应用应在用户点击窗口时熄灭）
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.flashFrame(false)
    }, 3000)
    return { ok: true }
  })
}
