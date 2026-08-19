<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const basic = `// 泛型：类型层面的"参数"。让函数/接口/类在不丢失类型信息的前提下复用逻辑
function first<T>(arr: T[]): T | undefined {
  return arr[0]
}
const a = first([1, 2, 3])        // a: number | undefined（推断出 T = number）
const b = first(['x', 'y'])       // b: string | undefined

// 显式指定类型参数（推断不出来时）
const c = first<string | number>(['a', 1])

// 多个类型参数
function pair<A, B>(x: A, y: B): [A, B] {
  return [x, y]
}`

const constraint = `// 约束（extends）：限制 T 必须具备某些能力
interface HasLength { length: number }
function longest<T extends HasLength>(a: T, b: T): T {
  return a.length >= b.length ? a : b
}
longest('abc', 'de')      // ✅ 字符串有 length
longest([1, 2], [3])      // ✅ 数组有 length
// longest(1, 2)          // ❌ number 没有 length

// 泛型默认参数
function makeArray<T = string>(n: number): T[] {
  return new Array(n)
}
const arr = makeArray(3)          // string[]
const numArr = makeArray<number>(3) // number[]`

const genericTypes = `// 泛型接口
interface Box<T> {
  value: T
}
const box: Box<number> = { value: 42 }

// 泛型函数类型
type Mapper<T, U> = (item: T) => U
const toStr: Mapper<number, string> = (n) => String(n)

// 泛型类
class Stack<T> {
  private items: T[] = []
  push(item: T): void { this.items.push(item) }
  pop(): T | undefined { return this.items.pop() }
}
const s = new Stack<number>()
s.push(1)`

const example = `// 本工程实战（preload 类型）：IPC invoke 封装用泛型把返回类型带给调用方
// 例如 window.api.download.list() 返回 Promise<DownloadRecord[]>
// 定义时可写成:  list: <T>() => Promise<T>  在具体实现处注入真实类型
// 好处：调用处直接获得类型补全，无需手动断言`

/** 运行示例：泛型 first 取首元素（等价 JS 行为） */
function firstDemo(): number | undefined {
  const first = (arr: number[]): number | undefined => arr[0]
  return first([1, 2, 3])
}
</script>

<template>
  <TsPage
    title="泛型"
    intro="泛型（Generics）让一段代码能处理多种类型，同时保留精确的类型关系——'类型层面的参数'。数组、Promise、Map 都是泛型。"
  >
    <TsExample
      title="泛型函数"
      explain="<T> 声明类型参数，TS 根据实参自动推断 T，返回值与入参建立类型联系。"
      :code="basic"
      :run="firstDemo"
      tip="优先依赖推断；只有推断不理想时才显式写 <T>。"
    />
    <TsExample
      title="约束与默认参数"
      explain="extends 约束 T 必须具备的能力；= 提供默认类型参数。"
      :code="constraint"
      tip="约束让泛型函数既通用又能调用被约束的能力（如 .length）。"
    />
    <TsExample
      title="泛型接口 / 函数类型 / 类"
      explain="泛型不止于函数：接口、函数类型、类都可以带类型参数。"
      :code="genericTypes"
    />
    <TsExample
      title="实战：IPC 封装"
      explain="把泛型用在 Electron 的 preload 封装上，让每个 API 的返回类型精确到达调用处。"
      :code="example"
    />
  </TsPage>
</template>
