# 25 - SQLite 数据库（node:sqlite）

> 对应源码：`src/main/features/sqlite.ts` | 演示页：SQLite 数据库

## 一、方案选择：node:sqlite（零依赖）

| 方案 | 依赖 | 编译 | 说明 |
|------|------|:---:|------|
| **node:sqlite**（本工程采用） | 无 | 无 | Node 22.13+ 内置（Electron 39 = Node 22.20 ✓），真实 SQLite |
| better-sqlite3 | 原生模块 | 需要 | 生产主流，API 几乎与 node:sqlite 一一对应，可平滑迁移 |
| sql.js | WASM | 无 | 数据需手动持久化，性能差，仅特殊场景 |

**迁移到 better-sqlite3**（生产工程常用，仅 3 处差异）：

```ts
// 安装: npm i better-sqlite3（需编译工具链，或使用其 prebuilt）
import Database from 'better-sqlite3'
const db = new Database(path)
// node:sqlite  →  better-sqlite3
// new DatabaseSync(path)  →  new Database(path)
// stmt.run/get/all       →  相同
// result.lastInsertRowid →  相同（bigint 需转换）
```

## 二、关键代码

```ts
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(join(app.getPath('userData'), 'app.db'))
db.exec('PRAGMA journal_mode = WAL') // WAL：读写并发性能好
db.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, ...)')

// 参数化查询（✅ 防注入）
db.prepare('INSERT INTO notes (title) VALUES (?)').run('标题')
db.prepare('SELECT * FROM notes WHERE title LIKE ?').all('%关键词%')

// 事务：原子性（要么全成功，要么全回滚）
db.exec('BEGIN')
try {
  // ... 多条写入
  db.exec('COMMIT')
} catch {
  db.exec('ROLLBACK')
}
```

## 三、复制到新工程的步骤

1. 复制 `src/main/features/sqlite.ts`（**无需安装任何依赖**）
2. `index.ts` 中调用 `registerSqlite()`
3. 渲染进程：

```ts
const notes = await window.api.db.list()
await window.api.db.add({ title: '标题', content: '内容' })
await window.api.db.remove(1)
const res = await window.api.db.execute('SELECT * FROM notes')
await window.api.db.transaction() // 批量插入演示
```

## 四、安全要点：SQL 注入

**永远使用参数化查询（`?` 占位）**，不要字符串拼接：

```ts
// ❌ 漏洞：输入 ' OR '1'='1 可绕过条件查询全部数据
db.prepare(`SELECT * FROM notes WHERE title LIKE '%${keyword}%'`)
// ✅ 安全：占位符由 SQLite 转义
db.prepare('SELECT * FROM notes WHERE title LIKE ?').all(`%${keyword}%`)
```

本工程演示页 ③ 可实际操作注入效果。**任何来自渲染进程的输入拼进 SQL 都是高危漏洞**。

## 五、最佳实践

- **数据位置**：永远放 `app.getPath('userData')`（应用私有目录，卸载时清理）
- **渲染进程隔离**：渲染进程无 Node 能力，SQL 操作统一经 IPC 走主进程（本工程模式）
- **执行器限制**：生产环境的"SQL 执行器"应进一步限制（只读、白名单表），本工程演示了语句类型拦截
- **备份**：定期 `VACUUM INTO` 或直接复制 .db 文件（WAL 模式需同时复制 -wal 文件）
- **数据库关闭**：应用退出前 `db.close()`（可选，进程退出自动清理）

## 六、关于 ExperimentalWarning（本工程实测确认）

启动时打印的 `ExperimentalWarning: SQLite is an experimental feature...` 是**预期行为**：

- node:sqlite 在 Node 22 的稳定性为 **1.1（Active development）**——含义是"未来版本
  API 可能变更/移除"，**不表示当前不可用**（Electron 39 上 CRUD 等核心 API 工作正常）
- **关键区别**：纯 Node 项目里用户机器 Node 版本各异，实验性 API 确实可能"环境不一致"；
  但 Electron **把 Node 版本捆绑进安装包**——Electron 39.x 固定捆绑 Node 22.20，
  所有机器运行的是同一个 node:sqlite，不存在运行期跨环境不一致
- **真实风险只在升级时**：升级 Electron 大版本（捆绑新 Node）时，sqlite API 可能有
  破坏性变更 → 按下方清单回归即可
- 本工程**选择保留警告**（不静默过滤）：警告是实验性 API 的诚实提示，
  配合 sqlite.ts 的启动兼容性自检（`assertSqliteApi`：关键 API 缺失时给出
  "对照升级检查清单"的可操作错误），比隐藏警告更利于教学与排障

## 七、升级检查清单（升级 Electron 大版本时执行）

1. `npm run typecheck`——API 签名变更会直接报错
2. 运行应用 → SQLite 数据库页：CRUD / 事务 / 注入对比全流程演练
3. 对照 Node changelog 的 `node:sqlite` 变更记录（如
   https://nodejs.org/en/download/releases 各版本的 sqlite 条目），确认
   本工程用到的 API（prepare/run/get/all/exec/close）无破坏性调整
4. 若 API 已变更：按报错信息调整 sqlite.ts；或此时再评估迁移 better-sqlite3
   （见 [docs/34-第三方SQLite](./34-第三方SQLite（better-sqlite3）.md)）

> 提示：`sqlite.ts` 的 `assertSqliteApi()` 自检会把"API 不匹配"转化为启动时的
> 明确错误（含上述指引），而不是运行到一半的 TypeError。
