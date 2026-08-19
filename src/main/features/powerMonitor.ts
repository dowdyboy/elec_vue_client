/**
 * 【特性】电源监控（powerMonitor）
 * 【API】powerMonitor
 * 【复制】1. 复制本文件到新工程 src/main/features/powerMonitor.ts
 *         2. 在 index.ts 中调用 registerPowerMonitor(getMainWindow)
 *         3. 渲染进程调用 window.api.power.* 与 onEvent 监听
 * 【说明】powerMonitor 监听系统电源/会话状态：
 *         - lock-screen / unlock-screen：锁屏与解锁（如：解锁后恢复数据）
 *         - suspend / resume：睡眠与唤醒（如：唤醒后重新连接服务器）
 *         - shutdown：系统关机前（保存数据的机会）
 *         - on-ac / on-battery：外接电源切换（如：自动切换功耗模式）
 *         典型场景：网盘/同步应用在唤醒后重新连接，会议应用在锁屏时静音。
 */

import { ipcMain, powerMonitor } from 'electron'
import type { MainWindowGetter } from '../types'

export function registerPowerMonitor(getMainWindow: MainWindowGetter): void {
  const push = (event: string): void => {
    getMainWindow()?.webContents.send('power:event', {
      event,
      time: new Date().toLocaleTimeString()
    })
  }

  // 会话事件
  powerMonitor.on('lock-screen', () => push('lock-screen')) // 锁屏
  powerMonitor.on('unlock-screen', () => push('unlock-screen')) // 解锁
  powerMonitor.on('suspend', () => push('suspend')) // 系统睡眠
  powerMonitor.on('resume', () => push('resume')) // 系统唤醒
  powerMonitor.on('shutdown', () => push('shutdown')) // 系统关机

  // 电源状态事件（部分平台支持）
  powerMonitor.on('on-ac', () => push('on-ac')) // 接入外接电源
  powerMonitor.on('on-battery', () => push('on-battery')) // 切到电池

  // 当前状态查询
  ipcMain.handle('power:getStatus', () => ({
    onBatteryPower: powerMonitor.onBatteryPower,
    idleTimeSeconds: powerMonitor.getSystemIdleTime(), // 系统空闲秒数
    isLocked: false // 无直接 API，事件驱动
  }))

  // ── 模拟推送电源事件（教学演示用）──
  // OS 事件（锁屏/睡眠/电源切换）不方便触发，这里让页面通过同一 power:event 通道
  // 推送"模拟事件"以演示管线；仅接受白名单内的事件名，避免随意注入
  const SIMULATABLE = new Set([
    'lock-screen',
    'unlock-screen',
    'suspend',
    'resume',
    'on-ac',
    'on-battery',
    'shutdown'
  ])
  ipcMain.handle('power:simulate', (_e, event: string) => {
    if (!SIMULATABLE.has(event)) return { ok: false, error: `不支持模拟: ${event}` }
    push(event) // 与真实 OS 事件走同一通道，页面无需区分
    return { ok: true }
  })
}
