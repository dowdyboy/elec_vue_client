# 信号组件（IQ / 频谱 / 时频 / 星座 / 功率-时间 / 信号质量 / 眼图 / 持续谱 / Smith / APD-CCDF）集成指南

> 面向“把组件接到其他上位机项目”的公共说明。组件内部实现与设计细节见仓库
> `docs/SIG-00-信号组件总览.md`、`docs/SIG-01-IQ时域图.md`、`docs/SIG-02-频谱图.md`、`docs/SIG-03-时频图.md`
> （拷贝本目录时可按需一并拷贝这些文档）。

## 1. 环境要求

- Vue **3.4+**（`defineProps` 类型推断 / `defineExpose`）
- 默认使用 **WebGL2**；不可用时自动回退 **Canvas2D**（`renderer="webgl2"` 可强制、失败会 emit error）
- `ResizeObserver`、Pointer Events；图表样式用到 `color-mix()`（Chromium 111+ / Electron 39+）
- 无 UI 库、无图表库依赖；仅依赖 `vue`
- 支持 Vite / webpack 等现代构建器（组件不依赖 Vite 专有环境变量）

## 2. 引入方式

### 方式 A：拷贝目录（推荐用于内部上位机）

```bash
node scripts/copy-signal.mjs ../my-host-app
# 默认不拷贝 *.test.ts；需要测试时加 --with-tests
```

宿主中：

```ts
import {
  IqChart,
  SpectrumChart,
  SpectrogramChart,
  ConstellationChart,
  PowerTimeChart,
  SignalQualityPanel,
  EyeDiagramChart,
  PersistenceSpectrumChart,
  SmithChart,
  ApdCcdfChart,
  iqAdapters
} from '@/components/signal'
```

> 公共入口会引入 10 个组件；只打包部分组件时可直接深路径导入
> `@/components/signal/IqChart.vue` / `SpectrumChart.vue` / `SpectrogramChart.vue` / `ConstellationChart.vue` / `PowerTimeChart.vue` / `SignalQualityPanel.vue` / `EyeDiagramChart.vue` / `PersistenceSpectrumChart.vue` / `SmithChart.vue` / `ApdCcdfChart.vue`，由打包器做 tree-shaking。

### 方式 B：全局注册

```ts
import SignalCharts from '@/components/signal'
app.use(SignalCharts)
// <IqChart /> <SpectrumChart /> ...
```

### 方式 C：构建为可发布包

```bash
npm run build:signal
# 产物：dist-signal/
#   signal-charts.js / signal-charts.css / types/ / package.json
```

宿主（Vue 作为 peerDependency）：

```ts
import { IqChart, SpectrumChart, SpectrogramChart } from 'elec-signal-charts'
import 'elec-signal-charts/style.css'
```

> 包名/版本在 `scripts/write-signal-package.mjs` 中可改；未发布 npm 时可直接从 `dist-signal` 安装或拷贝。

### 最小显示预设

公共入口导出九组“纯显示”props 组合；不传额外分析参数即可当普通画布使用：

```ts
import {
  IqChart,
  SpectrumChart,
  PowerTimeChart,
  EyeDiagramChart,
  PersistenceSpectrumChart,
  SmithChart,
  ApdCcdfChart,
  iqDisplayOnly,
  spectrumDisplayOnly,
  powerTimeDisplayOnly,
  eyeDisplayOnly,
  persistenceDisplayOnly,
  smithDisplayOnly,
  apdCcdfDisplayOnly
} from '@/components/signal'

// 不启用触发/包络/右键菜单
<IqChart v-bind="iqDisplayOnly" :data="iq" />

// 不自动量程、不显示信息栏/图例/峰值表，不跑 VBW/余辉/限制线
<SpectrumChart v-bind="spectrumDisplayOnly" :data="row" />

// 不启用脉冲分析
<PowerTimeChart v-bind="powerTimeDisplayOnly" :data="powerDb" />

// 只叠加眼图轨迹，不显示指标角标
<EyeDiagramChart v-bind="eyeDisplayOnly" :data="traces" />

// 直接显示密度矩阵，不显示信息栏
<PersistenceSpectrumChart v-bind="persistenceDisplayOnly" :data="matrix" />

// Smith 只画 Γ 轨迹
<SmithChart v-bind="smithDisplayOnly" :data="traces" />

// APD/CCDF 只画曲线
<ApdCcdfChart v-bind="apdCcdfDisplayOnly" :data="curves" />
```

