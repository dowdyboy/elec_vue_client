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
- `SpectrogramChart`（视觉回归页）：固定种子 real 128 行 × 512 bin 与 complex 64 行 × 1024 bin 时频瀑布，验证 WebGL2 纹理、Canvas2D 回退、带符号频率轴、色标/轴/游标
- `SpectrumChart`/`SpectrogramChart` 同时覆盖 **real 单边 0~Fs/2** 与 **complex 完整复谱 -Fs/2~+Fs/2**；complex 数据含正负频率两个峰
- `ConstellationChart`：固定 QPSK 四簇 + 小噪声，覆盖正方形 I/Q 轴、自动量程、Canvas2D/WebGL2 散点；视觉页总高 2000，避免 Windows 初始窗口钳位裁掉底部
- Mock 配置页按专业源操作：实数/复数输出、CW/AM/FM/Pulse/Two-tone/Noise/Digital、AWGN/镜像，与分析模式独立
- 运行时切换 `renderer`（auto / webgl2 / canvas2d）与 `theme`；切换 renderer 通过 `:key` 重建组件（后端在挂载时选择）
- 英文 `labels`（轴标题/aria）与 `chartStyle` 可在此继续扩展
- URL 参数：`?renderer=canvas2d` 强制 2D、`?renderer=webgl2` 强制 GL；`?nowebgl=1` 在 `main.ts` 里覆盖 `getContext('webgl2')` 返回 null，用于验证 `auto` 的 Canvas2D 回退

> WebGL2 不可用时 `renderer="auto"` 会回退 Canvas2D；强制 `webgl2` 失败会 emit `error`/`errorDetail` 并显示占位提示。
> 截图冒烟见仓库根 `scripts/screenshot-playground.cjs`（Electron capturePage + 非空颜色断言，不依赖 Playwright）。
