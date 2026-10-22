# Signal Charts Playground

不依赖 Electron 的最小 Vite + Vue 宿主，用来验证组件能被普通上位机前端直接集成。

## 运行

在项目根目录：

```bash
npx vite --config playground/vite.config.ts
```

打开终端提示的地址（默认 `http://localhost:5173`）。

## 构建验证

```bash
npx vite build --config playground/vite.config.ts
```

产物在 `playground/dist`。

## 演示内容

- `IqChart`：模拟 int16 交织 IQ → Web Worker 解析为 Float32 → `appendData(..., { sampleRate })`
- `SpectrumChart`：模拟 512-bin dBFS 谱 + `LIVE`/`MAX` 双迹线、`v-model:paused`
- 运行时切换 `renderer`（auto / webgl2 / canvas2d）与 `theme`；切换 renderer 通过 `:key` 重建组件（后端在挂载时选择）
- 英文 `labels`（轴标题/aria）与 `chartStyle` 可在此继续扩展
- URL 参数：`?renderer=canvas2d` 强制 2D、`?renderer=webgl2` 强制 GL；`?nowebgl=1` 在 `main.ts` 里覆盖 `getContext('webgl2')` 返回 null，用于验证 `auto` 的 Canvas2D 回退

> WebGL2 不可用时 `renderer="auto"` 会回退 Canvas2D；强制 `webgl2` 失败会 emit `error`/`errorDetail` 并显示占位提示。
> 截图冒烟见仓库根 `scripts/screenshot-playground.cjs`（Electron capturePage + 非空颜色断言，不依赖 Playwright）。
