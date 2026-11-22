import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initTheme } from './stores/theme'
import { installGlobalErrorHandlers } from './errorReporter'

// 挂载前先读取系统主题（避免闪烁），失败不阻塞启动
initTheme()

// 渲染层全局错误兜底：越早安装越好（挂载期间的异常也要能捕获到）
// 上报到主进程错误日志，与主进程异常同列表展示（见「生命周期」页）
installGlobalErrorHandlers()

createApp(App).use(router).mount('#app')
