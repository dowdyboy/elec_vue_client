# SIG-01 - IQ 时域图

> `src/components/signal/IqChart.vue` 拷贝即用

```vue
<template>
  <IqChart
    ref="iq"
    :adapter="myAdapter"
    theme="dark"
    :colors="['#00bcd4', '#ff4081']"
    :viewport="{ xMin: 0, xMax: 2000, autoScale: true }"
    :fps-limit="60"
    @error="onErr"
  />
</template>
<script setup lang="ts">
import { ref } from 'vue'
// myAdapter：业务侧把后端帧转成 {i,q}/交织 Float32Array（可用 iqAdapters.int16Interleaved）
const iq = ref<InstanceType<typeof IqChart> | null>(null)
ws.onmessage = (e) => iq.value?.appendData(e.data, { sampleRate: 1_000_000 })
</script>
```

**Adapter**：返回 `{i,q}` 或交织 `Float32Array`；内置 `iqAdapters.passthrough/jsonInterleaved/arrayBuffer/base64/int16Interleaved/int16Planar/float64Interleaved`，也可用 `createIqAdapter({ dtype, layout, scale, offset, endian })` 自定义。自定义 adapter 返回 `null` 时会回退尝试内置适配器链，全部失败才丢帧并 `emit('error')`；抛异常则直接 `emit('error')`（不回退）

**Props**：`theme:'light'|'dark'|'auto'|'spectrum'` `mode:'line'|'dots'` `lineWidth`（`mode:'dots'` 为点径；`mode:'line'` 且 >1 时以 ribbon 几何展开绘制粗折线） `colors`（可选，未传取主题预置）
`decimation`（`'minmax'`/`false`；`'lttb'` 类型保留但当前按 `'minmax'` 处理） `fpsLimit`（统一节流：数据推送/交互/尺寸变化触发的所有重绘） `viewport` `axis/xAxis/grid` `sampleRate`（Hz，启用时间轴） `span`（follow 窗宽样本数，默认 4096）
`chartStyle`（外观覆盖） `labels`（轴标题/角标/aria 文案） `locale`（`zh-CN`/`en-US`） `messages`（按 key 覆盖文案） `width/height`（数字或 `'100%'` 等 CSS 字符串） `follow`（受控跟随） `maxPoints`（环形缓冲上限，挂载时生效） `renderer`（`auto`/`webgl2`/`canvas2d`，挂载时生效） `preserveDrawingBuffer`（默认 true） `contextMenu`（默认 true） `exportHandler`（导出交付回调）

**外观**：`theme:'light'|'dark'|'auto'|'spectrum'` + `chartStyle` 字段级覆盖（优先级 `chartStyle > colors > 预置`）；
`auto` 通过 `matchMedia` 订阅系统深浅色，系统切换时画布同步重绘。
原生 `class`/`style` 用于布局（`style` 不再被组件占用）；主题字段请走 `chartStyle`。
`spectrum` 为频谱仪经典面板：纯黑底、暗绿栅格、亮黄 I 迹、青色 Q 迹；固定观感不随系统深浅色切换
DOM 浮层（图例/暂停角标/数据流中断角标/右键菜单）文字与边框跟随 `chartStyle.text` / `chartStyle.border`（中断角标固定警示橙、触发角标用 `chartStyle.triggerColor`）

```ts
// chartStyle 可覆盖字段（全部可选）：core/theme.ts
interface ChartStyle {
  bg?: string // 组件/画布背景
  plotBg?: string // 绘图区底色（须半透明：轴层绘制于波形层之上）
  grid?: string // 网格
  border?: string // 边框/轴线
  text?: string // 刻度文字
  zeroLine?: string // y=0 零基准线
  labelChipBg?: string // Y 刻度芯片底
  traceI?: string // I 迹线
  traceQ?: string // Q 迹线
  envColor?: string // 幅度包络迹线颜色
  traceAlpha?: number // 波形不透明度（dark/light 默认 0.85，spectrum 0.9）
  axisWidth?: number // 左侧刻度带宽 CSS px（≥40，默认 56）
  crosshair?: string // 十字光标/测量标记线颜色
  triggerColor?: string // 触发覆盖层强调色（电平虚线/触发三角/Lv 文字/右上触发角标文字）
}
```

