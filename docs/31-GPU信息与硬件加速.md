# 31 - GPU 信息与硬件加速开关

> 对应源码：`src/main/features/gpuInfo.ts` | 演示页：GPU 信息

## 一、背景：Electron 是 GPU 加速渲染

Electron 界面（Canvas、WebGL、视频解码、合成）由 GPU 加速。个别机器显卡驱动异常时，
典型症状：黑屏、花屏、白屏、界面卡顿、崩溃。排查三步走：

1. **看特性状态表**：`app.getGPUFeatureStatus()` —— 哪些特性是硬件加速，哪些被降级为软件
2. **看硬件信息**：`app.getGPUInfo('basic')` —— 显卡型号/驱动版本（上报 bug 时必附）
3. **禁用加速验证**：`disable-gpu` 开关（软渲染），若能正常显示则基本确认是驱动/GPU 问题

## 二、API 说明

```ts
// ① 特性状态表（每一项的状态字符串含义见下方对照）
const status = app.getGPUFeatureStatus()
// { '2d_canvas': 'enabled', 'webgl': 'enabled', 'gpu_compositing': 'enabled', ... }

// ② 基本信息（异步；macOS 返回内容较少属正常）
const info = await app.getGPUInfo('basic')
// { auxAttributes: { amdSwitchable: false, ... }, gpuDevice: [{ vendorId, deviceId, driverVersion, ... }] }

// ③ 禁用硬件加速：官方 API，必须在 app ready 之前调用（内部含完整的软件回退配置，
//    比裸 appendSwitch('disable-gpu') 更稳；二者等价可互换）
app.disableHardwareAcceleration()
```

常用状态值对照：

| 状态 | 含义 |
|------|------|
| `enabled` / `enabled_on` | 硬件加速 |
| `enabled_readback` | 加速但需回读（性能略降） |
| `disabled_software` | 软件渲染（加速被禁用） |
| `disabled_off` / `unavailable_off` | 特性已关闭 / 不可用 |

## 三、"禁用后重启生效"的实现模式

`disableHardwareAcceleration` 必须在 ready 前调用 → 运行时切换只能"标记 + 重启"：

```ts
// 启动阶段（index.ts，app ready 之前）
export function applyGpuCommandLine(): void {
  if (existsSync(flagFile())) {
    app.disableHardwareAcceleration()
    // ⚠️ relaunch 白屏踩坑：关闭加速后立即重启，旧实例 GPUCache 残留可能
    // 导致新实例软件合成初始化失败 → 白屏；启动前清除（仅缓存，安全）
    rmSync(join(app.getPath('userData'), 'GPUCache'), { recursive: true, force: true })
  }
}

// 运行期（IPC）：写标记文件，页面调 app.relaunch() 重启
ipcMain.handle('gpu:setAcceleration', (_e, enabled: boolean) => {
  if (enabled) rmSync(flagFile(), { force: true })
  else writeFileSync(flagFile(), '1')
  return { needsRelaunch: true }
})
```

本工程把标记文件放在 `userData/disable-gpu.flag`，重启按钮复用 relaunch.ts——
这也是"运行期配置 → 持久化 → 启动时应用"这一通用模式的实例。

⚠️ **dev 模式重启注意（electron-vite）**：开发时 vite dev server 在 electron-vite 进程内，
`app.relaunch()` 后旧进程退出会把整个 dev 进程（含 dev server）杀掉，新实例加载
`ELECTRON_RENDERER_URL` 失败 → **白屏**（与 GPU 无关，任何 dev 自动重启都如此）。
本工程 dev 模式不自动重启，页面会提示**手动重启 `npm run dev`** 生效；打包后自动重启正常。

## 四、复制到新工程的步骤

1. 复制 `src/main/features/gpuInfo.ts`
2. `index.ts` 中 **app ready 之前**调用 `applyGpuCommandLine()`（与 registerProtocolSchemes 并列）
3. `index.ts` 中调用 `registerGpuInfo()`
4. 渲染进程调用 `window.api.gpu.*`；重启可复用 relaunch 模式或让用户手动重启

## 五、相关调试手段

- 命令行排查：`electron . --disable-gpu`（临时禁用）、`--ignore-gpu-blocklist`（强行启用被拉黑的 GPU）
- 崩溃报告：`errorHandler.ts` 已接 `crashReporter`，GPU 进程崩溃会生成 .dmp
- 日志文件：userData/logs 下的 `gpu-process` 日志（可看到驱动加载失败原因）
- 远程排查：把 `getGPUInfo('complete')` 的结果附在用户反馈中
