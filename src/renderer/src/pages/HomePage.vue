<script setup lang="ts">
/**
 * 首页：项目导览
 * 展示项目的教学定位、目录结构与快速开始说明
 */
import { NCard, NGrid, NGridItem, NDataTable, NText, NAlert } from 'naive-ui'

/** 特性速查表：与 docs/ 目录下文档一一对应 */
const featureTable = {
  columns: [
    { title: '特性', key: 'name' },
    { title: 'Electron API', key: 'api' },
    { title: '教学文档', key: 'doc' }
  ],
  data: [
    { name: '窗口管理', api: 'BrowserWindow', doc: 'docs/01-窗口管理.md' },
    { name: 'IPC 通信', api: 'ipcMain / ipcRenderer', doc: 'docs/02-IPC通信.md' },
    { name: '系统托盘', api: 'Tray', doc: 'docs/03-系统托盘.md' },
    { name: '系统通知', api: 'Notification', doc: 'docs/04-系统通知.md' },
    { name: '全局快捷键', api: 'globalShortcut', doc: 'docs/05-全局快捷键.md' },
    { name: '剪贴板', api: 'clipboard', doc: 'docs/06-剪贴板.md' },
    { name: '文件对话框', api: 'dialog', doc: 'docs/07-文件对话框.md' },
    { name: '文件系统', api: 'fs（Node.js）', doc: 'docs/08-文件系统.md' },
    { name: '原生菜单', api: 'Menu', doc: 'docs/09-原生菜单.md' },
    { name: '屏幕信息', api: 'screen', doc: 'docs/10-屏幕信息.md' },
    { name: '系统主题', api: 'nativeTheme', doc: 'docs/11-系统主题.md' },
    { name: '安全实践', api: 'session / webContents', doc: 'docs/12-安全实践.md' },
    { name: '生命周期', api: 'app', doc: 'docs/13-生命周期.md' },
    { name: '网络通信', api: 'axios / socket.io', doc: 'docs/14-网络通信.md' },
    { name: '自动更新', api: 'electron-updater', doc: 'docs/15-自动更新.md' },
    {
      name: '协议与深链接',
      api: 'setAsDefaultProtocolClient',
      doc: 'docs/16-自定义协议与深链接.md'
    },
    { name: '桌面捕获', api: 'desktopCapturer', doc: 'docs/17-桌面捕获.md' },
    { name: '打印', api: 'printToPDF', doc: 'docs/18-打印.md' },
    { name: 'TCP/UDP 通信', api: 'net / dgram', doc: 'docs/19-TCP与UDP通信.md' },
    {
      name: '计算性能',
      api: 'utilityProcess / Web Worker',
      doc: 'docs/20-计算密集型与进程模型.md'
    },
    { name: '进阶工程实践', api: 'sandbox / 调试 / 上报', doc: 'docs/21-进阶工程实践.md' },
    { name: '下载管理', api: 'will-download / DownloadItem', doc: 'docs/22-下载管理.md' },
    {
      name: '会话管理',
      api: 'session.cookies / webRequest',
      doc: 'docs/23-网络会话（Cookie与请求拦截）.md'
    },
    { name: '自定义协议内容', api: 'protocol.handle', doc: 'docs/24-自定义协议内容.md' },
    { name: 'SQLite 数据库', api: 'node:sqlite', doc: 'docs/25-数据库（SQLite）.md' },
    {
      name: '第三方 SQLite',
      api: 'better-sqlite3',
      doc: 'docs/34-第三方SQLite（better-sqlite3）.md'
    },
    { name: '平台特性', api: 'setJumpList / app.dock / kiosk', doc: 'docs/26-平台特性.md' },
    { name: '系统集成', api: 'systemPreferences / net / inputHook', doc: 'docs/27-系统集成.md' },
    { name: '会话配置与证书', api: 'setProxy / setUserAgent', doc: 'docs/28-会话配置与证书.md' },
    {
      name: '媒体捕获',
      api: 'getUserMedia / getDisplayMedia',
      doc: 'docs/29-媒体捕获（摄像头麦克风录屏）.md'
    },
    {
      name: '串口通信',
      api: 'setDevicePermissionHandler',
      doc: 'docs/30-串口通信（Web Serial）.md'
    },
    {
      name: 'GPU 信息与硬件加速',
      api: 'getGPUFeatureStatus / getGPUInfo',
      doc: 'docs/31-GPU信息与硬件加速.md'
    },
    {
      name: '应用数据目录',
      api: 'getPath / setPath',
      doc: 'docs/32-应用数据目录（getPath setPath）.md'
    },
    { name: '加密存储', api: 'safeStorage', doc: 'docs/33-安全存储（safeStorage）.md' }
  ]
}
</script>

<template>
  <div class="home">
    <n-alert type="info" :show-icon="true">
      <template #header>项目定位</template>
      这是一个 <b>Electron 教学 + 模板</b> 项目：左侧菜单进入各特性演示页（直观看到功能），
      源码按特性模块化拆分并附中文注释（可直接复制到新工程）。
    </n-alert>

    <n-grid :cols="3" :x-gap="12" :y-gap="12" style="margin-top: 12px">
      <n-grid-item>
        <n-card size="small" title="📖 教学方式">
          <n-text depth="3" style="font-size: 13px">
            每个特性页包含：原理说明 → 在线演示 → 关键源码三段， 演示按钮调用的都是真实 Electron
            API。
          </n-text>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card size="small" title="🧩 模板方式">
          <n-text depth="3" style="font-size: 13px">
            主进程 <code>src/main/features/</code> 下每个文件是一个独立特性模块，
            文件头注释写明复制步骤，可整体搬运到别的工程。
          </n-text>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card size="small" title="🚀 快速开始">
          <n-text depth="3" style="font-size: 13px">
            <code>npm install</code> → <code>npm run dev</code><br />
            从左侧"窗口管理"开始按顺序体验即可。
          </n-text>
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card size="small" title="特性速查表" style="margin-top: 12px">
      <n-data-table
        :columns="featureTable.columns"
        :data="featureTable.data"
        :bordered="false"
        size="small"
      />
    </n-card>
  </div>
</template>
