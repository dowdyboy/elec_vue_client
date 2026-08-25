# SIG-04 - 星座图

> `src/components/signal/ConstellationChart.vue`

```vue
<ConstellationChart
  :point-size="2"
  :alpha="0.7"
  theme="dark"
  :adapter="constellationAdapters.passthrough"
/>
```

**输入**：`{i,q}` 或交织 `Float32Array`

**内部**：环形 500k 点，`WebGL POINTS` `alpha` 叠加，`x/yRange` 自动或 `viewport`

**Props**：`pointSize/alpha/density`
