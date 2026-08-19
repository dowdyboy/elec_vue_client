<script setup lang="ts">
import TsPage from '../../components/ts/TsPage.vue'
import TsExample from '../../components/ts/TsExample.vue'

const modifiers = `// 访问修饰符：public（默认）/ private（类内）/ protected（子类可访问）
class Account {
  public readonly id: string      // 只读 + 公开
  private balance = 0             // 私有：仅类内可改
  protected owner?: string        // 子类可读

  constructor(id: string) {
    this.id = id
  }

  deposit(amount: number): void {
    this.balance += amount
  }

  getBalance(): number {
    return this.balance
  }
}

const acc = new Account('a1')
acc.deposit(100)
// acc.balance        // ❌ 私有属性不能外部访问
acc.getBalance()      // ✅`

const abstract = `// 抽象类：定义"骨架"，子类必须实现抽象成员
abstract class Storage {
  abstract read(key: string): Promise<string | null>
  abstract write(key: string, value: string): Promise<void>

  // 公共模板方法：调用抽象成员，实现复用
  async readOrDefault(key: string, fallback: string): Promise<string> {
    const v = await this.read(key)
    return v ?? fallback
  }
}

class FileStorage extends Storage {
  async read(key: string): Promise<string | null> {
    return null // 实现省略
  }
  async write(key: string, value: string): Promise<void> {
    // 实现省略
  }
}

// interface：描述"契约"，类实现它
interface Shape {
  area(): number
}
class Square implements Shape {
  constructor(private side: number) {}
  area(): number {
    return this.side ** 2
  }
}`

const paramProp = `// 参数属性简写：构造参数直接声明为成员
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}   // 自动生成 this.x / this.y
}
const p = new Point(1, 2)
p.x       // ✅

// 泛型类 + 只读 + 默认值
class Cache<T> {
  constructor(private store = new Map<string, T>()) {}
  set(k: string, v: T): void { this.store.set(k, v) }
  get(k: string): T | undefined { return this.store.get(k) }
}`

const example = `// 实战：用抽象类做"策略/骨架"，子类实现不同后端
// 本工程多处"Feature 注册"模式即：一个 registerXxx 工厂 + 复用工具函数，
// 与抽象类/接口的"契约优先"思想一致——先定义能力，再分实现。`
</script>

<template>
  <TsPage
    title="类与面向对象"
    intro="Electron 项目里类常用于领域模型、服务封装。掌握访问修饰符、抽象类、implements 与参数属性简写，就够用 90% 的场景。"
  >
    <TsExample
      title="访问修饰符与只读"
      explain="private 封装内部状态、readonly 防篡改、protected 供子类使用——'封装'的最小实践。"
      :code="modifiers"
      tip="默认 public；能用 readonly/private 的地方尽量用，防止无意修改。"
    />
    <TsExample
      title="抽象类与接口"
      explain="abstract 定义骨架（子类必须实现抽象成员）；interface 定义契约（implements 实现）。"
      :code="abstract"
      tip="抽象类可含实现（模板方法），接口纯契约。需要共享实现用抽象类，只要契约用 interface。"
    />
    <TsExample
      title="参数属性与泛型类"
      explain="constructor(public x: number) 自动生成成员；泛型类让容器类型安全。"
      :code="paramProp"
    />
    <TsExample
      title="实战：契约优先"
      explain="面向接口/抽象类设计，让调用方只依赖能力而非实现。"
      :code="example"
    />
  </TsPage>
</template>
