/**
 * 【特性】桌面捕获（desktopCapturer）+ 窗口截图（capturePage）+ 录屏授权（getDisplayMedia）
 * 【API】desktopCapturer.getSources / webContents.capturePage /
 *        session.setDisplayMediaRequestHandler
 * 【复制】1. 复制本文件到新工程 src/main/features/desktopCapture.ts
 *         2. 在 index.ts 中调用 registerDesktopCapture(getMainWindow)
 *         3. 渲染进程调用 window.api.capture.*
 * 【说明】desktopCapturer 枚举所有屏幕/窗口源（含缩略图），
 *         是"录屏、共享屏幕"类应用（如 OBS、视频会议）的基础。
 *         本模块演示三种能力：
 *         ① 枚举屏幕/窗口源（缩略图，静态截图链路）
 *         ② 截取当前窗口保存 PNG
 *         ③ 持续录屏授权：getDisplayMedia 在 Electron 中默认不支持
 *            （不注册 setDisplayMediaRequestHandler 必抛 NotSupportedError），
 *            这里注册 handler 并用"应用内选择器"接管：主进程枚举源 →
 *            推给渲染层弹窗 → 回传选择 → callback 授权流（token 模式，
 *            与 serialPort.ts 一致；useSystemPicker 仅 macOS 且实验性，不用）。
 */

import { desktopCapturer, dialog, ipcMain, session, webContents } from 'electron'
import { promises as fs } from 'fs'
import type { MainWindowGetter } from '../types'

/** 录屏源选择请求表：token → 完成回调（callback 必须恰好调用一次） */
const pendingDisplays = new Map<string, (streams: Electron.Streams) => void>()

/** 超时兜底：页面迟迟不回传选择时自动取消，防止 getDisplayMedia 永久挂起 */
const DISPLAY_SELECT_TIMEOUT_MS = 30_000

export function registerDesktopCapture(getMainWindow: MainWindowGetter): void {
  // ── ① 枚举屏幕/窗口源（带缩略图）──
  ipcMain.handle('capture:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      // 缩略图尺寸（小图足够预览）
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      // 空缩略图（某些窗口最小化/权限原因）不返回 dataURL，页面据此跳过显示
      thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
      displayId: source.display_id
    }))
  })

  // ── ② 截取当前窗口（含页面内容）──
  ipcMain.handle('capture:capturePage', async () => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    const image = await win.webContents.capturePage()
    return { ok: true, dataUrl: image.toDataURL() }
  })

  // ── ③ 保存截图为 PNG 文件 ──
  ipcMain.handle('capture:savePng', async (_e, dataUrl: string) => {
    const win = getMainWindow()
    if (!win) return { ok: false, error: '无主窗口' }
    const result = await dialog.showSaveDialog(win, {
      title: '保存截图',
      defaultPath: `截图-${Date.now()}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '用户取消' }
    // dataURL → Buffer → 写文件
    const base64 = dataUrl.split(',')[1] ?? ''
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: result.filePath }
  })

  // ── ④ getDisplayMedia 支持：Electron 默认不实现该 API，必须注册 handler ──
  // 流程：权限白名单放行 display-capture（security.ts）→ 本 handler →
  //       枚举源推给渲染层弹窗 → 回传选择 → callback 授权流
  // 说明：不传 useSystemPicker（仅 macOS 且实验性），保证跨平台走应用内选择器
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // 只支持视频（本演示页面请求 video: true, audio: false）
    if (!request.videoRequested) {
      callback({})
      return
    }
    // 定位发起请求的窗口（frame 可能为 null：帧已导航/销毁）
    const requester = request.frame ? webContents.fromFrame(request.frame) : null
    if (!requester) {
      callback({})
      return
    }

    void (async (): Promise<void> => {
      let sources: Electron.DesktopCapturerSource[]
      try {
        sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 }
        })
      } catch {
        callback({}) // 枚举失败：拒绝本次请求
        return
      }

      const finish = (streams: Electron.Streams): void => {
        clearTimeout(timer)
        pendingDisplays.delete(token)
        callback(streams)
      }

      if (sources.length === 0) {
        callback({})
        return
      }

      // 每次请求一个唯一 token：渲染层回传时按 token 找到对应 callback
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timer = setTimeout(() => finish({}), DISPLAY_SELECT_TIMEOUT_MS)
      pendingDisplays.set(token, finish)

      // 兜底：发起窗口销毁时自动取消
      requester.once('destroyed', () => {
        if (pendingDisplays.has(token)) finish({})
      })

      // 推给发起请求的页面弹窗（见 MediaCapturePage.vue）
      requester.send('capture:display-sources', {
        token,
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL()
        }))
      })
    })()
  })

  // ── ⑤ 渲染层回传：按 token 分发，完成对应请求 ──
  ipcMain.on(
    'capture:display-select',
    (_e, token: string, sourceId: string, sourceName: string) => {
      const finish = pendingDisplays.get(token)
      if (finish) finish({ video: { id: sourceId, name: sourceName } })
    }
  )

  ipcMain.on('capture:display-cancel', (_e, token: string) => {
    const finish = pendingDisplays.get(token)
    if (finish) finish({})
  })
}
