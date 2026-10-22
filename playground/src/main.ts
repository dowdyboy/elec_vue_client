import { createApp } from 'vue'
import App from './App.vue'

// ?nowebgl=1：模拟工业面板/远程桌面没有 WebGL2，验证 renderer='auto' 的 Canvas2D 回退
if (new URLSearchParams(location.search).has('nowebgl')) {
  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ): RenderingContext | null {
    if (contextId === 'webgl2') return null
    return (orig as (...a: unknown[]) => RenderingContext | null).call(this, contextId, ...args)
  } as typeof HTMLCanvasElement.prototype.getContext
}

createApp(App).mount('#app')
