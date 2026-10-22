/// <reference lib="webworker" />
/**
 * 示例 Worker：把 int16 交织 IQ 转成组件需要的 Float32 交织。
 * 高频采集时把解析/归一化放到 Worker，主线程只做 appendData。
 */
self.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
  const src = new Int16Array(ev.data)
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i]! / 32768
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(out, [out.buffer])
}
