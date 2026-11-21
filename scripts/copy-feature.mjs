/**
 * 轻量复用脚本：复制单个特性到新工程
 * 用法：
 *   node scripts/copy-feature.mjs clipboard            # 复制到 ../new-app （默认）
 *   node scripts/copy-feature.mjs clipboard D:\path\to\new-app
 *   node scripts/copy-feature.mjs --list               # 列出可用特性
 *   node scripts/copy-feature.mjs --help
 *
 * 行为：
 *   - 复制 src/main/features/<name>.ts
 *   - 按源码里的 import 自动补带依赖文件：
 *       ../types              → src/main/types.ts（MainWindowGetter）
 *       ../utils/validateSender → src/main/utils/validateSender.ts（敏感通道校验）
 *   - 从源码解析真实的 register 函数名与参数（不再用"首字母大写"猜，
 *     否则 socket.ts / splash.ts 这类会生成错误导入名）
 *   - 打印可直接粘贴的 index.ts 注册代码
 *   - 提示 preload 中对应的 api 分组关键词（需手工粘贴）
 *
 * 不复制：preload 分组（各工程 window.api 结构不同，脚本只给定位提示）
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const root = resolve(dirname(__filename), '..')

/** 特性源文件里 import 的本地相对模块 → 需要一并复制的工程内文件 */
const DEP_FILES = {
  '../types': { from: 'src/main/types.ts', to: 'src/main/types.ts', why: 'MainWindowGetter 类型' },
  '../utils/validateSender': {
    from: 'src/main/utils/validateSender.ts',
    to: 'src/main/utils/validateSender.ts',
    why: '敏感 IPC 通道的发送方校验'
  },
  '../utils/disposable': {
    from: 'src/main/utils/disposable.ts',
    to: 'src/main/utils/disposable.ts',
    why: 'Disposer 资源释放约定'
  }
}

/** 只能在"整套一起复制"时才成立的依赖：只说清楚，不自动拷 */
const COUPLED_DEPS = {
  './windowManager': 'windowManager.ts（含 loadRenderer 与 MainWindowGetter 依赖）',
  './security': 'security.ts（含权限白名单；内嵌网页还要 registerDenyAllForSession）'
}

function listFeatures() {
  const dir = join(root, 'src/main/features')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
}

/** 解析 register 函数名与参数名（参数名用于生成调用示例） */
function parseRegister(source) {
  const m = /export function (register[A-Za-z0-9_]+)\s*\(([^)]*)\)/.exec(source)
  if (!m) return null
  const params = m[2]
    .split(',')
    .map((s) => s.trim().split(':')[0].split('=')[0].trim())
    .filter(Boolean)
  return { name: m[1], params }
}

