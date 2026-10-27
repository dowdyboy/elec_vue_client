# SIG-07 - 眼图（Eye Diagram）

> `src/components/signal/EyeDiagramChart.vue`
>
> 状态：纯显示眼图；调用方给已切好的轨迹，组件叠加绘制并从轨迹测量眼高/眼宽/抖动。不做时钟恢复/均衡。

## 一、输入

每条轨迹是一个 `Float32Array`，长度通常为 `samplesPerSymbol × spanSymbols`：

```ts
chart.appendData(trace)        // 单条
chart.appendTraces(traces)     // 多条
chart.setData(traces)          // 替换
```

也可传：

```ts
{ traces: Float32Array[], spanSymbols?: number, samplesPerSymbol?: number }
```

或单个 `Float32Array`（视为一条轨迹）。

调用方负责：

- 时钟恢复/最佳采样相位；
- 按 UI 切窗；
- 归一化幅度；
- 可选均衡/滤波。

## 二、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `spanSymbols` | 2 | 横向 UI 数 |
| `samplesPerSymbol` | 32 | UI 标注/抖动换算参考 |
| `maxTraces` | 500 | 轨迹上限 |
| `alpha` | 0.55 | 轨迹透明度 |
| `lineWidth` | 1 | 线宽 |
| `autoScale` | true | 自动 Y 量程 |
| `yMin/yMax` | — | 手动量程 |
| `showInfo` | true | 轨迹数/眼高/眼宽/抖动 |
| `axis/xAxis/grid/axisLabels` | true | 轴/网格 |
| `theme/chartStyle` | auto | 主题 |

渲染为 Canvas2D 叠加轨迹；眼图通常数百条轨迹，2D 足够，且不受 WebGL 点数限制。

## 三、API / 事件

- `appendData(trace|{traces})`
- `appendTraces(traces)`
- `setData(traces)`
- `clear()`
- `getStats()`：`EyeStats`
- `getTraceCount()`
- `getBackend()`：固定 `canvas2d`
- `exportPNG()` / `exportCSV()`
- 事件：`exported`、`error`、`errorDetail`

`EyeStats`：

```ts
{
  measured, traceCount, samples, min, max,
  height, opening, width, jitter, jitterUi
}
```

- `height`：中心采样点 p5~p95 的张开量；
- `opening`：眼高 / 全幅度；
- `width`：中心附近 p5~p95 张开 ≥25% 眼高的连续区间占比；
- `jitter`：首次过中点时间的 RMS / 轨迹长度；
- `jitterUi`：按 `spanSymbols` 换算的 UI 值。

## 四、最小显示预设

```ts
import { eyeDisplayOnly } from '@/components/signal'
```

```vue
<EyeDiagramChart v-bind="eyeDisplayOnly" :data="traces" />
```

只保留轴/网格/叠加轨迹，不显示指标角标。

## 五、测试

- `core/eye.test.ts`（3）：环形轨迹缓冲、双电平稳态眼高/眼宽、非有限值清洗与空输入；
- 总测试/版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 六、限制

- 不做时钟恢复、CDR、均衡、判决；
- 不做模板/掩模 Pass/Fail（后续可基于 `EyeStats` 增加）；
- 轨迹长度不一致时按各自长度映射到 0~spanSymbols；
- 眼宽/抖动是显示测量，不等同于标准眼图模板测试。
