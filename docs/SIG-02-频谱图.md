# SIG-02 - 频谱图

> `src/components/signal/SpectrumChart.vue`

```vue
<SpectrumChart
  :fft-size="2048"
  window="hann"
  db-scale
  theme="auto"
  :adapter="spectrumAdapters.passthrough"
/>
```

**输入**：时域 `Float32Array`（经 adapter），内部 `Worker` `getWindow`→`magnitudeSpectrum`→`toDB`，`fftSize` 256~8192

**Props**：`fftSize/window/dbScale`

**渲染**：`WebGL2` 折线，`decimation` 到视口宽度