/** 源文件 import 的本地相对模块列表 */
function localDeps(source) {
  return [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
用法: node scripts/copy-feature.mjs <feature> [dest]

  <feature>  特性名，如 clipboard / dialog / sqlite（不含 .ts）
  [dest]     目标工程根目录（默认 ../new-app，相对于本项目根）
  --list     列出所有可用特性
  --help     显示帮助

示例:
  node scripts/copy-feature.mjs clipboard
  node scripts/copy-feature.mjs windowManager D:\\my-app
`)
  process.exit(0)
}

if (process.argv.includes('--list')) {
  console.log('可用特性:')
  for (const f of listFeatures()) console.log('  -', f)
  process.exit(0)
}

const feature = process.argv[2]
if (!feature || feature.startsWith('-')) {
  console.error('请指定特性名。可用 --list 查看。例: node scripts/copy-feature.mjs clipboard')
  process.exit(1)
}

const destArg = process.argv[3] ?? '../new-app'
const destRoot = isAbsolute(destArg) ? destArg : resolve(root, destArg)

// ── 1. 校验源文件 ──
const srcFile = join(root, `src/main/features/${feature}.ts`)
const src = existsSync(srcFile) ? readFileSync(srcFile, 'utf8') : null
if (!src) {
  console.error(`未找到特性: ${feature} -> ${srcFile}`)
  console.log('可用:', listFeatures().join(', '))
  process.exit(1)
}

// 防呆：目标目录不能是项目自己（否则自我覆盖）
if (resolve(destRoot) === resolve(root)) {
  console.error('目标目录不能是本项目自身')
  process.exit(1)
}

const reg = parseRegister(src)
if (!reg) {
  console.error(`解析失败: ${feature}.ts 里没有找到 export function registerXxx(...)`)
  process.exit(1)
}

// ── 2. 复制主进程文件 + 它真正依赖的辅助文件 ──
const destFeatureDir = join(destRoot, 'src/main/features')
mkdirSync(destFeatureDir, { recursive: true })
cpSync(srcFile, join(destFeatureDir, `${feature}.ts`))
console.log(`✓ src/main/features/${feature}.ts`)

const copied = new Set()
const coupled = []
for (const dep of new Set(localDeps(src))) {
  if (DEP_FILES[dep]) {
    const meta = DEP_FILES[dep]
    const srcDep = join(root, meta.from)
    if (!existsSync(srcDep)) continue
    if (copied.has(meta.to)) continue
    const destDep = join(destRoot, meta.to)
    mkdirSync(dirname(destDep), { recursive: true })
    cpSync(srcDep, destDep)
    copied.add(meta.to)
    console.log(`✓ ${meta.to}   ← ${feature}.ts 依赖：${meta.why}`)
  } else if (COUPLED_DEPS[dep]) {
    coupled.push(COUPLED_DEPS[dep])
  }
}

// ── 3. 打印可直接粘贴的注册代码（用解析出的真实函数名与参数） ──
const callArgs = reg.params.length > 0 ? 'getMainWindow' : ''
console.log(`\n在目标工程 src/main/index.ts 中添加：`)
console.log(`  import { ${reg.name} } from './features/${feature}'`)
console.log(`  // app.whenReady() 内：`)
console.log(`  ${reg.name}(${callArgs})`)

// ── 4. 提示 preload 分组（不自动复制，各工程 window.api 结构不同） ──
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
const keyword = new RegExp(`^\\s{0,2}${feature}:\\s*\\{`, 'm').test(preload)
  ? feature
  : [feature, feature.replace(/-/g, '')].find((kw) =>
      new RegExp(`//.*${kw}|/\\*.*${kw}.*\\*/`, 'i').test(preload)
    )
if (keyword) {
  console.log(`\n渲染进程侧（可选）：在目标工程 src/preload/index.ts 中搜索 "${keyword}"，`)
  console.log(`  复制对应 api 分组到 window.api（本工程的 preload 是白名单式，按分组搬运即可）。`)
} else {
  console.log(
    `\n渲染进程侧（可选）：src/preload/index.ts 中未找到 "${feature}" 分组，该特性可能只由主进程使用。`
  )
}

// ── 5. 额外依赖提示 ──
const extraTips = {
  betterSqlite: 'better-sqlite3 + @types/better-sqlite3，并执行 electron-builder install-app-deps',
  socketServer: 'socket.io',
  network: 'axios（或改用 Electron net.request）',
  autoUpdater: 'electron-updater，并在 electron-builder.yml 配置 publish'
}
if (extraTips[feature]) console.log(`\n额外依赖：${extraTips[feature]}`)

// ── 6. 需要整套一起复制的耦合提示 ──
if (coupled.length > 0) {
  console.log(`\n⚠ 该特性还依赖同目录模块，需一并复制：`)
  for (const c of coupled) console.log(`  - ${c}`)
}

// ── 7. 目标工程项目检查（尽力而为，不阻断） ──
// 注意：Windows 上手工保存的 package.json 可能带 BOM，直接 JSON.parse 会抛错
function readPackageJson(file) {
  try {
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text)
  } catch {
    return null
  }
}

const destPackage = join(destRoot, 'package.json')
if (existsSync(destPackage)) {
  const pkg = readPackageJson(destPackage)
  if (pkg && !pkg.devDependencies?.electron && !pkg.dependencies?.electron) {
    console.log('\n提示：目标工程 package.json 里没有 electron 依赖，注意补上。')
  }
} else {
  console.log(`\n提示：${destRoot} 下没有 package.json，确认这是工程根目录。`)
}

console.log(
  `\n完成。已复制 ${copied.size + 1} 个文件到 ${relative(process.cwd(), destRoot) || '.'}`
)
