# SIG-02 - 频谱仪（SpectrumChart）

> `src/components/signal/SpectrumChart.vue` 拷贝即用

## 一、快速使用

```vue
<SpectrumChart
  ref="spec"
  theme="spectrum"
  :height="420"
  trace-mode="average"
  :average-count="32"
  :persistence="0.3"
  :export-handler="saveFile"
/>

<script setup>
const spec = useTemplateRef('spec')
// 帧元数据随数据一起传入（AnalysisFrame：sampleRate/fftSize/dbScale）
ws.onmessage = (e) => {
  const frame = unpack(e.data)
  spec.value.appendData(frame.data, {
    sampleRate: frame.sampleRate,
    fftSize: frame.fftSize,
    dbScale: frame.dbScale
  })
}
</script>
```

**输入**：服务端算好的幅度谱 `Float32Array`（长度 = fftSize/2）。窗函数/FFT/dB 换算在服务端完成；组件只做迹线累计、检波/抽稀、峰值/带宽类测量与显示换算。

**元数据**（频率轴与单位换算）：优先级 帧元数据 > props > 推导 ——

- `sampleRate` + `fftSize`：频率换算 `f = bin × (sampleRate / fftSize)`，显示范围 0 ~ Fs/2；两者缺省时 X 轴退化为 bin 索引
- `dbScale`：true（默认）= 数据为 dB；false = 线性幅度。**线性显示下功率类测量（OBW/N dB/信道功率/区间功率/ACPR/噪声密度）会先转 dB 再计算，结果始终以 dB 表示**
- 分辨率显示 `RBW≈ 采样率/FFT 大小`（含窗函数影响的 ENBW 未计入，仅作参考）
- 服务端已按**窗相干增益**补偿：同一 0 dBFS 复单音切 rect/hann/hamming/blackman 峰值都读 0 dB；`pointsPerFrame < fftSize` 时跨帧凑满再算，不再零填充

## 二、Props

```ts
interface SpectrumProps {
  // 通用
  theme?: 'light' | 'dark' | 'auto' | 'spectrum' // 默认 auto；spectrum = 黑底黄迹频谱仪观感
  width?: number | string // 数字按 px，字符串原样（如 '100%'）
  height?: number | string
  decimation?: 'minmax' | 'lttb' | false // 窗口 bin 数超过像素宽时 minmax 抽稀（默认 minmax）
  fpsLimit?: number // 默认 60；统一节流数据/交互/尺寸重绘
  viewport?: { xMin?; xMax?; yMin?; yMax?; autoScale? } // x 为 bin 索引域
  adapter?: SpectrumAdapter
  data?: RawInput | Float32Array // 受控；高频用 appendData
  // 显示
  chartStyle?: ChartStyle // 外观字段级覆盖（含 traceColor；优先级高于 lineColor 与主题预置）
  labels?: ChartLabels // 轴标题/角标/图例文案覆盖（最高优先级）
  locale?: 'zh-CN' | 'en-US' // 内置中英文（默认 zh-CN）
  messages?: Partial<Record<ChartMessageKey, string>> // 按 key 覆盖任意文案
  lineColor?: string // 旧 API：迹线颜色兜底
  lineWidth?: number // 折线宽度（>1 ribbon 几何展开）
  sampleRate?: number // 元数据兜底
  fftSize?: number
  dbScale?: boolean
  paused?: boolean // 冻结/暂停（支持 v-model:paused；也可调用 setPaused）
  contextMenu?: boolean // 内置右键菜单（默认 true；false 时仍 emit contextmenu）
  preserveDrawingBuffer?: boolean // 默认 true；无余辉需求可设 false 降低拷贝开销
  renderer?: 'auto' | 'webgl2' | 'canvas2d' // 默认 auto：WebGL2 不可用回退 Canvas2D（挂载时生效）
  // 幅度轴
  autoScale?: boolean // 默认 true（自动量程）；支持 v-model:auto-scale（Shift+滚轮/拖 Ref 线切手动会回写）
  refLevel?: number // 手动模式参考电平 dB（默认 0）
  scaleDiv?: number // 手动模式 dB/格（默认 10，纵轴 5 格）
  // 迹线
  traceMode?: 'clear' | 'average' | 'maxHold' | 'minHold' // 默认 clear（单迹线路径）
  traces?: SpectrumTraceSpec[] // 多迹线叠加（提供且非空时生效，覆盖 traceMode；支持 v-model:traces；spec.label 可自定义图例名）
  legend?: boolean // 迹线图例（实时/平均/最大保持/最小保持）是否显示，默认 true；固定顶部居中，可整体隐藏
  averageCount?: number // average 最近 N 帧（1~1024，默认 16；=1 等同直通最新帧，调帧数不会重置 maxHold/minHold）
  persistence?: number // 余辉 0~0.95（0=关闭）
  span?: number // 显示窗宽（bin 数，0/缺省=全带宽；支持 v-model:span）
  peakTrack?: boolean // 峰值跟踪：每帧把 M1 移到可见跨度最大点
  // 仪器化
  unit?: 'dBFS' | 'dBm' | 'dBuV' | 'dBmV' | 'dBW' // 幅度显示单位（默认 dBFS；Mock 输出为相对满量程 dB，dBm 等需宿主用 ampOffsetDb 校准）
  impedance?: 50 | 75 // dBµV/dBmV 阻抗换算（默认 50）
  vbw?: number // 视频带宽 Hz（0/缺省=关；比例模型 α=1−VBW/RBW，VBW≥RBW 视为关。先滤波再做平均/保持）
  showInfo?: boolean // 图内参数栏（四角：Ref/Scale、Center/Span、RBW/VBW；默认开启）
  peakTable?: boolean // 峰值表面板（默认关闭）
  peakTableOpts?: { count?; thresholdDb?; excursionDb? } // 峰值个数（默认 6）/绝对门限/回落门限（默认 6dB）
  markerTable?: boolean // 标记表（序号/频率/电平 + Δ 行；默认关闭用紧凑读数条）
  detector?: 'minmax' | 'posPeak' | 'negPeak' | 'sample' | 'rms' | 'average' // 检波器（默认 minmax 双极值）
  dots?: 'auto' | 'on' | 'off' // 深缩放样本点（默认 auto：可见样本间隔 >3px 显示）
  freqOffsetHz?: number // 频率偏移 Hz（仅显示层；API 返回原始 Hz）
  ampOffsetDb?: number // 幅度校准偏移 dB（仅显示层：轴/读数/测量芯片）
  limitLines?: SpectrumLimitLine[] // 限制线（上限/下限折线 + 通/失败判定，作用于活动迹线）
  // 轴
  axis?: boolean
  xAxis?: boolean
  grid?: boolean
  axisLabels?: boolean
  // 导出
  exportHandler?: (p: ExportPayload) => void | Promise<void>
}
```

