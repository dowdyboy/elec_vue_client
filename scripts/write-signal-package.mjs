/**
 * 为 dist-signal 生成可发布的 package.json（ESM + 类型 + CSS）。
 * 由 `npm run build:signal` 在 vite/vue-tsc 之后调用。
 */
import { copyFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = {
  name: 'elec-signal-charts',
  version: '2.1.0',
  description:
    'Reusable IQ time-domain / spectrum / spectrogram Vue 3 components (WebGL2 + Canvas2D fallback)',
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
  files: ['signal-charts.js', 'signal-charts.css', 'types', 'README.md'],
  sideEffects: ['./signal-charts.css'],
  peerDependencies: {
    vue: '^3.4.0'
  },
  keywords: ['vue', 'iq', 'spectrum', 'signal', 'webgl', 'canvas']
}

const out = fileURLToPath(new URL('../dist-signal/package.json', import.meta.url))
writeFileSync(out, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
const readme = fileURLToPath(new URL('../src/components/signal/README.md', import.meta.url))
const readmeOut = fileURLToPath(new URL('../dist-signal/README.md', import.meta.url))
copyFileSync(readme, readmeOut)
console.log(`[build:signal] wrote ${out}`)
