# 📚 教学文档索引

> 本项目是 **Electron 教学 + 模板** 项目。每个特性对应一篇文档，同时对应源码中的一个可复制模块。

## 推荐阅读顺序

| # | 文档 | 对应源码 | 难度 |
|---|------|---------|------|
| 00 | [项目总览与架构](./00-项目总览与架构.md) | `src/main/index.ts` | ⭐ |
| 01 | [窗口管理](./01-窗口管理.md) | `src/main/features/windowManager.ts` | ⭐⭐ |
| 02 | [IPC 通信](./02-IPC通信.md) | `src/main/features/ipcBridge.ts` + `src/preload/index.ts` | ⭐⭐⭐ |
| 03 | [系统托盘](./03-系统托盘.md) | `src/main/features/tray.ts` | ⭐ |
| 04 | [系统通知](./04-系统通知.md) | `src/main/features/notification.ts` | ⭐ |
| 05 | [全局快捷键](./05-全局快捷键.md) | `src/main/features/globalShortcut.ts` | ⭐ |
| 06 | [剪贴板](./06-剪贴板.md) | `src/main/features/clipboard.ts` | ⭐ |
| 07 | [文件对话框](./07-文件对话框.md) | `src/main/features/dialog.ts` | ⭐ |
| 08 | [文件系统](./08-文件系统.md) | `src/main/features/fileSystem.ts` | ⭐⭐ |
| 09 | [原生菜单](./09-原生菜单.md) | `src/main/features/menu.ts` | ⭐ |
| 10 | [屏幕信息](./10-屏幕信息.md) | `src/main/features/screenInfo.ts` | ⭐ |
| 11 | [系统主题](./11-系统主题.md) | `src/main/features/theme.ts` | ⭐⭐ |
| 12 | [安全实践](./12-安全实践.md) | `src/main/features/security.ts` | ⭐⭐⭐ |
| 13 | [生命周期](./13-生命周期.md) | `src/main/features/appLifecycle.ts` | ⭐⭐ |
| 14 | [网络通信](./14-网络通信.md) | `src/main/features/network.ts` | ⭐⭐ |
| 15 | [自动更新](./15-自动更新.md) | `src/main/features/autoUpdater.ts` | ⭐⭐ |
| 16 | [自定义协议与深链接](./16-自定义协议与深链接.md) | `src/main/features/protocol.ts` | ⭐⭐ |
| 17 | [桌面捕获](./17-桌面捕获.md) | `src/main/features/desktopCapture.ts` | ⭐ |
| 18 | [打印](./18-打印.md) | `src/main/features/print.ts` | ⭐ |
| 19 | [TCP/UDP 通信](./19-TCP与UDP通信.md) | `src/main/features/socket.ts` | ⭐⭐⭐ |
| 20 | [计算密集型与进程模型](./20-计算密集型与进程模型.md) | `src/main/features/utilityProcess.ts` | ⭐⭐⭐ |
| 21 | [进阶工程实践](./21-进阶工程实践.md) | 配置与生产化（sandbox/调试/上报） | ⭐⭐ |
| 22 | [下载管理](./22-下载管理.md) | `src/main/features/download.ts` | ⭐⭐ |
| 23 | [网络会话（Cookie与请求拦截）](./23-网络会话（Cookie与请求拦截）.md) | `cookies.ts` + `webRequest.ts` | ⭐⭐ |
| 24 | [自定义协议内容](./24-自定义协议内容.md) | `src/main/features/protocolContent.ts` | ⭐⭐ |
| 25 | [SQLite 数据库](./25-数据库（SQLite）.md) | `src/main/features/sqlite.ts`（node:sqlite） | ⭐⭐ |
| 26 | [平台特性](./26-平台特性.md) | `taskbar.ts`（JumpList/Dock）+ kiosk + 媒体控制 | ⭐⭐ |
| 27 | [系统集成](./27-系统集成.md) | 权限/在线状态/缓存/按键/语言/崩溃恢复 | ⭐⭐ |
| 28 | [会话配置与证书](./28-会话配置与证书.md) | 代理 / UA / 证书校验 | ⭐⭐ |

## 扩展特性（并入既有文档）

| 特性 | 文档位置 |
|------|---------|
| 任务栏进度 / 角标 / 窗口状态持久化 / 拖拽区 / 自定义标题栏 / 毛玻璃 / 闪屏 / 缩放 / 尺寸限制 / 透明度 / 窗口事件 / PDF 查看 | 01-窗口管理 第五~七节 |
| BroadcastChannel 多窗口直连 | 02-IPC通信 第五节 |
| 通知动作按钮 | 04-系统通知 第五节 |
| 目录监听（fs.watch） | 08-文件系统 第八节 |
| DNS 解析 / 在线状态 | 14-网络通信 第五节 |
| 文件关联（open-file） / 内嵌网页导航历史 | 16-自定义协议与深链接 第五、六节 |
| 静默权限检查 | 12-安全实践（两个权限处理器） |
| 退出前未保存询问 | 13-生命周期 第九节 |
| 会话分区（无痕/多账号） | 23-网络会话 第四节 |
| 拖拽文件真实路径 / 拖出窗口 / 系统文件图标 / shell 文件操作 | 08-文件系统 第四~七节 |
| 电源监控 / 全局错误处理 / 阻止系统睡眠 / 应用重启 | 13-生命周期 第五~八节 |

## 每篇文档的结构

1. **原理**：这个特性是什么、解决什么问题
2. **关键代码**：核心片段 + 逐行说明
3. **复制到新工程的步骤**：从本工程复制哪些文件、如何接入

## 模板使用的核心约定

- 每个特性 = 主进程 `features/xxx.ts` + preload 对应分组 + 一篇文档
- 所有特性通过 `src/main/index.ts` 的**注册表**挂载，注释一行即停用
- 渲染进程的 UI 演示页可单独复用（使用 Naive UI，见 [00-项目总览](./00-项目总览与架构.md)）
