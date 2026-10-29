# SIG-00 - 信号组件总览（可复用高性能）

> 信号源已从本组件总览拆出：`/source` 信号源工作台负责源类型/输出/损伤/播放，`/signal/*` 只负责分析 UI。见 [SRC-01](./SRC-01-信号源工作台.md)。

> 定位：垂直领域 10 组件（IQ/频谱/时频/星座/功率-时间/信号质量/眼图/持续谱/Smith/APD-CCDF）。**10 个组件均已完成库化**（公共入口、适配器、i18n、包构建；IQ/频谱/时频/星座含像素回归，其余先以核心单测 + Demo 覆盖）。数据经 `adapter` 自转（后端协议不确定，前端统一为 `Float32Array`），组件内 `WebGL2/Canvas2D` 自闭环高性能——**FFT/窗/dB/时频行在服务端完成**；组件只做迹线累计、抽稀、峰值/带宽类测量与绘制（频谱组件因此不是「零信号处理」），组件内无 Worker（Playground 提供宿主侧 Worker 解析示例）；自带 `light`/`dark`/`auto`/`spectrum` 主题，无额外依赖。IQ/频谱/时频/星座默认 WebGL2，不可用时自动回退 Canvas2D（`renderer` 可强制后端）；也可构建为 `dist-signal` 包（`npm run build:signal`，含 ESM/CSS/d.ts）。

> 所有组件都保留**最简使用路径**：IQ 不启用触发、频谱只累计/显示迹线、时频只追加 dB 行、星座纯显示、功率-时间不启用脉冲分析、信号质量面板只显示指标、眼图只叠加轨迹、持续谱直接显示密度矩阵、Smith 只画 Γ 轨迹、APD/CCDF 只画曲线；触发、OBW/ACPR/迹线保持、EVM/载波/符号恢复等高级分析必须由调用方显式开启。组件不会因为没有传高级参数而拒绝工作。
>
> 公共入口提供 `iqDisplayOnly` / `spectrumDisplayOnly` / `spectrogramDisplayOnly` / `constellationDisplayOnly` / `powerTimeDisplayOnly` / `eyeDisplayOnly` / `persistenceDisplayOnly` / `smithDisplayOnly` / `apdCcdfDisplayOnly` 九组最小显示预设；`v-bind` 后仍可覆盖单项。2.0 起星座旧 `carrierHz/symbolStrobe` 隐式预处理路径已移除，唯一预处理入口是 `analysis`。

> 演示信号源（Mock：主进程本地源 / remoteMock / `scripts/remote-signal-mock.mjs`）按「专业源」模型重构：**源输出域**与**分析域**分离。
>
> **源输出域** `outputMode`：`real`（默认）= 单路实数输出，IQ 捕获 I=x、Q=0，对应真实信号源/DAC；`complex` = 复数 IQ 输出，I/Q 独立，对应矢量源/仿真。
>
> **波形** `waveform`：CW / AM / FM / Pulse / Two-tone / Noise / Digital（BPSK/QPSK/16QAM）；参数含调制频率、AM 调制度、FM 频偏、脉冲周期/占空比、双音间隔、AWGN SNR。数字调制符号集归一化到 E|a|²=1，经升余弦成型（β=0.35）后上变频；Real 输出取实部，Complex 输出保留 I/Q。
>
> **分析域** `spectrumMode`：`real` 单边 0–Fs/2 / `complex` 完整带符号复谱；它只决定 FFT 怎么算，不改变源。Real 源用复谱分析会自然得到左右对称谱；Complex 源用 real 分析只是 I 投影。**Complex IQ 不保证双边**：QPSK 复载波在 +f 单边是正常的，负频为空；要负频请用实数输出、镜像或独立负频。
>
> 噪声按输出域保持 SNR：complex 每路 σ²=信号功率/(2·SNR)，real 只加 I 路同 σ；镜像/损伤只对 complex 有效。`imageDb` 为相对载波电平（-20 dB = 负频低 20 dB，只有 0 dB 等幅；0 dB 时 Q 抵消、基带变实，QPSK/16QAM 会退化）。
>
> 频谱行按窗相干增益补偿（0 dBFS 复单音在 rect/hann/hamming/blackman 下均读 0 dB）；`pointsPerFrame < fftSize` 时跨帧凑满窗再算。独立脚本是纯 JS 同步副本，`remoteScriptParity` 会对比行计算/生成器/波形，防止三套 Mock 漂移。

