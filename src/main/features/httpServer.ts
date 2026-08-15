/**
 * 【特性】HTTP 服务器（node:http —— 主进程即服务器）
 * 【API】node:http createServer / listen
 * 【复制】1. 复制本文件到新工程 src/main/features/httpServer.ts
 *         2. 在 index.ts 中调用 registerHttpServer()
 *         3. 渲染进程调用 window.api.httpServer.*（或直接 fetch）
 * 【说明】主进程可以用 Node 的 http 模块起本地 HTTP 服务：
 *         - 应用内 API mock（渲染进程 fetch 本地接口，绕开跨域）
 *         - 局域网共享（监听 0.0.0.0 供其他设备访问）
 *         - 与 WebContentsView、深链接组合出"本地 Web 应用"形态
 *         - /download 下载端点：下载管理页的"自闭环"下载源
 *           （可调大小/速度 + Range 支持，见 docs/22）
 *         与 axios（客户端）互补：本模块是"服务端"视角。
 */

import { ipcMain } from 'electron'
import http from 'node:http'
import { parse } from 'node:url'

let server: http.Server | null = null
let port = 0

/** 下载端点的数据块（64KB 重复模式，避免真实分配大文件内存） */
const CHUNK = Buffer.alloc(64 * 1024)
for (let i = 0; i < CHUNK.length; i++) CHUNK[i] = (i * 31 + 7) % 256

export function registerHttpServer(): void {
  // ── 启动本地 HTTP 服务器 ──
  ipcMain.handle('httpServer:start', (_e, targetPort = 8765) => {
    if (server) return { ok: false, error: `服务器已在运行（端口 ${port}）` }
    return new Promise<{ ok: boolean; port?: number; error?: string }>((resolve) => {
      server = http.createServer((req, res) => {
        const { pathname, query } = parse(req.url ?? '/', true)

        // ── /api/info：JSON 接口（网络通信页演示）──
        if (pathname === '/api/info') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Access-Control-Allow-Origin', '*') // 教学演示放开 CORS
          res.end(
            JSON.stringify({
              app: 'Electron 教学项目',
              server: 'node:http',
              time: new Date().toLocaleTimeString(),
              url: req.url
            })
          )
          return
        }

        // ── /download：自闭环下载端点（下载管理页演示，见 docs/22）──
        // 参数：size=MB（默认 20，上限 100）；delay=每 64KB 块的间隔 ms（默认 10）
        // Range 支持：DownloadItem 暂停/恢复（canResume）的前提
        if (pathname === '/download') {
          const sizeMb = Math.min(100, Math.max(1, Number(query.size) || 20))
          const delay = Math.max(0, Number(query.delay) || 10)
          const total = sizeMb * 1024 * 1024

          const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(total),
            'Content-Disposition': `attachment; filename="demo-${sizeMb}MB.bin"`,
            'Access-Control-Allow-Origin': '*'
          }

          let start = 0
          let end = total - 1
          const range = req.headers.range
          if (range) {
            const m = /^bytes=(\d+)-(\d*)$/.exec(range)
            if (m) {
              start = Number(m[1])
              end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
              headers['Content-Range'] = `bytes ${start}-${end}/${total}`
              headers['Content-Length'] = String(end - start + 1)
              res.writeHead(206, headers)
            } else {
              res.writeHead(416)
              res.end()
              return
            }
          } else {
            res.writeHead(200, headers)
          }

          // 按块流式发送（重复模式数据 + 可选延迟模拟网速）
          // 教学要点（下载管理页"真暂停"闭环，见 docs/22）：
          //   ① 尊重背压：res.write 返回 false（客户端暂停读取/socket 缓冲满）时
          //      停止继续写，等 'drain' 事件再发下一块——客户端暂停下载
          //      （Chromium 停止读取）→ 服务器真正停止发送，数据流可观测地暂停
          //   ② 连接提前关闭：客户端取消下载会断开连接，置标志停止循环，
          //      避免对已销毁 socket 继续 write（否则可能未处理异常）
          let offset = start
          let stopped = false
          let timer: NodeJS.Timeout | null = null
          res.once('close', () => {
            stopped = true
            if (timer) clearTimeout(timer)
          })

          const writeNext = (): void => {
            if (stopped || res.destroyed) return
            if (offset > end) {
              res.end()
              return
            }
            const size = Math.min(CHUNK.length, end - offset + 1)
            const base = offset % CHUNK.length
            const slice =
              base + size <= CHUNK.length
                ? CHUNK.subarray(base, base + size)
                : Buffer.concat([
                    CHUNK.subarray(base),
                    CHUNK.subarray(0, base + size - CHUNK.length)
                  ])
            offset += size
            const ok = res.write(slice)
            if (!ok) {
              // 背压：客户端暂停读取 → 等 drain 后再继续（暂停期间服务器不发数据）
              res.once('drain', () => {
                if (stopped) return
                if (delay > 0) timer = setTimeout(writeNext, delay)
                else writeNext()
              })
              return
            }
            if (delay > 0) {
              timer = setTimeout(writeNext, delay)
            } else {
              writeNext()
            }
          }
          writeNext()
          return
        }

        // ── 其他路径：通用 JSON 响应 ──
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(JSON.stringify({ message: '来自主进程 HTTP 服务器的响应', path: req.url ?? '/' }))
      })
      server.on('error', (err) => {
        server = null
        resolve({ ok: false, error: err.message })
      })
      server.listen(targetPort, '127.0.0.1', () => {
        port = targetPort
        resolve({ ok: true, port })
      })
    })
  })

  // ── 停止服务器 ──
  ipcMain.handle('httpServer:stop', () => {
    if (server) {
      server.close()
      server = null
    }
    return { ok: true }
  })

  // ── 状态查询 ──
  ipcMain.handle('httpServer:getStatus', () => ({
    running: server !== null,
    port
  }))
}
