/**
 * 【特性】窗口状态持久化（记住窗口位置与大小）
 * 【API】BrowserWindow + fs（userData 目录）
 * 【复制】1. 复制本文件到新工程 src/main/features/windowState.ts
 *         2. 在 index.ts 中调用 registerWindowState()（注册查询 IPC）
 *         3. 创建窗口后调用 attachWindowState(win)（恢复 + 自动保存）
 * 【说明】生产应用标配：用户调整窗口大小/位置后，下次启动恢复到上次状态。
 *         实现要点：
 *         - 保存到 userData/window-state.json（userData 是应用私有数据目录）
 *         - resize/move 事件高频触发 → debounce（500ms 合并写入）
 *         - 最大化状态用 getNormalBounds() 记录（最大化时的"正常"边界）
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

const STATE_FILE = join(app.getPath('userData'), 'window-state.json')

/** 持久化数据结构 */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** 读取上次保存的窗口状态（文件不存在时返回 null） */
export async function loadWindowState(): Promise<WindowState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    const state = JSON.parse(raw) as WindowState
    // 基本校验：尺寸必须有效
    if (!state.width || !state.height) return null
    return state
  } catch {
    return null // 首次启动 / 文件损坏 → 用默认值
  }
}

async function writeState(state: WindowState): Promise<void> {
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // 写入失败不影响运行（如磁盘只读）
  }
}

/**
 * 绑定窗口：启动时恢复状态，之后自动保存
 * @param win 目标窗口
 */
export function attachWindowState(win: BrowserWindow): void {
  // ── 恢复 ──
  loadWindowState().then((state) => {
    if (!state) return
    if (state.maximized) {
      win.maximize()
    } else {
      win.setBounds({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height
      })
    }
  })

  // ── 保存（debounce）──
  let timer: NodeJS.Timeout | null = null
  const persist = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const bounds = win.getNormalBounds() // 最大化时也返回"正常边界"
      writeState({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: win.isMaximized()
      })
    }, 500)
  }
  win.on('resize', persist)
  win.on('move', persist)
  win.on('close', persist) // 关闭时立即保存最后一次状态
}

/** 注册查询接口（渲染进程展示当前持久化状态） */
export function registerWindowState(): void {
  ipcMain.handle('window:getPersistedState', () => loadWindowState())
}
