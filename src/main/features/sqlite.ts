/**
 * 【特性】SQLite 数据库（node:sqlite —— Node.js 内置模块，零依赖）
 * 【API】node:sqlite（DatabaseSync）
 * 【复制】1. 复制本文件到新工程 src/main/features/sqlite.ts
 *         2. 在 index.ts 中调用 registerSqlite()
 *         3. 渲染进程调用 window.api.db.*
 * 【说明】Node 22.13+ 内置 node:sqlite（Electron 39 自带 Node 22.20 ✓），
 *         与 better-sqlite3 同底层 SQLite，同步 API 风格一致，无需编译。
 *         生产工程若需更成熟生态（插件/文档），可迁移 better-sqlite3
 *         （API 几乎一一对应），见 docs/25。
 *         教学重点：
 *         - 参数化查询（? 占位）防 SQL 注入 —— 见 db:search 的 safe/unsafe 对比
 *         - 事务（BEGIN/COMMIT/ROLLBACK）保证原子性 —— 见 db:transaction
 *         - 数据文件位于 userData/app.db（应用私有数据目录）
 */

import { DatabaseSync } from 'node:sqlite'
import { app, ipcMain } from 'electron'
import { join } from 'path'

/** 数据库实例（模块级单例） */
let db: DatabaseSync | null = null

/**
 * 启动兼容性自检：node:sqlite 是实验性 API（Node 22 稳定性 1.1），
 * 未来升级 Electron（捆绑新 Node 版本）时 API 可能变更。这里把"运行期摸不着
 * 头脑的 TypeError"变成可操作的失败指引（对照 docs/25 升级检查清单）。
 */
function assertSqliteApi(): void {
  const problems: string[] = []
  if (typeof DatabaseSync !== 'function') problems.push('DatabaseSync 类不存在')
  for (const method of ['prepare', 'exec', 'close'] as const) {
    if (typeof DatabaseSync.prototype[method] !== 'function') {
      problems.push(`DatabaseSync.${method} 方法不存在`)
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `node:sqlite API 与预期不符（${problems.join('；')}）。` +
        '当前 Electron 捆绑的 Node 版本可能已变更实验性 sqlite API，' +
        '请按 docs/25「升级检查清单」处理。'
    )
  }
}

export function registerSqlite(): void {
  assertSqliteApi()

  // ── 初始化：打开数据库 + WAL 模式 + 建示例表 ──
  const dbPath = join(app.getPath('userData'), 'app.db')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL') // WAL：读写并发性能好
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)
  // 性能基准专用表（独立于 notes，避免污染演示数据）
  db.exec(
    'CREATE TABLE IF NOT EXISTS bench (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, n INTEGER)'
  )

  // 退出前关闭数据库（WAL 模式更规范；进程退出也会自动释放）
  app.on('before-quit', () => {
    db?.close()
    db = null
  })

  // ── ① 笔记 CRUD（全部参数化查询，防注入）──
  ipcMain.handle('db:list', () => {
    return db!.prepare('SELECT * FROM notes ORDER BY id DESC').all()
  })

  ipcMain.handle('db:add', (_e, note: { title: string; content: string }) => {
    const result = db!
      .prepare('INSERT INTO notes (title, content) VALUES (?, ?)')
      .run(note.title, note.content)
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('db:update', (_e, note: { id: number; title: string; content: string }) => {
    db!
      .prepare('UPDATE notes SET title = ?, content = ? WHERE id = ?')
      .run(note.title, note.content, note.id)
    return true
  })

  ipcMain.handle('db:delete', (_e, id: number) => {
    db!.prepare('DELETE FROM notes WHERE id = ?').run(id)
    return true
  })

  // ── ② SQL 执行器（教学实验区，拦截危险语句）──
  ipcMain.handle('db:execute', (_e, sql: string) => {
    const trimmed = sql.trim()
    if (!/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(trimmed)) {
      return { ok: false, error: '仅允许 SELECT / INSERT / UPDATE / DELETE（防止误操作）' }
    }
    try {
      const stmt = db!.prepare(trimmed)
      if (/^SELECT\b/i.test(trimmed)) {
        return { ok: true, rows: stmt.all() }
      }
      const result = stmt.run()
      return {
        ok: true,
        // dangerous: 写操作会修改数据，渲染进程需二次确认
        dangerous: true,
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid)
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── ③ 事务演示：批量插入要么全部成功，要么全部回滚 ──
  ipcMain.handle('db:transaction', () => {
    db!.exec('BEGIN')
    try {
      const stmt = db!.prepare('INSERT INTO notes (title, content) VALUES (?, ?)')
      stmt.run('事务记录 1', '批量插入第 1 条')
      stmt.run('事务记录 2', '批量插入第 2 条')
      stmt.run('事务记录 3', '批量插入第 3 条')
      db!.exec('COMMIT')
      return { ok: true, inserted: 3 }
    } catch (error) {
      db!.exec('ROLLBACK')
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── ④ 搜索（注入对比：safe 参数化 vs unsafe 字符串拼接）──
  ipcMain.handle('db:search', (_e, keyword: string, safe: boolean) => {
    if (safe) {
      // ✅ 正确：参数化查询，? 占位由 SQLite 转义
      return db!.prepare('SELECT * FROM notes WHERE title LIKE ?').all(`%${keyword}%`)
    }
    // ❌ 错误示范：字符串拼接（教学演示 SQL 注入漏洞）
    // 输入 ' OR '1'='1 即可绕过条件查询全部数据
    return db!.prepare(`SELECT * FROM notes WHERE title LIKE '%${keyword}%'`).all()
  })

  // ── ⑤ 数据库信息 ──
  ipcMain.handle('db:info', () => {
    const tables = db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const count = db!.prepare('SELECT COUNT(*) AS total FROM notes').get() as { total: number }
    return { dbPath, tables: tables.map((t) => t.name), total: count.total }
  })

  // ── ⑥ 性能基准（与 betterSqlite.ts 的同名基准对比，见"第三方 SQLite"页）──
  ipcMain.handle('db:benchmark', (_e, rows: number) => {
    const n = Math.min(50000, Math.max(1, Math.floor(rows) || 1000))
    db!.exec('DELETE FROM bench')
    const stmt = db!.prepare('INSERT INTO bench (title, content, n) VALUES (?, ?, ?)')
    // 单事务批量插入计时（事务是批量写入性能的关键）
    db!.exec('BEGIN')
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < n; i++) stmt.run(`记录 ${i}`, `内容 ${i}`, i)
    db!.exec('COMMIT')
    const t1 = process.hrtime.bigint()
    // 全表聚合查询计时
    const result = db!.prepare('SELECT COUNT(*) AS c FROM bench').get() as { c: number }
    const t2 = process.hrtime.bigint()
    return {
      engine: 'node:sqlite',
      rows: n,
      insertMs: Number(t1 - t0) / 1e6,
      queryMs: Number(t2 - t1) / 1e6,
      total: Number(result.c)
    }
  })
}
