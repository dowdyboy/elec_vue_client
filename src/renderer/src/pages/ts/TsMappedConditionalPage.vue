<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const mapped = `// 映射类型：按规则"批量生成"属性（Mapped Types）
type Getters<T> = {
  [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K]
}
interface User { name: string; age: number }
type UserGetters = Getters<User>
// { getName: () => string; getAge: () => number }

// 加修饰符：-? 去掉可选、readonly 加只读
type RequiredAndReadonly<T> = {
  readonly [K in keyof T]-?: T[K]
}
type ReadonlyUser = RequiredAndReadonly<User>  // name/age 必填且只读`

const conditional = `// 条件类型：类型层面的 if-else（T extends U ? X : Y）
type IsString<T> = T extends string ? true : false
type A = IsString<'x'>   // true
type B = IsString<42>    // false

// infer：在条件里"提取"类型（类型层面的解构）
type ElementType<T> = T extends (infer E)[] ? E : never
type C = ElementType<number[]>   // number
type D = ElementType<string[]>   // string

// 分布式条件类型：联合类型会逐个分发
type Filter<T> = T extends string ? T : never
type E = Filter<string | number | boolean>  // string`

const satisfies = `// satisfies：让值"满足某类型"但不改变推断的字面量精度
type Keys = 'red' | 'green' | 'blue'
const palette = {
  red: [255, 0, 0],
  green: '#00ff00',
  blue: [0, 0, 255]
} satisfies Record<Partial<Keys>, unknown>
// palette.red 推断为 number[]（保留精度），同时整体满足约束

// as const：把字面量固化（配合映射/条件类型做"常量驱动类型"）
const ROUTES = ['home', 'settings', 'about'] as const
type Route = (typeof ROUTES)[number]   // 'home' | 'settings' | 'about'`
</script>

<template>
  <TsPage
    title="映射与条件类型"
    intro="这是 TS'类型编程'的核心：映射类型批量改属性，条件类型做类型级分支，infer 负责提取。理解了它们，就能读懂绝大多数'类型体操'。"
  >
    <TsExample
      title="映射类型"
      explain="用 [K in keyof T] 遍历对象键，配合 as 重命名、修饰符 -? / readonly 批量生成新类型。"
      :code="mapped"
      tip="Getters/组件 Props 提取等'一键生成配套类型'都可以用映射类型做，避免手写重复。"
    />
    <TsExample
      title="条件类型与 infer"
      explain="T extends U ? X : Y 做类型分支；infer E 在分支里提取被匹配的部分；联合类型自动分发。"
      :code="conditional"
      pitfall="普通类型在联合上的条件判断会'分发'到每个成员；若不想分发，用 [T] extends [U] 包一层。"
    />
    <TsExample
      title="satisfies 与 as const"
      explain="satisfies 校验约束但保留精确推断；as const + typeof 从常量反向推导类型。"
      :code="satisfies"
      tip="'常量数组 → 联合类型'（(typeof ROUTES)[number]）是路由表、枚举集合的标准推导方式。"
    />
  </TsPage>
</template>