**布局**：左侧固定宽度刻度带——Y 芯片与竖直轴线钉在组件最左，轴线向右引出刻度短线，与绘图区间留 14px 空隙；
绘图区内仅网格+波形（无边框盒），波形另在区内左右各内缩 `min(24, 绘图区宽×8%)` px（视窗等效外扩实现，
避免满幅波形的起止边缘贴边形成「信号墙」）；固定带宽不随数据变化，无逐帧左右抖动。
注：测量标记线与波形共用「显示域 → 整幅绘图区」映射（`markerPx`），与波形内缩等价，宽度变化下仍对齐；
触发点三角仍按固定 24px 计算，绘图区宽 <300px 时与波形内缩量不一致

**显示点数机制（三层，各自决定）**：

- ① 数据到达速率：**服务端**决定——Mock 默认 `pointsPerFrame=2048` × 60fps ≈ 12 万样本/秒，只影响流动快慢
- ② 视口展示样本数：**组件**决定——follow 模式窗口宽 = `span` prop（默认 4096，≥16，**支持 `v-model:span` 双向**：
  跟随态外部改值即时重绘生效；内部滚轮/框选/拖拽/键盘缩放与复位（含触发模式的滚轮/框选/`+`/`-`）均经 `update:span` 节流 150ms 回写；
  冻结态外部改值不影响当前冻结窗，恢复/复位后生效）；
  滚动/框选缩放范围 16 ~ 缓冲上限，follow/free-run 实际显示窗宽另封顶 180 万（RING_KEEP）
- ③ 实际绘制点数：**组件**决定——窗口内样本 `minmax` 抽稀到「每像素列约 1 点」（`targetPoints=绘图区像素宽`，
  顶点 ≤ 2×像素宽；`decimation:false` 时不抽稀、按原始样本绘制），与数据速率/窗宽无关，是高性能关键

**十字光标**：悬停绘图区显示虚线十字 + 三处读数——X 样本索引芯片（底部槽）、Y 幅值芯片（左带）、
浮动框显示最近采样点实际 I/Q 值；跟随/暂停状态均可用；颜色可经 `chartStyle.crosshair` 覆盖

**X 轴时间单位**：传入 `sampleRate`（Hz）后，X 刻度、光标 X 读数、浮动框时间均换算为
自适应单位（µs/ms/s，1/2/5 步进）；内部视口仍以样本索引为单位，`viewport`/`viewportChange` 语义不变

**迹线显隐**：点击右上角图例 I/Q 切换可见性；隐藏通道不参与绘制、Y 轴自适应统计与光标读数

**框选放大**：Shift+左键拖拽出矩形，松手放大到该区域（X 冻结到选段、Y 切手动精确范围）；
矩形过小（<8px）忽略；pointercancel 取消

**幅度包络通道**：`envelope` prop 启用后叠加第三条迹线 √(I²+Q²)（`chartStyle.envColor` 调色，图例可切显隐）——
基于金字塔 env 聚合（每块存幅度 min/max 及下标），大窗下仍 O(块数) 准确抽稀；
包络通道参与 Y 轴自适应（仅显示包络时量程随之）。
注意：等幅载波（如 sine 调制 I=cos/Q=sin）的包络理论值恒为 1，界面上仅见噪声抖动属正常现象；
包络在 AM/16QAM 等幅度变化信号上才呈现调制波形（16QAM 符号幅度 0.47/1.05/1.41 分层跳变）

**余辉（数字荧光）**：`persistence` prop（0~0.95，0=关闭）——>0 时每帧以 (1-强度) 透明度绘制
背景色覆盖旧帧（不清屏），旧迹线逐帧衰减成磷光拖影；观测抖动/眼图/变周期信号。
语义：流式跟随态持续累积衰减；**暂停后波形冻结、余辉停留在暂停瞬间**（鼠标移动/新数据触发的重绘不会让它衰减；
暂停期间数据持续摄入不丢样本，缓冲满后冻结窗随环形淘汰滑动）；
暂停中缩放/平移（视口变化）→ 旧余辉经 12 次重绘（60fps 约 0.2s）平滑淡出后由新视口重绘（旧拖影与新视口错位，属仪器标准行为）；
恢复跟随继续累积。WebGL 后端要求上下文 `preserveDrawingBuffer: true`（Canvas2D 回退用背景覆盖模拟余辉）；清空数据时强制完全清屏。Y 轴量程变化期间旧帧尺度不一致属正常现象。
注：触发模式下每次新触发对齐帧会清屏重绘，余辉不会跨触发累积（见「触发显示」）

**窗口自动测量**：暂停态下左上角显示窗口统计——样本数、I/Q 各自峰峰值 Vpp、均值、RMS
（基于金字塔 sum/sumsq 聚合，大窗 O(块数)，按窗口切片缓存）；仅显示可见通道；跟随态自动隐藏

