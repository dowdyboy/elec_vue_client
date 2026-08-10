import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initTheme } from './stores/theme'

// 挂载前先读取系统主题（避免闪烁），失败不阻塞启动
initTheme()

createApp(App).use(router).mount('#app')
