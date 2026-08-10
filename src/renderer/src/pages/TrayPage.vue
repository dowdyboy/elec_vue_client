<script setup lang="ts">
/**
 * 系统托盘演示页
 * 演示：托盘常驻、托盘菜单、托盘气泡
 */
import { NCard, NAlert, NText } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import trayCode from '../../../main/features/tray.ts?raw'

const trayMenus = [
  { label: '显示主窗口', action: '窗口将被显示（托盘 → 主窗口）' },
  { label: '隐藏主窗口', action: '窗口将被隐藏（应用仍常驻托盘）' },
  { label: '退出应用', action: '整个应用将退出（含托盘）' }
]
</script>

<template>
  <FeatureLayout
    title="系统托盘"
    api="Tray / Menu"
    intro="托盘让应用常驻系统任务栏（Windows 通知区域 / macOS 菜单栏）。本工程实现了完整常驻链路：点击窗口关闭按钮 = 隐藏到托盘（窗口不销毁，见 index.ts 的 close 拦截）；真正退出走托盘菜单「退出应用」。"
  >
    <n-card size="small" title="托盘菜单功能说明" style="margin-bottom: 12px">
      <div v-for="(item, i) in trayMenus" :key="i" style="padding: 4px 0; font-size: 13px">
        <b>「{{ item.label }}」</b> → {{ item.action }}
      </div>
      <n-text depth="3" style="font-size: 12px">
        💡 注意：托盘图标已在系统右下角显示。点击窗口右上角关闭按钮试试——窗口会隐藏到托盘，
        进程保持运行；通过托盘右键"显示主窗口"即可找回。
      </n-text>
    </n-card>

    <n-alert type="warning" :show-icon="true">
      <template #header>右键托盘图标体验菜单</template>
      关闭窗口 ≠ 退出应用（隐藏到托盘）；只有点击托盘菜单「退出应用」才真正结束进程。
      <code>isQuitting</code> 标志（index.ts）控制两种行为的切换。
    </n-alert>

    <template #code>
      <CodeBlock file="src/main/features/tray.ts" :code="trayCode" />
    </template>
  </FeatureLayout>
</template>
