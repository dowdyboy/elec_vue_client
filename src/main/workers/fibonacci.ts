/**
 * 【用途】utilityProcess 计算 worker（独立 Node.js 子进程）
 * 【说明】由主进程 utilityProcess.fork() 启动（见 features/utilityProcess.ts）。
 *         在 utilityProcess 环境中，通过 process.parentPort 与主进程通信：
 *         - 主进程 postMessage({ n }) 下发任务
 *         - 本脚本计算后 postMessage({ type: 'result', value, elapsedMs }) 回传
 * 【教学点】CPU 密集任务（此处为指数级 Fibonacci 递归）放在独立进程，
 *           主进程与所有窗口的 IPC 都不会被阻塞。
 */

// process.parentPort 是 utilityProcess 环境的专用通信端口
process.parentPort.on('message', (event: Electron.MessageEvent) => {
  const { n } = event.data as { n: number }

  const start = Date.now()
  // 经典指数级递归：n=43 时耗时约 1~3 秒，足够直观（勿用大 n）
  const fib = (x: number): number => (x <= 1 ? x : fib(x - 1) + fib(x - 2))
  const value = fib(n)

  process.parentPort.postMessage({
    type: 'result',
    value,
    elapsedMs: Date.now() - start
  })
  // 计算完成即退出子进程（与主进程的 perf:fibInProcess 释放引用对应）
  process.exit(0)
})