**测量标记**：数量不限，锚定绝对样本索引（缩放/平移保持数据位置）

- 添加：暂停状态下 Alt+点击空白，或右键菜单「在此处标记」（触发模式下跟随态也可 Alt+点击；右键菜单项在跟随态仍禁用）
- 清除：Alt+点击标记（按下无拖动判定）/ 右键「清除该标记」/「清除全部标记」
- 微调：Alt+按住标记拖拽（位移超 4px 判定为拖拽）
- 读数：右上角面板逐标记显示 索引·时间·I/Q；恰好两个标记时附加 Δ 样本 / Δt / 1/Δt 频率
- 非触发模式下，刷新（跟随）状态不允许标记与拖拽平移（始终展示最新数据），仅滚轮/框选缩放（缩放即进入暂停态）；触发模式允许 Alt 标记
- 左键双击 / 角标「恢复跟随」：恢复刷新并清除全部标记，**保留当前缩放窗宽与 Y 轴缩放状态**
  （手动缩放的 Y 量程不会被重置；仅暂停期间 Y 显示范围被冻结，恢复后自动继续自动、手动保持手动）；
  `zoomReset()`（「回到最新」）与清空数据才将窗宽复位为 `span` 默认值、Y 恢复自动缩放

**键盘微调（暂停态）**：`←`/`→` X 平移 ±10% 窗宽、`↑`/`↓` Y 平移（自动退出 autoScale）、`+`/`-` X 缩放
（光标居中锚定）；`Z` 撤销上一视口、`Shift+Z` 重做（缩放历史栈 30 级，滚轮/框选/拖拽/键盘均入栈；
`zoomReset()`「回到最新」与清空数据才重置基线，双击暂停⇄恢复不重置；Ctrl/Alt/Meta 组合键不拦截）；
快捷键仅在鼠标悬停本图表且焦点不在输入控件内时响应（多实例页面不互相抢键）

**读数精度自适应**：十字光标 Y 芯片、浮动框、标记、窗口统计的数值小数位随 Y 轴 V/div 档位自动定精度
（2~6 位，粗档位短读数、细档位精细读数）

**轴单位标题**：绘图区左上角竖排「幅度」、右下角单位（`sampleRate` 时显示「时间」，否则「样本」），半透明浮层不占布局；
`axisLabels` prop 控制显隐（默认开启）

**触发显示**：`trigger` prop 启用后进入触发对齐模式（默认保持跟随；暂停或经 `setViewport` 冻结视口时数据仍持续摄入，触发检测不中断）：

- `enabled` 开/关；`source:'i'|'q'` 触发通道；`edge:'rising'|'falling'` 边沿；`level` 电平；`mode:'auto'|'normal'|'single'`；`preTrigger` 触发点屏幕位置比例（默认 0.25）；`autoTimeout` auto 失联回退超时 ms（默认 500）
- 检测：每个新数据段只取段内**第一个**跨电平边沿（O(段长)，金字塔不动）；显示窗 = `[trigger − pre×span, trigger + (1−pre)×span]`
- 待渲染触发点（pending）：auto/normal 命中后先进入 `pendingAbs`，触发点右侧补齐 `(1−preTrigger)×span` 样本后才提升为 `lastTriggerAbs` 渲染/冻结——期间新边沿不覆盖 pending，因此周期信号（每帧都有边沿）也能稳定对齐；右侧长期无法补齐（信号消失/停止推流）时 auto 按失联超时回退自由滚动
- 模式差异：auto 按 pending 提升逐次刷新、`autoTimeout` 内有触发则锁定显示、失联回退自由滚动；normal 每次提升即更新并冻结（无新提升保持当前捕获窗）；single 命中即捕获、`armTrigger()` 重新武装（暂停期间触发检测仍工作）
- 冻结与淘汰：触发对齐帧渲染后波形层冻结保留捕获瞬间（余辉不再衰减），overlay（光标/标记/电平线/框选）仍随交互重绘，并随环形淘汰刷新采样切片；窗口尺寸变化时自动重渲染触发帧（GL 缓冲随画布重建失效）；触发窗左缘被环形淘汰时钳到 `dropped`（`core/trigger.ts` 导出的 `triggerWindow()` 整窗兜底重锚未被组件使用，仅单测覆盖）
- 与余辉：每次新触发对齐帧都清屏重绘（`trigNew` 分支），余辉不会跨触发累积——触发模式下的余辉为单帧迹线，不形成磷光眼图
- 交互：电平虚线可拖拽调阈值（Lv 标签随动，仅更新组件内部值，不回写 `trigger.level` prop；随后任何 trigger prop 变更会按新 prop 重置并覆盖拖拽值）；触发点三角标记；滚轮/框选/`+`/`-` 缩放只改窗宽保持对齐（同样回写 `update:span`）；跟随态拖拽平移禁用（暂停后恢复普通平移）；Alt 标记允许
- 颜色：触发覆盖层（电平虚线/触发三角/Lv 文字/右上角标文字）统一由 `chartStyle.triggerColor` 控制，主题预置 dark/light=`#18a058`、spectrum=`#7ee2a8`；与 `zeroLine`（y=0 零基准线）、`crosshair`（光标/标记/框选）互不影响
- 状态角标：⚡ 模式·边沿·电平·状态（single=`armed` 等待触发 / 已捕获；normal=`lastTriggerAbs≥0` 触发锁定 / 等待触发；auto=未失联且有触发 触发锁定 / 否则等待触发）；角标只反映触发引擎状态，不代表当前帧已对齐渲染
- 演示页 trigger 控制组（源/边沿/电平/模式/屏位/auto超时/arm）

