<script setup lang="ts">
/**
 * TypeScript 惯用法板块 · 总览
 * 教学路径 + 与 Electron 板块的对照
 */
import { NCard, NDataTable, NText, NAlert, type DataTableColumns } from 'naive-ui'
import TsPage from '../../components/ts/TsPage.vue'

interface Lesson {
  name: string
  route: string
  ability: string
}

const columns: DataTableColumns<Lesson> = [
  { title: '课程', key: 'name', width: 200 },
  { title: '路由', key: 'route', width: 180 },
  { title: '覆盖能力', key: 'ability' }
]

const lessons: Lesson[] = [
  { name: 'TS 总览', route: '/ts', ability: '学习路径与对照' },
  { name: '类型标注与推断', route: '/ts/intro', ability: '基础类型、字面量、any/unknown/never' },
  { name: 'interface vs type', route: '/ts/interface-type', ability: '可选/只读/索引签名/交叉' },
  {
    name: '联合类型与收窄',
    route: '/ts/narrowing',
    ability: 'typeof/in/instanceof、判别联合、穷尽检查'
  },
  { name: '泛型', route: '/ts/generics', ability: '函数/接口/约束/默认参数' },
  { name: '工具类型', route: '/ts/utility', ability: 'Partial/Omit/Record/ReturnType/Parameters' },
  {
    name: '映射与条件类型',
    route: '/ts/mapped-conditional',
    ability: 'keyof/infer/as const/satisfies'
  },
  { name: '函数惯用法', route: '/ts/function', ability: '重载/默认参数/rest/类型守卫' },
  {
    name: '枚举与常量断言',
    route: '/ts/enum-literal',
    ability: 'enum vs as const、模板字面量类型'
  },
  { name: '异步惯用法', route: '/ts/async', ability: 'async/await、错误处理、Promise.all/race' },
  { name: '模块与导入导出', route: '/ts/module', ability: 'import type、re-export、别名' },
  { name: '类与面向对象', route: '/ts/oop', ability: '访问修饰符、抽象类、implements' },
  {
    name: '与 Electron 结合',
    route: '/ts/electron-bridge',
    ability: 'IPC 通道类型安全、事件载荷推导'
  }
]
</script>

<template>
  <TsPage
    title="TypeScript 惯用法总览"
    intro="Electron 的每个演示页都在用 TypeScript。本板块把 TS 常用类型能力与惯用法系统地过一遍：先掌握类型标注、接口、泛型、工具类型这些「地基」，再看收窄、映射/条件类型这些「进阶武器」，最后用本工程真实的 IPC/事件代码演示「类型安全」落地。左侧子菜单可逐课学习。"
  >
    <n-card size="small" title="📚 学习路径" style="margin-bottom: 12px">
      <n-text depth="2" style="font-size: 13px; line-height: 1.9">
        ① 地基：类型标注与推断 → interface/type → 泛型<br />
        ② 进阶：联合与收窄 → 工具类型 → 映射/条件类型<br />
        ③ 实战：函数惯用法 → 异步惯用法 → 模块组织 → 类<br />
        ④ 落地：与 Electron 结合（IPC 类型安全）
      </n-text>
    </n-card>

    <n-card size="small" title="🗺️ 课程表">
      <n-data-table :columns="columns" :data="lessons" size="small" :bordered="false" />
    </n-card>

    <n-alert type="info" :show-icon="true" style="margin-top: 12px">
      <template #header>与 Electron 板块的对照</template>
      本工程的类型实例：preload 的 <code>window.api</code> 类型声明（index.d.ts）、各事件载荷的
      <code>接口 + 判别联合</code>、IPC 通道名常量。学完「与 Electron 结合」一课后， 可以回看 IPC
      通信、会话管理等页面的源码，你会看到同样的惯用法。
    </n-alert>
  </TsPage>
</template>
