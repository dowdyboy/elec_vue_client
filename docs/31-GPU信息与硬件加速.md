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

// ③ 禁用硬件加速：必须在 app ready 之前追加开关
app.commandLine.appendSwitch('disable-gpu')
```

常用状态值对照：

| 状态 | 含义 |
|------|------|
| `enabled` / `enabled_on` | 硬件加速 |
| `enabled_readback` | 加速但需回读（性能略降） |
| `disabled_software` | 软件渲染（加速被禁用） |
| `disabled_off` / `unavailable_off` | 特性已关闭 / 不可用 |

## 三、"禁用后重启生效"的实现模式

`appendSwitch` 必须在 ready 前调用 → 运行时切换只能"标记 + 重启"：

```ts
// 启动阶段（index.ts，app ready 之前）
export function applyGpuCommandLine(): void {
  if (existsSync(flagFile())) app.commandLine.appendSwitch('disable-gpu')
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
