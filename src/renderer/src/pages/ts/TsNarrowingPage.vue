<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const narrow = `// 类型收窄：把宽类型（联合）缩到具体分支，才能用该分支的能力
function handle(input: string | number): number {
  if (typeof input === 'string') {
    return input.length      // 这里 input: string ✅
  }
  return input * 2           // 这里 input: number ✅
}

// in 收窄（对象属性存在性）
type Cat = { meow: () => void }
type Dog = { bark: () => void }
function speak(pet: Cat | Dog): void {
  if ('meow' in pet) pet.meow()   // 有 meow → Cat
  else pet.bark()
}

// instanceof 收窄（类实例）
function read(x: Date | string): number {
  return x instanceof Date ? x.getTime() : Date.parse(x)
}`

const discriminated = `// 判别联合（discriminated union）：用一个字面量字段区分分支——最常用的类型安全惯用法
interface IdleState { status: 'idle' }
interface LoadingState { status: 'loading'; since: number }
interface ErrorState { status: 'error'; message: string }

type UiState = IdleState | LoadingState | ErrorState

function render(state: UiState): string {
  switch (state.status) {
    case 'idle':      return '等待'
    case 'loading':   return '加载中...' + state.since
    case 'error':     return '错误: ' + state.message
  }
}
// 每个分支都能访问该分支独有的字段，且 switch 穷尽时无需 default`

const exhaustive = `// 穷尽检查：加一个分支后编译器强制你处理它
interface SavedState { status: 'saved'; at: number }
type UiState2 = IdleState | LoadingState | ErrorState | SavedState

function assertNever(x: never): never {
  throw new Error('未处理的联合分支: ' + JSON.stringify(x))
}

function render2(state: UiState2): string {
  switch (state.status) {
    case 'idle':     return '等待'
    case 'loading':  return '加载中'
    case 'error':    return '错误'
    case 'saved':    return '已保存'
    default: return assertNever(state)   // 新增分支忘处理 → 这里编译报错
  }
}`

const example = `// 本工程实战（SessionPage 等）：事件载荷用判别联合
// 主进程推送 { type: 'checking' } / { type: 'error', message } / { type: 'progress', percent }
// 渲染进程按 status.type 分支处理，每个分支都能安全访问对应字段`

/** 运行示例：typeof 收窄（等价 JS 行为） */
function narrowDemo(): number[] {
  const f = (input: string | number): number =>
    typeof input === 'string' ? input.length : input * 2
  return [f('hello'), f(21)]
}
</script>

<template>
  <TsPage
    title="联合类型与收窄"
    intro="联合类型（|）让'一个值可能属于几种类型'，而收窄是'如何把联合逐步缩小到具体分支'。判别联合 + 穷尽检查是 TS 项目最值钱的两个惯用法。"
  >
    <TsExample
      title="基础收窄"
      explain="typeof / in / instanceof 是三种最常用收窄手段，配合 if-else 或 switch 让类型逐步变窄。"
      :code="narrow"
      :run="narrowDemo"
      tip="收窄后 TS 会自动记住分支内的具体类型，无需再手动断言。"
    />
    <TsExample
      title="判别联合"
      explain="每个分支带一个唯一的字面量字段（status），switch 按它分发——状态机、IPC 消息、UI 状态的标准建模方式。"
      :code="discriminated"
      tip="分支字段建议用联合字面量（'idle' | 'loading' | ...）而不是 string，这样 switch 才能穷尽检查。"
    />
    <TsExample
      title="穷尽检查（never）"
      explain="default 分支调用 assertNever(state)：新增联合分支而忘记处理时，编译直接报错——防止'加字段漏改 switch'。"
      :code="exhaustive"
      pitfall="如果 default 直接 return 而不调用 assertNever，新增分支不会报错，穷尽检查就失效了。"
    />
    <TsExample
      title="实战：事件载荷"
      explain="Electron 主进程推给渲染进程的事件，几乎都适合用判别联合建模（本工程 onStatus / onDownload 等均如此）。"
      :code="example"
    />
  </TsPage>
</template>
