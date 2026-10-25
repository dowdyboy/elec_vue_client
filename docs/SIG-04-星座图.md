# SIG-04 - 星座图（ConstellationChart）

> `src/components/signal/ConstellationChart.vue`
>
> 状态：**已完成库化**（WebGL2 + Canvas2D 降级、I/Q 轴/网格、自动/手动量程、缩放平移、i18n、PNG/CSV、像素回归）。

星座图把 IQ 流的 I/Q 样本作为散点画在复平面上。它适合观察 QPSK/QAM 的簇、噪声、幅度/相位不平衡、IQ 镜像和调制器损伤；**不替代符号同步/判决/EVM 分析**。

## 一、快速使用

```vue
<ConstellationChart
  ref="const"
  theme="dark"
  :point-size="2"
  :alpha="0.7"
  :max-points="200000"
  :renderer="'auto'"
  :height="420"
/>

<!-- 流式 IQ：交织 Float32Array 或 { i, q } -->
<script setup lang="ts">
const const = ref()
onIq((iq) => const.value?.appendData(iq))
</script>
```

```ts
const const = ref<InstanceType<typeof ConstellationChart>>()
const.appendData(iq)           // 追加，环形缓冲自动淘汰
const.setData(iq)              // 清空后写入
const.clear()
const.resetView()              // 双击/自适应
const.getStats()               // I/Q 极值、RMS、功率、峰值
const.getView()                // 当前 I/Q 范围
const.exportPNG()
const.exportCSV()
```

## 二、输入与适配器

支持：

- 交织 `Float32Array`：`[I0,Q0,I1,Q1,...]`；
- `{ i: Float32Array, q: Float32Array }`；
- `adapter` 返回 `ConstellationNormalized`；
- 未提供 adapter 或返回 `null` 时，按 `constellationAdapters`（与 IQ 共用）尝试 `jsonInterleaved` / `arrayBuffer` / `base64`。

```ts
const adapter = (raw: unknown) => {
  const v = raw as { i: number[]; q: number[] }
  return { i: Float32Array.from(v.i), q: Float32Array.from(v.q) }
}
```

非法数据在入口清洗为 0，不产生 NaN；adapter 异常会 `error` + `errorDetail({code:'adapter'})`。

## 三、坐标与量程

- **正方形绘图区**：星座图始终使用正方形 I/Q 视口，保证单位长度一致，不会在宽画布上被拉成椭圆，也不会把 QPSK 四簇压到中心；
- **自动量程**：以 `(0,0)` 为中心，按 `max(|I|,|Q|)` + 12% 余量，并向外吸附到 1/2/5×10^k 刻度档位；
- **手动量程**：`viewport: { xMin,xMax,yMin,yMax }`；若范围不是正方形，内部按较大跨度等比扩展（保持中心）；
- **自适应**：`resetView()` / 双击 / `setViewport({ autoScale: true })`；
- **缩放/平移**：滚轮以光标为锚点缩放，拖拽平移；交互后自动切到手动量程，`viewportChange` 事件回传；
- **抽点绘制**：`maxRenderPoints` 默认 WebGL 150k、Canvas2D 30k；只影响绘制，不丢缓冲。

## 四、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `pointSize` | `2` | 点大小（CSS px；GL 内部按 DPR 换算） |
| `alpha` | `0.7` | 点透明度 0~1 |
| `axis` | `true` | I/Q 坐标轴与刻度槽 |
| `grid` | `true` | 网格 |
| `axisLabels` | `true` | I/Q 轴标题 |
| `showInfo` | `true` | 右上角点数/后端角标 |
| `maxPoints` | `500000` | 缓冲上限；超出淘汰最老点 |
| `maxRenderPoints` | 见上 | 单帧绘制点数上限 |
| `renderer` | `'auto'` | `auto` / `webgl2` / `canvas2d` |
| `theme` | `'auto'` | light / dark / auto / spectrum |
| `chartStyle` | — | 颜色覆盖（`traceColor` 为点颜色，`grid/text/border/plotBg/zeroLine` 等复用通用字段） |
| `labels` | — | `i/q/aria` 等文案覆盖 |
| `viewport` | — | 手动 I/Q 量程 |
| `exportHandler` | — | 接管 PNG/CSV 持久化 |
| `adapter` / `data` | — | 数据输入 |

通用 props（`width/height/fpsLimit/locale/messages/renderer`）与其它组件一致。

## 五、交互与 API

| 操作 | 行为 |
| --- | --- |
| 滚轮 | 以光标为中心缩放 I/Q，切手动 |
| 拖拽 | 平移复平面 |
| 双击 / `0` | 恢复自动量程 |
| `+` / `-` | 中心缩放 |
| `getView()` | `{xMin,xMax,yMin,yMax,autoScale}` |
| `setViewport(v)` | 手动范围；`{autoScale:true}` 恢复自动 |
| `getStats()` | `{points,renderPoints,iMin,iMax,qMin,qMax,iRms,qRms,power,powerDbfs,peak}` |
| `exportPNG/Async` | 组合主画布 + 轴层 + 背景 |
| `exportCSV` | `index,i,q` 全缓冲 |

事件：`viewportChange`、`exported`、`error`、`errorDetail`。

## 六、渲染与降级

- 默认 `renderer='auto'`：优先 WebGL2 `POINTS`；不可用回退 Canvas2D 散点；
- 强制 `renderer='webgl2'` 失败时 emit `error`/`errorDetail` 并显示占位；
- 轴/网格/游标在独立 2D 覆盖层绘制，主画布只画点；
- WebGL 开启 `preserveDrawingBuffer`，保证 `exportPNG` 能合成当前帧；
- 视觉回归覆盖 canvas2d/webgl2 双后端（1200×2000 页面，含 QPSK 四簇）。

## 七、限制与后续

- 输入是**原始 IQ**，包含符号过渡轨迹；要显示判决点需宿主做符号同步/最佳采样点抽取（组件提供抽点，不做定时恢复）；
- 暂未提供 EVM/幅度误差/相位误差/IQ 不平衡等**参考星座**测量；
- 暂未提供密度热力图（density）和 2D 直方图；当前为点云 + alpha；
- 星座的“中心/量程”是显示域，不改变原始 IQ 数值。

## 八、测试

`src/components/signal/core/constellation.test.ts`（7）：

- 环形缓冲追加/淘汰/`setMaxPoints`；
- 对称自动量程/全零回退；
- 宽/高画布的等比扩展；
- 抽点数量与不修改原缓冲；
- I/Q 极值/RMS/功率/峰值；
- 刻度格式。

总测试：`npm test` 当前 **165** 例；视觉回归 `npm run test:visual` 双后端。