- `iqDisplayOnly`：触发关闭、包络关闭、右键菜单关闭；
- `spectrumDisplayOnly`：固定量程、关闭信息栏/图例/菜单/峰值表/标记表、VBW=0、余辉=0；
- `spectrogramDisplayOnly`：固定电平、关闭参数栏/右键菜单；
- `constellationDisplayOnly`：不传 `analysis`，只画点；
- `powerTimeDisplayOnly`：不启用脉冲分析、不显示信息栏；
- `eyeDisplayOnly`：只叠加轨迹、不显示指标角标；
- `persistenceDisplayOnly`：直接显示密度矩阵、不显示信息栏；
- `smithDisplayOnly`：只画 Γ 轨迹、保留网格/游标；
- `apdCcdfDisplayOnly`：只画 APD/CCDF 曲线；
- 预设之后可继续覆盖任意 prop，后者优先。

### 尺寸（重点）

`width` / `height` 支持 **数字（px）或字符串**，便于 flex/grid 宿主：

```vue
<div style="height: 100%">
  <SpectrumChart height="100%" />
</div>
```

> 组件根节点默认 `width:100%`、高度 `260px`；字符串高度需要父容器有确定高度。
> 外观覆盖用 **`chart-style`**（不要用原生 `style` 传主题字段；原生 `style` 现在可用于布局）。

## 3. 快速开始

### IQ 时域

```vue
<template>
  <IqChart
    ref="iq"
    :adapter="iqAdapters.int16Interleaved"
    :sample-rate="sampleRate"
    :max-points="400_000"
    height="100%"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { IqChart, iqAdapters } from '@/components/signal'

const iq = ref<InstanceType<typeof IqChart> | null>(null)
const sampleRate = 1_000_000

ws.onmessage = (e) => iq.value?.appendData(e.data, { sampleRate })
</script>
```

### 频谱

```vue
<SpectrumChart
  ref="spec"
  :adapter="spectrumAdapters.uint8"
  :unit="'dBFS'"
  :traces="[
    { mode: 'clear', label: 'TX1' },
    { mode: 'maxHold', label: 'MAX' }
  ]"
  height="100%"
  @meta-change="onMeta"
/>
```

```ts
spec.value?.appendData(buffer, { sampleRate: 1_000_000, fftSize: 4096, dbScale: true })
```

### 实信号单边 / 复谱带符号

```vue
<!-- real（默认）：0~Fs/2 单边 -->
<SpectrumChart :sample-rate="4_000_000" :fft-size="1024" />

<!-- complex：完整 N bin，-Fs/2~+Fs/2 -->
<SpectrumChart
  spectrum-mode="complex"
  :sample-rate="4_000_000"
  :fft-size="1024"
  :freq-start-hz="-2000000"
  :bin-hz="3906.25"
  fft-shift
/>
```

```ts
spec.value?.appendData(fullNRow, {
  sampleRate: 4_000_000,
  fftSize: 1024,
  spectrumMode: 'complex',
  freqStartHz: -2_000_000,
  binHz: 3906.25,
  fftShift: true,
  dbScale: true
})
```

> `real`：只取 I 通道，非 DC ×2，长度 `fftSize/2`；`complex`：I/Q 完整 FFT，长度 `fftSize`，负频独立。
> 频率轴统一 `f = freqStartHz + bin × binHz`；`freqOffsetHz` 只影响显示读数。
> 源/服务高级配置的 `imageDb` 可在 `-freq` 叠加 -120~0 dB 的共轭镜像，用于验证负频；它是**相对载波**电平（-20 dB = 负频低 20 dB，只有 0 dB 等幅），默认 -120 关闭。0 dB 时 Q 抵消、基带变实，QPSK/16QAM 会退化；复调制请关闭镜像或使用独立负频。

### 信号源（只影响演示后端）

源工作台/高级配置按专业源拆分：

