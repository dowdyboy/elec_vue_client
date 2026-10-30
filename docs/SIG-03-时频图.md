# SIG-03 - 时频图（瀑布）

> `src/components/signal/SpectrogramChart.vue` —— 生产级可复用组件
>
> 默认 WebGL2 纹理渲染；无 WebGL2 时自动回退 Canvas2D。支持频率缩放/平移、冻结、自动/手动电平、色标、游标读数、PNG/CSV 导出、i18n、像素回归。
>
> 最小显示：`import { spectrogramDisplayOnly }` 后 `v-bind="spectrogramDisplayOnly"`，固定电平并关闭参数栏/右键菜单。

```vue
<SpectrogramChart
  ref="specgram"
  theme="dark"
  color-map="viridis"
  :time-span="256"
  :sample-rate="4_000_000"
  :fft-size="1024"
  :time-step-sec="0.000256"
  :height="420"
/>
```

```ts
// 服务端每算好一行 dB 就追加（帧元数据可随行传入）
ws.onmessage = (e) => {
  const frame = unpack(e.data) // { data, sampleRate, fftSize, timeStepSec, spectrumMode, freqStartHz, binHz, fftShift }
  specgram.value?.appendData(frame.data, {
    sampleRate: frame.sampleRate,
    fftSize: frame.fftSize,
    timeStepSec: frame.timeStepSec,
    spectrumMode: frame.spectrumMode,
    freqStartHz: frame.freqStartHz,
    binHz: frame.binHz,
    fftShift: frame.fftShift,
    seq: frame.seq
  })
}
```

## 一、数据契约

- 每行是服务端算好的 **dB 幅度谱** `Float32Array`，口径固定 **-120~0 dBFS**（与频谱图的 `dbScale` 显示开关解耦）。
- **real 模式（默认）**：长度 = `fftSize/2`，单边 `0~Fs/2`，非 DC 已 ×2。
- **complex 模式**：长度 = `fftSize`，完整复谱，通常 fftShift 后覆盖 `-Fs/2~+Fs/2`；负频是独立信息。
- 行长度是强契约：行长变化（如 fftSize/模式调整）会清空旧瀑布并重建，避免混行黑条。
- 非有限值（NaN/Inf）在入口填 `-160 dB`。
- 行元数据（均可选，帧优先于 props）：

| 字段           | 说明                                                      |
| -------------- | --------------------------------------------------------- |
| `sampleRate`   | 采样率 Hz，用于频率轴                                     |
| `fftSize`      | FFT 大小                                                  |
| `spectrumMode` | `real` / `complex`                                        |
| `freqStartHz`  | 第 0 bin 物理频率；real 通常 0，complex+fftShift 为 -Fs/2 |
| `binHz`        | bin 宽 Hz（缺省 sampleRate/fftSize）                      |
| `fftShift`     | 复谱是否已 fftShift（仅 complex）                         |
| `timeStepSec`  | 行间时间（重叠 hop/sampleRate），用于时间轴/游标          |
| `seq`          | 服务端行序号（诊断）                                      |
| `timestamp`    | 行时间戳（ms，预留）                                      |

服务端计算重叠行时：`timeStepSec = fftSize * (1 - overlap) / sampleRate`。
频率轴统一为 `f = freqStartHz + bin × binHz`；`freqOffsetHz` 只影响显示，CSV/API 返回物理频率。
源工作台的 `outputMode`（real/complex）决定源输出，本组件的 `spectrumMode` 只决定行按单边还是复谱计算，两者独立。Real 源复谱分析天然左右对称，Complex 源 real 分析是 I 投影；**Complex IQ 不保证双边**，QPSK 在 +f 单边是正常的，负频为空。
源工作台的 `imageDb`（-120~0 dB，仅 complex 输出）会在 `-freq` 叠加共轭镜像，用于验证复谱/瀑布负频；默认 -120 关闭。

## 二、Props

```ts
interface SpectrogramProps {
  // 数据/渲染
  colorMap?: 'viridis' | 'turbo' | 'jet' | 'grayscale' | 'hot'
  timeSpan?: number // 显示行数，默认 256
  maxRows?: number // 环形容量，默认 max(timeSpan, 256)
  interpolation?: 'nearest' | 'linear' // 默认 nearest
  renderer?: 'auto' | 'webgl2' | 'canvas2d' // 默认 auto
  fpsLimit?: number // 默认 30
  width?: number | string
  height?: number | string
  // 频率/时间
  sampleRate?: number
  fftSize?: number
  spectrumMode?: 'real' | 'complex' // 默认 real；complex=带符号全复谱
  freqStartHz?: number // 第 0 bin 物理频率
  binHz?: number // 显式 bin 宽
  fftShift?: boolean // complex 默认 true
  freqOffsetHz?: number // 显示偏移
  timeStepSec?: number
  // 电平/色阶
  dbMin?: number // 默认 -120
  dbMax?: number // 默认 0
  autoLevel?: boolean // 默认 false
  gamma?: number // 默认 1
  unit?: string // 默认 dBFS（仅显示）
  ampOffsetDb?: number // 仅显示校准
  // 外观
  theme?: 'light' | 'dark' | 'auto' | 'spectrum'
  chartStyle?: ChartStyle
  labels?: ChartLabels
  locale?: 'zh-CN' | 'en-US'
  messages?: Partial<Record<ChartMessageKey, string>>
  axis?: boolean
  xAxis?: boolean
  grid?: boolean
  axisLabels?: boolean
  showColorbar?: boolean
  showInfo?: boolean
  showCursor?: boolean
  contextMenu?: boolean
  paused?: boolean // v-model:paused
  adapter?: SpectrogramAdapter
  data?: RawInput | Float32Array
  exportHandler?: (p: ExportPayload) => void | Promise<void>
}
```