## 三、迹线模式

| 模式      | 说明                                                                       |
| --------- | -------------------------------------------------------------------------- |
| `clear`   | 实时：直通最新帧（输入缓冲内部 copy，调用方可复用）                        |
| `average` | 视频平均：最近 `averageCount` 帧滑动平均（Float64 求和，环形覆盖先减旧值） |
| `maxHold` | 最大保持：逐 bin 取历史最大                                                |
| `minHold` | 最小保持：逐 bin 取历史最小                                                |

模式/平均帧数切换以最新帧为种子（切换瞬间不黑屏）；`fftSize` 变化（帧长变化）自动重置累计。
`averageCount=1` 等同直通最新帧；调整平均帧数/平均语义**只影响 average 迹线**，不会清空 maxHold/minHold 历史。
`clear()` / `resetTraces()` 清空累计与标记。

**多迹线叠加**：`traces` prop 传多条配置（如 `[{mode:'clear'},{mode:'maxHold'},{mode:'average'}]`），
任意组合同时显示；颜色取主题 `tracePalette`（首条仍优先 `chartStyle.traceColor`，`spec.color` 可单独覆盖）。
图例位于**顶部居中**（不再压住左上角 Ref/Scale 参数栏与竖排轴标题）；点击条目开关迹线——**隐藏的迹线仍在后台累计**，
再开启即恢复最新状态（与真机 View blank 语义不同，更接近「后台继续采集」）；图例状态不依赖宿主绑定 `v-model:traces`，组件内部会同步。
`traces[i].label` 可把图例从「实时/平均/最大保持」改成宿主业务名（如 `TX1`/`REF`）；`labels.legend` 可整体本地化模式名。
`legend=false` 可整体隐藏图例（演示页「图例」复选框）；隐藏后画布参数栏与「数据流中断」角标自动上移，不占位。
实例按「模式 + 是否运算迹线」匹配复用（不再按下标），增删某条迹线不会重置其它迹线的历史。
自动量程按全部启用迹线的极值合并；峰值/标记/测量/CSV 导出作用于「活动迹线」（首条启用迹线）。

