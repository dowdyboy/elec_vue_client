# ⚡ Electron 教学与模板项目

基于 **Electron 39 + Vue 3 + TypeScript + Naive UI** 的教学与模板项目。

- **教学**：运行后从左侧菜单进入各特性演示页，直观看到 Electron 各项能力
- **模板**：主进程按特性模块化（`src/main/features/`），每个文件可独立复制到新工程，并附中文注释与复制指南

## 特性一览

| 特性                       | Electron API                                    | 演示页                              | 文档                                                                                          |
| -------------------------- | ----------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| 窗口管理                   | BrowserWindow                                   | 多窗口/透明/置顶/全屏               | [docs/01](./docs/01-窗口管理.md)                                                              |
| IPC 通信                   | ipcMain / MessageChannel                        | 4 种通信模式                        | [docs/02](./docs/02-IPC通信.md)                                                               |
| 系统托盘                   | Tray                                            | 托盘菜单/常驻                       | [docs/03](./docs/03-系统托盘.md)                                                              |
| 系统通知                   | Notification                                    | 原生通知+点击事件                   | [docs/04](./docs/04-系统通知.md)                                                              |
| 全局快捷键                 | globalShortcut                                  | 系统级热键                          | [docs/05](./docs/05-全局快捷键.md)                                                            |
| 剪贴板                     | clipboard                                       | 文本/富文本/图片                    | [docs/06](./docs/06-剪贴板.md)                                                                |
| 文件对话框                 | dialog                                          | 打开/保存/消息框                    | [docs/07](./docs/07-文件对话框.md)                                                            |
| 文件系统                   | fs                                              | 读写/目录浏览/拖拽路径              | [docs/08](./docs/08-文件系统.md)                                                              |
| 原生菜单                   | Menu                                            | 应用菜单/右键菜单                   | [docs/09](./docs/09-原生菜单.md)                                                              |
| 屏幕信息                   | screen                                          | 多显示器/光标                       | [docs/10](./docs/10-屏幕信息.md)                                                              |
| 系统主题                   | nativeTheme                                     | 亮/暗/跟随系统                      | [docs/11](./docs/11-系统主题.md)                                                              |
| **TCP/UDP 通信**           | net / dgram                                     | 本机服务端+客户端互发               | [docs/19](./docs/19-TCP与UDP通信.md)                                                          |
| 网络通信                   | axios / socket.io                               | HTTP + WebSocket                    | [docs/14](./docs/14-网络通信.md)                                                              |
| **下载管理**               | will-download / DownloadItem                    | 进度/暂停/恢复/取消                 | [docs/22](./docs/22-下载管理.md)                                                              |
| **会话管理**               | session.cookies / webRequest                    | Cookie 读写/请求拦截/虚拟协议       | [docs/23](./docs/23-网络会话（Cookie与请求拦截）.md) + [docs/24](./docs/24-自定义协议内容.md) |
| **SQLite 数据库**          | node:sqlite（零依赖）                           | CRUD/事务/注入对比                  | [docs/25](./docs/25-数据库（SQLite）.md)                                                      |
| **第三方 SQLite**          | better-sqlite3（原生模块）                      | 对比教学/transaction/性能基准       | [docs/34](./docs/34-第三方SQLite（better-sqlite3）.md)                                        |
| **平台特性**               | setJumpList / app.dock / kiosk                  | Windows 任务栏/macOS Dock/媒体控制  | [docs/26](./docs/26-平台特性.md)                                                              |
| **系统集成**               | systemPreferences / net / inputHook             | 权限/在线状态/缓存/按键拦截         | [docs/27](./docs/27-系统集成.md)                                                              |
| **会话配置与证书**         | setProxy / setUserAgent / 证书                  | 代理 / UA / 证书校验                | [docs/28](./docs/28-会话配置与证书.md)                                                        |
| **媒体捕获**               | getUserMedia / getDisplayMedia / MediaRecorder  | 摄像头/麦克风预览录制 + 桌面录屏    | [docs/29](./docs/29-媒体捕获（摄像头麦克风录屏）.md)                                          |
| **串口通信（Web Serial）** | setDevicePermissionHandler / select-serial-port | 权限放行 + 应用内端口选择 + 读写    | [docs/30](./docs/30-串口通信（Web%20Serial）.md)                                              |
| **GPU 信息与硬件加速**     | getGPUFeatureStatus / getGPUInfo / appendSwitch | 特性状态表 / 软渲染开关（重启生效） | [docs/31](./docs/31-GPU信息与硬件加速.md)                                                     |
| **应用数据目录**           | getPath / setPath                               | 目录全景 / 运行期修改下载目录       | [docs/32](./docs/32-应用数据目录（getPath%20setPath）.md)                                     |
| **加密存储**               | safeStorage（DPAPI/Keychain）                   | OS 级加密往返 / 敏感数据落盘方案    | [docs/33](./docs/33-安全存储（safeStorage）.md)                                               |
| **桌面捕获**               | desktopCapturer                                 | 屏幕源/窗口截图                     | [docs/17](./docs/17-桌面捕获.md)                                                              |
| **打印**                   | printToPDF                                      | 页面导出 PDF                        | [docs/18](./docs/18-打印.md)                                                                  |
| **协议与深链接**           | setAsDefaultProtocolClient                      | 唤起应用/内嵌网页                   | [docs/16](./docs/16-自定义协议与深链接.md)                                                    |
| **自动更新**               | electron-updater                                | 检查/下载/安装链路                  | [docs/15](./docs/15-自动更新.md)                                                              |
| **计算性能**               | utilityProcess / Web Worker                     | 阻塞对比/子进程计算/资源面板        | [docs/20](./docs/20-计算密集型与进程模型.md)                                                  |
| 安全实践                   | session / webContents                           | 权限/导航拦截                       | [docs/12](./docs/12-安全实践.md)                                                              |
| 生命周期                   | app                                             | 单实例/自启/事件                    | [docs/13](./docs/13-生命周期.md)                                                              |