- `outputMode`：`real`（默认）单路实数输出，IQ 捕获 I=x、Q=0；`complex` 复 IQ 输出；
- `waveform`：CW / AM / FM / Pulse / Two-tone / Noise / Digital（BPSK/QPSK/16QAM）；
- 参数：载波、幅度、AWGN SNR、调制频率、AM 调制度、FM 频偏、脉冲周期/占空比、双音间隔；
- `spectrumMode` 是**分析模式**，只决定单边/复谱 FFT，不改变源；Real 源做复谱分析自然左右对称，Complex 源做 real 分析只是 I 投影；
- UI 的「输出模式/波形」在信号源区，「分析模式（FFT）」在处理区；真实源 IQ 图 Q=0 是正常现象。

### 星座图 / 星座分析仪

纯显示（默认，不传 `analysis`）：

```vue
<ConstellationChart ref="const" theme="dark" :point-size="2" :height="420" />
```

```ts
const.value?.appendData({ i, q }) // 调用方给什么就画什么
const.value?.getStats()
```

可选分析仪（传 `analysis` 才启用）：

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
const.value?.appendData(rawIq)
const.value?.getAnalysisStats() // EVM/MER/误差/IQ 不平衡/频偏/定时
```

- 纯显示不强制载波/符号/EVM 参数；组件只画点、轴、量程、统计；
- 分析仪模式内部做 NCO 下变频、残余载波估计、符号定时、判决点与 EVM/MER；
- 2.0 起旧 `carrierHz/symbolStrobe/samplesPerSymbol` 已移除；唯一预处理入口是 `analysis`；
- 正方形 I/Q 视口 + 自动/手动量程，滚轮缩放/拖拽平移/双击复位；
- WebGL2 Points 优先，Canvas2D 散点自动降级；主题/i18n/PNG/CSV 同其它组件；
- 详细 API/限制见 [SIG-04](../../../docs/SIG-04-星座图.md)。

### 功率-时间 / Zero Span

```vue
<PowerTimeChart ref="pt" :height="320" :unit="'dBm'" :sample-rate="10000" />
```

```ts
pt.value?.appendData(powerDb) // 已经算好的功率序列
pt.value?.getStats()
```

可选脉冲分析：

```vue
<PowerTimeChart
  :analysis="{ enabled: true, thresholdDb: -42, hysteresisDb: 4, minWidthSec: 1e-4 }"
/>
```

- 默认只画功率，不检测脉冲；
- 有 `analysis` 时叠加门限/脉冲带，输出脉宽/周期/占空比/PAPR；
- 详细 API 见 [SIG-05](../../../docs/SIG-05-功率时间.md)。

### 信号质量面板

```vue
<SignalQualityPanel :metrics="analysisStats" :thresholds="{ evmPercentMax: 5, merDbMin: 25 }" />
```

- 只显示调用方/分析仪给的指标，不做 DSP；
- 有阈值才判 Pass/Fail，无阈值显示 N/A；
- 详细指标/阈值见 [SIG-06](../../../docs/SIG-06-信号质量面板.md)。

### 眼图

```vue
<EyeDiagramChart ref="eye" :height="420" :span-symbols="2" :samples-per-symbol="32" />
```

```ts
eye.value?.appendData(trace) // Float32Array，调用方切好的 2UI 轨迹
eye.value?.appendTraces(traces)
eye.value?.getStats() // 眼高/眼宽/抖动
```

- 只叠加调用方切好的轨迹，不做时钟恢复/均衡；
- Canvas2D 叠加，适合数百条轨迹；
- 详细 API 见 [SIG-07](../../../docs/SIG-07-眼图.md)。

### 持续谱 / 密度谱

纯显示密度矩阵：

```ts
chart.appendData({
  width: 256,
  height: 256,
  minDb: -120,
  maxDb: -10,
  density: counts // level*width+bin
})
```

可选逐帧累计：

```vue
<PersistenceSpectrumChart
  :bins="256"
  :levels="256"
  :min-db="-120"
  :max-db="-10"
  :analysis="{ enabled: true, decay: 0.02 }"
  color-map="turbo"
