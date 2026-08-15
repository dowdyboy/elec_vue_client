<script setup lang="ts">
/**
 * 应用根组件：
 * - NConfigProvider：Naive UI 主题（亮/暗 与 Electron nativeTheme 联动）+ 中文 locale
 * - NMessageProvider / NDialogProvider：函数式弹窗上下文
 * - 布局：左侧特性导航菜单 + 右侧页面内容
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NButton,
  NText,
  NTag
} from 'naive-ui'
import { menuOptions } from './router'
import { isDark, initTheme, setThemeSource, themeSource } from './stores/theme'
// 代码高亮：naive-ui 的 n-code 通过 NConfigProvider 的 :hljs prop 全局获取
// highlight.js（注意：新版 naive-ui 不再读取 window.hljs，必须经此注入，
// 否则 CodeBlock 无高亮并打印 "[naive/code]: hljs is not set" 警告）
import hljs from 'highlight.js/lib/common'

const router = useRouter()
const route = useRoute()

const activeKey = computed(() => route.path)
const options = computed(() => menuOptions())

/** 最外层 n-layout（滚动复位的作用范围，见下方 watch 注释） */
const layoutRef = ref<InstanceType<typeof NLayout> | null>(null)

// ── 路由切换时复位滚动 ──
// 根因（本工程实测踩坑，三轮试错结论）：naive-ui 的 .n-layout 无 display:flex、
// 内层布局没有高度约束链，真实滚动元素位于"外层 layout 子树中的某个滚动容器"
// （.n-layout-scroll-container 或 .n-scrollbar-container，实测定位到两者之一，
// 且不在 n-layout-content 子树内）。
// 教训链：
//   ① document 全量复位 → 误伤左侧菜单（n-layout-sider 同样是 .n-scrollbar-container）
//   ② 范围限定到 content 子树 → 漏掉真实滚动容器（复位失效）
//   ③ 正确做法：外层 layout 子树全覆盖 + closest('.n-layout-sider') 排除侧栏
//      ——命中集合 = 全量命中 − 侧栏容器，右侧置顶与侧栏保持两个目标同时达成。
watch(
  () => route.path,
  async () => {
    await nextTick()
    // ① window/body 兜底
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    // ② 外层 layout 子树内所有滚动容器复位，排除左侧菜单内部的
    const rootEl = layoutRef.value?.$el as HTMLElement | undefined
    rootEl
      ?.querySelectorAll<HTMLElement>('.n-layout-scroll-container, .n-scrollbar-container')
      .forEach((el) => {
        if (!el.closest('.n-layout-sider')) el.scrollTop = 0
      })
  }
)

onMounted(() => initTheme())

/** 顶部主题切换：亮 / 暗 / 跟随系统（对应主进程 nativeTheme.themeSource） */
const themeButtons = [
  { value: 'light', label: '亮' },
  { value: 'dark', label: '暗' },
  { value: 'system', label: '跟随系统' }
] as const
</script>

<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :hljs="hljs"
    :theme-overrides="{ common: { primaryColor: '#2f7ef7' } }"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-layout ref="layoutRef" has-sider style="height: 100vh">
          <!-- ── 左侧：特性导航 ── -->
          <n-layout-sider bordered :width="200" :native-scrollbar="false">
            <div class="brand">
              <n-text strong>⚡ Electron 教学</n-text>
              <n-text depth="3" class="brand-sub">教学 + 模板项目</n-text>
            </div>
            <n-menu
              :value="activeKey"
              :options="options"
              @update:value="(key: string) => router.push(key)"
            />
          </n-layout-sider>

          <!-- ── 右侧：内容区 ── -->
          <n-layout>
            <n-layout-header bordered class="header">
              <n-text strong>{{ route.meta.title }}</n-text>
              <div class="theme-switch">
                <n-tag v-if="isDark" size="small" type="warning">当前暗色</n-tag>
                <n-tag v-else size="small" type="info">当前亮色</n-tag>
                <n-button
                  v-for="btn in themeButtons"
                  :key="btn.value"
                  size="tiny"
                  :type="themeSource === btn.value ? 'primary' : 'default'"
                  secondary
                  @click="setThemeSource(btn.value)"
                >
                  {{ btn.label }}
                </n-button>
              </div>
            </n-layout-header>
            <n-layout-content :native-scrollbar="false" class="content">
              <router-view />
            </n-layout-content>
          </n-layout>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.brand {
  padding: 16px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-sub {
  font-size: 12px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
}
.theme-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}
.content {
  padding: 16px;
}
</style>
