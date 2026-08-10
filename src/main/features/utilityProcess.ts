/**
 * 【特性】计算密集型任务（utilityProcess 子进程 + 进程资源监控）
 * 【API】utilityProcess / app.getAppMetrics / webContents.getProcessMemoryInfo
 * 【复制】1. 复制本文件与 src/main/workers/fibonacci.ts 到新工程
 *         2. electron.vite.config.ts 的 main.rollupOptions.input 增加 worker 入口
 *         3. 在 index.ts 中调用 registerUtilityProcess(getMainWindow)
 *         4. 渲染进程调用 window.api.perf.*
 * 【说明】教学核心：主进程是单线程——
 *         - 在主进程同步跑 CPU 密集任务 → 整个应用（所有窗口 IPC）被阻塞
 *         - utilityProcess.fork 启动独立 Node.js 进程 → 主进程照常响应
 *         生产场景：文件压缩、图像处理、加解密、解析大文件等都应放子进程。
 */

import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { MainWindowGetter } from '../types'

export function registerUtilityProcess(getMainWindow: MainWindowGetter): void {
  const push = (data: unknown): void => {
    getMainWindow()?.webContents.send('perf:event', data)
  }

  // ── ① 主进程同步计算（教学演示：观察 UI 冻结）──
  // 注意：这只是演示"错误做法"，生产代码不要这样写
  ipcMain.handle('perf:fibSync', (_e, n: number) => {
    const start = Date.now()
    const fib = (x: number): number => (x <= 1 ? x : fib(x - 1) + fib(x - 2))
    const value = fib(n)
    return { value, elapsedMs: Date.now() - start }
  })

  // ── ② utilityProcess 子进程计算（正确做法）──
  let child: UtilityProcess | null = null

  /** 统一清理：无论正常完成、被终止还是异常退出，都要释放引用 */
  const cleanupChild = (): void => {
    child = null
  }

  ipcMain.handle('perf:fibInProcess', (_e, n: number) => {
    if (child) return { ok: false, error: '已有计算任务运行中' }
    // fork 独立 Node.js 进程执行 worker 脚本
    child = utilityProcess.fork(join(__dirname, 'workers/fibonacci.js'))
    child.on('message', (message) => {
      const data = message as { type: string; value?: number; elapsedMs?: number }
      if (data.type === 'result') {
        push({ type: 'result', value: data.value, elapsedMs: data.elapsedMs })
        child?.kill()
        cleanupChild()
      }
    })
    // 异常退出（脚本报错/崩溃）也要清理引用，否则下次计算会被"已有任务"卡住
    child.on('exit', () => cleanupChild())
    child.postMessage({ n })
    return { ok: true }
  })

  // 中途终止计算（演示子进程可随时杀掉）
  ipcMain.handle('perf:terminate', () => {
    child?.kill()
    cleanupChild()
    push({ type: 'terminated' })
    return true
  })

  // ── ③ 进程资源监控（类"任务管理器"）──
  ipcMain.handle('perf:getMetrics', () => {
    const appMetrics = app.getAppMetrics().map((m) => ({
      type: m.type, // 'browser'(主进程) / 'renderer' / 'gpu' / 'utility' / 'zygote'...
      cpu: m.cpu ? Math.round(m.cpu.percentCPUUsage * 100) / 100 : 0,
      memoryMB: m.memory ? Math.round(m.memory.workingSetSize / 1024 / 1024) : 0
    }))
    return { appMetrics }
  })
}
