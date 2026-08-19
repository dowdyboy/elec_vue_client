<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const base = `// 基础类型：string / number / boolean / null / undefined / bigint / symbol
let name: string = 'Electron'
const count: number = 42
let active: boolean = true

// 数组的两种写法
const list: number[] = [1, 2, 3]
const list2: Array<string> = ['a', 'b']

// 元组：长度与位置类型都固定
const pair: [string, number] = ['version', 1]

// 字面量类型：值本身作为类型（配合联合 = 枚举的轻量替代）
type Direction = 'up' | 'down' | 'left' | 'right'
let dir: Direction = 'up'   // ✅
// dir = 'back'             // ❌ 类型错误`

const infer = `// 类型推断：能不写就不写（IDE 会给出类型）
let msg = 'hello'        // 推断为 string
const num = 100          // 推断为 100（字面量类型，const）
let n2 = 100             // 推断为 number

// 函数返回类型自动推断
function add(a: number, b: number) {
  return a + b            // 推断返回 number
}

// ⚠️ 复杂推导看不准时可显式标注，但别处处都写
function identity<T>(x: T): T {
  return x
}`

const topBottom = `// any：放弃类型检查（慎用——会传染，让整个链路的类型失效）
let anything: any = 1
anything = 'str'          // ✅ 但丢失了类型保护

// unknown：未知但安全（必须收窄后才能用）
let data: unknown = JSON.parse('{"a":1}')
// data.a                  // ❌ 类型错误：unknown 不能直接访问属性
if (typeof data === 'object' && data !== null && 'a' in data) {
  const a = (data as { a: number }).a   // 收窄后再用
}

// never：永不发生的类型（穷尽检查的关键，见"收窄"一课）
function fail(msg: string): never {
  throw new Error(msg)
}

// void：函数"没有返回值"
function log(msg: string): void {
  console.log(msg)
}`

const example = `// 用 const 断言（as const）让对象所有值变成字面量类型
const CONFIG = {
  appName: 'elec-vue',
  version: 1
} as const
// CONFIG.version 类型是 1（字面量），而不是 number`
</script>

<template>
  <TsPage
    title="类型标注与推断"
    intro="TypeScript 的核心：类型系统 + 自动推断。掌握基础类型、字面量类型，以及 any/unknown/never 三兄弟的区别，就抓住了 TS 的起点。"
  >
    <TsExample
      title="基础类型与字面量"
      explain="字符串/数字/布尔/数组/元组，以及'值本身作为类型'的字面量类型（配合联合类型就是最常用的'选项集'写法）。"
      :code="base"
      tip="类型标注写在变量后（冒号）。能推断出来的可以省略；const 声明的字面量会收窄为字面量类型，let 则为宽类型。"
    />
    <TsExample
      title="类型推断"
      explain="TS 会尽力推断类型，原则是：能不写就不写，但读起来不明了的显式标注。"
      :code="infer"
      tip="给函数返回值/参数标注类型是最高性价比的投入——调用处立刻获得补全与检查。"
    />
    <TsExample
      title="any / unknown / never"
      explain="三个特殊类型的取舍是高频面试点：any 放弃检查、unknown 安全但需收窄、never 表示'不可能'。"
      :code="topBottom"
      tip="生产代码建议：新代码禁止 any（可开 ESLint 的 no-explicit-any）；拿不到类型的数据用 unknown + 收窄，比 any 安全得多。"
      pitfall="any 会'传染'：一个 any 变量传给函数后，函数参数的类型检查就失效了，错误一路溜走。"
    />
    <TsExample
      title="const 断言（as const）"
      explain="as const 把对象/数组的所有值固化为字面量类型，是做'只读配置'和'常量表'的标准写法。"
      :code="example"
      tip="as const 与 enum 的取舍见「枚举与常量断言」一课。"
    />
  </TsPage>
</template>
