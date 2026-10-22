/**
 * 拷贝信号组件到他项目（轻量复用，拷贝即用）
 * 用法：
 *   node scripts/copy-signal.mjs ../other-app                 # 组件 + core + README（不含测试）
 *   node scripts/copy-signal.mjs ../other-app --with-tests    # 连同 *.test.ts 一起拷贝
 *   node scripts/copy-signal.mjs --list
 *   node scripts/copy-signal.mjs --help
 */
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const root = resolve(dirname(__filename), '..')
const args = process.argv.slice(2)
const withTests = args.includes('--with-tests')

function isTestFile(p) {
  return p.endsWith('.test.ts')
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法: node scripts/copy-signal.mjs [dest] [--with-tests]

  [dest]         目标项目根目录（默认 ../other-app）
  --with-tests   连同 core/*.test.ts 一起拷贝（宿主需安装 vitest）
  --list         列出可拷贝文件
  --help         帮助

示例:
  node scripts/copy-signal.mjs ../my-electron-app
  node scripts/copy-signal.mjs "D:\\\\my-app"
  node scripts/copy-signal.mjs ../my-app --with-tests
`)
  process.exit(0)
}

if (args.includes('--list')) {
  // 递归列出（含 core/ 与 composables/ 子目录）
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), prefix + entry.name + '/')
      else if (withTests || !isTestFile(entry.name)) console.log(' ', prefix + entry.name)
    }
  }
  console.log(`可拷贝${withTests ? '（含测试）' : '（不含测试）'}:`)
  walk(join(root, 'src/components/signal'))
  process.exit(0)
}

const destArg = args.find((a) => !a.startsWith('--')) ?? '../other-app'
const destRoot = resolve(root, destArg)

const srcSignal = join(root, 'src/components/signal')
const destSignal = join(destRoot, 'src/components/signal')

mkdirSync(destSignal, { recursive: true })
cpSync(srcSignal, destSignal, {
  recursive: true,
  // 默认排除测试：宿主未安装 vitest 时，拷贝过去的 *.test.ts 会让 typecheck 报错
  filter: (src) => withTests || !isTestFile(src)
})

console.log(
  `✓ 已拷贝: src/components/signal -> ${destSignal}${withTests ? '（含测试）' : '（不含测试）'}`
)
console.log(`\n他项目使用（推荐公共入口）:`)
console.log(
  `  import { IqChart, SpectrumChart, iqAdapters, spectrumAdapters } from '@/components/signal'`
)
console.log(
  `  // 或全局注册: import SignalCharts from '@/components/signal'; app.use(SignalCharts)`
)
console.log(`\n示例:`)
console.log(`  <IqChart :adapter="iqAdapters.int16Interleaved" height="100%" />`)
console.log(`  <SpectrumChart :traces="[{ mode: 'clear', label: 'TX1' }]" />`)
console.log(`  iqRef.value?.appendData(rawFromBackend, { sampleRate: 1_000_000 })`)
console.log(
  `  specRef.value?.appendData(raw, { sampleRate: 1_000_000, fftSize: 4096, dbScale: true })`
)
console.log(`\n数据格式/适配器/props/事件/方法见 src/components/signal/README.md`)
console.log(
  `外观覆盖用 chart-style（不要用原生 style 传主题字段）；尺寸支持 number | '100%' 等字符串`
)
