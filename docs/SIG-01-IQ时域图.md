# SIG-01 - IQ 时域图

> `src/components/signal/IqChart.vue` 拷贝即用

```vue
<IqChart
  :adapter="myAdapter"
  theme="dark"
  :colors="['#00bcd4', '#ff4081']"
  :viewport="{ xMin: 0, xMax: 2000, autoScale: true }"
  :fps-limit="60"
  @error="onErr"
/>
<script setup>
const iqRef = useTemplateRef('iq')
ws.onmessage = (e) => iqRef.value.appendData(e.data) // RawInput 任意
</script>
```

**Adapter**：返回 `{i,q}` 或交织 `Float32Array`；内置 `iqAdapters.passthrough/jsonInterleaved/arrayBuffer/base64`

**Props**：`theme:'light'|'dark'|'auto'|'spectrum'` `mode:'line'|'dots'` `lineWidth` `colors`（可选，未传取主题预置）
`decimation` `viewport` `axis/xAxis/grid` `sampleRate`（Hz，启用时间轴） `span`（follow 窗宽样本数，默认 4096）
`style`（外观覆盖） `exportHandler`（导出交付回调）

**外观**：`theme:'light'|'dark'|'auto'|'spectrum'` + `style` 字段级覆盖（优先级 `style > colors > 预置`）
`spectrum` 为频谱仪经典面板：纯黑底、暗绿栅格、亮黄 I 迹、青色 Q 迹；固定观感不随系统深浅色切换

```ts
// style 可覆盖字段（全部可选）：core/theme.ts
interface ChartStyle {
  bg?: string            // 组件/画布背景
  plotBg?: string        // 绘图区底色（须半透明：轴层绘制于波形层之上）
  grid?: string          // 网格
  border?: string        // 边框/轴线
  text?: string          // 刻度文字
  zeroLine?: string      // y=0 零基准线
  labelChipBg?: string   // Y 刻度芯片底
  traceI?: string        // I 迹线
  traceQ?: string        // Q 迹线
  traceAlpha?: number    // 波形不透明度（默认 0.85）
  axisWidth?: number     // 左侧刻度带宽 CSS px（≥40，默认 56）
  crosshair?: string     // 十字光标/测量标记线颜色
}
```

**布局**：左侧固定宽度刻度带——Y 芯片与竖直轴线钉在组件最左，轴线向右引出刻度短线，与绘图区间留 14px 空隙；
绘图区内仅网格+波形（无边框盒），波形另在区内左右各内缩约 24px（视窗等效外扩实现，与网格刻度严格对齐，
避免满幅波形的起止边缘贴边形成「信号墙」）；固定带宽不随数据变化，无逐帧左右抖动

**显示点数机制（三层，各自决定）**：
- ① 数据到达速率：**服务端**决定——Mock 默认 `pointsPerFrame=2048` × 60fps ≈ 12 万样本/秒，只影响流动快慢
- ② 视口展示样本数：**组件**决定——follow 模式窗口宽 = `span` prop（默认 4096，≥16，**支持 `v-model:span` 双向**：
  外部改值实时生效，内部缩放/框选/复位会通过 `update:span` 事件反馈回外部输入框，始终显示当前窗宽）；
  滚动/框选缩放会改写，范围 16 ~ 缓冲上限
- ③ 实际绘制点数：**组件**决定——窗口内样本 `minmax` 抽稀到「每像素列约 1 点」（`targetPoints=绘图区像素宽`，
  顶点 ≤ 2×像素宽），与数据速率/窗宽无关，是高性能关键

**十字光标**：悬停绘图区显示虚线十字 + 三处读数——X 样本索引芯片（底部槽）、Y 幅值芯片（左带）、
浮动框显示最近采样点实际 I/Q 值；跟随/暂停状态均可用；颜色可经 `style.crosshair` 覆盖

**X 轴时间单位**：传入 `sampleRate`（Hz）后，X 刻度、光标 X 读数、浮动框时间均换算为
自适应单位（µs/ms/s，1/2/5 步进）；内部视口仍以样本索引为单位，`viewport`/`viewportChange` 语义不变

**迹线显隐**：点击右上角图例 I/Q 切换可见性；隐藏通道不参与绘制、Y 轴自适应统计与光标读数

**框选放大**：Shift+左键拖拽出矩形，松手放大到该区域（X 冻结到选段、Y 切手动精确范围）；
矩形过小（<8px）忽略；pointercancel 取消

