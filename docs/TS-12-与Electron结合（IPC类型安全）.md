# TS-12 - 与 Electron 结合（IPC 类型安全）

> 对应演示页：TypeScript 惯用法 → 与 Electron 结合（路由 `/ts/electron-bridge`）

## 一、惯用法是什么

把前面各课的能力落地到 Electron：**通道名常量、判别联合载荷、preload 类型声明、
结果对象返回值**——让主/渲染进程之间"类型一致"。这是 Electron 项目最重要的
类型实践：跨进程边界一旦类型漂移，错误很难排查。

## 二、关键代码

```ts
// ① 通道名常量：避免"魔法字符串"拼错
export const IPC = {
  downloadStart: 'download:start',
  downloadProgress: 'download:progress',
  cookiesGetAll: 'cookies:getAll'
} as const
type Channel = (typeof IPC)[keyof typeof IPC]   // 通道名联合类型
// 主/渲染进程共用同一份常量 → 拼错通道名 = 编译错误

// ② 事件载荷用判别联合（与 TS-03 一致）
type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'error'; message: string }
function onStatus(status: UpdateStatus): void {
  switch (status.type) {
    case 'available': void status.version; break   // 分支内可安全访问独有字段
    case 'progress':  void status.percent; break
    case 'error':     void status.message; break
  }
}

// ③ 通用 invoke 泛型封装
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>
}

// ④ handler 返回"结果对象"（判别联合），跨进程契约统一
// 主进程：return err ? { ok: false, error: err } : { ok: true, path: p }
// 渲染进程：if (res.ok) ... else message.error(res.error)
```

## 三、常见陷阱

- 通道名别散落成字符串字面量——集中成常量后派生联合类型。
- 事件载荷别用裸 `any`/`object`——用判别联合建模，新增字段漏处理由穷尽检查兜底。

## 四、本工程真实出处

- **preload 类型声明**：`src/preload/index.d.ts` 用 `declare global` 把
  `window.api: Api` 暴露给渲染进程——`Api` 类型与 `src/preload/index.ts` 实现同源，
  改动一处全项目生效。
- **通道名与载荷**：`src/main/features/*.ts` 推送的 `download:progress`、
  `webRequest:log` 等通道，载荷都是结构化对象（见 TS-03/TS-05）。
- **结果对象**：`src/main/features` 各 `ipcMain.handle` 返回 `{ ok, ... }`，
  渲染进程按 `res.ok` 分支处理（见 TS-09）。

对照学习：看完本节后回看「IPC 通信」「会话管理」「自动更新」等页源码，
你会看到同样的惯用法。
