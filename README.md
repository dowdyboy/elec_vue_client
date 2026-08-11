# ⚡ Electron 教学与模板项目

基于 **Electron 39 + Vue 3 + TypeScript + Naive UI** 的教学与模板项目。

- **教学**：运行后从左侧菜单进入各特性演示页，直观看到 Electron 各项能力
- **模板**：主进程按特性模块化（`src/main/features/`），每个文件可独立复制到新工程，并附中文注释与复制指南

## 特性一览（19 项 + 5 项扩展）

| 特性 | Electron API | 演示页 | 文档 |
|------|-------------|--------|------|
| 窗口管理 | BrowserWindow | 多窗口/透明/置顶/全屏 | [docs/01](./docs/01-窗口管理.md) |
| IPC 通信 | ipcMain / MessageChannel | 4 种通信模式 | [docs/02](./docs/02-IPC通信.md) |
| 系统托盘 | Tray | 托盘菜单/常驻 | [docs/03](./docs/03-系统托盘.md) |
| 系统通知 | Notification | 原生通知+点击事件 | [docs/04](./docs/04-系统通知.md) |
| 全局快捷键 | globalShortcut | 系统级热键 | [docs/05](./docs/05-全局快捷键.md) |
| 剪贴板 | clipboard | 文本/富文本/图片 | [docs/06](./docs/06-剪贴板.md) |
| 文件对话框 | dialog | 打开/保存/消息框 | [docs/07](./docs/07-文件对话框.md) |
| 文件系统 | fs | 读写/目录浏览/拖拽路径 | [docs/08](./docs/08-文件系统.md) |
| 原生菜单 | Menu | 应用菜单/右键菜单 | [docs/09](./docs/09-原生菜单.md) |
| 屏幕信息 | screen | 多显示器/光标 | [docs/10](./docs/10-屏幕信息.md) |
| 系统主题 | nativeTheme | 亮/暗/跟随系统 | [docs/11](./docs/11-系统主题.md) |
| **TCP/UDP 通信** | net / dgram | 本机服务端+客户端互发 | [docs/19](./docs/19-TCP与UDP通信.md) |
| 网络通信 | axios / socket.io | HTTP + WebSocket | [docs/14](./docs/14-网络通信.md) |
| **下载管理** | will-download / DownloadItem | 进度/暂停/恢复/取消 | [docs/22](./docs/22-下载管理.md) |
| **会话管理** | session.cookies / webRequest | Cookie 读写/请求拦截/虚拟协议 | [docs/23](./docs/23-网络会话（Cookie与请求拦截）.md) + [docs/24](./docs/24-自定义协议内容.md) |
| **SQLite 数据库** | node:sqlite（零依赖） | CRUD/事务/注入对比 | [docs/25](./docs/25-数据库（SQLite）.md) |
| **平台特性** | setJumpList / app.dock / kiosk | Windows 任务栏/macOS Dock/媒体控制 | [docs/26](./docs/26-平台特性.md) |
| **系统集成** | systemPreferences / net / inputHook | 权限/在线状态/缓存/按键拦截 | [docs/27](./docs/27-系统集成.md) |
| **会话配置与证书** | setProxy / setUserAgent / 证书 | 代理 / UA / 证书校验 | [docs/28](./docs/28-会话配置与证书.md) |
| **桌面捕获** | desktopCapturer | 屏幕源/窗口截图 | [docs/17](./docs/17-桌面捕获.md) |
| **打印** | printToPDF | 页面导出 PDF | [docs/18](./docs/18-打印.md) |
| **协议与深链接** | setAsDefaultProtocolClient | 唤起应用/内嵌网页 | [docs/16](./docs/16-自定义协议与深链接.md) |
| **自动更新** | electron-updater | 检查/下载/安装链路 | [docs/15](./docs/15-自动更新.md) |
| **计算性能** | utilityProcess / Web Worker | 阻塞对比/子进程计算/资源面板 | [docs/20](./docs/20-计算密集型与进程模型.md) |
| 安全实践 | session / webContents | 权限/导航拦截 | [docs/12](./docs/12-安全实践.md) |
| 生命周期 | app | 单实例/自启/事件 | [docs/13](./docs/13-生命周期.md) |

**扩展特性**（并入既有页面与文档）：任务栏进度条、应用角标、窗口状态持久化、无边框窗口拖拽区与自定义标题栏、毛玻璃/亚克力、启动闪屏、页面缩放、窗口尺寸限制与透明度、窗口事件、内置 PDF 查看、会话分区（无痕/多账号）、目录监听、内嵌网页导航历史、退出前未保存询问、静默权限检查、电源监控、阻止系统睡眠、全局错误处理、崩溃自动恢复、通知动作按钮、文件拖出窗口、系统文件图标、shell 文件操作、应用重启、文件关联、DNS 解析、BroadcastChannel 直连、系统语言与字体、会话缓存清理、关于面板。

**进阶实践**：[docs/21](./docs/21-进阶工程实践.md)（sandbox 生产切换、远程调试、Sentry 崩溃上报、contentTracing、electron-store、electron-log 等）。

## 快速开始

```bash
npm install
npm run dev        # 开发（支持 HMR）
npm run typecheck  # 类型检查
npm run lint       # 代码检查
npm run build:win  # 打包 Windows 安装包
```

## 项目结构

```
src/
├── main/
│   ├── index.ts          # 入口：特性注册表（每行一个特性，注释即停用）
│   └── features/         # ★ 14 个可独立复制的特性模块
├── preload/
│   └── index.ts          # 安全桥：window.api.<分组>.<方法>
└── renderer/src/
    ├── App.vue           # Naive UI 主题 + 侧边导航 + 内容区
    ├── router/           # vue-router（hash 模式）
    ├── stores/theme.ts   # 主题状态（与 nativeTheme 联动）
    └── pages/            # 14 个特性演示页 + 子窗口演示页
docs/                     # 教学文档（每特性一篇，含复制步骤）
```

## 教学使用方式

1. 从左侧菜单**按顺序**浏览各特性页（窗口 → IPC → 系统 → 文件 → 安全）
2. 每个页面三段式：**原理说明 → 在线演示 → 关键源码**
3. 演示按钮调用的都是真实 Electron API，可交互验证

## 模板使用方式

以"系统托盘"为例复制到新工程：

1. 复制 `src/main/features/tray.ts`（文件头注释写明完整步骤）
2. 新工程 `index.ts` 中调用 `registerTray(getMainWindow)`
3. 需要渲染进程交互时，复制 `src/preload/index.ts` 对应分组

> UI 演示页依赖 Naive UI；主进程 + preload 部分无 UI 依赖，可直接复用。

## 技术栈

Electron 39 · Vue 3.5 · TypeScript 5.9 · electron-vite 5 · Naive UI 2 · vue-router 4 · axios · socket.io-client
