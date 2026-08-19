<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const importType = `// import type / export type：仅类型导入，运行时被擦除（利于 tree-shaking）
import type { User } from './types'
import { fetchUser } from './api'   // 运行时导入

export type { User, Task }

// re-export：中转导出
export { fetchUser } from './api'
export type { User } from './types'

// 默认导出 vs 命名导出（团队统一即可，推荐命名导出利于重构）
export function helper(): void {}`

const namespace = `// namespace（旧式内部模块，现代项目少用）
namespace Utils {
  export function format(n: number): string {
    return n.toFixed(2)
  }
}
Utils.format(3.14)

// 现代做法：直接模块 + 按需 import（推荐）
// utils.ts
export function format(n: number): string {
  return n.toFixed(2)
}
// 使用处
import { format } from '../utils'`

const aliases = `// 路径别名：避免深层相对路径
// vite/tsconfig 配置 "@renderer" -> src/renderer/src
import { useMessage } from 'naive-ui'
// 不使用别名时：../../../../components/xxx
// 使用别名：@renderer/components/xxx

// 通配符：把同类型模块聚合成一个入口（barrel file）
// features/index.ts:
export * from './windowManager'
export * from './tray'
// 使用处只需：import { registerTray } from './features'`

const example = `// 实战（本工程 preload/index.ts）：把 window.api 的类型集中声明后
// 通过全局类型（.d.ts）暴露给渲染进程，实现"调用处有补全"——
// 这就是 export type + 集中声明模块的威力。`
</script>

<template>
  <TsPage
    title="模块与导入导出"
    intro="模块组织决定项目的可维护性：import type 与运行时导入要分清，re-export/barrel 文件管理依赖，路径别名让代码干净。"
  >
    <TsExample
      title="import type 与 re-export"
      explain="import type 仅引入类型（运行时被擦除）；re-export 统一对外出口。"
      :code="importType"
      tip="纯类型模块建议一律 import type，明确意图且利于编译优化。"
    />
    <TsExample
      title="namespace 与现代做法"
      explain="namespace 是旧式方案；现代 TypeScript 直接「一个文件一个模块 + import」。"
      :code="namespace"
    />
    <TsExample
      title="路径别名与 barrel"
      explain="用 @别名避免深层相对路径；用 barrel 文件（index.ts 聚合导出）收敛内部实现。"
      :code="aliases"
      pitfall="barrel 文件别过度聚合导致循环依赖；按领域分桶。"
    />
    <TsExample
      title="实战：类型集中声明"
      explain="preload 的 window.api 类型经 .d.ts 全局暴露，是 Electron 项目「类型安全 IPC」的地基。"
      :code="example"
    />
  </TsPage>
</template>
