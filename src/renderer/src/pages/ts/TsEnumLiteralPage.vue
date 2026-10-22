<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const enumVsConst = `// enum：运行时真实存在的对象（反向映射）
enum Color {
  Red,
  Green,
  Blue
}
console.log(Color.Red)      // 0（数字枚举从 0 递增）
console.log(Color[0])       // "Red"（反向映射）

// 字符串枚举：没有反向映射，但语义更清晰
enum Status {
  Idle = 'idle',
  Loading = 'loading',
  Error = 'error'
}
const s: Status = Status.Idle

// as const + 联合：更"现代"的替代（仍生成对象，但无数字枚举的 IIFE/反向映射开销，类型更精确）
const Statuses = {
  Idle: 'idle',
  Loading: 'loading',
  Error: 'error'
} as const
type StatusT = (typeof Statuses)[keyof typeof Statuses]  // 'idle' | 'loading' | 'error'
// 对比：数字枚举编译为 IIFE 且生成反向映射 Color[0]==="Red"；as const 对象仅为普通对象，无额外运行时开销
// const enum 在编译期擦除（无对象），但在 isolatedModules/跨包场景下不可用，需权衡`

const template = `// 模板字面量类型：在字符串类型层面做模板
type Unit = 'px' | '%'
type Size = \`\${number}\${Unit}\`       // "10px" | "10%" ...
const s1: Size = '12px'                 // ✅
// const s2: Size = '12'               // ❌ 缺单位

// 与字面量联合组合出"路径"类型
type Route =
  | '/'
  | \`/user/\${string}\`
  | \`/user/\${string}/\${'edit' | 'view'}\`
const r1: Route = '/user/42'           // ✅
const r2: Route = '/user/42/edit'      // ✅`

const example = `// 实战取舍：小型固定选项 → as const + 联合；需要运行时枚举/反向映射 → enum
// 本工程多处用 as const + 联合描述"选项集"（如主题 source、权限名单），
// 因为它类型精确、无运行时开销，且能和判别联合配合做穷尽检查。`

/** 运行示例：数字枚举的反向映射（等价 JS 行为） */
function colorDemo(): { Red: number; reverse: string; hasReverse: boolean } {
  // 模拟数字枚举的运行时形态：{0:"Red", Red:0}
  const Color: Record<string, string | number> = { Red: 0, Green: 1, Blue: 2 }
  Color[0] = 'Red' // 反向映射（数字枚举独有）
  Color[1] = 'Green'
  return { Red: Color.Red as number, reverse: Color[0] as string, hasReverse: Color[0] === 'Red' }
}
</script>

<template>
  <TsPage
    title="枚举与常量断言"
    intro="enum 是 TS 的传统枚举；as const + 联合是更现代的替代。以及模板字面量类型——在字符串类型上做模式匹配。"
  >
    <TsExample
      title="enum 与 as const"
      explain="对比 enum（运行时对象、可反向映射）与 as const+联合（纯类型、更精确）两种建模方式。"
      :code="enumVsConst"
      :run="colorDemo"
      tip="团队新项目常用 as const + 联合替代 enum：类型更精确、无运行时副作用、能与穷尽检查配合。"
      pitfall="数字 enum 的反向映射在仅类型使用时是多余的运行时开销；字符串 enum 无反向映射、语义更安全。"
    />
    <TsExample
      title="模板字面量类型"
      explain="用反引号模板在类型层面构造字符串类型，非常适合路径、单位、事件名等场景。"
      :code="template"
      tip="与泛型/条件类型结合能做'类型安全的 URL 构造器'等高级玩法。"
    />
    <TsExample
      title="实战取舍"
      explain="怎么选：小型固定选项 → as const + 联合；需要运行时枚举或反向映射 → enum。"
      :code="example"
    />
  </TsPage>
</template>
