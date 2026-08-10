<script setup lang="ts">
/**
 * 应用根组件：
 * - NConfigProvider：Naive UI 主题（亮/暗 与 Electron nativeTheme 联动）+ 中文 locale
 * - NMessageProvider / NDialogProvider：函数式弹窗上下文
 * - 布局：左侧特性导航菜单 + 右侧页面内容
 */
import { computed, onMounted } from 'vue'
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

const router = useRouter()
const route = useRoute()

const activeKey = computed(() => route.path)
const options = computed(() => menuOptions())

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
    :theme-overrides="{ common: { primaryColor: '#2f7ef7' } }"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-layout has-sider style="height: 100vh">
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
