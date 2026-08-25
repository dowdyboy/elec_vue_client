/**
 * 拷贝信号组件到他项目（轻量复用，拷贝即用）
 * 用法：
 *   node scripts/copy-signal.mjs ../other-app                 # 拷贝全部 4 组件 + core
 *   node scripts/copy-signal.mjs --list
 *   node scripts/copy-signal.mjs --help
 */
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const root = resolve(dirname(__filename), '..')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
用法: node scripts/copy-signal.mjs [dest]

  [dest]  目标项目根目录（默认 ../other-app）
  --list  列出可拷贝文件
  --help  帮助

示例:
  node scripts/copy-signal.mjs ../my-electron-app
  node scripts/copy-signal.mjs "D:\\my-app"
`)
  process.exit(0)
}

if (process.argv.includes('--list')) {
  // 递归列出（含 core/ 与 composables/ 子目录）
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), prefix + entry.name + '/')
      else console.log(' ', prefix + entry.name)
    }
  }
  console.log('可拷贝:')
  walk(join(root, 'src/components/signal'))
  process.exit(0)
}

const destArg = process.argv[2] ?? '../other-app'
const destRoot = resolve(root, destArg)

const srcSignal = join(root, 'src/components/signal')
const destSignal = join(destRoot, 'src/components/signal')

mkdirSync(destSignal, { recursive: true })
cpSync(srcSignal, destSignal, { recursive: true })

console.log(`✓ 已拷贝: src/components/signal -> ${destSignal}`)
console.log(`\n他项目使用:`)
console.log(`  import IqChart from '@/components/signal/IqChart.vue'`)
console.log(`  import SpectrumChart from '@/components/signal/SpectrumChart.vue'`)
console.log(`  import SpectrogramChart from '@/components/signal/SpectrogramChart.vue'`)
console.log(`  import ConstellationChart from '@/components/signal/ConstellationChart.vue'`)
console.log(`\n示例:`)
console.log(`  <IqChart :adapter="myAdapter" ref="iqRef" theme="dark" />`)
console.log(`  <SpectrumChart :fft-size="2048" db-scale />`)
console.log(`  // 流式: iqRef.value.appendData(rawFromBackend)`)
console.log(
  `\n适配器见 src/components/signal/core/adapters.ts（passthrough/jsonInterleaved/arrayBuffer/base64）`
)
console.log(`主题: props theme="light" | "dark" | "auto"（组件自带，无需 NaiveUI）`)
