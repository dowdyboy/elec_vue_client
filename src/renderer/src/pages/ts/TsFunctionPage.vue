<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const defaults = `// 默认参数 + 可选参数
function greet(name: string, title = '同学'): string {
  return \`你好，\${title}\${name}\`
}
greet('小明')            // 你好，同学小明
greet('小红', '老师')    // 你好，老师小红

// rest 参数：剩余参数收集为数组
function sum(...nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}
sum(1, 2, 3)             // 6`

const overload = `// 函数重载：同一函数多组签名，调用时按实参匹配
function format(input: number): string
function format(input: Date): string
function format(input: number | Date): string {
  if (typeof input === 'number') return input.toFixed(2)
  return input.toLocaleDateString()
}
format(3.14159)          // "3.14"
format(new Date())       // 本地日期

// 不同参数组合的重载（常见于"可选开关"类 API）
function createTimer(cb: () => void, ms?: number): void
function createTimer(ms?: number): void
function createTimer(cbOrMs: (() => void) | number, ms?: number): void {
  // 实现签名只写一次，不对外
}`

const guards = `// 自定义类型守卫：让函数返回 boolean 的同时把类型收窄
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}
function process(input: unknown): string[] {
  if (isStringArray(input)) {
    return input          // 这里 input 已是 string[] ✅
  }
  return []
}

// this 类型：显式标注 this（回调场景避免隐式 any）
interface ElementLike {
  click(): void
}
function bindClick(this: ElementLike): void {
  this.click()
}`

const example = `// 实战：用类型守卫安全处理"未知"数据（如 IPC 收到的 payload）
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
// window.api.error.onNew((record) => { ... }) 里对 record 做守卫后使用`

/** 运行示例：默认参数（等价 JS 行为） */
function greetDemo(): string {
  const greet = (n: string, t = '同学'): string => '你好，' + t + n
  return greet('小明')
}
</script>

<template>
  <TsPage
    title="函数惯用法"
    intro="函数是 TS 里用得最多的场景：默认参数、重载、rest、自定义类型守卫，能让 API 既好用又类型安全。"
  >
    <TsExample
      title="默认参数与 rest"
      explain="默认参数、可选参数、rest 剩余参数让函数签名灵活且自文档化。"
      :code="defaults"
      :run="greetDemo"
    />
    <TsExample
      title="函数重载"
      explain="同一函数多组对外签名，实参不同返回不同语义；实现签名合并所有可能。"
      :code="overload"
      tip="重载顺序有讲究：更具体的签名放前面。实现签名不对外可见。"
    />
    <TsExample
      title="类型守卫与 this"
      explain="value is T 返回类型让调用处自动收窄；this 参数标注显式指定 this 的类型。"
      :code="guards"
      tip="把 typeof/in/instanceof 组合封装成守卫函数，是'干净地处理 unknown'的关键。"
    />
    <TsExample
      title="实战：处理未知载荷"
      explain="在 IPC 回调里用守卫/转换函数把 unknown 变安全类型，避免 any。"
      :code="example"
    />
  </TsPage>
</template>