## 四、标记与峰值

- 添加：Alt+点击空白 / 右键菜单「在此处标记」；点击标记即清除
- 微调：Alt+按住标记拖拽（位移 >4px 判定拖拽）；标记锚定 bin（支持小数，缩放保持位置）
- 恰好两个标记时读数面板显示 `Δf` 与 `ΔL`
- 峰值：`peakSearch()` 取可见跨度最大点；`nextPeak()` 取低于当前峰回落门限（dB 6 / 线性 0.1）以上中的最高峰；
  手动模式另加绝对门限（可见底部 +3dB）；`peakTrack` 开启后每帧自动跟踪最大点
- 读数值随数据单位（dB 或线性）

## 五、交互

| 操作            | 行为                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| 滚轮            | 频率轴缩放（光标处 bin 锚定；缩放到全带宽时**吸附并锁定平移**，见下）                                  |
| Shift+滚轮      | 幅度缩放（**光标锚定**，与 X 轴一致；dB 模式。线性模式因底部恒 0 保持顶部缩放）                        |
| 拖拽            | 频率轴平移 + 幅度轴纵向平移（纵向 >2px 自动退出自动量程并平移 Ref；全带宽时仍可纵向平移）              |
| Shift+拖拽      | 框选放大：宽 ≥8px 缩放频率、高 ≥8px 缩放幅度（扁平/细长框只缩放对应轴，两向都过小才忽略）              |
| 双击            | 冻结 ⇆ 恢复（冻结期间不再合并新帧；全带宽复位移至右键菜单「复位」）                                    |
| Alt+点击 / 右键 | 标记管理（添加/清除/清空/峰值搜索/复位）                                                               |
| 拖拽 Ref 线     | 手动 dB 模式：鼠标移近顶部热区（6px）显示 Ref 虚线且光标变 `ns-resize`，按住拖拽调参考电平；平时不显示 |
| ←→ / +-         | 冻结外平移/缩放；↑↓ 调参考电平；Z / Shift+Z 视口撤销重做                                               |
| 空格            | 冻结 ⇆ 恢复（Run/Stop 习惯；与双击、角标、按钮等价）                                                   |
| 悬停            | 十字光标 + 频率/幅度芯片 + 浮动读数（最近 bin）                                                        |

缩放窗口以**真实 bin 域**计算（不含显示留白），锚点保持屏上相对位置；窗宽钳制 `[8, 全带宽]`，
达到全带宽即精确吸附 `0 ~ Fs/2` 并锁定平移（键盘 / 框选缩到全宽同样吸附）。
快捷键仅在鼠标悬停本图表且焦点不在输入控件内时响应；键盘微调与滚轮缩放均写入缩放历史（30 级）。
演示页顶部标签行显示 Span/Center/RBW/Ref 便于快速查看；图内参数栏由 `showInfo` 控制（默认开启，见 §11），两者并存属演示页的有意冗余。

## 六、冻结与余辉

- 双击 / `setPaused(true)` / 角标：冻结期间不再合并新帧（保持当前迹线），双击或角标点击恢复；数据流中断角标暂停期间不显示
- 余辉 `persistence`：实时采集每帧淡出合成磷光拖影；冻结后画面像素级静止；冻结中缩放/平移旧迹线 12 帧平滑淡出

## 七、导出

- `exportPNG()`：波形 + 网格 + 标记合成（导出前同步重绘保证 WebGL 帧有效；无画布状态面板，画面不被遮挡）
- `exportCSV()`：可见跨度 `freq_hz,level`（无采样率元数据时为 `bin,level`）
- `exportHandler` 提供后交由宿主持久化，否则回退 `<a download>`；两条路径均发 `exported` 事件

## 八、方法 / 事件

