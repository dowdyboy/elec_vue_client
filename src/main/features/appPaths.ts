/**
 * 【特性】应用数据目录（app.getPath / setPath —— 数据该放哪里的全景地图）
 * 【API】app.getPath / app.setPath / app.getAppPath
 * 【复制】1. 复制本文件到新工程 src/main/features/appPaths.ts
 *         2. 在 index.ts 中调用 registerAppPaths()
 *         3. 渲染进程调用 window.api.paths.*
 * 【说明】Electron 应用的数据落点全貌（真实工程必备知识）：
 *         - userData：应用私有数据（SQLite 库、配置、日志都放这里，卸载可清理）
 *         - cache / temp：可随时删除的缓存与临时文件（sessionCleanup.ts 清理的就是 cache）
 *         - downloads / documents / desktop：用户可见目录（下载、导出文件）
 *         - logs：崩溃日志、主进程日志
 *         重要规则：userData / sessionData 必须在 app ready 之前 setPath。
 *         ⚠️ 注意：Electron 39 运行期 setPath 已不再抛错（源码 SetPath 无 ready 检查），
 *         但运行期修改会造成数据撕裂（getPath 新目录 vs 已初始化的旧数据），
 *         本模块在 paths:set 通道做应用层拦截（见下方代码注释）。
 *         downloads 等可在运行期修改；演示：修改 downloads 后下载管理落到新目录。
 */

import { app, ipcMain } from 'electron'

/** Electron 合法的目录 key（app.getPath 参数类型） */
type PathKey = Parameters<typeof app.getPath>[0]

/** 需要展示的目录清单（中文名 + 说明） */
const PATH_NAMES: { key: PathKey; label: string; note: string }[] = [
  {
    key: 'userData',
    label: '应用数据',
    note: '应用私有数据：SQLite 库、配置、窗口状态（本工程 sqlite.ts / windowState.ts 都在这里落盘）'
  },
  {
    key: 'sessionData',
    label: '会话数据',
    note: 'Chromium 会话数据：缓存/Cookie 所在（sessionCleanup.ts 清理的就是这里）'
  },
  { key: 'temp', label: '临时文件', note: 'OS 临时目录，可随时删除' },
  {
    key: 'logs',
    label: '日志',
    note: '崩溃日志与主进程日志（errorHandler.ts 的崩溃转储在 crashDumps）'
  },
  {
    key: 'downloads',
    label: '下载目录',
    note: 'download.ts 的默认下载位置（运行期可修改，本页演示）'
  },
  { key: 'documents', label: '我的文档', note: '用户文档（taskbar.ts 最近文档演示使用）' },
  { key: 'desktop', label: '桌面', note: '用户桌面' },
  {
    key: 'exe',
    label: '可执行文件',
    note: 'app.exe 所在目录（生产为安装目录，dev 为 node_modules/electron）'
  }
]

export function registerAppPaths(): void {
  // ── 全部目录一览（getPath 支持列表见类型定义，这里取常用 8 个）──
  ipcMain.handle('paths:getAll', () => {
    return PATH_NAMES.map(({ key, label, note }) => ({
      key,
      label,
      note,
      path: app.getPath(key)
    }))
  })

  // ── 运行期修改目录（演示 downloads；userData/sessionData 由应用层拦截）──
  ipcMain.handle('paths:set', (_e, key: string, value: string) => {
    // 应用层拦截：这两个目录必须在 app ready 之前设置。
    // 源码证据：Electron 39 的 App::SetPath（electron_api_app.cc）已移除"ready 前"
    // 抛错检查——运行期 setPath('userData') 会静默成功（仅校验绝对路径/合法 key），
    // 但会造成数据撕裂：getPath 返回新目录，而 Chromium 会话数据、已打开的 SQLite、
    // 窗口状态文件等启动时已按旧目录初始化，仍指向旧位置。
    // 因此生产工程的正确姿势仍是在 ready 前 setPath；本演示页用主动拦截把这一点教出来。
    if (key === 'userData' || key === 'sessionData') {
      return {
        ok: false,
        error:
          `${key} 必须在 app ready 之前设置（Electron 39 运行期 setPath 不再抛错，` +
          '但会造成数据撕裂：getPath 返回新目录，而已初始化的 Chromium 数据/数据库仍留在旧目录）'
      }
    }
    try {
      // 渲染进程传来的 key 需校验：非法 key 运行时也会抛错，这里统一兜底返回
      app.setPath(key as PathKey, value)
      return { ok: true, path: app.getPath(key as PathKey) }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })

  // ── 应用代码目录（打包后为 resources/app.asar）──
  ipcMain.handle('paths:getAppPath', () => {
    return { appPath: app.getAppPath(), appName: app.getName(), appVersion: app.getVersion() }
  })
}
