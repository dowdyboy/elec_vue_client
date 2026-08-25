import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// 轻量化：__dirname 在 ESM 下需自行推导，保证 Windows/打包后路径稳定
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // 多入口：主进程入口 + utilityProcess 计算 worker（输出 out/main/workers/fibonacci.js）
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'workers/fibonacci': resolve(__dirname, 'src/main/workers/fibonacci.ts')
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
          index: resolve(__dirname, 'src/renderer/index.html'),
          splash: resolve(__dirname, 'src/renderer/splash.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@components': resolve(__dirname, 'src/components')
      }
    },
    plugins: [vue()]
  }
})
