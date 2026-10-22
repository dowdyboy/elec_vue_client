# SIG-03 - 时频图（瀑布）

> `src/components/signal/SpectrogramChart.vue`
>
> 状态：**演示级骨架**（Canvas2D 行刷；尚未做库化、Canvas2D/WebGL 双后端、i18n、像素回归）。

```vue
<SpectrogramChart
  theme="dark"
  color-map="viridis"
  :time-span="128"
  :adapter="spectrumAdapters.passthrough"
/>
```

**输入**：服务端算好的 dB 行 `Float32Array`（长度 = fftSize/2，经 adapter）——切窗/FFT/dB 全在服务端完成；
组件逐行累计成瀑布，最新行在顶部、历史行随新数据向下滚动；行长由首帧决定，行长变化（如 fftSize 变更）时自动重置瀑布

**Props**：`colorMap`（`viridis/jet/grayscale/hot`）、`timeSpan`（显示行数，默认 128）+ 通用项
（`theme/decimation/fpsLimit/width/height/adapter/data`；无 `fftSize/overlap/window/dbScale`——处理在服务端）

**着色**：dB 按约定 `-120~0` 归一化映射色阶

**渲染**：`Canvas2D ImageData` 行刷（`imageSmoothingEnabled:false`；ImageData 与离屏 canvas 尺寸不变时复用），
可无缝升 `WebGL` 纹理