**扩展特性**（并入既有页面与文档）：任务栏进度条、应用角标、窗口状态持久化、无边框窗口拖拽区与自定义标题栏、毛玻璃/亚克力、启动闪屏、页面缩放、窗口尺寸限制与透明度、窗口事件、点击穿透、内置 PDF 查看、会话分区（无痕/多账号）、目录监听、内嵌网页导航历史、页面加载状态监控、脚本注入、HTTP 本地服务器、系统强调色、崩溃转储、退出前未保存询问、静默权限检查、电源监控、阻止系统睡眠、全局错误处理、崩溃自动恢复、通知动作按钮、文件拖出窗口、系统文件图标、shell 文件操作、应用重启、文件关联、DNS 解析、BroadcastChannel 直连、系统语言与字体、会话缓存清理、关于面板、Thumbar 缩略图按钮、任务栏闪烁提醒。

**进阶实践**：[docs/21](./docs/21-进阶工程实践.md)（sandbox 生产切换、远程调试、Sentry 崩溃上报、contentTracing、electron-store、electron-log 等）。

## 信号源

信号源与信号分析 UI 已拆分：源工作台负责波形/输出/损伤/播放，分析组件只负责显示/测量。

- **信号源工作台**：`/source`，源类型目录、real/complex、载波/幅度/AWGN、启动/停止/单帧、IQ/频谱预览
- **分析配置**：`/signal/analysis-config`，FFT/窗/dB/重叠/频谱语义；源参数不在这里
- **源/连接高级配置**：`/source/advanced`，本地/远程连接、端口、远端 Mock；不再含 FFT
- **信号分析 UI 组件**：`/signal/*`，不再承担源波形参数
- 源领域模型、SourceEngine/SourceFrame：[`src/shared/source.ts`](./src/shared/source.ts)、[`src/shared/sourceEngine.ts`](./src/shared/sourceEngine.ts)
- 主进程独立源 IPC：`source:start/stop/getStatus/setConfig/trigger` + `source:frame`
- 文档：[SRC-01 信号源工作台](./docs/SRC-01-信号源工作台.md)

## 信号分析组件

IQ 时域/频谱/时频/星座/功率-时间/信号质量/眼图/持续谱/Smith/APD-CCDF 10 个组件已按“可被其他上位机集成”的目标库化：

