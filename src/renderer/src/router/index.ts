/**
 * 路由配置：每个特性一个页面
 * meta.hidden 为 true 的页面不出现在侧边栏菜单（如子窗口演示页）
 * meta.group 用于侧边栏子菜单分组（如 "Electron 教学" / "TypeScript 惯用法"）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import type { MenuOption } from 'naive-ui'

// 扩展 vue-router 的 meta 类型（官方推荐方式）
declare module 'vue-router' {
  interface RouteMeta {
    title: string
    icon?: string
    hidden?: boolean
    group?: string
  }
}

/** 分组显示名（与 meta.group 对应） */
const GROUP_LABELS: Record<string, string> = {
  'Electron 教学': '⚛ Electron 教学',
  'TypeScript 惯用法': '🟦 TypeScript 惯用法',
  信号分析: '📡 信号分析'
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../pages/HomePage.vue'),
    meta: { title: '项目导览', icon: '🏠' }
  },
  {
    path: '/window',
    name: 'window',
    component: () => import('../pages/WindowPage.vue'),
    meta: { title: '窗口管理', icon: '🪟', group: 'Electron 教学' }
  },
  {
    path: '/ipc',
    name: 'ipc',
    component: () => import('../pages/IpcPage.vue'),
    meta: { title: 'IPC 通信', icon: '🔗', group: 'Electron 教学' }
  },
  {
    path: '/tray',
    name: 'tray',
    component: () => import('../pages/TrayPage.vue'),
    meta: { title: '系统托盘', icon: '📌', group: 'Electron 教学' }
  },
  {
    path: '/notification',
    name: 'notification',
    component: () => import('../pages/NotificationPage.vue'),
    meta: { title: '系统通知', icon: '🔔', group: 'Electron 教学' }
  },
  {
    path: '/shortcut',
    name: 'shortcut',
    component: () => import('../pages/ShortcutPage.vue'),
    meta: { title: '全局快捷键', icon: '⌨️', group: 'Electron 教学' }
  },
  {
    path: '/clipboard',
    name: 'clipboard',
    component: () => import('../pages/ClipboardPage.vue'),
    meta: { title: '剪贴板', icon: '📋', group: 'Electron 教学' }
  },
  {
    path: '/dialog',
    name: 'dialog',
    component: () => import('../pages/DialogPage.vue'),
    meta: { title: '文件对话框', icon: '🗂️', group: 'Electron 教学' }
  },
  {
    path: '/fs',
    name: 'fs',
    component: () => import('../pages/FileSystemPage.vue'),
    meta: { title: '文件系统', icon: '📁', group: 'Electron 教学' }
  },
  {
    path: '/paths',
    name: 'paths',
    component: () => import('../pages/AppPathsPage.vue'),
    meta: { title: '数据目录', icon: '📂', group: 'Electron 教学' }
  },
  {
    path: '/menu',
    name: 'menu',
    component: () => import('../pages/MenuPage.vue'),
    meta: { title: '原生菜单', icon: '🍔', group: 'Electron 教学' }
  },
  {
    path: '/screen',
    name: 'screen',
    component: () => import('../pages/ScreenPage.vue'),
    meta: { title: '屏幕信息', icon: '🖥️', group: 'Electron 教学' }
  },
  {
    path: '/theme',
    name: 'theme',
    component: () => import('../pages/ThemePage.vue'),
    meta: { title: '系统主题', icon: '🌗', group: 'Electron 教学' }
  },
  {
    path: '/sockets',
    name: 'sockets',
    component: () => import('../pages/SocketPage.vue'),
    meta: { title: 'TCP/UDP 通信', icon: '🔌', group: 'Electron 教学' }
  },
  {
    path: '/serial',
    name: 'serial',
    component: () => import('../pages/SerialPage.vue'),
    meta: { title: '串口通信', icon: '📟', group: 'Electron 教学' }
  },
  {
    path: '/network',
    name: 'network',
    component: () => import('../pages/NetworkPage.vue'),
    meta: { title: '网络通信', icon: '🌐', group: 'Electron 教学' }
  },
  {
    path: '/download',
    name: 'download',
    component: () => import('../pages/DownloadPage.vue'),
    meta: { title: '下载管理', icon: '⬇️', group: 'Electron 教学' }
  },
  {
    path: '/session',
    name: 'session',
    component: () => import('../pages/SessionPage.vue'),
    meta: { title: '会话管理', icon: '🧾', group: 'Electron 教学' }
  },
  {
    path: '/database',
    name: 'database',
    component: () => import('../pages/DatabasePage.vue'),
    meta: { title: 'SQLite 数据库', icon: '🗄️', group: 'Electron 教学' }
  },
  {
    path: '/better-sqlite',
    name: 'better-sqlite',
    component: () => import('../pages/BetterSqlitePage.vue'),
    meta: { title: '第三方 SQLite', icon: '⚙️', group: 'Electron 教学' }
  },
  {
    path: '/safe-storage',
    name: 'safe-storage',
    component: () => import('../pages/SafeStoragePage.vue'),
    meta: { title: '加密存储', icon: '🔑', group: 'Electron 教学' }
  },
  {
    path: '/platform',
    name: 'platform',
    component: () => import('../pages/PlatformPage.vue'),
    meta: { title: '平台特性', icon: '🎛️', group: 'Electron 教学' }
  },
  {
    path: '/capture',
    name: 'capture',
    component: () => import('../pages/CapturePage.vue'),
    meta: { title: '桌面捕获', icon: '📸', group: 'Electron 教学' }
  },
  {
    path: '/media',
    name: 'media',
    component: () => import('../pages/MediaCapturePage.vue'),
    meta: { title: '媒体捕获', icon: '🎥', group: 'Electron 教学' }
  },
  {
    path: '/print',
    name: 'print',
    component: () => import('../pages/PrintPage.vue'),
    meta: { title: '打印 PDF', icon: '🖨️', group: 'Electron 教学' }
  },
  {
    path: '/protocol',
    name: 'protocol',
    component: () => import('../pages/ProtocolPage.vue'),
    meta: { title: '协议与深链接', icon: '🧭', group: 'Electron 教学' }
  },
  {
    path: '/update',
    name: 'update',
    component: () => import('../pages/AutoUpdatePage.vue'),
    meta: { title: '自动更新', icon: '⬆️', group: 'Electron 教学' }
  },
  {
    path: '/performance',
    name: 'performance',
    component: () => import('../pages/PerformancePage.vue'),
    meta: { title: '计算性能', icon: '⚡', group: 'Electron 教学' }
  },
  {
    path: '/gpu',
    name: 'gpu',
    component: () => import('../pages/GpuPage.vue'),
    meta: { title: 'GPU 信息', icon: '🎮', group: 'Electron 教学' }
  },
  {
    path: '/security',
    name: 'security',
    component: () => import('../pages/SecurityPage.vue'),
    meta: { title: '安全实践', icon: '🛡️', group: 'Electron 教学' }
  },
  {
    path: '/lifecycle',
    name: 'lifecycle',
    component: () => import('../pages/LifecyclePage.vue'),
    meta: { title: '生命周期', icon: '🔄', group: 'Electron 教学' }
  },
  // ── TypeScript 惯用法板块 ──
  {
    path: '/ts',
    name: 'ts-home',
    component: () => import('../pages/ts/TsHomePage.vue'),
    meta: { title: 'TS 总览', icon: '📘', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/intro',
    name: 'ts-intro',
    component: () => import('../pages/ts/TsIntroPage.vue'),
    meta: { title: '类型标注与推断', icon: '🔤', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/interface-type',
    name: 'ts-interface-type',
    component: () => import('../pages/ts/TsInterfaceTypePage.vue'),
    meta: { title: 'interface vs type', icon: '🧱', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/narrowing',
    name: 'ts-narrowing',
    component: () => import('../pages/ts/TsNarrowingPage.vue'),
    meta: { title: '联合类型与收窄', icon: '🔀', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/generics',
    name: 'ts-generics',
    component: () => import('../pages/ts/TsGenericsPage.vue'),
    meta: { title: '泛型', icon: '🧩', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/utility',
    name: 'ts-utility',
    component: () => import('../pages/ts/TsUtilityPage.vue'),
    meta: { title: '工具类型', icon: '🛠️', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/mapped-conditional',
    name: 'ts-mapped-conditional',
    component: () => import('../pages/ts/TsMappedConditionalPage.vue'),
    meta: { title: '映射与条件类型', icon: '🪞', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/function',
    name: 'ts-function',
    component: () => import('../pages/ts/TsFunctionPage.vue'),
    meta: { title: '函数惯用法', icon: '🎯', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/enum-literal',
    name: 'ts-enum-literal',
    component: () => import('../pages/ts/TsEnumLiteralPage.vue'),
    meta: { title: '枚举与常量断言', icon: '🏷️', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/async',
    name: 'ts-async',
    component: () => import('../pages/ts/TsAsyncPage.vue'),
    meta: { title: '异步惯用法', icon: '⏳', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/module',
    name: 'ts-module',
    component: () => import('../pages/ts/TsModulePage.vue'),
    meta: { title: '模块与导入导出', icon: '📦', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/oop',
    name: 'ts-oop',
    component: () => import('../pages/ts/TsOopPage.vue'),
    meta: { title: '类与面向对象', icon: '🏛️', group: 'TypeScript 惯用法' }
  },
  {
    path: '/ts/electron-bridge',
    name: 'ts-electron-bridge',
    component: () => import('../pages/ts/TsElectronBridgePage.vue'),
    meta: { title: '与 Electron 结合', icon: '🔗', group: 'TypeScript 惯用法' }
  },
  // ── 信号分析板块（垂直领域，4 组件 + Mock 配置，Mock 服务端自产数）──
  {
    path: '/signal',
    name: 'signal-config',
    component: () => import('../pages/signal/SignalConfigPage.vue'),
    meta: { title: 'Mock 配置', icon: '🛠️', group: '信号分析' }
  },
  {
    path: '/signal/iq',
    name: 'signal-iq',
    component: () => import('../pages/signal/IqDemoPage.vue'),
    meta: { title: 'IQ 时域', icon: '〰️', group: '信号分析' }
  },
  {
    path: '/signal/spectrum',
    name: 'signal-spectrum',
    component: () => import('../pages/signal/SpectrumDemoPage.vue'),
    meta: { title: '频谱', icon: '📊', group: '信号分析' }
  },
  {
    path: '/signal/spectrogram',
    name: 'signal-spectrogram',
    component: () => import('../pages/signal/SpectrogramDemoPage.vue'),
    meta: { title: '时频图', icon: '🌈', group: '信号分析' }
  },
  {
    path: '/signal/constellation',
    name: 'signal-constellation',
    component: () => import('../pages/signal/ConstellationDemoPage.vue'),
    meta: { title: '星座图', icon: '✨', group: '信号分析' }
  },
  {
    // 子窗口演示页：仅通过主进程创建子窗口时加载，不在菜单显示
    path: '/window-demo',
    name: 'window-demo',
    component: () => import('../pages/WindowDemoPage.vue'),
    meta: { title: '子窗口演示', hidden: true }
  }
]

/**
 * 侧边栏菜单项：无 group 的页面作为顶层项（如首页）；
 * 有 group 的按分组聚合成 Naive UI 子菜单（type: 'submenu'）。
 * 分组顺序 = 路由中首次出现的顺序（Electron 在前、TS 在后）。
 */
export function menuOptions(): MenuOption[] {
  const topLevel: MenuOption[] = []
  const groups = new Map<string, MenuOption & { children: MenuOption[] }>()

  for (const route of routes) {
    if (route.meta?.hidden) continue
    const item: MenuOption = {
      key: route.path,
      label: `${route.meta?.icon ?? ''} ${route.meta?.title ?? ''}`,
      type: 'item'
    }
    const group = route.meta?.group
    if (!group) {
      topLevel.push(item)
      continue
    }
    let g = groups.get(group)
    if (!g) {
      g = {
        key: group,
        label: GROUP_LABELS[group] ?? group,
        type: 'submenu',
        children: []
      }
      groups.set(group, g)
    }
    g.children.push(item)
  }

  return [...topLevel, ...groups.values()]
}

const router = createRouter({
  // Electron 生产环境 loadFile 加载本地文件，必须用 hash 模式
  history: createWebHashHistory(),
  routes
})

export default router
