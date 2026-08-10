/**
 * 路由配置：每个特性一个页面
 * meta.hidden 为 true 的页面不出现在侧边栏菜单（如子窗口演示页）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import type { MenuOption } from 'naive-ui'

// 扩展 vue-router 的 meta 类型（官方推荐方式）
declare module 'vue-router' {
  interface RouteMeta {
    title: string
    icon?: string
    hidden?: boolean
  }
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
    meta: { title: '窗口管理', icon: '🪟' }
  },
  {
    path: '/ipc',
    name: 'ipc',
    component: () => import('../pages/IpcPage.vue'),
    meta: { title: 'IPC 通信', icon: '🔗' }
  },
  {
    path: '/tray',
    name: 'tray',
    component: () => import('../pages/TrayPage.vue'),
    meta: { title: '系统托盘', icon: '📌' }
  },
  {
    path: '/notification',
    name: 'notification',
    component: () => import('../pages/NotificationPage.vue'),
    meta: { title: '系统通知', icon: '🔔' }
  },
  {
    path: '/shortcut',
    name: 'shortcut',
    component: () => import('../pages/ShortcutPage.vue'),
    meta: { title: '全局快捷键', icon: '⌨️' }
  },
  {
    path: '/clipboard',
    name: 'clipboard',
    component: () => import('../pages/ClipboardPage.vue'),
    meta: { title: '剪贴板', icon: '📋' }
  },
  {
    path: '/dialog',
    name: 'dialog',
    component: () => import('../pages/DialogPage.vue'),
    meta: { title: '文件对话框', icon: '🗂️' }
  },
  {
    path: '/fs',
    name: 'fs',
    component: () => import('../pages/FileSystemPage.vue'),
    meta: { title: '文件系统', icon: '📁' }
  },
  {
    path: '/menu',
    name: 'menu',
    component: () => import('../pages/MenuPage.vue'),
    meta: { title: '原生菜单', icon: '🍔' }
  },
  {
    path: '/screen',
    name: 'screen',
    component: () => import('../pages/ScreenPage.vue'),
    meta: { title: '屏幕信息', icon: '🖥️' }
  },
  {
    path: '/theme',
    name: 'theme',
    component: () => import('../pages/ThemePage.vue'),
    meta: { title: '系统主题', icon: '🌗' }
  },
  {
    path: '/sockets',
    name: 'sockets',
    component: () => import('../pages/SocketPage.vue'),
    meta: { title: 'TCP/UDP 通信', icon: '🔌' }
  },
  {
    path: '/network',
    name: 'network',
    component: () => import('../pages/NetworkPage.vue'),
    meta: { title: '网络通信', icon: '🌐' }
  },
  {
    path: '/capture',
    name: 'capture',
    component: () => import('../pages/CapturePage.vue'),
    meta: { title: '桌面捕获', icon: '📸' }
  },
  {
    path: '/print',
    name: 'print',
    component: () => import('../pages/PrintPage.vue'),
    meta: { title: '打印 PDF', icon: '🖨️' }
  },
  {
    path: '/protocol',
    name: 'protocol',
    component: () => import('../pages/ProtocolPage.vue'),
    meta: { title: '协议与深链接', icon: '🧭' }
  },
  {
    path: '/update',
    name: 'update',
    component: () => import('../pages/AutoUpdatePage.vue'),
    meta: { title: '自动更新', icon: '⬆️' }
  },
  {
    path: '/performance',
    name: 'performance',
    component: () => import('../pages/PerformancePage.vue'),
    meta: { title: '计算性能', icon: '⚡' }
  },
  {
    path: '/security',
    name: 'security',
    component: () => import('../pages/SecurityPage.vue'),
    meta: { title: '安全实践', icon: '🛡️' }
  },
  {
    path: '/lifecycle',
    name: 'lifecycle',
    component: () => import('../pages/LifecyclePage.vue'),
    meta: { title: '生命周期', icon: '🔄' }
  },
  {
    // 子窗口演示页：仅通过主进程创建子窗口时加载，不在菜单显示
    path: '/window-demo',
    name: 'window-demo',
    component: () => import('../pages/WindowDemoPage.vue'),
    meta: { title: '子窗口演示', hidden: true }
  }
]

/** 侧边栏菜单项（过滤 hidden 页面），直接输出 Naive UI 的 MenuOption */
export function menuOptions(): MenuOption[] {
  return routes
    .filter((route) => !route.meta?.hidden)
    .map((route) => ({
      key: route.path,
      label: `${route.meta?.icon ?? ''} ${route.meta?.title ?? ''}`,
      type: 'item' as const
    }))
}

const router = createRouter({
  // Electron 生产环境 loadFile 加载本地文件，必须用 hash 模式
  history: createWebHashHistory(),
  routes
})

export default router