**数据流中断反馈**：跟随态下超过 3 秒未收到实际数据，顶部居中显示橙色「数据流中断」角标；
恢复跟随/清空时重置计时。组件无常驻计时器——角标在下一次重绘时才会出现/消失（停止推流后移动鼠标或触发一次交互即可看到）；
演示页「停止推流」按钮可不切页停流验证

**导出**：`exportPNG()` 当前视图截图（波形+轴+图例合成，导出前同步重绘确保 WebGL 帧有效；
合成按输出尺寸显式缩放两层画布；overlay 轴画布经 CSS `width/height:100%` 拉伸到与波形画布同一布局盒
（`<canvas>` 为 replaced element，仅 `absolute + inset:0` 不会拉伸，会按 bitmap 固有尺寸显示、轴层被裁且文字错乱），
轴层与波形共用同一 CSS→设备映射，高 DPI/页面缩放下不会被裁在左上角）；
`exportCSV()` 可见窗口原始样本（超 50 万行等步长抽稀；`sampleRate` 存在时附 `time_s` 列）；
导出交付：配置 `exportHandler?` 回调后 PNG/CSV 交由宿主持久化（如 Electron 写入自定义目录），
否则回退浏览器 `<a download>`；两种路径均发 `exported` 事件（`{kind, filename}`）供宿主 UI 反馈

**自动 Y 轴**：目标范围经「V/div 档位量化」（向外吸附到刻度步进族）+ 快扩张/慢收缩平滑——
小幅波动被同一档位吸收，流式刷新时刻度完全静止；仅跨档时离散更新并缓入新档；
另设**换档滞回 + 收窄驻留**（`YAutoScaler({hysteresis:0.25, holdFrames:60, shrinkRelease:0.05})`）：
扩张仍即时（不裁切），收窄需候选跨度明显变小且连续稳定约 1s 才换档——抑制随机调制信号（QAM/PSK 过冲起伏）
极值在档位边界附近来回导致的逐帧翻转抖动；
清空数据/双击复位/外部切回 autoScale 时状态重置、直接吸附目标范围

**历史淘汰与冻结**：组件内置 200 万样本环形缓冲（Mock 默认推速下约 16s 填满），
填满后一次淘汰到保留最新 90%（淘汰量取 16 的整数倍，约 20 万样本/次）、淘汰前沿 `dropped` 阶跃推进；
滚轮/拖拽冻结后进入**暂停**语义——视口像素级静止，但**数据持续摄入不丢样本**（触发检测不中断），
恢复跟随（双击/角标）后无缝续接；冻结窗在缓冲满被环形淘汰吞没时，由「锚定最老可用数据」分支接管并随淘汰前沿滑动。
注：暂停期间内存与淘汰行为与跟随态一致；如需长时间定格回看，请在冻结窗被淘汰吞没前操作

**宿主 API / 事件**（公开入口 `@/components/signal`；完整见 `README.md`）：

