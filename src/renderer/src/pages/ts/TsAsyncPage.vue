<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const asyncBasics = `// async/await：让异步代码像同步一样写
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(\`/api/user/\${id}\`)
  if (!res.ok) throw new Error('请求失败: ' + res.status)
  return (await res.json()) as User   // 收窄 unknown → User
}
interface User { id: string; name: string }

// 类型：async 函数永远返回 Promise<T>
const promise: Promise<User> = fetchUser('1')`

const errors = `// 错误处理惯用法一：try/catch + 类型化错误
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function safeFetch(id: string): Promise<User | null> {
  try {
    return await fetchUser(id)
  } catch (error) {
    // error 是 unknown，用守卫收窄
    if (error instanceof ApiError) {
      console.error('API 错误', error.status)
      return null
    }
    if (error instanceof Error) console.error(error.message)
    return null
  }
}

// 惯用法二：结果对象（Go 风格），避免层层 try/catch
type Result<T> = { ok: true; value: T } | { ok: false; error: string }
async function fetchResult(id: string): Promise<Result<User>> {
  try {
    return { ok: true, value: await fetchUser(id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}`

const combos = `// 并发组合
const [a, b] = await Promise.all([p1(), p2()])      // 全部成功才继续（任一失败即 reject）
const winner = await Promise.race([p1(), timeout()]) // 谁先完成用谁
const settled = await Promise.allSettled([p1(), p2()])
// settled: PromiseSettledResult[] —— 每个都是成功/失败，不会整体 reject

// 用 allSettled 做"不因单个失败中断"的批量任务
async function loadAll(ids: string[]): Promise<User[]> {
  const results = await Promise.allSettled(ids.map(fetchUser))
  return results
    .filter((r): r is PromiseFulfilledResult<User> => r.status === 'fulfilled')
    .map((r) => r.value)
}

function timeout(ms = 3000): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), ms))
}`

const example = `// 实战：Electron IPC 也是 Promise 化
const res = await window.api.shell.openPath('C:/tmp/a.txt')
if (res.ok) console.log('已打开', res.path)
else message.error(res.error ?? '打开失败')

// 与"结果对象"惯用法一致：IPC handler 返回 { ok, ... } 判别联合`
</script>

<template>
  <TsPage
    title="异步惯用法"
    intro="async/await 之外，真正让项目好维护的是错误处理模式与并发组合：类型化错误、结果对象（Result）、allSettled 批量任务。"
  >
    <TsExample
      title="async/await 与类型"
      explain="async 函数返回 Promise<T>；await 解包；unknown 数据用断言/守卫收窄。"
      :code="asyncBasics"
      tip="fetch/axios 的返回值是 any/unknown，务必显式断言成你的类型，否则类型失效。"
    />
    <TsExample
      title="错误处理模式"
      explain="两种主流模式：try/catch + instanceof 类型化错误；以及 Result 结果对象（{ ok, value } | { ok: false, error }），避免嵌套 try/catch。"
      :code="errors"
      tip="Result 模式与本工程 IPC 的 { ok, error } 返回值一脉相承，跨语言通用。"
    />
    <TsExample
      title="并发组合"
      explain="Promise.all（全部成功）、race（谁先）、allSettled（逐个不中断），以及用 allSettled 写'批量不因单个失败中断'。"
      :code="combos"
      pitfall="Promise.all 任一 reject 会整体失败；批量加载失败容忍场景要用 allSettled。"
    />
    <TsExample
      title="实战：IPC 即 Promise"
      explain="Electron invoke 就是 Promise 化调用，天然适配 Result/错误处理模式。"
      :code="example"
    />
  </TsPage>
</template>
