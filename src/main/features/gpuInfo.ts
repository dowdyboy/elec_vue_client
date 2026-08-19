/**
 * 【特性】GPU 信息与硬件加速开关（排查渲染异常/黑屏/卡顿的起点）
 * 【API】app.getGPUFeatureStatus / app.getGPUInfo / app.disableHardwareAcceleration
 * 【复制】1. 复制本文件到新工程 src/main/features/gpuInfo.ts
 *         2. 在 index.ts 的 app ready 之前调用 applyGpuCommandLine()
 *            （与 registerProtocolSchemes 并列，注释说明原因）
 *         3. 在 index.ts 中调用 registerGpuInfo()
 *         4. 渲染进程调用 window.api.gpu.*
 * 【说明】Electron 界面由 GPU 加速渲染，个别机器驱动异常会出现黑屏/花屏/卡顿：
 *         - getGPUFeatureStatus()：逐项列出硬件加速特性状态（2d_canvas / webgl 等）
 *         - getGPUInfo('basic')：显卡型号、驱动版本等基本信息（上报 bug 时很有用）
 *         - 禁用硬件加速：官方 API 是 app.disableHardwareAcceleration()（必须在 app
 *           ready 之前调用，一次性设置完整的禁用/软件回退开关），比裸 appendSwitch
 *           ('disable-gpu') 更完整；本演示用 userData 下的标记文件 + 重启
 *           （复用 relaunch.ts）实现闭环
 *         ⚠️ relaunch 白屏踩坑（本工程实测）：关闭加速后立即 app.relaunch()，
 *         旧实例的 GPUCache/GPU 进程残留可能导致新实例软件合成初始化失败 → 白屏；
 *         因此检测到禁用标记时启动前清除 GPUCache（仅缓存，删除安全）。
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

/** 禁用 GPU 是否生效：直接读标记文件（比 hasSwitch 更直接、不依赖内部实现） */
function isAccelerationDisabled(): boolean {
  return existsSync(flagFile())
}

/**
 * 在 app ready 之前调用：若存在"禁用 GPU"标记，禁用硬件加速并清理陈旧 GPU 缓存。
 * 原因：禁用必须在 ready 前生效（官方 API disableHardwareAcceleration）。
 */
export function applyGpuCommandLine(): void {
  if (!isAccelerationDisabled()) return
  // 官方完整禁用 API（内部含软件回退配置，比裸 appendSwitch('disable-gpu') 更稳）
  app.disableHardwareAcceleration()
  // 清除陈旧 GPU 缓存：避免 relaunch 时旧实例残留导致新实例软件合成白屏（仅缓存，安全）
  rmSync(join(app.getPath('userData'), 'GPUCache'), { recursive: true, force: true })
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
      accelerated: !isAccelerationDisabled(),
      platform: process.platform
    }
  })
}
