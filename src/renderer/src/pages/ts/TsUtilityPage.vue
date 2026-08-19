<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const builtin = `// 工具类型：内置的"类型变换函数"，都在全局可直接用
interface User {
  id: string
  name: string
  email?: string
  age?: number
}

type PartialUser = Partial<User>          // 所有属性可选
type RequiredUser = Required<User>        // 所有属性必填
type ReadonlyUser = Readonly<User>        // 所有属性只读
type Picked = Pick<User, 'id' | 'name'>   // 只留 id/name
type Omitted = Omit<User, 'email'>        // 去掉 email
type JustName = Record<'a' | 'b', string> // 键→值的映射

// 内置"状态对象"惯用法
type State = Record<'idle' | 'loading' | 'done', boolean>`

const extract = `// 从函数/对象里"提取"类型
function createUser(name: string, age: number): User {
  return { id: '1', name, age }
}
type CreateArgs = Parameters<typeof createUser>   // [name: string, age: number]
type CreatedUser = ReturnType<typeof createUser>  // User

const obj = { a: 1, b: 'x' }
type ObjKey = keyof typeof obj       // 'a' | 'b'
type ObjValues = (typeof obj)[keyof typeof obj]  // number | string

type NonNull = NonNullable<string | null | undefined>  // string
type MaybeArray = string | string[]
type Element = string                // （取联合成员的单个元素用条件类型，见下一课）`

const example = `// 实战：Omit + Pick 做"表单态"与"详情态"的派生
interface Task {
  id: string
  title: string
  done: boolean
  createdAt: number
}
// 新建任务：不需要 id/createdAt
type TaskInput = Omit<Task, 'id' | 'createdAt'>
// 更新载荷：只接受可改字段
type TaskPatch = Partial<Pick<Task, 'title' | 'done'>>`
</script>

<template>
  <TsPage
    title="工具类型"
    intro="TypeScript 内置一批'类型变换'工具：Partial/Omit/Record 等。它们不是运行时函数，而是编译期的类型操作，能大幅减少重复定义。"
  >
    <TsExample
      title="对象变换工具"
      explain="Partial/Required/Readonly/Pick/Omit/Record 覆盖了'把对象类型改一改'的绝大多数需求。"
      :code="builtin"
      tip="Record<K, V> 是'建字典'的默认首选；Omit/Pick 用于从已有类型派生新类型。"
      pitfall="Partial 只把已有属性变可选，不会新增属性。'部分可选的表单态'建议显式定义或 Record 组合。"
    />
    <TsExample
      title="提取工具"
      explain="Parameters/ReturnType 从函数类型提取参数与返回值；keyof + 索引访问从对象提取键与值类型。"
      :code="extract"
      tip="ReturnType<typeof fn> 让你不必重复写函数的返回类型——一处定义，处处提取。"
    />
    <TsExample
      title="实战：派生类型"
      explain="用 Omit/Pick/Partial 从'数据库实体'派生'输入/更新载荷'，保持单一真相源。"
      :code="example"
      tip="这是后端 DTO、表单校验、IPC 载荷建模最常见的套路。"
    />
  </TsPage>
</template>