## 三、渲染与性能

- **WebGL2（默认）**：每行映射为 R8 强度纹理（环形 slot），片段着色器用 256×1 RGBA LUT 上色；频率缩放只改 uniform，不重传纹理。新行增量 `texSubImage2D`。
- **Canvas2D 回退**：同样的 LUT 映射为 ImageData，再按频率窗口裁剪缩放；适合无 WebGL2 的工业面板/远程桌面。
- 电平/gamma/色阶变化才重建纹理；普通新行 O(cols) 映射 + 一次上传；绘制 O(1) 纹理 quad。
- `maxRows` 控制内存；默认 256 行；`timeSpan` 只影响显示窗口，底层可保留更多行。
- 自动电平按抽样直方图 p1/p99，每 8 行最多更新一次，避免色阶抖动。
- 离屏（IntersectionObserver）暂停重绘；数据仍入环形缓冲。
- 像素级视觉回归：`npm run test:visual`（Canvas2D/WebGL2 双基线）。

## 四、交互

| 操作                      | 行为                                            |
| ------------------------- | ----------------------------------------------- |
| 滚轮                      | 以光标为锚点缩放频率轴（≥8 bin）                |
| 拖拽                      | 平移频率轴                                      |
| 双击 / 右键「冻结」       | 冻结当前画面（数据继续累积，恢复后无缝续接）    |
| 右键菜单                  | 冻结/恢复、复位频率、清空、导出 PNG/CSV         |
| 悬停                      | 十字光标 + 频率/时间/电平读数（`cursorChange`） |
| 触摸双指                  | 以双指中点为锚点缩放频率轴                      |
| `f` / `0` / `Esc`（聚焦） | 冻结切换 / 复位频率 / 关闭菜单                  |

## 五、暴露 API

```ts
appendData(raw, meta?) // 追加一行（帧元数据优先）
setData(raw, meta?) // 清空后设置一行
clear()
setPaused(v)
setLevelRange(min, max) // 手动电平
setFrequencyRange(startBin, endBin)
resetView() // 频率全带宽
getStats(): SpectrogramStats // 含 spectrumMode/freqStartHz/binHz
getVisibleData(): SpectrogramVisibleData | null // newest→oldest 拷贝
getRows(): number
getView(): { freqStart, freqEnd, fullSpan, paused, spectrumMode, freqStartHz, binHz }
resize() / redraw()
exportPNG() / exportPNGAsync() / exportCSV({ maxRows? })
dispose()
```

**事件**：`ready`、`error`、`errorDetail({code,message})`、`cursorChange`、`contextmenu`、`update:paused`、`update:dbMin`/`update:dbMax`、`levelChange`、`frequencyChange`、`metaChange`、`exported`、`contextLost/contextRestored`。

**插槽**：`<template #overlay>…</template>` 宿主自定义标注/告警框。

## 六、限制

- **real 模式**输出单边 `0~Fs/2`（N/2 bin）；**complex 模式**输出完整 N bin 带符号复谱；组件按 `spectrumMode`/`freqStartHz` 选择轴语义。
- `timeStepSec` 未知时按 `fftSize/sampleRate` 推导；存在重叠时请由服务端/宿主显式传入。
- CSV 按矩阵导出（`time_s` + 各 bin 频率列），默认最多约 100 万单元格，可用 `maxRows` 限制。
- 强制 `renderer="webgl2"` 且创建失败时 emit error + 占位，不回退；默认 `auto` 会回退 Canvas2D。

## 七、测试

- 核心：`core/spectrogram.test.ts` 8 例（色阶端点/LUT、电平/gamma/NaN、环形缓冲换行/容量/冻结拷贝）。
- DSP：real 单边 ×2、complex 全 bin/fftShift、正负频率方向（`signalFrames.test.ts` / `signalDsp.test.ts`）。
- 总单测：**230**（`npm test`）。
- 视觉：`npm run test:visual` 的 canvas2d/webgl2 双基线包含 real 与 complex 时频图。