```ts
// 暴露方法
appendData(raw, meta?) // meta: { sampleRate?, fftSize?, dbScale? }
setData(raw)
setMeta({ sampleRate?, fftSize?, dbScale? })
clear() / resetTraces()
setPaused(bool) // 也可用 paused prop / v-model:paused
setViewport({ xMin?, xMax?, yMin?, yMax?, autoScale? }) // x 为 bin
getView(): SpectrumViewInfo // 含 freqMin/freqMax/centerHz/spanHz
getMeta(): SpectrumMeta // { sampleRate, fftSize, binHz, dbScale }
getStats(): SpectrumStats // { bins, fftSize, sampleRate, dbScale, paused, traceCount, markerCount }
getVisibleData(): SpectrumVisibleData | null // 活动迹线可见窗数据拷贝 + startBin/endBin
zoomReset() // 全带宽 + 自动量程
peakSearch() / nextPeak() / clearMarkers()
getPeaks(opts?): Peak[] // 与 UI 解耦：无需开启 peakTable；opts={count,thresholdDb,excursionDb}
getMarkers(): number[] // 当前标记（bin 索引）
addMarker(bin): boolean / setMarkers(bins) / removeMarker(i) // 程序化标记（上限 6）
setActiveTrace(i) // 设置活动迹线（标记/测量/导出作用对象；图例 Alt+点击同效；发 activeTraceChange）
markerToCenter(i?): boolean // 标记 → 中心（保持窗宽）
markerToRef(i?): boolean // 标记 → 参考电平（取活动迹线电平）
bandPower(lo?, hi?): { powerDb, densityDbPerHz, fLowHz, fHighHz } | null // 显式区间或 M1–M2
markerNoise(i?): { levelDb, densityDbPerHz } | null // 噪声标记（dB/Hz）
measureOBW(pct?, range?): { fLowHz, fHighHz, obwHz, totalDb } | null // 占用带宽（默认 99%；range={loBin,hiBin}）
measureNdB(nDb?, opts?): { fLowHz, fHighHz, widthHz, centerHz } | null // opts={smooth:3,hold:3,loBin,hiBin}
measureChannelPower(range?): { powerDb } | null // 显式区间或当前视窗
measureACPR(opts?): { mainDb, lowerDb, upperDb, acprLowerDb, acprUpperDb } | null // 邻道功率比（主带以 M1/峰值居中）
clearMeasurements() // 清除测量叠加（zoomReset/clear 也会清除）
getLimitResult(): { pass, violations, worstMarginDb } | null // 限制线判定
saveTraceToMemory(): boolean // 活动迹线快照 → 内存迹线（灰色参考线）
showMemory(v) / clearMemory() // 内存迹线显示/清除
exportPNG() / exportPNGAsync() / exportCSV() // Async 用 toBlob，宿主可直接持久化 blob
resize() / redraw() // 手动尺寸校准 / 重绘（容器显隐切换后有用）
dispose() // 手动释放监听/渲染器/rAF（幂等；卸载时自动调用）

// 事件
// error(msg) · errorDetail({code,message}) · ready() · contextLost() · contextRestored()
// viewportChange(SpectrumViewInfo) · exported({kind,filename})
// contextmenu({x,y,dataX,hitIdx}) · activeTraceChange(index) · cursorChange(SpectrumCursorInfo|null)
// update:span(bins) · update:autoScale(boolean) · update:paused(boolean)
// update:refLevel(dB) · update:scaleDiv(dB/格) · update:traces(SpectrumTraceSpec[]) · metaChange(SpectrumMeta)
// 插槽：#overlay 宿主自定义标注/告警框
```

## 九、轴与主题

- 频率轴：Hz/kHz/MHz 自适应（刻度单位随步长量级）；幅度轴：dB（`幅度 (dBFS/dBm/…)`）或线性（`幅度`）
- 自动量程（`autoScale`）：`core/spectrum.ts` 的 `SpectrumAutoRange` ——
  输入为**稳健极值**（`robustMinMax`：峰值取真实最大，底部取 ~~3% 分位，忽略单 bin 深谷噪声）；
  量程**顶部锚定贴合**（top = 峰值 + 余量上取、bottom = 底沿 − 余量下取，档距 1/2/5×10^k 且浪费 ≤15%），
  使底噪靠底、峰值靠顶（允许约 3~~5% 极值尖峰在底部轻微裁切）；
  快攻慢释包络抑制逐帧噪声抖动；档位仅「超出即扩张」、收窄需连续稳定约 3s（180 帧驻留）且数据跨度 ≤ 当前档位 55% 才切换；
  收缩缓动按数据帧推进（约 1.5~2s 平滑滑入，扩张瞬时防裁切），`display()` 为纯读取、与绘制次数无关。
  缩放/平移只重置驻留计数（`resetShrink`），帧长变化用 `resetTier`（保留显示范围，不闪量程）