## 一、快速拷贝

```bash
node scripts/copy-signal.mjs ../other-app
# 拷 src/components/signal/**（组件 + core + composables + README；默认排除 *.test.ts）
# 需要测试：--with-tests
```

他项目（推荐从公共入口导入，避免逐个 SFC 深路径）：

```ts
import {
  IqChart,
  SpectrumChart,
  SpectrogramChart,
  iqAdapters,
  spectrumAdapters,
  type IqProps,
  type SpectrumProps,
  type SpectrogramProps
} from '@/components/signal'
// 或全局注册：import SignalCharts from '@/components/signal'; app.use(SignalCharts)
```

```vue
<IqChart :adapter="iqAdapters.int16Interleaved" height="100%" theme="dark" />
<SpectrumChart :adapter="spectrumAdapters.uint8" height="100%" theme="dark" />
<SpectrogramChart
  :time-span="256"
  :sample-rate="4_000_000"
  :fft-size="1024"
  height="100%"
  theme="dark"
/>
```

宿主集成说明（尺寸/适配器/props/事件/方法/性能/限制）见 `src/components/signal/README.md`；
版本号 `SIGNAL_CHARTS_VERSION`。

流式（高频）：`iqRef.value.appendData(rawFromBackend, { sampleRate })` / `specRef.value.appendData(raw, { sampleRate, fftSize, dbScale, spectrumMode, freqStartHz, binHz, fftShift })`
（rAF 合帧：同一帧内多次推送合并为一次重绘；`fpsLimit` 统一约束数据推送/交互/尺寸变化触发的重绘——组件内统一走 rAF 调度并按 fpsLimit 节流）

### 实信号 / 复信号双模式

| 模式           | 数据长度    | 频率轴                      | 典型场景                                   |
| -------------- | ----------- | --------------------------- | ------------------------------------------ |
| `real`（默认） | `fftSize/2` | `0 ~ Fs/2`，非 DC ×2        | 振动、声学、电压/电流、示波器、EMC         |
| `complex`      | `fftSize`   | `-Fs/2 ~ +Fs/2`（fftShift） | 射频/SDR、通信、雷达/多普勒、超声正交、PMU |

- 频率轴统一：`f = freqStartHz + bin × binHz`；`freqOffsetHz` 只影响显示读数。
- 帧元数据：`spectrumMode / freqStartHz / binHz / fftShift`；缺省按 real、`Fs/fftSize` 推导。
- 三个 Mock 与配置页都支持 `spectrumMode` 切换；`real` 只取 I 通道，`complex` 使用 I/Q 完整 FFT。
- `SpectrumChart`/`SpectrogramChart` 均支持带符号轴、负频显示、游标/CSV/测量 API。

## 二、适配器（前端自转）

```ts
import { iqAdapters, createIqAdapter } from '@/components/signal'
type Adapter = (raw: unknown) => Float32Array | { i: Float32Array; q: Float32Array } | null

// 内置：passthrough / jsonInterleaved / arrayBuffer / base64 /
//       int16Interleaved / int16Planar / float64Interleaved
// 硬件 int16 交织（最常见）：
const myAdapter = iqAdapters.int16Interleaved
// 自定义缩放/字节序：
const custom = createIqAdapter({
  dtype: 'int16',
  layout: 'interleaved',
  scale: 1 / 32768,
  endian: 'le'
})
// 用法：<IqChart :adapter="custom" />
```

> 非有限值（NaN/Inf）在入口清洗；`int16` 不再被静默 reinterpret 成 float32（协议不匹配会显式丢弃并告警）。

