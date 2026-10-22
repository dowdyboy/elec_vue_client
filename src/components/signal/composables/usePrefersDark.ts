/**
 * 系统深浅色监听（可拷贝）
 * - 客户端：matchMedia('(prefers-color-scheme: dark)') + change 监听，onUnmounted 清理
 * - SSR / 无 matchMedia 环境：恒为 false，避免 window 未定义报错
 */
import { onUnmounted, ref, type Ref } from 'vue'

export function usePrefersDark(): Ref<boolean> {
  const dark = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return dark

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  dark.value = mq.matches
  const onChange = (e: MediaQueryListEvent): void => {
    dark.value = e.matches
  }
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    onUnmounted(() => mq.removeEventListener('change', onChange))
  } else {
    // 旧版 Safari/WebView 的 addListener 兼容
    const legacy = mq as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void
    }
    legacy.addListener?.(onChange)
    onUnmounted(() => legacy.removeListener?.(onChange))
  }
  return dark
}