- Y 网格：自动量程 7 条（约 20 dB/档）；手动 dB 模式 6 条刻度（5 个间隔，与 dB/div 对齐），避免 db 量程下过疏
- `spectrum` 主题：纯黑底、暗绿栅格、亮黄迹线（`traceColor=#ffd60a`）；dark/light/auto 各自预置 traceColor
- `chartStyle.traceColor` / `chartStyle.tracePalette` 字段级覆盖；旧 `lineColor` 仍可用（优先级低于 chartStyle）

## 十、性能

- 单帧 ~fftSize/2 个 bin（默认 512），累计器 copy/环形均为 O(bin)
- 仅在窗口 bin 数超过绘图区像素宽时 minmax 抽稀；绘制顶点 ≤ 2×像素宽
- 重绘统一 rAF 调度并按 `fpsLimit` 节流；`useGlChart` 每帧校准画布尺寸与 DPI
- 默认 WebGL2；无法创建 WebGL2 时 `renderer='auto'` 自动回退 Canvas2D（折线/散点 + 现有轴层），余辉用低 alpha 背景覆盖模拟；Canvas2D 建议保持 minmax 抽稀
- 离屏（IntersectionObserver）暂停重绘；数据仍入缓冲，恢复可见时补一帧

## 十一、仪器化扩展

**幅度单位**：`unit` + `impedance` 仅作用于显示格式化层（Y 刻度芯片、轴标题、十字光标、标记读数、
Ref 芯片、峰值表、信息栏）。内部数据为**归一化 dBFS**（0 dB = 满量程复单音，服务端已补偿窗相干增益）；默认单位 `dBFS`。
`dBm` 为直通口径（需宿主用 `ampOffsetDb` 做绝对校准）；dBW=dBm−30；dBmV=dBm+46.99(50Ω)/+48.75(75Ω)；
dBµV=dBm+106.99(50Ω)/+108.75(75Ω)。Ref/dB格 手动模型与 `update:refLevel`/`update:scaleDiv` 回写保持 dB 域不变。
`dbScale=false`（线性显示）下 Y 轴为线性幅度，但**功率类测量仍先转 dB 再算**，测量结果始终以 dB 表达（线性模式下不带 dBFS/dBm 后缀）。

**VBW 视频带宽**：`core/spectrum.ts` 的 `VbwFilter`（逐 bin 一阶 IIR 低通），强度按 **VBW/RBW 比例**建模：
`α = clamp(1 − VBW/RBW, 0, 0.95)`，`y = α·prev + (1−α)·x`——与帧率无关。真机的视频滤波效果取决于
VBW/RBW 比例（扫频过程平滑），本工程每帧一条完整谱，用比例模型复现同样的「旋钮手感」：
VBW=0.1×RBW 时 α=0.9（强平滑）、0.5×RBW 时 α=0.5、≥RBW 视为关闭（真机上此时效果可忽略）。
接入点在迹线 push **之前**——与真机一致：先视频滤波、再做平均/保持。
与 `average` 的区别：VBW 是逐 bin 连续平滑（压低噪声底起伏而不牺牲保持类迹线），average 是 N 帧等权平均。
信息栏显示 `VBW xxx (off)` 表示未生效（≥RBW 或 RBW 未知）；帧长变化/clear 自动以新帧为种子，显示不跳变。

**峰值表**：`peakTable` 开启后右上角绘制 Top-N 表面板（`# / 频率 / 电平`，标记读数面板自动下移避让），
复用 `findPeaks`（`thresholdDb`/`excursionDb`/`count` 可调，按当前显示数据单位解释：dB 模式为 dB，线性模式为幅度差）；
候选峰按幅度降序截断到 128 个再做回落门限筛选，避免噪声谱的 O(k²) 区间扫描拖慢每帧重绘；`getPeaks()` 取同款数据供宿主导出 CSV。

**测量**（作用于活动迹线 + 当前视窗，频率换算依赖 `binHz`；线性显示时先转 dB 再算）：

- `measureOBW(pct=0.99)`：占用带宽（两端各裁 (1−pct)/2 功率），绘制边界虚线 + 半透明区间 + 结果芯片
- `measureNdB(nDb=3, opts?)`：峰值左右 (peak−nDb) 穿越点（线性插值亚 bin 精度）。
  默认带**抗噪**（`opts = {smooth:3, hold:3}`：轻度滑动平均 + 连续 3 点低于门限确认），
  避免噪声迹线上单 bin 噪谷造成虚假窄带宽（实测噪声平台 0.4 bin → 恢复 ~118 bin）；
  穿越检测在包络上进行，报告峰值仍为原始峰值；传 `{smooth:1, hold:1}` 即裸测口径。
  注：N dB 带宽基于显示迹线的首个穿越点，对噪声/调制类信号建议先用 VBW（<RBW）或平均迹线平滑后再测
