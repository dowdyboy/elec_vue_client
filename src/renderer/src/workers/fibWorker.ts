/**
 * 渲染进程 Web Worker：计算密集型演示（Fibonacci）
 * 由 PerformancePage 通过 Vite 官方写法加载：
 *   new Worker(new URL('../workers/fibWorker.ts', import.meta.url), { type: 'module' })
 * Vite 会将其打包为独立 chunk，dev/prod 均走同源脚本（CSP 'self' 放行），
 * 避免 Blob URL 内联 Worker 在 Electron 下的 CSP 兼容问题。
 */

self.onmessage = (event: MessageEvent<number>) => {
  const n = event.data
  const start = Date.now()
  // 经典指数级递归（教学演示用，勿用大 n）
  const fib = (x: number): number => (x <= 1 ? x : fib(x - 1) + fib(x - 2))
  const value = fib(n)

  self.postMessage({ value, elapsedMs: Date.now() - start })
  self.close()
}

export {}
