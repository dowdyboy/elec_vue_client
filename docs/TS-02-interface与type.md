# TS-02 - interface 与 type

> 对应演示页：TypeScript 惯用法 → interface vs type（路由 `/ts/interface-type`）

## 一、惯用法是什么

描述"对象结构"有两种方式：`interface` 与 `type`。大部分对象场景两者等价，
但各有擅长边界与独有能力。知道何时用哪个，是写出可读类型的第一步。

## 二、关键代码

```ts
// interface：专为对象结构设计
interface User {
  name: string
  age?: number          // 可选
  readonly id: string   // 只读
}

// type：万能别名（联合/元组/函数/字面量等）
type Status = 'idle' | 'loading' | 'error'
type Callback = (err: Error | null, data?: unknown) => void

// 索引签名：键不固定时
interface Dict { [key: string]: number }
const scores: Dict = { a: 1, b: 2 }

// interface 继承（可多个） / type 交叉组合
interface Base { id: string }
interface User extends Base { name: string }
type UserT = Base & { name: string }

// 声明合并：interface 独有（type 不允许重复声明）
interface Box { w: number }
interface Box { h: number }   // ✅ 合并为 { w, h }
```

## 三、常见陷阱

- 索引签名的值类型会约束所有显式属性：`{ a: 1; b: 'x' }` 对 `number` 值的 `Dict` 会报错。
- `type` 重复声明直接报错；只有 `interface` 支持声明合并（第三方库类型增强依赖它）。

## 四、与 Electron 实例对照

本工程 `src/preload/index.d.ts` 用 `interface` 描述 `window.api` 分组结构；
`src/renderer/src/pages/*.vue` 里的事件载荷、配置对象大量用 interface 建模。
团队规范常见做法：对象/类用 interface，联合/函数签名/工具组合用 type。
