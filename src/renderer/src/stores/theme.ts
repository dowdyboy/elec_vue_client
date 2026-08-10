/**
 * 主题状态管理：与主进程 nativeTheme 双向同步
 * - setSource: 亮 / 暗 / 跟随系统（主进程 nativeTheme.themeSource）
 * - onUpdated: 系统主题变化时主进程推送，自动跟随
 */
import { ref, watch } from 'vue'

export type ThemeSource = 'system' | 'light' | 'dark'

export const themeSource = ref<ThemeSource>('system')
export const isDark = ref(false)

/**
 * 将主题状态同步到 <html> 的 dark 类：
 * 供自定义 CSS 变量（main.css 中 :root.dark 覆盖）与 Naive UI 暗色主题联动，
 * 否则暗色主题下自定义变量仍停留在亮色值（如 CodeBlock/日志框背景发白）。
 */
watch(isDark, (dark) => {
  document.documentElement.classList.toggle('dark', dark)
})

let initialized = false

export async function initTheme(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const state = await window.api.theme.getState()
    isDark.value = state.shouldUseDarkColors
    themeSource.value = state.themeSource
    // 系统主题变化（如用户在 Windows 设置切换明暗）→ 实时跟随
    window.api.theme.onUpdated(({ shouldUseDarkColors }) => {
      isDark.value = shouldUseDarkColors
    })
  } catch {
    // 极端情况（如脱离 Electron 环境）静默降级
  }
}

export async function setThemeSource(source: ThemeSource): Promise<void> {
  themeSource.value = source
  try {
    isDark.value = await window.api.theme.setSource(source)
  } catch {
    // 降级：本地切换
    isDark.value = source === 'dark'
  }
}
