# 信号组件（IQ / 频谱）集成指南

> 面向“把组件接到其他上位机项目”的公共说明。组件内部实现与设计细节见仓库
> `docs/SIG-00-信号组件总览.md`、`docs/SIG-01-IQ时域图.md`、`docs/SIG-02-频谱图.md`
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
import { IqChart, SpectrumChart, iqAdapters } from '@/components/signal'
```

> 公共入口会引入 4 个组件；只打包 IQ/频谱时可直接深路径导入
> `@/components/signal/IqChart.vue` / `SpectrumChart.vue`，由打包器做 tree-shaking。

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
import { IqChart, SpectrumChart } from 'elec-signal-charts'
import 'elec-signal-charts/style.css'
```

> 包名/版本在 `scripts/write-signal-package.mjs` 中可改；未发布 npm 时可直接从 `dist-signal` 安装或拷贝。

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
- 图表根节点可聚焦（`tabindex=0`），聚焦后键盘快捷键生效；触摸屏支持双指 X 缩放。

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
- 频谱仍为**单边谱 0~Fs/2**；真实基带 IQ（中心 0）的负频不在当前契约内。
- 噪声底未做 ENBW/PSD 绝对校准；峰值已按窗相干增益校准，Mock 默认口径为 dBFS。
- 多迹线是**同一帧数据**的显示变换；两路独立信号请开两个实例（或等后续独立 source API）。
- 无浏览器级单测；核心数学/文案有 136 个单测。像素级视觉回归覆盖 Canvas2D/WebGL2 两条后端（见下节）。

## 8. Playground、像素级视觉回归与截图冒烟

不依赖 Electron 的最小 Vite 宿主在 `playground/`：

```bash
npm run playground          # 开发服务器
npm run build:playground    # 生产构建（index + visual 两个入口）
```

**像素级视觉回归**（固定种子、固定 1100×360×2、dark、en-US、DPR=1；分别回归 canvas2d/webgl2）：

```powershell
npm run test:visual          # 构建 + canvas2d/webgl2 双后端像素对比
npm run test:visual:update   # 构建 + 更新两套基线
```

- 基线：`playground/visual/baseline-canvas2d.png`、`baseline-webgl2.png`；失败时输出 `playground/dist/visual-*.png`。
- 判定：通道差 > `VISUAL_PIXEL_DELTA`（默认 16）计差异像素，占比 > `VISUAL_MAX_DIFF_RATIO`（默认 0.4%）失败。
- 基线绑定本机 Electron/GPU/字体；CI 需在相同镜像生成。DPR 通过 `--force-device-scale-factor=1` 固定；每个后端独立 Electron 进程运行。

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

`SIGNAL_CHARTS_VERSION = '1.2.0'`（公共 API 变更时按语义化版本维护）。