**幅度包络通道**：`envelope` prop 启用后叠加第三条迹线 √(I²+Q²)（`style.envColor` 调色，图例可切显隐）——
基于金字塔 env 聚合（每块存幅度 min/max 及下标），大窗下仍 O(块数) 准确抽稀；
包络通道参与 Y 轴自适应（仅显示包络时量程随之）。
注意：等幅载波（如 sine 调制 I=cos/Q=sin）的包络理论值恒为 1，界面上仅见噪声抖动属正常现象；
包络在 AM/16QAM 等幅度变化信号上才呈现调制波形（16QAM 符号幅度 0.47/1.05/1.41 分层跳变）

**窗口自动测量**：暂停态下左上角显示窗口统计——样本数、I/Q 各自峰峰值 Vpp、均值、RMS
（基于金字塔 sum/sumsq 聚合，大窗 O(块数)，按窗口切片缓存）；仅显示可见通道；跟随态自动隐藏

**测量标记**：数量不限，锚定绝对样本索引（缩放/平移保持数据位置）
- 添加：暂停状态下 Alt+点击空白，或右键菜单「在此处标记」
- 清除：Alt+点击标记（按下无拖动判定）/ 右键「清除该标记」/「清除全部标记」
- 微调：Alt+按住标记拖拽（位移超 4px 判定为拖拽）
- 读数：右上角面板逐标记显示 索引·时间·I/Q；恰好两个标记时附加 Δ 样本 / Δt / 1/Δt 频率
- 刷新（跟随）状态下不允许标记与拖拽平移（始终展示最新数据），仅滚轮/框选缩放（缩放即进入暂停态）
- 左键双击 / 角标「恢复跟随」：恢复刷新并清除全部标记，**保留当前缩放窗宽**；
  `zoomReset()`（「回到最新」）与清空数据才将窗宽复位为 `span` 默认值

**导出**：`exportPNG()` 当前视图截图（波形+轴+图例合成，导出前同步重绘确保 WebGL 帧有效）；
`exportCSV()` 可见窗口原始样本（超 50 万行等步长抽稀；`sampleRate` 存在时附 `time_s` 列）；
导出交付：配置 `exportHandler?` 回调后 PNG/CSV 交由宿主持久化（如 Electron 写入自定义目录），
否则回退浏览器 `<a download>`；两种路径均发 `exported` 事件（`{kind, filename}`）供宿主 UI 反馈

**自动 Y 轴**：目标范围经「V/div 档位量化」（向外吸附到刻度步进族）+ 快扩张/慢收缩平滑——
小幅波动被同一档位吸收，流式刷新时刻度完全静止；仅跨档时离散更新并缓入新档；
清空数据/双击复位/外部切回 autoScale 时状态重置、直接吸附目标范围

**历史淘汰与冻结**：组件内置 200 万样本环形缓冲（Mock 默认推速下约 16s 填满），
填满后每次保留最新 90%、淘汰前沿 `dropped` 阶跃推进；滚轮/拖拽冻结后进入**完全暂停**语义——
新帧在入口直接丢弃（缓冲零增长、淘汰永不发生，视口像素级静止，暂停期间仍可缩放/平移回看历史），
恢复跟随（双击/角标）后自动继续接收；若冻结窗曾被外部视口指向已淘汰区域，视口锚定最老可用数据

**单元测试**：`npm test`（vitest）——覆盖 `axis`（niceStep/niceTicks/snapRangeNice 档位量化）、
`yauto`（Y 轴量程状态机：即时扩张防裁剪/慢速收敛/档位量化静止/reset）、
`pyramid`（整树重建随机区间/增量追加/按桶抽稀与旧实现逐值一致/扩容重建）

**内部**：环形 2M 点；**min/max 极值金字塔**（`core/pyramid.ts`，默认 16 样本/块，多层预聚合，含 min/max 下标以保持原索引顺序）——
Y 轴自适应统计与按桶抽稀均为 O(块数)：200 万点全窗下 Y 统计 ~0.001ms、抽稀 ~0.75ms（旧全扫描分别 ~4.3ms/~3.4ms）；
追加数据仅增量更新受影响块，扩容/环形淘汰后整树重建；`WebGL2` 双 `LINE_STRIP`；
GL 视口/scissor 与 overlay 轴层均按「背板设备像素 ÷ 元素 CSS 实测尺寸」做真实比例映射，
页面缩放/系统非整数缩放场景下波形与网格严格对齐（不依赖全局 DPR 缓存）
