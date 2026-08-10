/**
 * 【特性】原生菜单（应用菜单 Menu.setApplicationMenu + 右键菜单）
 * 【API】Menu / MenuItem
 * 【复制】1. 复制本文件到新工程 src/main/features/menu.ts
 *         2. 在 index.ts 中调用 registerMenu(getMainWindow)
 *         3. 渲染进程触发右键菜单：window.api.menu.showContext()
 * 【说明】两类菜单：
 *         - 应用菜单：窗口顶部菜单栏（macOS 在系统顶部），可放全局命令
 *         - 上下文菜单：右键弹出，本工程演示在渲染进程页面右键区域触发
 */

import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import type { MainWindowGetter } from '../types'

/** 设置应用菜单（窗口顶部菜单栏） */
function setupAppMenu(getMainWindow: MainWindowGetter): void {
  const template: Electron.MenuItemConstructorOptions[] = []
  // macOS 的第一个菜单必须是应用名（含 about/quit 等系统角色）；
  // Windows/Linux 上该惯例菜单会显得多余，因此仅 macOS 添加
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
    })
  }
  template.push({
    label: '教学示例',
    submenu: [
      {
        label: '打开 GitHub（外部链接）',
        // 外部链接必须用 shell.openExternal，不要直接在应用内导航
        click: () => shell.openExternal('https://github.com/')
      },
      { type: 'separator' },
      {
        label: '全屏切换',
        accelerator: 'F11',
        click: () => {
          const win = getMainWindow()
          if (win) win.setFullScreen(!win.isFullScreen())
        }
      },
      {
        label: '开发者工具',
        accelerator: 'CommandOrControl+Shift+I',
        click: () => getMainWindow()?.webContents.toggleDevTools()
      }
    ]
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 创建右键上下文菜单（在渲染进程指定坐标弹出） */
function showContextMenu(win: BrowserWindow): void {
  const menu = Menu.buildFromTemplate([
    {
      label: '复制（演示 role）',
      // role 是 Electron 内置行为，无需自己写逻辑
      role: 'copy'
    },
    { label: '剪切', role: 'cut' },
    { label: '粘贴', role: 'paste' },
    { type: 'separator' },
    {
      label: '自定义菜单项',
      click: () => {
        // 菜单项点击后向渲染进程发事件（页面可监听展示）
        win.webContents.send('menu:item-clicked', '自定义菜单项被点击')
      }
    }
  ])
  // 弹在鼠标位置：需要渲染进程把鼠标坐标传给主进程
  menu.popup({ window: win })
}

export function registerMenu(getMainWindow: MainWindowGetter): void {
  setupAppMenu(getMainWindow)

  ipcMain.on('menu:show-context', (event) => {
    // 从事件中取出发起请求的窗口，菜单挂在它上面
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) showContextMenu(win)
  })
}
