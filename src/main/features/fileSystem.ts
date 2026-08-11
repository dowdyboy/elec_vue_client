/**
 * 【特性】文件系统（fs 安全封装 + fs.watch 目录监听）
 * 【API】fs（Node.js 内置）+ dialog
 * 【复制】1. 复制本文件到新工程 src/main/features/fileSystem.ts
 *         2. 在 index.ts 中调用 registerFileSystem(getMainWindow)
 *         3. 渲染进程调用 window.api.fs.*
 * 【说明】渲染进程默认没有 Node.js 能力（contextIsolation + 无 nodeIntegration），
 *         所有文件操作必须经主进程执行。本模块是最小可用封装：
 *         - 所有 IPC 返回 { ok, data?, error? }，异常不抛出到渲染进程
 *         - 生产工程建议：校验路径白名单 / 使用 dialog 选择路径而非任意传参
 *         - fs.watch 目录监听：文件夹变化实时推送（热同步/构建监视器场景）
 */

import { ipcMain } from 'electron'
import { promises as fs, watch, type Dirent, type FSWatcher } from 'fs'
import { join, basename, dirname } from 'path'
import type { MainWindowGetter } from '../types'

/** 统一返回结构：异常被捕获并转为 error 字段，不向上抛出 */
type FsResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** 包装异步操作，统一异常处理 */
async function safe<T>(fn: () => Promise<T>): Promise<FsResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 活动监听器表 */
const watchers = new Map<number, FSWatcher>()
let watchSeq = 0

function registerFileSystemImpl(getMainWindow: MainWindowGetter): void {
  // ── 读取文本文件 ──
  ipcMain.handle('fs:readFile', (_e, filePath: string) =>
    safe(async () => (await fs.readFile(filePath, 'utf-8')).toString())
  )

  // ── 写入文本文件（自动创建父目录）──
  ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) =>
    safe(async () => {
      await fs.mkdir(dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
      return `${basename(filePath)} 写入成功`
    })
  )

  // ── 列出目录内容 ──
  ipcMain.handle('fs:listDir', (_e, dirPath: string) =>
    safe(async () => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.map((entry: Dirent) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        // 常用辅助字段，教学演示用
        isFile: entry.isFile(),
        size: 0 // 完整工程可用 stat 获取，此处从简
      }))
    })
  )

  // ── 拼接路径工具（渲染进程无法直接用 node:path，走 IPC）──
  ipcMain.handle('fs:joinPath', (_e, base: string, name: string) => join(base, name))

  // ── 目录监听（fs.watch）：文件夹变化实时推送 ──
  ipcMain.handle('fs:watch', (_e, dirPath: string) => {
    if (!dirPath) return { ok: false, error: '路径不能为空' }
    const id = ++watchSeq
    try {
      // Windows/macOS 支持 recursive 递归监听（Linux 需自行递归实现）
      const watcher = watch(
        dirPath,
        { recursive: process.platform !== 'linux' },
        (eventType, filename) => {
          getMainWindow()?.webContents.send('fs:watcher-event', {
            id,
            eventType,
            filename: filename?.toString() ?? '',
            time: new Date().toLocaleTimeString()
          })
        }
      )
      watcher.on('error', () => {
        watchers.delete(id)
      })
      watchers.set(id, watcher)
      return { ok: true, id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 停止监听
  ipcMain.handle('fs:unwatch', (_e, id: number) => {
    const watcher = watchers.get(id)
    if (watcher) {
      watcher.close()
      watchers.delete(id)
    }
    return true
  })
}

export function registerFileSystem(getMainWindow: MainWindowGetter): void {
  registerFileSystemImpl(getMainWindow)
}