/>
```

```ts
chart.appendData(spectrumDb) // Float32Array
```

- 纯显示不做累加；`analysis` 才把 dB 谱逐帧累加；
- Canvas2D 热力图，频率/幅度轴、色标、游标；
- 详细 API 见 [SIG-08](../../../docs/SIG-08-持续谱.md)。

### Smith 圆图

```vue
<SmithChart ref="smith" :height="520" :z0="50" />
```

```ts
smith.value?.appendData({ i, q, name: 'Antenna' }) // Γ 实部/虚部
smith.value?.getStats() // VSWR/回波损耗
```

- 纯显示 Γ 轨迹，不做 VNA 校准；
- 等电阻/等电抗网格，游标显示 Γ/VSWR/RL/阻抗；
- 详细 API 见 [SIG-09](../../../docs/SIG-09-Smith圆图.md)。

### APD / CCDF

纯显示曲线：

```ts
chart.appendData({
  apd: { x, y },
  ccdf: { x, y },
  meanDb,
  peakDb,
  paprDb,
  p01Db,
  p1Db,
  sampleCount
})
```

可选从功率样本计算：

```vue
<ApdCcdfChart :analysis="{ enabled: true, bins: 100 }" />
```

```ts
chart.appendData(samplesDb)
```

- 不开 `analysis` 时只接受 APD/CCDF 曲线；
- 输出 APD/CCDF/PAPR/0.1%/1% 电平；
- 详细 API 见 [SIG-10](../../../docs/SIG-10-APD-CCDF.md)。

### 时频瀑布

```vue
<SpectrogramChart
  ref="specgram"
  color-map="viridis"
  :time-span="256"
  :sample-rate="4_000_000"
  :fft-size="1024"
  :time-step-sec="0.000256"
  height="100%"
