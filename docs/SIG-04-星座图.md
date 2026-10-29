# SIG-04 - 星座图 / 星座分析仪

> `src/components/signal/ConstellationChart.vue`
>
> 状态：**已完成库化，支持纯显示与星座分析仪双模式**。WebGL2 + Canvas2D、i18n、主题、PNG/CSV、像素回归。
>
> 最小显示：`import { constellationDisplayOnly }` 后 `v-bind="constellationDisplayOnly"`；不传 `analysis` 即不做载波/符号/EVM。

## 一、两种使用方式

### 1. 纯显示（默认，不传 `analysis`）

调用方自己准备基带/判决点 IQ，组件只负责画点、轴、量程、统计、主题和导出：

```vue
<ConstellationChart ref="const" :height="420" />
```

```ts
// 已经是基带点或任意待显示点，原样绘制
const.value?.appendData({ i, q })
```

此时组件**不做**载波下变频、符号同步、EVM，不要求调用方提供高级参数。

### 2. 星座分析仪（显式传 `analysis`）

调用方给原始复数 IQ；组件内部做中心频率下变频、残余载波估计、符号定时、判决点和 EVM/MER：

```vue
<ConstellationChart
  ref="const"
  :analysis="{
    modulation: 'QPSK',
    sampleRate: 8192,
    centerFrequencyHz: 512,
    samplesPerSymbol: 16,
    autoCarrier: true,
    autoSymbolTiming: true
  }"
  :height="480"
/>
```

```ts
const.value?.appendData(rawIq) // 原始复数 IQ，可带载波
const.value?.getAnalysisStats()
// { measured, modulation, symbolRateHz, samplesPerSymbol, carrierOffsetHz,
//   symbolTimingOffset, symbolCount, evmRms, evmPercent, merDb,
//   magnitudeErrorRms, phaseErrorRmsDeg, iqGainImbalanceDb, iqPhaseImbalanceDeg }
```

`analysis` 缺省即纯显示；不会强制调用方使用任何高级功能。

## 二、输入

支持：

- 交织 `Float32Array`：`[I0,Q0,I1,Q1,...]`；
- `{ i: Float32Array, q: Float32Array }`；
- `adapter` 返回 `ConstellationNormalized`；
- 未提供 adapter 或返回 `null` 时，按 `constellationAdapters`（与 IQ 共用）尝试 `jsonInterleaved` / `arrayBuffer` / `base64`。

**路径只有两条**：

- `analysis` 缺省：`appendData` 的点原样显示，不读取源载波/符号率，不做下变频/抽点/EVM；
- 传 `analysis`：`appendData` 视为原始 IQ，按 `analysis` 的中心频率、采样率、符号率处理。

旧版 `carrierHz` / `symbolStrobe` / `samplesPerSymbol` 便捷参数已在 **2.0.0 移除**；请统一用 `analysis`。

非法数据在入口清洗为 0，不产生 NaN；adapter 异常会 `error` + `errorDetail({code:'adapter'})`。

## 三、`analysis` 配置

| 字段                | 默认     | 说明                                                  |
| ------------------- | -------- | ----------------------------------------------------- |
| `modulation`        | `'QPSK'` | BPSK / QPSK / 16QAM 判决参考                          |
| `sampleRate`        | —        | 原始 IQ 采样率；**必填且 >0**                         |
| `centerFrequencyHz` | 0        | 分析仪中心频率（下变频）                              |
| `frequencyOffsetHz` | 0        | 已知残余频偏（Hz）                                    |
| `phaseOffsetDeg`    | 0        | 已知相位偏移                                          |
| `symbolRateHz`      | —        | 符号率；与 `samplesPerSymbol` 二选一                  |
| `samplesPerSymbol`  | —        | 每符号采样数；与 `symbolRateHz` 二选一                |
| `autoCarrier`       | false    | 用判决点 EVM 搜索估计残余频偏（BPSK/QPSK/16QAM 通用） |
| `autoSymbolTiming`  | false    | 搜索最小 EVM 的定时相位                               |
| `estimatorSymbols`  | 4096     | 参与 EVM/不平衡统计的最近符号数                       |

## 四、分析流程

