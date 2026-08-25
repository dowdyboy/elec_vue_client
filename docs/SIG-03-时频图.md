# SIG-03 - 时频图（瀑布）

> `src/components/signal/SpectrogramChart.vue`

```vue
<SpectrogramChart
  :fft-size="512"
  :overlap="0.5"
  window="hann"
  color-map="viridis"
  :time-span="128"
  db-scale
/>
```

**输入**：时域流，按 `step=fftSize*(1-overlap)` 切窗，多次 FFT 入环形 `timeSpan` 行

**着色**：`viridis/jet/grayscale/hot`，`-120~0 dB` 归一化

**渲染**：`Canvas2D ImageData` 行刷（`imageSmoothingEnabled:false`），可无缝升 `WebGL` 纹理
