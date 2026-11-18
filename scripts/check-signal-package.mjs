/**
 * 校验 dist-signal 发布产物完整性（在 `npm run build:signal` 之后运行）：
 *   node scripts/check-signal-package.mjs          # 结构 / 元数据 / 入口文件
 *   node scripts/check-signal-package.mjs --pack   # 额外用 npm pack --dry-run --json 校验包内容
 *
 * 退出码：0 = 通过；1 = 有缺失或不一致（逐项列出）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(root, 'dist-signal')
const metaPath = join(root, 'src/components/signal/package.meta.json')
const withPack = process.argv.includes('--pack')

const problems = []
const fail = (message) => problems.push(message)

function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`${label} 不存在: ${path}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    fail(`${label} 不是合法 JSON: ${err.message}`)
    return null
  }
}

function requireFile(relPath, label = relPath) {
  const rel = relPath.replace(/^\.\//, '')
  const abs = join(distDir, rel)
  if (!existsSync(abs)) {
    fail(`缺少文件: ${label} (${rel})`)
    return
  }
  if (!statSync(abs).isFile()) fail(`不是普通文件: ${label} (${rel})`)
}

function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

if (!existsSync(distDir)) {
  console.error('[check:signal] dist-signal 不存在，请先运行 `npm run build:signal`')
  process.exit(1)
}

// ── package.json 与 meta 一致性 ──
const pkg = readJson(join(distDir, 'package.json'), 'dist-signal/package.json')
const meta = readJson(metaPath, 'src/components/signal/package.meta.json')

if (pkg && meta) {
  if (pkg.name !== meta.name) fail(`name 不一致: package.json=${pkg.name} meta=${meta.name}`)
  if (pkg.version !== meta.version)
    fail(`version 不一致: package.json=${pkg.version} meta=${meta.version}`)
  if (pkg.description !== meta.description) fail('description 与 package.meta.json 不一致')
  if (JSON.stringify(pkg.keywords) !== JSON.stringify(meta.keywords))
    fail('keywords 与 package.meta.json 不一致')
  if (JSON.stringify(pkg.peerDependencies) !== JSON.stringify(meta.peerDependencies))
    fail('peerDependencies 与 package.meta.json 不一致')

  // 运行时版本常量必须与 meta 同步（否则 npm 包版本与 SIGNAL_CHARTS_VERSION 名实不符）
  const indexTsPath = join(root, 'src/components/signal/index.ts')
  if (!existsSync(indexTsPath)) {
    fail('缺少 src/components/signal/index.ts')
  } else {
    const source = readFileSync(indexTsPath, 'utf8')
    const match = /SIGNAL_CHARTS_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(source)
    if (!match) fail('index.ts 缺少 SIGNAL_CHARTS_VERSION')
    else if (match[1] !== meta.version)
      fail(`运行时版本常量不一致: index.ts=${match[1]} meta=${meta.version}`)
  }

  // ── 入口指向的文件必须存在 ──
  const entries = [
    ['main', pkg.main],
    ['module', pkg.module],
    ['types', pkg.types],
    ["exports['.'].types", pkg.exports?.['.']?.types],
    ["exports['.'].import", pkg.exports?.['.']?.import],
    ["exports['./style.css']", pkg.exports?.['./style.css']],
    ["exports['./package.json']", pkg.exports?.['./package.json']]
  ]
  for (const [label, rel] of entries) {
    if (!rel) fail(`package.json 缺少 ${label}`)
    else requireFile(rel, label)
  }

  // ── files 字段必须覆盖发布产物 ──
  if (!Array.isArray(pkg.files)) {
    fail('package.json 缺少 files 数组')
  } else {
    for (const entry of pkg.files) {
      if (!existsSync(join(distDir, entry))) fail(`files 中的路径不存在: ${entry}`)
    }
    for (const name of ['README.md', 'CHANGELOG.md']) {
      if (!pkg.files.includes(name)) fail(`files 未包含 ${name}（npm 发布包会缺少）`)
    }
  }

  // ── sideEffects 必须指向存在的 CSS ──
  if (!Array.isArray(pkg.sideEffects) || !pkg.sideEffects.includes('./signal-charts.css')) {
    fail('package.json 的 sideEffects 未指向 ./signal-charts.css')
  }
}

// ── 必需产物 ──
for (const name of [
  'signal-charts.js',
  'signal-charts.css',
  'README.md',
  'CHANGELOG.md',
  'types/index.d.ts'
]) {
  requireFile(name)
}

// ── 可选：npm pack 包内容校验 ──
if (withPack && problems.length === 0) {
  // Windows 不能直接 spawn npm.cmd（EINVAL）；用静态命令字符串交给 shell，
  // 命令不含外部输入，避免把参数拼进 shell（Node DEP0190）。
  const res = spawnSync('npm pack --dry-run --json', {
    cwd: distDir,
    encoding: 'utf8',
    shell: true
  })
  if (res.error) {
    fail(`无法执行 npm pack: ${res.error.message}`)
  } else if (res.status !== 0) {
    fail(`npm pack --dry-run 失败 (exit ${res.status}): ${(res.stderr || '').trim()}`)
  } else {
    let packed = null
    try {
      const parsed = JSON.parse(res.stdout)
      packed = Array.isArray(parsed) ? parsed[0] : parsed
    } catch (err) {
      fail(`npm pack 输出不是合法 JSON: ${err.message}`)
    }
    if (packed && Array.isArray(packed.files)) {
      const names = new Set(packed.files.map((f) => f.path))
      for (const name of [
        'package.json',
        'signal-charts.js',
        'signal-charts.css',
        'types/index.d.ts',
        'README.md',
        'CHANGELOG.md'
      ]) {
        if (!names.has(name)) fail(`npm pack 产物缺少 ${name}`)
      }
      console.log(
        `[check:signal] npm pack: ${packed.files.length} 个文件, ${packed.unpackedSize ?? 0} bytes (unpacked)`
      )
    } else if (packed) {
      fail('npm pack 输出缺少 files 列表')
    }
  }
}

if (problems.length > 0) {
  console.error(`[check:signal] 校验失败（${problems.length} 项）:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const files = walk(distDir)
const bytes = files.reduce((sum, rel) => sum + statSync(join(distDir, rel)).size, 0)
const kib = (bytes / 1024).toFixed(1)
console.log(`[check:signal] 通过: ${pkg.name}@${pkg.version} (meta 一致)`)
console.log(`[check:signal] 入口/必需产物齐全, 共 ${files.length} 个文件 / ${kib} KiB`)
