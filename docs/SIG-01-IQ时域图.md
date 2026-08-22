# SIG-01 - IQ 时域图

> `src/components/signal/IqChart.vue` 拷贝即用

```vue
<IqChart
  :adapter="myAdapter"
  theme="dark"
  :colors="['#00bcd4', '#ff4081']"
  :viewport="{ xMin: 0, xMax: 2000, autoScale: true }"
  :fps-limit="60"
  @error="onErr"
/>
<script setup>
const iqRef = useTemplateRef('iq')
ws.onmessage = (e) => iqRef.value.appendData(e.data) // RawInput 任意
</script>
```

**Adapter**：返回 `{i,q}` 或交织 `Float32Array`；内置 `iqAdapters.passthrough/jsonInterleaved/arrayBuffer/base64`

**Props**：`mode:'line'|'dots'` `lineWidth` `colors`（可选，未传取主题预置） `decimation` `viewport` `axis/xAxis/grid`

**外观**：`theme:'light'|'dark'|'auto'|'spectrum'` + `style` 字段级覆盖（优先级 `style > colors > 预置`）
`spectrum` 为频谱仪经典面板：纯黑底、暗绿栅格、亮黄 I 迹、青色 Q 迹；固定观感不随系统深浅色切换

```ts
// style 可覆盖字段（全部可选）：core/theme.ts
interface ChartStyle {
  bg?: string            // 组件/画布背景
  plotBg?: string        // 绘图区底色（须半透明：轴层绘制于波形层之上）
  grid?: string          // 网格
  border?: string        // 边框/轴线
  text?: string          // 刻度文字
  zeroLine?: string      // y=0 零基准线
  labelChipBg?: string   // Y 刻度芯片底
  traceI?: string        // I 迹线
  traceQ?: string        // Q 迹线
  traceAlpha?: number    // 波形不透明度（默认 0.85）
  axisWidth?: number     // 左侧刻度带宽 CSS px（≥40，默认 56）
}
```

**布局**：左侧固定宽度刻度带（Y 芯片右对齐贴绘图区左边框，波形与刻度彻底分离）+ 底部 X 槽；
固定带宽不随数据变化，无逐帧左右抖动

**内部**：环形 2M 点，`minmax` 抽稀至 `2×px`，`WebGL2` 双 `LINE_STRIP`