```text
原始复数 IQ
  → 中心频率 NCO 下变频
  → 可选残余载波估计（在 ±symbolRate/8 内做判决点 EVM 搜索）
  → 可选符号定时相位搜索（最小 EVM）
  → 判决点抽取
  → EVM/MER、幅度/相位误差、IQ 增益/相位不平衡
```

- **载波恢复**：首帧用标称中心频率粗抽判决点，再用判决点估计残余频偏；RRC 过渡点不会直接拉偏估计；
- **符号定时**：在 `[0, samplesPerSymbol)` 内搜索整数采样偏移，取 EVM 最小；Mock 的符号中心通常已在整数边界上，自动结果常为 0，此时开关不会有视觉变化，属于正常；
- **相位旋转**：EVM 计算自动尝试 BPSK 2 个 / QPSK·16QAM 4 个参考相位；
- **统计窗口**：最近 `estimatorSymbols` 个判决点，滚动更新。

## 五、Props / API

除 `analysis` 外：

| 属性                           | 默认                      | 说明                           |
| ------------------------------ | ------------------------- | ------------------------------ |
| `pointSize`                    | `2`                       | 点大小                         |
| `alpha`                        | `0.7`                     | 点透明度                       |
| `axis` / `grid` / `axisLabels` | `true`                    | I/Q 轴、网格、轴标题           |
| `showInfo`                     | `true`                    | 点数/后端/EVM 角标             |
| `maxPoints`                    | `500000`                  | 缓冲上限                       |
| `maxRenderPoints`              | WebGL 150k / Canvas2D 30k | 绘制抽点                       |
| `theme`                        | `'auto'`                  | auto / dark / light / spectrum |
| `chartStyle` / `labels`        | —                         | 配色/文案覆盖                  |
| `viewport`                     | —                         | 手动 I/Q 量程                  |
| `exportHandler`                | —                         | 接管 PNG/CSV 持久化            |

API：

- `appendData(iq, meta?)` / `setData(iq, meta?)` / `clear()`
- `getStats()`：I/Q 极值、RMS、功率、峰值
- `getAnalysisStats()`：EVM/MER、误差、频偏、定时、符号数（纯显示返回 `null`）
- `getView()` / `setViewport()` / `resetView()` / `fit()`
- `exportPNG()` / `exportPNGAsync()` / `exportCSV()`
- `getBackend()`

事件：`viewportChange`、`exported`、`error`、`errorDetail`。

## 六、交互、主题与降级

| 操作       | 行为                         |
| ---------- | ---------------------------- |
| 滚轮       | 以光标为中心缩放 I/Q，切手动 |
| 拖拽       | 平移复平面                   |
| 双击 / `0` | 恢复自动量程                 |
| `+` / `-`  | 中心缩放                     |

- 正方形 I/Q 视口，单位长度一致；
- 自动量程扩张即时，收窄带 20% 滞回 + 180 帧驻留；
- `theme`：auto / dark / light / spectrum；主题切换只重绘，不清缓冲/量程；
- 默认 WebGL2 Points，Canvas2D 散点自动降级；轴/网格/游标在独立 2D 覆盖层。

## 七、限制

- 载波恢复估计的是**残余频偏**，要求 `centerFrequencyHz` 大致正确；大频偏请先设置中心频率；
- 自动定时只搜索整数采样相位，不做连续定时跟踪/Gardner 环；源本来对齐时结果就是 0；
- 自动载波搜索范围约 ±symbolRate/8，要求中心频率已大致对准；大频偏请先设中心频率；
- 不负责解调比特、信道解码、协议解析；
- 输入原始 IQ 时若 `analysis` 的 `sampleRate/symbolRate` 不正确，EVM 不可信；
- 纯显示模式下组件不会猜测基带/载波，调用方传入什么就画什么。

## 八、测试

- `core/constellation.test.ts`（13）：缓冲、量程、抽点、去载波、符号抽点、统计；
- `core/constellationAnalysis.test.ts`（8）：EVM、载波估计、定时、分析仪、配置校验；
- `core/presets.test.ts`（1）：九组最小显示预设；
- 总测试：`npm test` 当前 **214** 例；
- 视觉回归：`npm run test:visual` Canvas2D/WebGL2 双后端，1200×2000 页面。
