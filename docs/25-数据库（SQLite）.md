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
