# SIG-09 - Smith 圆图（Smith Chart）

> `src/components/signal/SmithChart.vue`
>
> 状态：纯显示复反射系数轨迹；Canvas2D；等电阻/等电抗网格、游标、VSWR/回波损耗/阻抗读数。
>
> Demo 支持“仿真轨迹 / S11 扫频”数据源：S11 由独立 SweepService 生成串联 RLC 的 Γ(f)，组件本身仍保持纯显示。
>
> S11 模式支持端口延时/补偿损耗校准与去嵌入（`calDelayPs`、`calLossDb`），仅作用于显示数据。

## 一、输入

```ts
interface SmithTrace {
  i: Float32Array // Γ 实部
  q: Float32Array // Γ 虚部
  name?: string
  color?: string
}
```

```ts
chart.appendData({ i, q, name: 'Antenna' })
chart.appendData([trace1, trace2])
chart.setData(traces)
```

也可通过 `data` prop 直接传单条/多条轨迹。

调用方负责：

- VNA 校准/去嵌入；
- 频率扫描组织；
- 把 S11 转成复反射系数。

## 二、Props

| 属性                     | 默认 | 说明                     |
| ------------------------ | ---- | ------------------------ |
| `z0`                     | 50   | 特性阻抗，用于阻抗读数   |
| `traceWidth`             | 1.5  | 轨迹线宽                 |
| `alpha`                  | 0.9  | 轨迹透明度               |
| `showGrid`               | true | 等电阻/等电抗网格        |
| `showLabels`             | true | Γ 轴/网格标签            |
| `showCursor`             | true | 最近点游标               |
| `showInfo`               | true | 轨迹数/最大 VSWR/最小 RL |
| `maxPoints`              | 2000 | 单条轨迹最多点数         |
| `freqStartHz/freqStopHz` | —    | 预留频率信息             |
| `theme/chartStyle`       | auto | 主题                     |

## 三、网格/读数

- 等电阻圆：\(r\in[0,0.2,0.5,1,2,5,10]\)；
- 等电抗圆：\(|x|\in[0.2,0.5,1,2,5,10]\)，正负两族；
- 外圆为 \(|\Gamma|=1\)；
- 游标显示：
  - Γ 实部/虚部；
  - \(|\Gamma|\)；
  - VSWR = \((1+|\Gamma|)/(1-|\Gamma|)\)；
  - 回波损耗 = \(-20\log_{10}|\Gamma|\)；
  - 阻抗 \(Z=Z_0(1+\Gamma)/(1-\Gamma)\)。

## 四、API

- `appendData(trace | traces)` / `setData(traces)` / `clear()`
- `getStats()`：points/maxGamma/minReturnLossDb/maxVswr/meanVswr
- `getTraceCount()` / `getBackend()`（固定 canvas2d）
- `exportPNG()` / `exportCSV()`
- 事件：`exported`、`error`、`errorDetail`

核心数学也可独立使用：

```ts
import { gammaToImpedance, gammaToVswr, gammaToReturnLossDb } from '@/components/signal'
```

## 五、最小显示预设

```ts
import { smithDisplayOnly } from '@/components/signal'
```

```vue
<SmithChart v-bind="smithDisplayOnly" :data="traces" />
```

不显示信息栏，保留网格/标签/游标。

## 六、测试

- `core/smith.test.ts`（3）：Γ=0、实/复反射系数、轨迹统计；
- 总测试/版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 七、限制

- 不做 VNA 校准/去嵌入/时域变换；
- 网格为标准归一化 Smith 网格，不支持任意阻抗坐标缩放；
- 频率只作为元数据，当前不按频率着色；
- 超出单位圆的点会被裁剪显示。
