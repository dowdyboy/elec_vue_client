/**
 * 【工具】资源释放约定（轻量化）
 * 【说明】各 features 模块的 registerX 返回 Disposer，index.ts 收集到
 *         featureDisposers，在 app 'will-quit' 时统一调用，避免端口/文件句柄泄漏。
 *         用同一个类型别名而不是各写 `() => void`，是为了让"哪些模块需要释放"
 *         在签名上可 grep、可校验。
 *         （历史版本里的 combineDisposers / safeDispose 从未被使用，已删除；
 *           index.ts 的 will-quit 循环本身已经做了逐项 try/catch。）
 */

/** 释放函数：调用即释放该模块占用的资源（可重复调用，需保证幂等） */
export type Disposer = () => void