- 数据：`appendData(raw, meta?)`（`meta.sampleRate` 优先于 `sampleRate` prop）、`setData(raw, meta?)`、`clear()`
- 控制：`setViewport`、`setFollow(v)` / `setPaused(v)`（`follow` prop + `v-model:follow`）、`setSpan(n)`、`setYRange(min,max,auto?)`、`zoomReset`、`armTrigger`
- 数据/诊断：`getView()`、`getStats()`、`getVisibleData()`（可见窗 I/Q 拷贝）、`getLength()`
- 标记：`addMarker(index)`、`setMarkers(list)`、`removeMarker(i)`（程序化 API 不限制跟随态；UI 的 Alt 标记仍遵循跟随语义）
- 渲染/导出：`resize()`、`redraw()`、`exportPNG()`、`exportPNGAsync()`（toBlob，宿主可直接持久化）、`exportCSV()`、`dispose()`
- 事件：`error`、`errorDetail({code,message})`、`cursorChange(IqCursorInfo|null)`、`ready`、`contextLost`、`contextRestored`、`contextmenu`（含 `{x,y,dataX}`）、`viewportChange`、`update:follow`、`update:span`、`exported`
- 插槽：`<template #overlay>` 宿主自定义标注/告警框（默认 `pointer-events:none`，可自行覆盖）
- 输入清洗：非有限值（NaN/Inf）在入口置 0；`maxPoints` 控制内存；`preserveDrawingBuffer=false` 可在无余辉需求时降低拷贝开销
- 可移植性：`renderer='auto'` 在 WebGL2 不可用时回退 Canvas2D（余辉用 Canvas 覆盖模拟）；`renderer='webgl2'` 强制且失败时 emit `error/errorDetail` + 占位提示
- 批量/触控/无障碍：离屏暂停重绘；根节点 `tabindex=0`、`role=application`、`aria-label`（可由 `labels.aria` 覆盖）；触摸双指 X 缩放

**单元测试**：`npm test`（vitest，当前 152 例）——覆盖 `axis`（niceStep/niceTicks/snapRangeNice 档位量化，9）、
`yauto`（Y 轴量程状态机：即时扩张防裁剪/慢速收敛/档位量化静止/换档滞回与收窄驻留/reset，12）、
`pyramid`（整树重建随机区间/增量追加/bucketChannel 与旧实现逐值一致/扩容重建/queryStats/包络 env 通道/compactShift 环形淘汰增量，9）、
`trigger`（findEdge 边沿检测/triggerWindow 钳制/triggerRightNeed·pending 提升门控/auto·normal pending 与 promote·single 状态机与 reset，18）、
`spectrum`（迹线累计/自动量程/峰值/缩放窗口/ACPR/平均与保持/稳健极值，56）、
`adapters`（对齐/类型守卫/int16·float64/字节序/平面/工厂/频谱 uint8，11）、`i18n`（中英/覆盖/插值，5）、
`spectrogram`（色阶/LUT/电平/环形缓冲/冻结拷贝，8）、
`shared/signal`（默认 real / spectrumMode / imageDb 校验，3）、
`shared/signalDsp`（升余弦成型/生成器连续性/成型谱形/SNR 口径/magnitudeSpectrum full+fftShift/镜像分量，9）、
`shared/signalFrames`（窗增益补偿/跨帧 FIFO/时频固定 dB 行/real 单边与 complex 全谱，9）、`shared/remoteScriptParity`（独立脚本与共享实现的帧计算/生成器逐样本一致，3）

**帧元数据**：IQ 帧携带 `sampleRate`（[shared/signal.ts](../src/shared/signal.ts)），演示页默认随帧自动同步采样率，手动修改后锁定、点「自动」恢复；
宿主应优先使用帧元数据换算时间轴，`sampleRate` prop 仅作缺省回退。

**内部**：环形 2M 点；**min/max 极值金字塔**（`core/pyramid.ts`，默认 16 样本/块，多层预聚合，含 min/max 下标以保持原索引顺序）——
Y 轴自适应统计与按桶抽稀均为 O(块数)：200 万点全窗下 Y 统计 ~0.001ms、抽稀 ~0.75ms（旧全扫描分别 ~4.3ms/~3.4ms）；
追加数据仅增量更新受影响块；扩容/清空整树重建，环形淘汰走 `compactShift` 增量平移（level0 copyWithin + 高层重聚合）；
`WebGL2` 绘制 I/Q/包络各一条 `LINE_STRIP`（`mode:'dots'` 为 `POINTS`；`lineWidth>1` 时改用 `TRIANGLE_STRIP` ribbon 几何展开）；
Canvas2D 回退后端使用普通折线/散点（无 ribbon，`lineWidth` 直接作为 Canvas 线宽）；
GL 视口/scissor 与 overlay 轴层均按「背板设备像素 ÷ 元素 CSS 实测尺寸」做真实比例映射，
页面缩放/系统非整数缩放场景下波形与网格对齐（不依赖全局 DPR 缓存）。
注：波形顶点按抽稀输出索引均匀铺满窗宽，深缩放（窗宽→16）时与网格/光标存在最大约 1 个样本的映射偏差
