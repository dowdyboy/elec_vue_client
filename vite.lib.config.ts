import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 信号组件库构建（ESM + 独立 CSS）：
 *   npx vite build --config vite.lib.config.ts
 *
 * 产物：dist-signal/signal-charts.js、dist-signal/signal-charts.css
 * 宿主：`import { IqChart } from '.../signal-charts.js'` + 引入 css；Vue 作为 peer 外部化。
 * 类型声明：npx vue-tsc -p tsconfig.signal.json（产物 dist-signal/types）
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist-signal',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/components/signal/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'signal-charts.js',
      cssFileName: 'signal-charts'
    },
    rollupOptions: {
      external: ['vue']
    }
  }
})