- WebGL2 + Canvas2D 自动降级、`renderer` 可强制后端
- int16/float64/平面/字节序适配器，程序化 API（follow/paused、标记、区间测量、峰值、统计/可见数据、星座统计/导出）
- **real 单边 0~~Fs/2 与 complex 带符号复谱 -Fs/2~~+Fs/2** 双模式（`spectrumMode`/`freqStartHz`/`binHz`/`fftShift`）
- Mock 专业源：`outputMode` real/complex、CW/AM/FM/Pulse/Two-tone/Noise/Digital、AWGN 与 IQ 镜像；源输出域与分析域独立
- 9 组 `*DisplayOnly` 最小显示预设：IQ/频谱/时频/星座/功率-时间/眼图/持续谱/Smith/APD-CCDF 可只当普通显示组件使用
- 星座图：默认纯显示；可选星座分析仪（NCO/残余载波/符号定时/EVM/MER/IQ 不平衡），正方形 I/Q 视口、自动/手动量程、统计与 PNG/CSV
- 功率-时间 / Zero Span：纯显示功率序列；可选门限+滞回脉冲分析（脉宽/周期/占空比/PAPR）
- 信号质量面板：纯指标显示与阈值 Pass/Fail，不计算 DSP
- 眼图：叠加调用方切好的轨迹，测量眼高/眼宽/抖动；不做时钟恢复
- 持续谱/密度谱：频率×幅度命中计数热力图；纯显示密度矩阵或逐帧累计
- Smith 圆图：Γ 轨迹、等电阻/等电抗网格、VSWR/RL/阻抗游标
- APD/CCDF：纯曲线或从功率样本计算，输出 PAPR/0.1%/1% 电平
- 时频瀑布：WebGL2 R8 纹理 + LUT、频率缩放/冻结/色标/游标、PNG/CSV 导出
- 中英文 i18n（`locale`/`messages`）、`chartStyle`、尺寸字符串、ARIA/触摸、离屏暂停
- 独立 `dist-signal` 包（ESM/CSS/d.ts）与 Vite Playground + Worker 示例
- 像素级视觉回归（Canvas2D/WebGL2 双基线，覆盖 IQ/频谱/时频/星座）
- 新组件 Electron smoke：PowerTime/Eye/Persistence/Smith/APD/Quality 的 API/统计/渲染检查

文档：[SRC-01 信号源](./docs/SRC-01-信号源工作台.md) · [SIG-00 总览](./docs/SIG-00-信号组件总览.md) · [SIG-01 IQ](./docs/SIG-01-IQ时域图.md) · [SIG-02 频谱](./docs/SIG-02-频谱图.md) · [SIG-03 时频](./docs/SIG-03-时频图.md) · [SIG-04 星座](./docs/SIG-04-星座图.md) · [SIG-05 功率-时间](./docs/SIG-05-功率时间.md) · [SIG-06 信号质量](./docs/SIG-06-信号质量面板.md) · [SIG-07 眼图](./docs/SIG-07-眼图.md) · [SIG-08 持续谱](./docs/SIG-08-持续谱.md) · [SIG-09 Smith](./docs/SIG-09-Smith圆图.md) · [SIG-10 APD/CCDF](./docs/SIG-10-APD-CCDF.md) · [集成指南](./src/components/signal/README.md) · [Playground](./playground/README.md)

> 10 个组件均已完成库化；IQ/频谱/时频/星座含 Canvas2D 降级与像素回归，其余以核心单测 + Demo 覆盖。

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
│   └── features/         # ★ 55 个可独立复制的特性模块
├── preload/
│   └── index.ts          # 安全桥：window.api.<分组>.<方法>
└── renderer/src/
    ├── App.vue           # Naive UI 主题 + 侧边导航 + 内容区
    ├── router/           # vue-router（hash 模式）
    ├── stores/theme.ts   # 主题状态（与 nativeTheme 联动）
    └── pages/            # 50 个演示页（含信号分析/TypeScript/子窗口）
src/components/signal/    # 可复用 IQ/频谱组件（core + composables + README）
playground/               # 独立 Vite 宿主 + 像素回归 visual 页
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

Electron 39 · Vue 3.5 · TypeScript 5.9 · electron-vite 5 · Naive UI 2 · vue-router 5 · axios · socket.io-client
