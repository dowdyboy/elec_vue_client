# SIG-00 - 信号组件总览（可复用高性能）

> 定位：垂直领域 4 组件（IQ/频谱/时频/星座），**拷贝即用**，数据经 `adapter` 自转（后端协议不确定，前端统一为 `Float32Array`），组件内 `WebGL2 + Worker` 自闭环高性能，自带 `light/dark` 主题，无额外依赖

## 一、快速拷贝

```bash
node scripts/copy-signal.mjs ../other-app
# 拷 src/components/signal/** 到他项目
```

他项目：

```vue
import IqChart from '@/components/signal/IqChart.vue' import SpectrumChart from
'@/components/signal/SpectrumChart.vue' import SpectrogramChart from
'@/components/signal/SpectrogramChart.vue' import ConstellationChart from
'@/components/signal/ConstellationChart.vue'

<IqChart :adapter="myAdapter" ref="iq" theme="dark" />
<SpectrumChart :fft-size="2048" db-scale />
```

流式（高频）：`iqRef.value.appendData(rawFromBackend)`（`Transferable`，`rAF` 节流 `fpsLimit`）

## 二、适配器（前端自转）

```ts
import { iqAdapters } from '@/components/signal/core/adapters'
type Adapter = (raw:unknown)=> Float32Array|{i:Float32Array,q:Float32Array}|null

// 内置：passthrough / jsonInterleaved / arrayBuffer / base64
// 自定义：后端推 {payload:{iData:[],qData:[]}} 时
const myAdapter = (raw:any)=>{
  const d=raw.payload, n=d.iData.length, out=new Float32Array(n*2)
  for(let k=0;k<n;k++){ out[2*k]=d.iData[k]; out[2*k+1]=d.qData[k] }
  return out
}
<IqChart :adapter="myAdapter" />
```

适配器在组件内执行（大数据可移入 Worker），失败返回 `null` 丢帧，不中断渲染

## 三、通用 Props

```ts
interface ChartBaseProps {
  theme?: 'light' | 'dark' | 'auto' | 'spectrum' // 自带，无需 NaiveUI；spectrum 为频谱仪黑底黄迹预置
  width?
  height? // 未传则 ResizeObserver 自适应
  decimation?: 'minmax' | 'lttb' | false
  fpsLimit?: number // 60
  viewport?: { xMin?; xMax?; yMin?; yMax?; autoScale? }
  adapter?: Adapter
  data?: RawInput | Normalized // 受控；高频用 appendData
}
```

## 四、四组件一览

| 组件                 | 输入（经 adapter）                       | 内部计算                      | 渲染                                         |
| -------------------- | ---------------------------------------- | ----------------------------- | -------------------------------------------- |
| `IqChart`            | `{i,q}` 或交织 `Float32Array`            | 环形缓冲 + minmax 抽稀（按索引排序）；V/div 档位自适应 + 完全暂停语义；坐标轴/十字光标/多标记/框选缩放/图例显隐/右键菜单/时间轴（sampleRate）/导出（PNG+CSV） | WebGL2 折线双通道 + Canvas2D 轴层（实测比例映射，页面缩放下波形与网格严格对齐） |
| `SpectrumChart`      | 服务端算好的 dB 幅度谱 `Float32Array`    | minmax 抽稀到视口宽           | WebGL2 折线                                  |
| `SpectrogramChart`   | 服务端算好的 dB 行 `Float32Array`        | 行累计瀑布（最新行在顶部，历史向下滚动；行长变化自动重置） | Canvas2D `ImageData` 行刷 |
| `ConstellationChart` | `{i,q}`                                  | 环形缓冲 500k 点，对称方形视口 | WebGL Points（pointSize 可调）               |

## 五、性能要点

- 全链路 `Float32Array` 二进制，`postMessage(buf,[buf])` 零拷贝
- 组件零外部依赖：类型内联于 `core/types.ts`，仅依赖 Vue 3 + 浏览器 WebGL2/Canvas2D
- 瀑布 `ImageData` 行刷 + 离屏 canvas 复用（最新行在顶部，历史向下滚动）
- `viewport` 抽稀到 `~2×px` 点，1M 点/帧 → 2k 点绘制

## 六、验证

```bash
npm run typecheck && npm run lint
# 模拟：setInterval(()=> chart.appendData(new Float32Array(4096).map(()=>Math.random()*2-1)), 16)
```
