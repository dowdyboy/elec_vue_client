/**
 * 【特性】第三方 SQLite（better-sqlite3 —— Electron 生态最流行的 SQLite 库）
 * 【API】better-sqlite3
 * 【复制】1. 安装依赖：npm i better-sqlite3 && npm i -D @types/better-sqlite3
 *            （原生模块需针对 Electron ABI 重编译：本工程 postinstall 的
 *            electron-builder install-app-deps 已自动处理；手工方式 npx electron-rebuild）
 *         2. 复制本文件到新工程 src/main/features/betterSqlite.ts
 *         3. 在 index.ts 中调用 registerBetterSqlite()
 *         4. 渲染进程调用 window.api.betterDb.*
 * 【说明】与内置 node:sqlite（docs/25）的对比教学，见 docs/34：
 *         - node:sqlite：Node 22+ 内置、零依赖，但实验性 API（启动会打印
 *           ExperimentalWarning，本工程选择保留该警告，含义见 docs/25）
 *         - better-sqlite3：第三方原生模块，API 长期稳定、功能丰富
 *           （transaction() 自动事务包装、自定义函数、backup 等），
 *           代价是原生编译链路：Electron ABI ≠ Node ABI，升级 Electron 需重编译；
 *           打包时 electron-builder 会自动把 .node 文件外置到 asar 之外
 *         - 两者 API 风格几乎一一对应（prepare/run/get/all 同名），迁移成本低
 *         本模块演示：独立 db 文件（better-demo.db）+ 同结构 CRUD + 注入对比 +
 *         事务（better-sqlite3 特色的 transaction() 包装）+ 性能基准（与 sqlite.ts
 *         的 db:benchmark 同口径，见"第三方 SQLite"页的对比按钮）
 */

import Database from 'better-sqlite3'
import { app, ipcMain } from 'electron'
import { join } from 'path'

/** 数据库实例（模块级单例） */
let db: Database.Database | null = null

export function registerBetterSqlite(): void {
  // ── 初始化：独立数据文件（与 node:sqlite 的 app.db 分离，互不干扰）──
  const dbPath = join(app.getPath('userData'), 'better-demo.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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
  ipcMain.handle('betterDb:list', () => {
    return db!.prepare('SELECT * FROM notes ORDER BY id DESC').all()
  })

  ipcMain.handle('betterDb:add', (_e, note: { title: string; content: string }) => {
    const result = db!
      .prepare('INSERT INTO notes (title, content) VALUES (?, ?)')
      .run(note.title, note.content)
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('betterDb:update', (_e, note: { id: number; title: string; content: string }) => {
    db!
      .prepare('UPDATE notes SET title = ?, content = ? WHERE id = ?')
      .run(note.title, note.content, note.id)
    return true
  })

  ipcMain.handle('betterDb:delete', (_e, id: number) => {
    db!.prepare('DELETE FROM notes WHERE id = ?').run(id)
    return true
  })

  // ── ② 搜索（注入对比：safe 参数化 vs unsafe 字符串拼接）──
  ipcMain.handle('betterDb:search', (_e, keyword: string, safe: boolean) => {
    if (safe) {
      return db!.prepare('SELECT * FROM notes WHERE title LIKE ?').all(`%${keyword}%`)
    }
    // ❌ 错误示范：字符串拼接（输入 ' OR '1'='1 即可绕过条件查询全部数据）
    return db!.prepare(`SELECT * FROM notes WHERE title LIKE '%${keyword}%'`).all()
  })

  // ── ③ 事务演示：better-sqlite3 特色 transaction() 自动包装 BEGIN/COMMIT/ROLLBACK ──
  ipcMain.handle('betterDb:transaction', () => {
    // transaction() 返回一个函数：执行过程异常时自动 ROLLBACK（无需手写 BEGIN/COMMIT）
    const insertMany = db!.transaction(() => {
      const stmt = db!.prepare('INSERT INTO notes (title, content) VALUES (?, ?)')
      stmt.run('事务记录 1', '批量插入第 1 条')
      stmt.run('事务记录 2', '批量插入第 2 条')
      stmt.run('事务记录 3', '批量插入第 3 条')
    })
    try {
      insertMany()
      return { ok: true, inserted: 3 }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── ④ 数据库信息 ──
  ipcMain.handle('betterDb:info', () => {
    const tables = db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const count = db!.prepare('SELECT COUNT(*) AS total FROM notes').get() as { total: number }
    return { dbPath, tables: tables.map((t) => t.name), total: count.total }
  })

  // ── ⑤ 性能基准（与 sqlite.ts 的 db:benchmark 同口径，供页面两库对比）──
  ipcMain.handle('betterDb:benchmark', (_e, rows: number) => {
    const n = Math.min(50000, Math.max(1, Math.floor(rows) || 1000))
    db!.exec('DELETE FROM bench')
    const stmt = db!.prepare('INSERT INTO bench (title, content, n) VALUES (?, ?, ?)')
    // better-sqlite3 同样推荐单事务批量写入（其 transaction() 包装可复用）
    const insertMany = db!.transaction(() => {
      for (let i = 0; i < n; i++) stmt.run(`记录 ${i}`, `内容 ${i}`, i)
    })
    const t0 = process.hrtime.bigint()
    insertMany()
    const t1 = process.hrtime.bigint()
    const result = db!.prepare('SELECT COUNT(*) AS c FROM bench').get() as { c: number }
    const t2 = process.hrtime.bigint()
    return {
      engine: 'better-sqlite3',
      rows: n,
      insertMs: Number(t1 - t0) / 1e6,
      queryMs: Number(t2 - t1) / 1e6,
      total: Number(result.c)
    }
  })
}
