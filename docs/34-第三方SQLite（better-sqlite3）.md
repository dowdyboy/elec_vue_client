# 34 - 第三方 SQLite（better-sqlite3）

> 对应源码：`src/main/features/betterSqlite.ts` | 演示页：第三方 SQLite
> 对照文档：[docs/25-数据库（SQLite）](./25-数据库（SQLite）.md)

## 一、为什么还需要第三方库

内置 `node:sqlite` 是实验性 API（稳定性 1.1，含义见 docs/25 第六节）。
better-sqlite3 是 Electron/Node 生态**最成熟**的 SQLite 方案（10+ 年维护史，
Node 生态下载量前列），两者 API 风格几乎一一对应：

| 维度 | node:sqlite（内置） | better-sqlite3（第三方） |
|------|--------------------|-------------------------|
| 依赖 | 零依赖（随 Electron 捆绑 Node） | npm 原生模块 |
| API 稳定性 | 实验性（1.1） | 长期稳定 |
| 构建链路 | 无 | Electron ABI ≠ Node ABI，需重编译 |
| 打包 | 无特殊处理 | electron-builder 自动外置 .node 到 asar 外 |
| 特色功能 | 核心 CRUD / 事务 | `transaction()` 自动事务、`backup()`、自定义函数、`explain()` 查询计划 |
| 升级风险 | Electron 大版本升级时 API 可能变更 | 升级 Electron 仅需重编译（API 不变） |

**选择建议**：
- 教学/轻量/不想碰编译链路 → node:sqlite（本工程默认，零依赖）
- 生产项目重视长期稳定与功能 → better-sqlite3（社区验证最充分）

## 二、关键代码

```ts
import Database from 'better-sqlite3'

const db = new Database(join(app.getPath('userData'), 'better-demo.db'))
db.pragma('journal_mode = WAL')
db.exec('CREATE TABLE IF NOT EXISTS notes (...)')

// CRUD：与 node:sqlite 同名 API（prepare/run/get/all）
db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run('标题', '内容')
db.prepare('SELECT * FROM notes WHERE title LIKE ?').all('%关键词%')

// better-sqlite3 特色：transaction() 自动 BEGIN/COMMIT/ROLLBACK（无需手写）
const insertMany = db.transaction(() => {
  const stmt = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)')
  stmt.run('a', '1')
  stmt.run('b', '2') // 任意一行抛错 → 全部回滚
})
insertMany()
```

## 三、原生模块的编译链路（重点）

`better-sqlite3` 是 C++ 原生模块：**Node ABI ≠ Electron ABI**，直接用 npm 安装的
prebuilt 可能无法在 Electron 中加载（报 `NODE_MODULE_VERSION` 不匹配）。三种处理方式：

| 方式 | 命令 | 说明 |
|------|------|------|
| electron-builder 集成 | `electron-builder install-app-deps` | 本工程 postinstall 已自动执行（推荐） |
| electron-rebuild | `npx electron-rebuild -f -w better-sqlite3` | 手工方式 |
| prebuild 直接命中 | 无需操作 | 新版本 better-sqlite3 对 Electron ABI 也发布 prebuilt（本工程实测 v13 直接加载成功） |

验证是否可用（无需打开窗口）：

```bash
# ELECTRON_RUN_AS_NODE 用 Electron 内嵌 Node 加载模块，可快速验证 ABI
$env:ELECTRON_RUN_AS_NODE='1'; npx electron -e "require('better-sqlite3'); console.log('ok')"
```

打包：electron-builder 会自动检测 `.node` 文件并外置到 asar 之外（`app.asar.unpacked`），
无需手动配置 asarUnpack。

## 四、复制到新工程的步骤

1. 安装：`npm i better-sqlite3 && npm i -D @types/better-sqlite3`（postinstall 会自动
   按 Electron ABI 重编译）
2. 复制 `src/main/features/betterSqlite.ts`，`index.ts` 中调用 `registerBetterSqlite()`
3. 渲染进程调用 `window.api.betterDb.*`（分组与 `db` 分组并列，API 同构）

## 五、两库性能基准（演示页 ③ 卡片）

演示页提供同口径基准（单事务批量插入 + 全表 COUNT，结果在页面对比）。
**教学结论**：两者同底层 SQLite、吞吐同一量级——选型的真正依据是
"API 稳定性 / 功能丰富度 / 构建链路"，而非性能神话。
