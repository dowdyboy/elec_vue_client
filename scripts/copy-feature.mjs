/**
 * 轻量复用脚本：复制单个特性到新工程
 * 用法：
 *   node scripts/copy-feature.mjs clipboard            # 复制到 ../new-app （默认）
 *   node scripts/copy-feature.mjs clipboard D:\path\to\new-app
 *   node scripts/copy-feature.mjs --list               # 列出可用特性
 *   node scripts/copy-feature.mjs --help
 *
 * 行为：
 *   - 从 src/main/features/<name>.ts 复制到 <dest>/src/main/features/<name>.ts
 *   - 从 src/preload/index.ts 抽取对应分组（按注释 "-- <name> --" 匹配）提示用户手动粘贴
 *   - 提示在新工程 index.ts 中添加 register 调用
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const root = resolve(dirname(__filename), '..')

function getArg(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function listFeatures() {
  const dir = join(root, 'src/main/features')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  return files.map((f) => f.replace(/\.ts$/, '')).sort()
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
const destRoot = resolve(root, destArg)

// 1. 校验源文件
const srcFile = join(root, `src/main/features/${feature}.ts`)
if (!existsSync(srcFile)) {
  console.error(`未找到特性: ${feature} -> ${srcFile}`)
  console.log('可用:', listFeatures().join(', '))
  process.exit(1)
}

// 2. 复制主进程文件
const destFeatureDir = join(destRoot, 'src/main/features')
mkdirSync(destFeatureDir, { recursive: true })
const destFile = join(destFeatureDir, `${feature}.ts`)
cpSync(srcFile, destFile)
console.log(`✓ 已复制: src/main/features/${feature}.ts -> ${destFile}`)

// 3. 提示 preload 片段
const preloadPath = join(root, 'src/preload/index.ts')
const preload = readFileSync(preloadPath, 'utf8')
// 简单按 feature 名匹配分组注释（容错：大小写/连字符）
const keywords = [feature, feature.replace(/-/g, '')]
let hint = ''
for (const kw of keywords) {
  const re = new RegExp(`//.*${kw}|/\\*.*${kw}.*\\*/|${kw}:\\s*\\{`, 'i')
  if (re.test(preload.toLowerCase())) {
    hint = kw
    break
  }
}
if (hint) {
  console.log(`\n提示: 请在目标工程 src/preload/index.ts 中，`)
  console.log(
    `  从本项目 src/preload/index.ts 复制与 "${feature}" 相关的 api 分组到 window.api 中，`
  )
  console.log(`  并在目标工程 src/preload/index.d.ts 补充类型（如需）。`)
  console.log(`  可搜索关键词: "${hint}" 定位分组。`)
} else {
  console.log(
    `\n提示: 未自动定位到 preload 分组，请在 src/preload/index.ts 中搜索 "${feature}" 手动复制对应 api 分组。`
  )
}

// 4. 提示 index.ts 注册
console.log(`\n下一步: 在目标工程 src/main/index.ts 中添加:`)
console.log(
  `  import { register${feature[0].toUpperCase()}${feature.slice(1)} } from './features/${feature}'`
)
console.log(`  // 并在 app.whenReady 内调用 register... (参考本项目 src/main/index.ts 注册表)`)

// 5. 额外依赖提示（部分特性）
const extraTips = {
  betterSqlite:
    '  需安装 better-sqlite3 并执行 electron-builder install-app-deps / electron-rebuild',
  socketServer: '  需安装 socket.io',
  network: '  需安装 axios',
  autoUpdater: '  需安装 electron-updater 并配置 publish'
}
if (extraTips[feature]) {
  console.log(`\n依赖提示:${extraTips[feature]}`)
}

console.log(`\n完成。目标目录: ${destRoot}`)
