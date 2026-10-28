# SIG-10 - APD / CCDF

> `src/components/signal/ApdCcdfChart.vue`
>
> 状态：纯显示曲线 + 可选从功率样本计算。Canvas2D；X=dB，Y=%。

## 一、两种模式

### 1. 纯显示：调用方给曲线

```ts
chart.appendData({
  apd: { x, y },   // y 为各电平概率 %
  ccdf: { x, y },  // y 为超限概率 %
  meanDb: 0,
  peakDb: 10,
  paprDb: 10,
  p01Db: 8,
  p1Db: 6,
  sampleCount: 20000
})
```

### 2. 可选 analysis：从功率样本计算

```vue
<ApdCcdfChart
  :analysis="{ enabled: true, bins: 100 }"
  theme="spectrum"
/>
```

```ts
chart.appendData(samplesDb) // Float32Array
```

- 输入默认按 dB；`analysis.linear:true` 时按线性功率，内部 `10log10`；
- 直方图 → APD（各 bin 概率）；
- 从高到低累加 → CCDF（超限概率）；
- 同时给出均值/峰值/PAPR/CCDF 0.1% 与 1% 电平。

不开 `analysis` 时传样本会报 `apd.needCurves`。

## 二、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `data` | — | ApdCcdfData 纯显示 |
| `analysis` | — | 样本计算配置 |
| `analysis.bins` | 100 | 直方图 bin 数 |
| `analysis.minDb/maxDb` | — | 固定范围；缺省由样本推导 |
| `analysis.linear` | false | 输入是否线性功率 |
| `showInfo` | true | 左上统计 |
| `lineWidth` | 1.5 | 曲线线宽 |
| `axis/xAxis/grid/axisLabels` | true | 轴/网格 |
| `theme/chartStyle` | auto | 主题 |

## 三、API

- `appendData(curves | samples)` / `setData(...)` / `clear()`
- `getStats()`：ApdCcdfData
- `getBackend()`：固定 canvas2d
- `exportPNG()` / `exportCSV()`
- 事件：`exported`、`error`、`errorDetail`

核心计算可独立使用：

```ts
import { computeApdCcdf } from '@/components/signal'

const d = computeApdCcdf(samples, { bins: 100, linear: false })
```

## 四、最小显示预设

```ts
import { apdCcdfDisplayOnly } from '@/components/signal'
```

```vue
<ApdCcdfChart v-bind="apdCcdfDisplayOnly" :data="curves" />
```

纯显示不显示信息栏，保留轴/网格。

## 五、测试

- `core/apd.test.ts`（3）：dB 样本 APD/CCDF/PAPR、线性转 dB、空输入；
- 总测试/版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 六、限制

- 不做 FFT/解调/包络检波，样本由调用方提供；
- APD/CCDF 共用 0~100% 线性 Y 轴，不对概率轴做对数缩放；
- CCDF 0.1%/1% 是直方图 bin 分位，精度受 `bins` 限制；
- 稀疏尖峰需要足够样本数才有稳定尾部。
