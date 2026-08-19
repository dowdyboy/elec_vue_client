<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const both = `// interface 描述"对象的结构"
interface User {
  name: string
  age?: number          // 可选属性
  readonly id: string   // 只读属性（初始化后不可改）
}

// type 别名可以描述更多形态：联合、元组、函数、字面量
type Status = 'idle' | 'loading' | 'error'
type Callback = (err: Error | null, data?: unknown) => void
type Point = { x: number; y: number }

// 对象结构两者等价，可互换：
interface A { x: number }
type B = { x: number }`

const indexSig = `// 索引签名：不确定有哪些键时
interface Dict {
  [key: string]: number        // 任意字符串键，值都是 number
}
const scores: Dict = { a: 1, b: 2 }

// 函数类型（interface 写法）
interface Calc {
  (a: number, b: number): number
}
const add: Calc = (a, b) => a + b`

const extend = `// interface 通过 extends 继承（可多个）
interface Base { id: string }
interface WithName { name: string }
interface User extends Base, WithName { email?: string }

// type 通过交叉类型 & 组合
type BaseT = { id: string }
type WithNameT = { name: string }
type UserT = BaseT & WithNameT & { email?: string }

// 二者主要区别：同名 interface 会合并（声明合并），type 不允许重复声明
interface Box { w: number }
interface Box { h: number }   // ✅ 合并成 { w, h }`

const example = `// 实战惯用法：可选 + 只读 + 联合，就是"配置对象"的标准形态
interface AppOptions {
  readonly appId: string
  theme?: 'light' | 'dark'
  plugins?: string[]
  onReady?: () => void
}`
</script>

<template>
  <TsPage
    title="interface vs type"
    intro="描述对象结构有 interface 和 type 两种方式。大部分对象场景两者等价；知道各自擅长的边界，才能写出别人看得懂的类型。"
  >
    <TsExample
      title="各自擅长的形态"
      explain="interface 专为对象结构设计；type 是'万能别名'，能表示联合/元组/函数/字面量等一切类型。"
      :code="both"
      tip="团队规范常见做法：对象/类用 interface，其余（联合、函数签名、工具组合）用 type。"
    />
    <TsExample
      title="索引签名与函数类型"
      explain="索引签名用于'键不固定'的映射结构；两种写法都能表达函数类型。"
      :code="indexSig"
      pitfall="索引签名的值类型会约束所有显式属性：{ a: 1; b: 'x' } 对 number 值的 Dict 会报错。"
    />
    <TsExample
      title="继承与组合"
      explain="interface extends 继承，type 用交叉类型 & 组合；同名 interface 支持声明合并。"
      :code="extend"
      tip="声明合并是 interface 的独有能力（第三方库类型增强常用）。type 没有合并，重复声明直接报错。"
    />
    <TsExample
      title="实战：配置对象"
      explain="可读的配置对象类型，把可选、只读、联合、回调组合在一起，就是最常见的 interface 用法。"
      :code="example"
    />
  </TsPage>
</template>