/>
```

```ts
specgram.value?.appendData(rowDb, {
  sampleRate: 4_000_000,
  fftSize: 1024,
  timeStepSec: 0.000256,
  spectrumMode: 'complex',
  freqStartHz: -2_000_000,
  binHz: 3906.25,
  fftShift: true
})
```

> 行长度 = real `fftSize/2` / complex `fftSize`；固定 dB 口径 -120~0。WebGL2 R8 纹理 + LUT，无 WebGL2 时 Canvas2D 降级；
> 支持频率缩放/平移、冻结、自动/手动电平、色标、游标、PNG/CSV；详见 [SIG-03](../../../docs/SIG-03-时频图.md)。

## 4. 数据格式与适配器

组件接受 `Float32Array` / `{ i, q }` / `ArrayBuffer` / TypedArray / base64，最终由适配器归一化。

**IQ 常用适配器**

| 适配器                                                      | 用途                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `iqAdapters.passthrough`                                    | Float32 交织或 `{i,q}`                                                  |
| `iqAdapters.jsonInterleaved`                                | `{i:[],q:[]}` / `{data:[]}`                                             |
| `iqAdapters.int16Interleaved`                               | **int16 交织，1/32768 归一化**（最常见硬件格式）                        |
| `iqAdapters.int16Planar`                                    | int16 平面 `{i,q}`                                                      |
| `iqAdapters.float64Interleaved`                             | Float64 交织                                                            |
| `createIqAdapter({ dtype, layout, scale, offset, endian })` | 自定义：`dtype: 'int16' \| 'int8' \| 'uint8' \| 'float32' \| 'float64'` |

**频谱常用适配器**

| 适配器                                                              | 用途                      |
| ------------------------------------------------------------------- | ------------------------- |
| `spectrumAdapters.passthrough`                                      | Float32 dB/线性           |
| `spectrumAdapters.uint8`                                            | Uint8 0..255 → -120..0 dB |
| `spectrumAdapters.int16`                                            | int16，默认 0.01 dB/LSB   |
| `createSpectrumAdapter({ dtype, scale, offset, min, max, endian })` | 自定义                    |

> 非有限值（NaN/Inf）会在组件入口被清洗：IQ 置 0，频谱填 floor，不会破坏自动量程/GL。

## 5. 常用 Props / 事件 / 方法

完整列表见 `core/types.ts` 与 docs/SIG-*。

**通用**

- `theme`：`light | dark | auto | spectrum`；`auto` 会跟随系统深浅色变化
- `chartStyle`：颜色/线宽/轴宽/多迹线调色板（`tracePalette`）等字段覆盖
- `labels`：轴标题/角标/图例/aria 文案（最高优先级，兼容旧用法）
- `locale`：`zh-CN`（默认）| `en-US`；`messages`：按 key 覆盖任意内置文案
- `width/height`：数字或 CSS 字符串
- `renderer`：`auto`（默认，WebGL2→Canvas2D）/ `webgl2` / `canvas2d`；**挂载时生效**
- `preserveDrawingBuffer`：默认 `true`；无余辉需求可设 `false` 降低拷贝开销
- `contextMenu`：默认 `true`；设 `false` 后仍会 emit `contextmenu`，由宿主自绘
- 事件：`error`、`errorDetail`、`cursorChange`、`ready`、`contextLost`、`contextRestored`、`exported`、`contextmenu`、`viewportChange`
- 无障碍/触摸：根节点 `tabindex/role/aria-label`，聚焦后可键盘操作；触摸支持双指 X 缩放
- 离屏：IntersectionObserver 不可见时暂停重绘（数据仍入缓冲）；`dispose()` 可手动释放

**IQ 新增**

- `follow` / `update:follow`：受控跟随；`v-model:follow`
- `maxPoints`：环形缓冲上限（默认 2,000,000，挂载时生效）
- 方法：`setFollow` / `setPaused` / `setSpan` / `setYRange` / `getStats` / `getVisibleData` / `addMarker` / `setMarkers` / `removeMarker` / `resize` / `redraw` / `exportPNGAsync` / `dispose`
- `appendData(raw, meta?)`：`meta.sampleRate` 可用于时间轴

**频谱新增**

- `paused` / `update:paused`：`v-model:paused`
- `SpectrumTraceSpec.label`：图例自定义名称
- 方法：`getPeaks(opts?)`（不再依赖峰值表开关）、`addMarker` / `setMarkers` / `removeMarker`、`measureOBW(pct, {loBin,hiBin})` / `measureNdB(nDb, {loBin,hiBin,...})` / `measureChannelPower({loBin,hiBin})` / `bandPower(lo, hi)`、`getVisibleData` / `getStats` / `resize` / `redraw` / `exportPNGAsync` / `dispose`
- 事件：`activeTraceChange`、`contextmenu`、`cursorChange`、`ready`、`contextLost/restored`

## 6. 布局 / 主题 / 文案

```vue
<SpectrumChart
  height="100%"
  :chart-style="{ bg: '#000', traceColor: '#ffd60a', tracePalette: ['#ffd60a', '#36cfc9'] }"
  :labels="{
    x: 'Frequency',
    y: 'Amplitude (dBFS)',
    paused: 'Frozen',
    stale: 'No data',
    aria: 'Spectrum',
    legend: { clear: 'Live', maxHold: 'Max' }
  }"
/>
```

- 原生 `class`/`style` 可以正常用于布局；外观色请走 `chart-style`。
- 内置 `spectrum` 主题为黑底黄迹频谱仪风格；`tracePalette` 可覆盖多迹线调色板。
- 覆盖插槽：`<template #overlay>…</template>` 可叠加自定义标注/告警框（默认 `pointer-events:none`）。
- 图表根节点可聚焦（`tabindex=0`），聚焦后键盘快捷键生效；触摸屏支持双指 X 缩放（IQ/频谱/时频）。

### 多语言

```vue
<SpectrumChart locale="en-US" />
<!-- 或按 key 覆盖 -->
<SpectrumChart
  locale="zh-CN"
  :messages="{
    'spectrum.menuPeak': '找峰',
    'common.stale': '无数据',
    'spectrum.legendClear': '当前'
  }"
/>
```

- 内置 `zh-CN` / `en-US`（`core/i18n.ts`），覆盖轴标题、菜单、角标、图例、触发状态、统计、限制线判定等。
- 优先级：`labels`（旧字段） > `messages` > `locale` 内置。
- 可用 `translate()`/`zhCN`/`enUS`/`ChartMessages` 自行扩展；数值单位（Hz/dB/ms）保持 SI/仪器通用写法。

## 7. 性能与限制

