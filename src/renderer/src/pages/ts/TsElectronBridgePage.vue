<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const channel = `// 惯用法一：IPC 通道名用常量集中管理，避免"魔法字符串"拼错
// channels.ts
export const IPC = {
  downloadStart: 'download:start',
  downloadProgress: 'download:progress',
  webRequestLog: 'webRequest:log',
  cookiesGetAll: 'cookies:getAll'
} as const
export type Channel = (typeof IPC)[keyof typeof IPC]   // 通道名联合类型

// 主进程 / 渲染进程共用同一份常量 → 拼错通道名 = 编译错误`

const payload = `// 惯用法二：事件载荷用判别联合，渲染进程安全分发
// 类型定义（主进程推送、渲染进程消费共享）
type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// 渲染进程处理（本工程 AutoUpdatePage 即此模式）：
function onStatus(status: UpdateStatus): void {
  switch (status.type) {
    case 'available':
      // 这里能用 status.version ✅
      void status.version
      break
    case 'progress':
      void status.percent
      break
    case 'error':
      void status.message
      break
  }
}`

const typing = `// 惯用法三：preload 把每个 API 的返回类型精确带给调用处
// preload/index.ts（节选）：
//   download: { list: () => ipcRenderer.invoke('download:list') }
//   shell:    { openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p) }
//
// 通过 index.d.ts 的 declare global 把 window.api: Api 暴露给渲染进程，
// 于是调用处自动获得类型补全：
//   const res = await window.api.shell.openPath('C:/a.txt')
//   res.ok / res.path / res.error   全部有类型提示

// 也可以为通用 invoke 封装泛型签名：
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>
}
// 使用时：const user = await invoke<User>('user:get', id)`

const example = `// 惯用法四：主进程 handler 返回"判别联合结果"，跨进程保持类型一致
// 主进程：
//   ipcMain.handle('shell:openPath', async (_e, p: string) => {
//     const err = await shell.openPath(p)
//     return err ? { ok: false, error: err } : { ok: true, path: p }
//   })
// 渲染进程只依赖 { ok: true; path } | { ok: false; error } 这个契约，
// 与"Result 结果对象"惯用法（异步一课）完全一致。`
</script>

<template>
  <TsPage
    title="与 Electron 结合：IPC 类型安全"
    intro="把前面各课的能力落地到 Electron：通道名常量、判别联合载荷、preload 类型声明、结果对象返回值——让主/渲染进程之间'类型一致'。本工程 preload/index.d.ts 与各 feature 页已在实践这些惯用法。"
  >
    <TsExample
      title="通道名常量"
      explain="把 IPC 通道名收敛成常量对象并用 as const 派生联合类型，拼错即编译错误。"
      :code="channel"
      tip="通道名统一前缀（如 download:、cookies:），按领域分组，便于排查。"
    />
    <TsExample
      title="事件载荷判别联合"
      explain="主进程推送的事件用判别联合建模，渲染进程 switch 分发，每分支安全访问独有字段。"
      :code="payload"
      tip="这正是「收窄」一课的模式在 Electron 事件上的应用（本工程 onStatus/onDownload 同款）。"
    />
    <TsExample
      title="preload 类型声明"
      explain="通过 declare global 把 window.api 的类型暴露给渲染进程；通用 invoke 可用泛型签名。"
      :code="typing"
      tip="preload 的 index.d.ts 是这个「类型安全 IPC」的枢纽——api 类型与实现同源，改动一处全项目生效。"
    />
    <TsExample
      title="结果对象返回值"
      explain="handler 返回 { ok, ... } 判别联合，与 Result 惯用法一致，跨进程契约统一。"
      :code="example"
    />
  </TsPage>
</template>