适配器在组件内执行（大数据可移入 Worker）；自定义适配器返回 `null` 时会先回退尝试内置适配器链（jsonInterleaved/arrayBuffer/base64），全部失败才丢帧并 emit error；抛异常则直接 emit error——均不中断渲染

## 三、通用 Props

```ts
interface ChartBaseProps {
  theme?: 'light' | 'dark' | 'auto' | 'spectrum' // 自带，无需 NaiveUI；spectrum 为频谱仪黑底黄迹预置
  width?: number | string // 数字按 px，字符串原样（'100%' / 'calc(...)'）
  height?: number | string // 未传则各组件有默认高度；字符串需父容器有确定高度
  decimation?: 'minmax' | 'lttb' | false // 'lttb' 类型保留，当前实现按 minmax 处理
  fpsLimit?: number // 60；运行时修改即时生效
  viewport?: { xMin?; xMax?; yMin?; yMax?; autoScale? }
  adapter?: Adapter
  data?: RawInput | Normalized // 受控；高频用 appendData
  preserveDrawingBuffer?: boolean // 默认 true（余辉/导出需要）；无余辉可设 false
  renderer?: 'auto' | 'webgl2' | 'canvas2d' // 默认 auto：WebGL2 不可用回退 Canvas2D
  locale?: 'zh-CN' | 'en-US' // 默认 zh-CN；内置英文
  messages?: Partial<Record<ChartMessageKey, string>> // 按 key 覆盖文案
}
```

IQ/频谱额外通用：`chartStyle`（外观覆盖，替代原 `style`；原生 class/style 留给宿主布局）、
`labels`（轴标题/角标/图例/aria 文案，最高优先级）、`locale`/`messages`（内置中英文 + 任意 key 覆盖）、
`contextMenu`（内置右键菜单开关）、`#overlay` 插槽（宿主标注）。
事件补齐：`ready`、`cursorChange`、`errorDetail({code,message})`、`contextLost/contextRestored`、`contextmenu`；
方法补齐：`exportPNGAsync`、`dispose`、`resize`/`redraw`、`getStats`/`getVisibleData`。
离屏时 IntersectionObserver 暂停重绘；根节点可聚焦（键盘）并支持触摸双指 X 缩放。
像素级视觉回归见 `playground/visual.html` + `scripts/visual-regression.cjs`（canvas2d/webgl2 双基线）。

## 四、十组件一览

