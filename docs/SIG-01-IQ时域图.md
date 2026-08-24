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

**布局**：左侧固定宽度刻度带——Y 芯片与竖直轴线钉在组件最左，轴线向右引出刻度短线，与绘图区间留 14px 空隙；
绘图区内仅网格+波形（无边框盒），波形另在区内左右各内缩约 24px（视窗等效外扩实现，与网格刻度严格对齐，
避免满幅波形的起止边缘贴边形成「信号墙」）；固定带宽不随数据变化，无逐帧左右抖动

**十字光标**：悬停绘图区显示虚线十字 + 三处读数——X 样本索引芯片（底部槽）、Y 幅值芯片（左带）、
浮动框显示最近采样点实际 I/Q 值；跟随/暂停状态均可用；颜色可经 `style.crosshair` 覆盖

**X 轴时间单位**：传入 `sampleRate`（Hz）后，X 刻度、光标 X 读数、浮动框时间均换算为
自适应单位（µs/ms/s，1/2/5 步进）；内部视口仍以样本索引为单位，`viewport`/`viewportChange` 语义不变

**自动 Y 轴**：目标范围经「V/div 档位量化」（向外吸附到刻度步进族）+ 快扩张/慢收缩平滑——
小幅波动被同一档位吸收，流式刷新时刻度完全静止；仅跨档时离散更新并缓入新档；
清空数据/双击复位/外部切回 autoScale 时状态重置、直接吸附目标范围

**历史淘汰与冻结**：组件内置 200 万样本环形缓冲（Mock 默认推速下约 16s 填满），
填满后每次保留最新 90%、淘汰前沿 `dropped` 阶跃推进；滚轮/拖拽冻结后进入**完全暂停**语义——
新帧在入口直接丢弃（缓冲零增长、淘汰永不发生，视口像素级静止，暂停期间仍可缩放/平移回看历史），
恢复跟随（双击/角标）后自动继续接收；若冻结窗曾被外部视口指向已淘汰区域，视口锚定最老可用数据

**内部**：环形 2M 点，`minmax` 抽稀至 `2×px`，`WebGL2` 双 `LINE_STRIP`
