# SIG-06 - 信号质量面板

> `src/components/signal/SignalQualityPanel.vue`
>
> 状态：纯指标显示组件；不计算 EVM/MER/SNR，只格式化、阈值判定和 Pass/Fail。

## 一、定位

产线测试/调试上位机里，EVM、MER、SNR、频偏、符号率误差、PAPR、IQ 不平衡通常需要以统一表格/卡片呈现。  
本组件只接收指标对象，不依赖星座图/频谱图，也不会触发任何 DSP。

## 二、最小使用

```vue
<SignalQualityPanel
  :metrics="{
    evmPercent: 3.2,
    merDb: 29.8,
    snrDb: 26.5,
    carrierOffsetHz: -12.4,
    paprDb: 8.1
  }"
/>
```

不传 `thresholds` 时所有指标显示为“未判定”，不会伪造 Pass。

## 三、带阈值

```vue
<SignalQualityPanel
  :metrics="metrics"
  :thresholds="{
    evmPercentMax: 5,
    merDbMin: 25,
    snrDbMin: 20,
    carrierOffsetHzMax: 50,
    paprDbMax: 10
  }"
/>
```

- EVM/PAPR：`<= max`；
- MER/SNR：`>= min`；
- 频偏/符号率误差/IQ 不平衡：`|x| <= max`；
- 功率：`min <= x <= max`；
- 任一失败 → 总体 Fail；全部有阈值且通过 → Pass；无阈值/无指标 → N/A。

## 四、与星座分析仪联动

```ts
const stats = constChart.value?.getAnalysisStats()
quality.metrics = stats ?? {}
```

`SignalQualityMetrics` 可直接接收：

- `evmPercent`
- `merDb`
- `snrDb`
- `carrierOffsetHz`
- `symbolRateErrorPpm`
- `paprDb`
- `iqGainImbalanceDb`
- `iqPhaseImbalanceDeg`
- `powerDbm`
- `peakPowerDbm`
- `frequencyHz`
- `pulseWidthSec`
- `dutyCycle`

## 五、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `metrics` | `{}` | 指标对象 |
| `thresholds` | `{}` | 阈值对象 |
| `title` | 内置文案 | 标题 |
| `compact` | false | 紧凑间距 |
| `showPassFail` | true | 总体 Pass/Fail 角标 |
| `labels/locale/messages` | — | 文案覆盖/中英文 |

没有 `analysis` 配置：这个组件本身永远只是显示/判定，不产生指标。

## 六、测试

- `core/quality.test.ts`（4）：全通过、单项失败、无阈值未判定、功率区间；
- 总测试与版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 七、限制

- 不计算物理指标；
- 不保存历史/趋势，只显示当前值；
- 指标单位由调用方保证；`powerDbm` 固定按 dBm 展示；
- 需要趋势/SPC 时由宿主把 metrics 序列化后自行绘图。
