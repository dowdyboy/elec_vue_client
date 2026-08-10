import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // 多入口：主进程入口 + utilityProcess 计算 worker（输出 out/main/workers/fibonacci.js）
        input: {
          index: resolve('src/main/index.ts'),
          'workers/fibonacci': resolve('src/main/workers/fibonacci.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        // 多页：应用主页面 + 闪屏页（splash.html 为纯静态页）
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
