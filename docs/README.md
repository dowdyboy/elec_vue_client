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

## 扩展特性（并入既有文档）

| 特性 | 文档位置 |
|------|---------|
| 任务栏进度 / 角标 / 窗口状态持久化 / 拖拽区 / 自定义标题栏 / 毛玻璃 / 闪屏 | 01-窗口管理 第五、六节 |
| BroadcastChannel 多窗口直连 | 02-IPC通信 第五节 |
| 通知动作按钮 | 04-系统通知 第五节 |
| 拖拽文件真实路径 / 拖出窗口 / 系统文件图标 | 08-文件系统 第四、五、六节 |
| 电源监控 / 全局错误处理 / 阻止系统睡眠 | 13-生命周期 第五、六、七节 |

## 每篇文档的结构

1. **原理**：这个特性是什么、解决什么问题
2. **关键代码**：核心片段 + 逐行说明
3. **复制到新工程的步骤**：从本工程复制哪些文件、如何接入

## 模板使用的核心约定

- 每个特性 = 主进程 `features/xxx.ts` + preload 对应分组 + 一篇文档
- 所有特性通过 `src/main/index.ts` 的**注册表**挂载，注释一行即停用
- 渲染进程的 UI 演示页可单独复用（使用 Naive UI，见 [00-项目总览](./00-项目总览与架构.md)）
