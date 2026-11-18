/**
 * 为 dist-signal 生成可发布的 package.json（ESM + 类型 + CSS），并复制
 * README.md / CHANGELOG.md。库身份元数据单点维护在
 * src/components/signal/package.meta.json，本脚本只负责产物布局。
 * 由 `npm run build:signal` 在 vite/vue-tsc 之后调用。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const metaPath = fileURLToPath(
  new URL('../src/components/signal/package.meta.json', import.meta.url)
)
const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
if (!meta.name || !meta.version) {
  throw new Error(`[build:signal] package.meta.json 缺少 name/version: ${metaPath}`)
}

const signalDir = fileURLToPath(new URL('../src/components/signal/', import.meta.url))
const outDir = fileURLToPath(new URL('../dist-signal/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const pkg = {
  name: meta.name,
  version: meta.version,
  description: meta.description,
  type: 'module',
  main: './signal-charts.js',
  module: './signal-charts.js',
  types: './types/index.d.ts',
  exports: {
    '.': {
      types: './types/index.d.ts',
      import: './signal-charts.js'
    },
    './style.css': './signal-charts.css',
    './package.json': './package.json'
  },
  files: ['signal-charts.js', 'signal-charts.css', 'types', 'README.md', 'CHANGELOG.md'],
  sideEffects: ['./signal-charts.css'],
  peerDependencies: meta.peerDependencies,
  keywords: meta.keywords
}

const out = join(outDir, 'package.json')
writeFileSync(out, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
for (const name of ['README.md', 'CHANGELOG.md']) {
  copyFileSync(join(signalDir, name), join(outDir, name))
}
console.log(`[build:signal] wrote ${out} (${pkg.name}@${pkg.version})`)
console.log('[build:signal] copied README.md, CHANGELOG.md')
