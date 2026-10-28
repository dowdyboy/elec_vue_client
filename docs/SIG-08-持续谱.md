# SIG-08 - 持续谱 / 密度谱（Persistence Spectrum）

> `src/components/signal/PersistenceSpectrumChart.vue`
>
> 状态：纯显示密度矩阵 + 可选逐帧频谱累计。Canvas2D 热力图、频率/幅度轴、色标、游标、PNG/CSV。

## 一、两种模式

### 1. 纯显示：调用方给密度矩阵

```ts
chart.appendData({
  width: 256,       // 频率 bin 数
  height: 256,      // 幅度 level 数
  minDb: -120,
  maxDb: -10,
  density: counts   // row-major: level*width+bin
})
```

`density` 可以是 `Float32Array`/`Uint32Array`/普通数组；组件只做色阶映射与绘制，不做累加。

### 2. 可选 analysis：逐帧累加

```vue
<PersistenceSpectrumChart
  :bins="256"
  :levels="256"
  :min-db="-120"
  :max-db="-10"
  :analysis="{ enabled: true, decay: 0.02 }"
/>
```

```ts
chart.appendData(spectrumDb) // Float32Array，一帧 dB 谱
```

- 每个 bin 落到最近的幅度 level，计数 +1；
- `decay > 0` 时每帧先乘 `1-decay`，形成荧光余辉；
- 不开 `analysis` 时，`appendData(Float32Array)` 会报 `persistence.needMatrix`。

## 二、Props

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `bins` | 512 | 分析模式频率 bin 数；矩阵模式由 `data.width` 决定 |
| `levels` | 256 | 幅度 level 数 |
| `minDb/maxDb` | -120/0 | 幅度范围 |
| `unit` | dB | Y 轴单位 |
| `colorMap` | viridis | viridis/turbo/jet/grayscale/hot |
| `gamma` | 1 | 色阶 gamma |
| `sampleRate/fftSize/binHz` | — | 频率轴换算 |
| `freqStartHz` | — | 第 0 bin 频率 |
| `spectrumMode/fftShift` | real/true | complex 时默认 -Fs/2 起点 |
| `analysis` | — | 开启逐帧累加 |
| `showInfo` | true | 左上统计 |
| `showColorbar` | true | 右侧色标 |
| `showCursor` | true | 十字游标读数 |
| `axis/xAxis/grid/axisLabels` | true | 轴/网格 |
| `theme/chartStyle` | auto | 主题 |

## 三、API

- `appendData(matrix | spectrumDb)` / `setData(...)` / `clear()`
- `getStats()`：width/height/frames/max/total/occupied
- `getDensity()`：当前密度矩阵
- `getBackend()`：固定 `canvas2d`
- `exportPNG()` / `exportCSV()`：CSV 仅导出 count>0 的 bin/level
- 事件：`exported`、`error`、`errorDetail`

核心 `PersistenceBuffer` 也可单独用于 Worker/服务端：

```ts
import { PersistenceBuffer } from '@/components/signal'

const p = new PersistenceBuffer({ width: 256, height: 256, minDb: -120, maxDb: -10 })
p.addSpectrum(spectrumDb)
const t = p.normalize(0.85) // 0..1
```

## 四、最小显示预设

```ts
import { persistenceDisplayOnly } from '@/components/signal'
```

```vue
<PersistenceSpectrumChart v-bind="persistenceDisplayOnly" :data="matrix" />
```

不显示信息栏，保留轴/色标/游标。

## 五、测试

- `core/persistence.test.ts`（3）：bin/level 累加、逐帧衰减、矩阵/归一化/清空；
- 总测试/版本见 [SIG-00](./SIG-00-信号组件总览.md)。

## 六、限制

- 不做 FFT/检波/峰值搜索；频谱帧由调用方提供；
- 密度矩阵是“频率 bin × 幅度 level”，不是时频瀑布；
- 频率轴线性，不做对数轴；
- 热力图是 Canvas2D 位图缩放到绘图区，超高频 bin 会被重采样；
- 颜色只表示命中密度，不表示绝对功率。
