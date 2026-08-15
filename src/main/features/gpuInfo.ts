/**
 * 【特性】GPU 信息与硬件加速开关（排查渲染异常/黑屏/卡顿的起点）
 * 【API】app.getGPUFeatureStatus / app.getGPUInfo / app.commandLine.appendSwitch
 * 【复制】1. 复制本文件到新工程 src/main/features/gpuInfo.ts
 *         2. 在 index.ts 的 app ready 之前调用 applyGpuCommandLine()
 *            （与 registerProtocolSchemes 并列，注释说明原因）
 *         3. 在 index.ts 中调用 registerGpuInfo()
 *         4. 渲染进程调用 window.api.gpu.*
 * 【说明】Electron 界面由 GPU 加速渲染，个别机器驱动异常会出现黑屏/花屏/卡顿：
 *         - getGPUFeatureStatus()：逐项列出硬件加速特性状态（2d_canvas / webgl 等）
 *         - getGPUInfo('basic')：显卡型号、驱动版本等基本信息（上报 bug 时很有用）
 *         - disable-gpu：禁用硬件加速（软渲染），必须在 app ready 之前追加开关；
 *           本演示用 userData 下的标记文件 + 重启（复用 relaunch.ts）实现闭环
 *         注意：正常机器禁用 GPU 后界面会明显变卡，演示后记得重新开启。
 */

import { app, ipcMain } from 'electron'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GPUFeatureStatus } from 'electron'

/** 禁用 GPU 的标记文件（位于 userData，重启后由 applyGpuCommandLine 读取） */
function flagFile(): string {
  return join(app.getPath('userData'), 'disable-gpu.flag')
}

/**
 * 在 app ready 之前调用：若存在"禁用 GPU"标记，追加命令行开关。
 * 原因：appendSwitch 必须在 ready 前调用才能完整生效。
 */
export function applyGpuCommandLine(): void {
  if (existsSync(flagFile())) {
    app.commandLine.appendSwitch('disable-gpu')
  }
}

export function registerGpuInfo(): void {
  // ── GPU 加速特性状态表（每一项：hardware_accelerated / software_only 等）──
  ipcMain.handle('gpu:getFeatureStatus', (): GPUFeatureStatus => {
    return app.getGPUFeatureStatus()
  })

  // ── GPU 基本信息（型号/驱动/厂商，排查与 bug 上报必备）──
  ipcMain.handle('gpu:getInfo', async () => {
    return app.getGPUInfo('basic')
  })

  // ── 切换硬件加速：写/删标记文件（重启后生效，重启由页面调 relaunch）──
  ipcMain.handle('gpu:setAcceleration', (_e, enabled: boolean) => {
    if (enabled) rmSync(flagFile(), { force: true })
    else writeFileSync(flagFile(), '1')
    return { needsRelaunch: true }
  })

  ipcMain.handle('gpu:getAccelerationState', () => {
    return {
      accelerated: !app.commandLine.hasSwitch('disable-gpu'),
      platform: process.platform
    }
  })
}
