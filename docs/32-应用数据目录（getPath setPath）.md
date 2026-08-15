# 32 - 应用数据目录（app.getPath / setPath）

> 对应源码：`src/main/features/appPaths.ts` | 演示页：数据目录

## 一、数据落点全景

桌面应用的数据分三类，放错目录是新手最常见的坑：

| 分类 | 目录 | 特征 | 示例 |
|------|------|------|------|
| 私有数据 | `userData` / `sessionData` / `logs` | 不可见、卸载时清理 | SQLite 库、配置、Cookie、崩溃日志 |
| 缓存临时 | `temp` / `sessionData` | 可随时删除 | 临时文件、Chromium 缓存 |
| 用户可见 | `downloads` / `documents` / `desktop` | 用户感知、不应乱写 | 下载、导出、另存为 |

```ts
app.getPath('userData')    // Windows: %APPDATA%/应用名；macOS: ~/Library/Application Support/应用名
app.getPath('sessionData') // Chromium 会话数据（缓存/Cookie，sessionCleanup.ts 清理对象）
app.getPath('logs')        // 崩溃日志
app.getPath('downloads')   // 下载（download.ts 默认落点）
app.getPath('exe')         // 可执行文件目录（生产=安装目录，dev=node_modules/electron）
```

本工程实例：`sqlite.ts` 把 app.db 放 userData，`windowState.ts` 把 window-state.json 放 userData，
`errorHandler.ts` 的崩溃转储在 `crashDumps`。

## 二、setPath 的时机限制（重点）

| 目录 | 何时可 setPath |
|------|---------------|
| `userData` / `sessionData` | **仅 app ready 之前**（见下方"运行期会怎样"） |
| `downloads` 等 | 运行期可改（立即生效，影响后续下载落点） |

```ts
// 必须放在 app.whenReady().then(...) 之前
app.setPath('userData', 'D:\\MyAppData') // 便携版应用常用：数据放可移动盘

// 运行期（allowed）：改下载目录
ipcMain.handle('paths:set', (_e, key, value) => {
  app.setPath(key as PathKey, value)
})
```

**运行期 setPath('userData') 到底会怎样？（本工程实测纠错）**

- 老版本 Electron 会直接抛错（"userData path cannot be changed after app is ready"）
- **Electron 39 已移除该检查**——源码 `electron_api_app.cc` 的 `App::SetPath` 只校验
  "绝对路径 + 合法 key"，运行期调用会**静默成功**（本页按钮曾实测"竟然成功了"）；
  官方文档如今也只要求 `sessionData` 在 ready 前设置（Chromium 约束，代码同样未强制）
- **但这不意味着可以随便改**：会造成数据撕裂——`getPath('userData')` 返回新目录，
  而启动时已按旧目录初始化的 Chromium profile/缓存、已打开的 SQLite（sqlite.ts）、
  窗口状态文件（windowState.ts）等仍留在旧目录
- 结论：生产仍在 ready 前设置；并且建议像本工程一样在 setPath 通道**应用层拦截**
  userData/sessionData（appPaths.ts 的 paths:set 已实现，演示页按钮可验证）

```ts
// 应用层拦截（appPaths.ts）：把"为什么必须提前"教给调用方
if (key === 'userData' || key === 'sessionData') {
  return { ok: false, error: `${key} 必须在 app ready 之前设置（运行期修改会造成数据撕裂）` }
}
```

**为什么 userData 要提前**：Electron 启动早期就按 userData 初始化缓存、LocalStorage、
Chromium profile 等，中途换目录会导致"一半数据在新目录、一半在旧目录"的撕裂状态。

## 三、复制到新工程的步骤

1. 复制 `src/main/features/appPaths.ts`，`index.ts` 中调用 `registerAppPaths()`
2. 渲染进程调用 `window.api.paths.*`
3. 需要自定义 userData 时，在 `index.ts` 顶部（import 之后、whenReady 之前）setPath

## 四、真实工程约定

- **不要**把配置写进安装目录（Program Files 无写权限，且升级会被覆盖）→ 放 userData
- **不要**用相对路径（`./data`）——工作目录不稳定，打包后是安装目录
- 便携版（绿色软件）：把 userData 指到 exe 旁的 `data` 目录（注意 U 盘场景的权限）
- 多用户隔离：userData 天然按系统用户隔离，跨用户共享数据用 `setPath('userData', 公共目录)`（自担安全风险）
- 打包后 `app.getAppPath()` 指向 `resources/app.asar`；读打包内资源用 `join(__dirname, ...)` 而非拼绝对路径