- IQ 默认 2M 环缓冲，约 25~40MB/实例；多实例/低内存请显式设置 `maxPoints`。
- **WebGL2 后端**：每个图表一个 WebGL2 上下文；浏览器通常限制 8~16 个，仪表盘请控制实例数。
- **Canvas2D 回退**：无上下文数量限制，适合工业面板/远程桌面；建议保持 `decimation:'minmax'`（默认），`decimation:false` + 大窗会明显变慢。
- 高频 ingestion 在主线程按样本循环；>50 万点/帧建议先在宿主侧抽稀，或使用 `playground/src/iqWorker.ts` 的 Worker 解析模式。
- 不可见（离屏）时暂停重绘；数据仍入缓冲，滚回可见时补一帧。
- 频谱/时频支持 **real 单边 0~Fs/2** 与 **complex 完整带符号复谱 -Fs/2~+Fs/2**；复谱负频独立，不要只取正半轴。
- 频率轴由 `freqStartHz + bin × binHz` 决定；`freqOffsetHz` 仅显示偏移，API/CSV 返回物理频率。
- 噪声底未做 ENBW/PSD 绝对校准；峰值已按窗相干增益校准，Mock 默认口径为 dBFS。
- 多迹线是**同一帧数据**的显示变换；两路独立信号请开两个实例（或等后续独立 source API）。
- 时频默认保留 `timeSpan` 行（256 行 × 512 bin 约 0.5MB）；WebGL 纹理按行增量上传，只有电平/gamma/色阶变化才整幅重建；Canvas2D 回退每帧按可见行×列映射，建议控制 `timeSpan`/FFT 规模。
- 时频时间轴依赖 `timeStepSec`（帧/ prop）；重叠行请由服务端显式提供，否则按非重叠 `fftSize/sampleRate` 估算。
- 无浏览器级单测；核心数学/文案有 206 个单测。像素级视觉回归覆盖 canvas2d/WebGL2 两条后端（含 real/complex 时频、频谱与星座，见下节）。

## 8. Playground、像素级视觉回归与截图冒烟

不依赖 Electron 的最小 Vite 宿主在 `playground/`：

```bash
npm run playground          # 开发服务器
npm run build:playground    # 生产构建（index + visual + smoke 三个入口）
```

**像素级视觉回归**（固定种子、1200×2000 页面、dark、en-US、DPR=1；real + complex 频谱/瀑布 + QPSK 星座，分别回归 canvas2d/webgl2）：

```powershell
npm run test:visual          # 构建 + canvas2d/webgl2 双后端像素对比
npm run test:visual:update   # 构建 + 更新两套基线
```

- 基线：`playground/visual/baseline-canvas2d.png`、`baseline-webgl2.png`；失败时输出 `playground/dist/visual-*.png`。
- 判定：通道差 > `VISUAL_PIXEL_DELTA`（默认 16）计差异像素，占比 > `VISUAL_MAX_DIFF_RATIO`（默认 0.4%）失败。
- 基线绑定本机 Electron/GPU/字体；CI 需在相同镜像生成。DPR 通过 `--force-device-scale-factor=1` 固定；每个后端独立 Electron 进程运行。

**新组件 smoke**（PowerTime/Eye/Persistence/Smith/APD/Quality 的 API、统计与渲染）：

```powershell
npm run test:smoke
# 构建 playground 后由 Electron 加载 smoke.html，检查统计结果、页面错误并截图
# 输出：playground/dist/smoke.png
```

**截图冒烟**（可交互 Playground，自动检查非空）：

```powershell
npm run build:playground
npx vite preview --config playground/vite.config.ts --port 4173
# 另开终端；Windows 需先清除 ELECTRON_RUN_AS_NODE
$env:ELECTRON_RUN_AS_NODE = $null
$env:SHOT_URL='http://127.0.0.1:4173/?renderer=canvas2d'
$env:SHOT_OUT='playground/dist/canvas2d.png'
npx electron scripts/screenshot-playground.cjs
```

> `?nowebgl=1` 模拟无 WebGL2，验证 `renderer='auto'` 的 Canvas2D 回退；截图脚本会检查颜色数，白屏/黑屏直接失败。

## 9. 版本

`SIGNAL_CHARTS_VERSION = '2.4.2'`（公共 API 变更时按语义化版本维护）。
