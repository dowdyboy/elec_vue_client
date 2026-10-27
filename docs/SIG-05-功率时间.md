# SIG-05 - 功率-时间 / Zero Span

> `src/components/signal/PowerTimeChart.vue`
>
> 状态：已完成库化，默认纯显示；脉冲分析为可选 `analysis`。Canvas2D/WebGL2 折线、轴/网格、主题、i18n、PNG/CSV。

## 一、两种使用方式

### 纯显示（默认）

调用方给功率序列，组件只画功率-时间，不做脉冲检测：

```vue
<PowerTimeChart ref="pt" :height="320" :unit="'dBm'" :sample-rate="10000" />
```

```ts
pt.value?.appendData(powerDb) // Float32Array
pt.value?.getStats()
```

### 可选脉冲分析

```vue
<PowerTimeChart
  :analysis="{
    enabled: true,
    thresholdDb: -42,
    hysteresisDb: 4,
    minWidthSec: 1e-4
  }"
  :unit="'dBm'"
  :sample-rate="10000"
/>
```

分析结果：

```ts
pt.value?.getPulses()
// { measured, count, widthMeanSec, periodMeanSec, dutyCycle, pulseRateHz, peakDb, meanDb, paprDb, pulses[] }
```

## 二、输入

- `Float32Array`：功率/dB 序列；
- `{ values, timeStepSec?, sampleRate?, startTimeSec? }`；
- `adapter` 返回上述结构；
- 交织/字节流等由调用方先转换。

时间轴：

- `timeStepSec` 优先；
- 否则 `sampleRate`；
- 都没有时按样本序号显示，不伪造时间单位。

## 三、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `unit` | `'dB'` | 仅显示单位 |
| `timeStepSec` / `sampleRate` | — | 时间轴换算 |
| `startTimeSec` | 0 | 首点绝对时间 |
| `span` | 4096 | 跟随窗口点数 |
| `follow` | true | 跟随最新点 |
| `autoScale` | true | 自动 Y 量程 |
| `yMin` / `yMax` | — | 手动 Y 量程 |
| `mode` | `'line'` | line / dots |
| `lineWidth` | 1 | 线宽 |
| `showInfo` | true | 左上峰值/均值/脉冲摘要 |
| `maxPoints` | 500000 | 环形缓冲上限 |
| `thresholdDb` | — | 仅画门限线，不分析 |
| `analysis` | — | 开启脉冲分析 |
| `axis/xAxis/grid/axisLabels` | true | 轴/网格 |
| `theme/chartStyle` | auto | 主题 |

## 四、API

- `appendData(power)` / `setData(power)` / `clear()`
- `getStats()`：min/max/mean/rms/peak/PAPR
- `getPulses()`：最近一次脉冲分析
- `resetView()` / `exportPNG()` / `exportCSV()`
- `getBackend()`

事件：`exported`、`error`、`errorDetail`。

## 五、脉冲判定

```text
上升：v >= threshold + hysteresis/2
下降：v <= threshold - hysteresis/2
脉宽：下降沿前一个采样 - 上升沿 + 1
过滤：widthSec < minWidthSec 丢弃
周期：相邻脉冲 startTime 差
占空比：全部脉宽和 / (首脉冲起点 ~ 末脉冲终点)
PAPR：峰值 - 脉冲均值（dB 输入）
```

## 六、最小显示预设

```ts
import { powerTimeDisplayOnly } from '@/components/signal'
```

```vue
<PowerTimeChart v-bind="powerTimeDisplayOnly" :data="powerDb" />
```

不启用脉冲分析，仅保留轴/网格/自动量程。

## 七、测试

- `core/power.test.ts`（4）：环形缓冲、脉冲宽度/周期/占空比、最小脉宽、非有限值清洗；
- 总测试与版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 八、限制

- 输入按 dB 功率理解时 PAPR 为 `peak - mean`；线性功率请调用方先转 dB；
- 脉冲检测是门限/滞回，不做匹配滤波/雷达脉压；
- 不做 FFT/零扫宽下变频，频点由调用方选择；
- 组件不做自动触发，触发/采集属于宿主或后续分析模块。