| 组件                 | 输入（经 adapter）                                                                                                | 内部计算                                                                                                                                                                                                           | 渲染                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IqChart`            | `{i,q}` 或交织 `Float32Array`                                                                                     | 环形缓冲 + minmax 抽稀（按索引排序）；V/div 档位自适应 + 完全暂停语义；触发对齐（auto/normal/single）+ 余辉（persistence）；坐标轴/十字光标/多标记/框选缩放/图例显隐/右键菜单/时间轴（sampleRate）/导出（PNG+CSV） | WebGL2 折线（I/Q 双迹线，`envelope` 时叠加包络第三迹线）+ Canvas2D 轴层；Canvas2D 降级为普通折线/散点                                                                                                                                                                                                                 |
| `SpectrumChart`      | 服务端算好的幅度谱 `Float32Array`（real N/2 / complex N；含 `spectrumMode/freqStartHz/binHz/fftShift`+dB 元数据） | 多迹线累计（实时/平均(功率·对数)/最大保持/最小保持，偏移/A−B 运算/内存参考线）+ 检波器（正峰/负峰/采样/RMS/平均）+ 自动/手动纵轴 + VBW 视频滤波 + 单位换算 + 频率/校准偏移                                         | 频谱仪：WebGL2 折线（深缩放样本点）+ Canvas2D 轴层；Canvas2D 降级为折线/散点；多迹线图例（Alt+点击设活动迹线）、标记/标记表/标记→中心·参考、峰值搜索/峰值表、区间功率/噪声标记、OBW/N dB/信道功率/ACPR、限制线 PASS/FAIL、余辉、冻结、参考线拖拽、框选缩放、图内参数栏、导出（PNG+CSV/全迹线）、real/complex 带符号轴 |
| `SpectrogramChart`   | 服务端算好的 dB 行 `Float32Array`（real N/2 / complex N；含频率轴元数据）                                         | 行累计瀑布（最新行在顶部，历史向下滚动；行长/模式变化自动重置）                                                                                                                                                    | WebGL2 R8 纹理 + LUT 着色（Canvas2D LUT 降级）；轴/色标/游标/频率缩放/冻结/PNG/CSV；real/complex 带符号轴                                                                                                                                                                                                             |
| `ConstellationChart` | `{i,q}` 或交织 `Float32Array`                                                                                     | **默认纯显示**；可选 `analysis` 启用星座分析仪：中心频率 NCO、残余载波估计、符号定时、判决点、EVM/MER、幅度/相位误差、IQ 不平衡；环形缓冲 500k、正方形 I/Q 视口、自动/手动量程、PNG/CSV                            | WebGL2 Points + Canvas2D 轴层；Canvas2D 散点降级；I/Q 轴/网格/十字游标/自动量程；`renderer` 可强制后端                                                                                                                                                                                                                |
| `PowerTimeChart`     | 功率/dB 序列 `Float32Array` 或 `{values,timeStepSec}`                                                             | 默认纯显示；可选 `analysis` 做门限+滞回+最小脉宽检测，输出脉宽/周期/占空比/PAPR；环形缓冲、自动/手动量程、时间轴                                                                                                   | WebGL2 折线 + Canvas2D 轴层；Canvas2D 降级；门限线/脉冲带叠加；PNG/CSV                                                                                                                                                                                                                                                |
| `SignalQualityPanel` | 调用方/分析仪给的指标对象（EVM/MER/SNR/CFO/符号率/PAPR/IQ 不平衡/功率）                                           | 不做 DSP；按阈值方向给出 pass/fail/unknown，总体状态                                                                                                                                                               | 纯 DOM 卡片；主题跟随明暗；可嵌入任意面板                                                                                                                                                                                                                                                                             |
| `EyeDiagramChart`    | 调用方切好的眼图轨迹 `Float32Array[]`                                                                             | 叠加轨迹；从轨迹测量眼高/眼宽/交叉抖动；环形轨迹缓冲、自动 Y 量程                                                                                                                                                  | Canvas2D 叠加轨迹 + 轴/网格；PNG/CSV；`eyeDisplayOnly`                                                                                                                                                                                                                                                                |

## 五、性能要点

- 全链路 `Float32Array` 二进制；宿主若从 Worker/IPC 取数，可先 `postMessage(buf, [buf])` 零拷贝转移再喂 `appendData`
- 组件零外部依赖：类型内联于 `core/types.ts`，仅依赖 Vue 3 + 浏览器 WebGL2/Canvas2D；所有组件 `renderer='auto'` 在 WebGL2 不可用时回退 Canvas2D，只有强制 `renderer='webgl2'` 且创建失败时才 emit error + 占位。
- 瀑布 WebGL2 R8 纹理逐行 `texSubImage2D` + LUT 着色；Canvas2D 回退用 ImageData 行刷 + 离屏 canvas 复用（最新行在顶部，历史向下滚动）
- `viewport` 抽稀到 `~2×px` 点，1M 点/帧 → 2k 点绘制

## 六、验证

```bash
npm run typecheck && npm run lint && npm test   # 当前 209 例（含 real/complex 频谱/瀑布/星座/功率/眼图/持续谱/Smith/APD）
npm run test:visual   # canvas2d/webgl2 像素级回归（real + complex 双模式）
npm run test:smoke    # 新组件 Electron 集成冒烟 + 截图（PowerTime/Eye/Persistence/Smith/APD/Quality）
# 模拟：setInterval(()=> chart.appendData(new Float32Array(4096).map(()=>Math.random()*2-1)), 16)
```
