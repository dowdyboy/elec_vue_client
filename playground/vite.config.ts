import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 独立 Playground（非 Electron）：验证组件能被普通 Vite/Vue 宿主直接集成。
 * 启动：npx vite --config playground/vite.config.ts
 * 构建：npx vite build --config playground/vite.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // 相对 base：既可用 vite preview 起服务，也可用 Electron loadFile 直接打开 dist/index.html
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@signal': fileURLToPath(new URL('../src/components/signal/index.ts', import.meta.url))
    }
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        visual: fileURLToPath(new URL('./visual.html', import.meta.url)),
        smoke: fileURLToPath(new URL('./smoke.html', import.meta.url))
      }
    }
  }
})
