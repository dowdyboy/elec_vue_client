/**
 * IPC 通道目录一致性校验（把 ipcChannels.ts 从"文档"变成"契约"）
 *
 * 为什么需要它：通道名在主进程、preload、目录三处各写一遍，而它们都是字符串，
 * TypeScript 抓不到任何拼写错误。拼错的后果是运行期静默失败——
 * `window.api.xxx()` 返回的 Promise 永挂起（没有对应 handle）或事件永远不来。
 *
 * 本测试在 `npm test` / CI 里强制三方一致：
 *   ① preload 用到的通道，主进程必须有实现（否则渲染端调用必挂起）
 *   ② 主进程实现/推送的通道，必须登记进 ipcChannels.ts（防止新特性绕过目录）
 *   ③ 目录里声明的通道必须真的有实现（防止目录腐烂成死常量）
 *   ④ 目录内通道值不重复（防止复制粘贴改错）
 *
 * 注意：这是"测试期"契约，不是编译期——要拿到编译期保证，调用处需 import { IPC }
 * 而不是写字符串字面量（教学示例见 docs/00-复用指南）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAIN_ROOT = HERE
const PRELOAD_ROOT = join(HERE, '..', 'preload')
const CATALOG_FILE = join(MAIN_ROOT, 'ipcChannels.ts')

/** 通道字面量：'namespace:action'，支持 signal:analysis:status 这类多级命名 */
const CHANNEL_LITERAL = /'([a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z0-9][a-zA-Z0-9:_-]*)'/g

/**
 * 形如通道、但不是 Electron IPC 通道的字符串（避免误报）：
 * - `node:*`：Node 内置模块说明符
 * - `persist:work`：session 分区名
 * - `signal:analysis:config` / `signal:analysis:trigger`：远程后端的 socket.io 事件名
 *   （见 src/main/signal/analysisServer.ts 头部注释，属于 socket 协议而非 IPC）
 */
const NOT_IPC_VALUES = new Set(['signal:analysis:config', 'signal:analysis:trigger'])
const NOT_IPC_PREFIX = /^(node|persist):/

/** 只统计真实实现文件：测试自身、模板文件不参与 */
const SKIPPED_FILES = new Set(['ipcChannels.ts', '_template.ts'])

function isIpcChannel(value: string): boolean {
  return !NOT_IPC_VALUES.has(value) && !NOT_IPC_PREFIX.test(value)
}

function collectFromFile(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(CHANNEL_LITERAL)].map((m) => m[1]).filter(isIpcChannel)
}

function collectFromTree(root: string): Set<string> {
  const found = new Set<string>()
  for (const name of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!name.endsWith('.ts')) continue
    if (name.endsWith('.test.ts')) continue
    const base = name.split(/[\\/]/).pop() ?? ''
    if (SKIPPED_FILES.has(base)) continue
    for (const channel of collectFromFile(join(root, name))) found.add(channel)
  }
  return found
}

const catalogChannels = new Set(collectFromFile(CATALOG_FILE))
const mainChannels = collectFromTree(MAIN_ROOT)
const preloadChannels = collectFromTree(PRELOAD_ROOT)

const sort = (values: Iterable<string>): string[] => [...values].sort()

describe('IPC 通道目录一致性', () => {
  it('preload 用到的通道在主进程都有实现', () => {
    // 违反时的后果：window.api.<分组>.<方法>() 返回的 Promise 永远不 resolve
    const orphans = sort(preloadChannels).filter((c) => !mainChannels.has(c))
    expect(orphans).toEqual([])
  })

  it('主进程实现与推送的通道都登记进目录', () => {
    const undeclared = sort(mainChannels).filter((c) => !catalogChannels.has(c))
    expect(undeclared).toEqual([])
  })

  it('目录里声明的通道都有实现', () => {
    const deadEntries = sort(catalogChannels).filter((c) => !mainChannels.has(c))
    expect(deadEntries).toEqual([])
  })

  it('目录内通道值不重复', () => {
    const values = collectFromFile(CATALOG_FILE)
    const seen = new Set<string>()
    const duplicates = values.filter((v) => (seen.has(v) ? true : (seen.add(v), false)))
    expect(duplicates).toEqual([])
  })

  it('目录规模覆盖全部通道分组（防止新增分组漏登记）', () => {
    const groups = new Set(sort(mainChannels).map((c) => c.slice(0, c.indexOf(':'))))
    const catalogGroups = new Set(sort(catalogChannels).map((c) => c.slice(0, c.indexOf(':'))))
    const missingGroups = sort(groups).filter((g) => !catalogGroups.has(g))
    expect(missingGroups).toEqual([])
  })
})
