/**
 * 【特性】shell 文件操作（打开/定位/回收站/蜂鸣）
 * 【API】shell
 * 【复制】1. 复制本文件到新工程 src/main/features/shellOps.ts
 *         2. 在 index.ts 中调用 registerShellOps()
 *         3. 渲染进程调用 window.api.shell.*
 * 【说明】shell 是"调用系统能力"的便捷通道：
 *         - openPath：用系统默认程序打开文件/文件夹/URL
 *         - showItemInFolder：在资源管理器中定位文件
 *         - trashItem：移到回收站（可撤销，比直接删除安全）
 *         - beep：系统蜂鸣
 *         注意：打开外部链接不要用 openPath('https://...')，用 shell.openExternal（见 security.ts）。
 */

import { ipcMain, shell } from 'electron'

export function registerShellOps(): void {
  // 打开文件/文件夹（系统默认程序；返回错误字符串，空串 = 成功）
  ipcMain.handle('shell:openPath', async (_e, target: string) => {
    if (!target) return { ok: false, error: '路径不能为空' }
    const error = await shell.openPath(target)
    return { ok: !error, error }
  })

  // 在资源管理器中定位（Windows 资源管理器 / macOS Finder）
  ipcMain.handle('shell:showInFolder', (_e, target: string) => {
    if (!target) return { ok: false, error: '路径不能为空' }
    shell.showItemInFolder(target)
    return { ok: true }
  })

  // 移到回收站（可恢复，比 fs.unlink 安全）
  ipcMain.handle('shell:trash', async (_e, target: string) => {
    if (!target) return { ok: false, error: '路径不能为空' }
    try {
      await shell.trashItem(target)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 系统蜂鸣
  ipcMain.handle('shell:beep', () => {
    shell.beep()
    return true
  })
}