- `measureChannelPower(range?)`：显式区间或视窗内线性功率和转 dB（bin 视作等功率密度样本的简化口径，未做 ENBW 归一）
- 测量叠加在 `zoomReset()`/`clear()`/`clearMeasurements()` 时清除

**图内参数栏**（`showInfo`，默认开）：左上 `Ref …· dB/div`（自动量程显示 `Auto`）、右上 `Center/Span`、
左下 `RBW/VBW`；10px 半透明，避让图例/轴标题/峰值表。截图/PNG 导出自带参数，仪器观感。

## 十二、仪器化扩展（二）

**检波器与样本点**：`detector` 决定抽稀时每像素桶取值——`minmax`（默认，双极值保持旧版行为）、
`posPeak` 正峰 / `negPeak` 负峰 / `sample` 采样 / `rms` 功率平均（dB 域线性功率平均、线性域平方平均开方）/
`average` 对数平均；桶数不足时全分辨率直通。`dots` 深缩放样本点：`auto`（默认，可见样本间隔 >3px 时
按迹线色绘制离散点）/ `on` / `off`——复现真机深缩放下的采样点形态。

**迹线保真**：

- `avgMode: 'power' | 'log'`（average 模式；**默认 power** = 功率(RMS)平均，真机口径；log 为对数平均），
  环形覆盖在线性域扣旧值
- `offsetDb` 迹线显示偏移（绘制与该迹线读数芯片；测量按原始数据）
- `math: { op:'subtract', a, b }` A−B 运算迹线（dB 域相减，不占缓冲；不参与活动迹线选择与自动量程）
- `exportCSV({ allTraces: true })` 全迹线多列导出（列名 `t1_clear,t2_maxHold…`）

**频率/校准偏移**：`freqOffsetHz`（刻度/光标/标记/峰值表/信息栏频率读数整体平移）与 `ampOffsetDb`
（轴刻度/全部电平读数/测量芯片）——**仅显示层**，内部域与 API 返回值保持原始（kHz 输入的
Center/Start/Stop 在演示页做显示域换算）。

**标记系统**：上限 6 个；`markerTable` 标记表（`# / 频率 / 电平` + Δ 行，噪声标记行附密度）；
右键菜单新增「最近标记 → 中心 / → 参考电平（`markerToCenter/markerToRef`）」；
**活动迹线**（图例 Alt+点击或 `setActiveTrace(i)`，下划线标识）——标记/峰值/测量/导出均作用于活动迹线。

**区间/噪声标记**：`bandPower()` 取 M1–M2 区间（总功率 + dB/Hz 密度，区间填充 + 芯片），
也可 `bandPower(loBin, hiBin)` 显式指定区间；`markerNoise(i)` 在标记读数追加密度（`bandStats` 按 RBW=binHz 简化，未做 ENBW 归一；线性显示时先转 dB）。

**ACPR**：`measureACPR({ mainBwHz?, adjBwHz? })` 主信道以 M1（无标记取峰值）居中，
默认主/邻带宽 = 视窗 span/5；`mainBwHz/adjBwHz` 是**全带宽**，内部换算为半带宽后，
主信道取 `[c−mh, c+mh]`、邻道取 `[c−mh−2·ah, c−mh−1]` / `[c+mh+1, c+mh+2·ah]`（各 2·ah bin，与主信道等宽），
避免旧实现邻道只积分一半导致的 ~3 dB 偏好；三信道填充 + `ACPR L/U dBc` 芯片（`acprBands` 纯函数）。

**限制线**：`limitLines: [{ points:[{freqHz|bin, level}], type:'upper'|'lower' }]`——折线（超限区间红染）

- 左上 `LIMIT PASS / FAIL ×n` 判定芯片；`getLimitResult()` 返回 `pass/violations/worstMarginDb`。
  `level` 使用当前数据单位（dB 模式为 dB，线性显示时为幅度），与活动迹线原始数据比较（不含显示偏移）。

**迹线内存**：`saveTraceToMemory()` 活动迹线快照 → `showMemory(v)` 灰色参考线叠加
（不参与自动量程与活动迹线选择）；`clearMemory()` 清除。
