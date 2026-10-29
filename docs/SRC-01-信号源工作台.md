# SRC-01 - 信号源工作台

> `src/renderer/src/pages/source/SourceWorkbenchPage.vue`
>
> 状态：Phase 0/7 已完成——信息架构拆分、源类型目录、源工作台、IQ/频谱预览、SourceEngine/SourceFrame、独立 source IPC/SourceService、分析侧消费 SourceFrame、独立分析配置页、本地分析去 HTTP/socket 依赖，以及 PowerTime/Eye/APD 的源 IQ 数据源。
> 本地分析现在只通过主进程 SourceFrame → FFT → `signal:analysis` IPC；socket.io 只用于远程后端客户端与独立远端 Mock。

## 一、为什么拆

信号源和分析 UI 是不同领域：

```text
信号源：产生/损伤/输出/播放
分析 UI：显示/测量/触发/FFT 结果
```

源页面不配置 FFT/窗/重叠；分析组件页面不持有源波形参数。

## 二、信息架构

```text
信号源
├─ 信号源工作台       /source
└─ 源/连接高级配置    /source/advanced

信号分析 UI 组件
├─ 分析配置            /signal/analysis-config
├─ IQ 时域            /signal/iq
├─ 频谱               /signal/spectrum
├─ 时频               /signal/spectrogram
├─ 星座               /signal/constellation
├─ 功率-时间          /signal/power-time
├─ 眼图               /signal/eye
├─ 持续谱             /signal/persistence
├─ Smith              /signal/smith
└─ APD/CCDF           /signal/apd
```

`/signal` 旧地址重定向到 `/source/advanced`。

## 三、源类型目录

`src/shared/source.ts` 提供 `SOURCE_CATALOG`：

- CW 单音
- AM / FM
- Pulse 脉冲
- 双音
- Noise
- BPSK / QPSK / 16QAM

每个源有：

```ts
{
  id, label, description,
  waveform, modType?,
  capabilities: {
    outputModes: ['real','complex'],
    supportsDigital,
    usesSamplesPerSymbol
  }
}
```

源类型与分析配置的映射由 `sourceKindOf/sourceKindPatch` 统一，避免页面各自拼 `waveform/modType`。

## 四、工作台能力（Phase 1）

- 源类型选择；
- real/complex 输出；
- 载波、幅度、AWGN；
- 采样率、每帧点数；
- 每符号采样数（数字源）；
- AM/FM/Pulse/双音参数；
- 本地端口、启动/停止/单帧、运行中应用参数；
- IQ 实时预览；
- 频谱实时预览（分析消费者生成）；
- 源帧元数据：seq/outputMode/waveform/carrierHz；
- 分析配置入口：`/signal/analysis-config`；

## 五、SourceEngine / SourceFrame（Phase 2）

新增：

```text
src/shared/sourceEngine.ts
```

```ts
interface SourceFrame {
  seq: number
  timestamp: number
  sampleRate: number
  centerFrequencyHz: number
  outputMode: 'real' | 'complex'
  waveform: string
  modType: string
  samplesPerSymbol: number
  amplitude: number
  data: Float32Array // 交织 IQ
}
```

`SourceEngine`：

- 持有源配置与有状态波形生成器；
- `next(n)` 只生成 `SourceFrame`，不做 FFT；
- `setConfig` 重建生成器，保持相位/符号历史重置语义；
- 可注入确定性 RNG/时钟；
- LocalAnalysisSource 现在只消费 `sourceEngine.next().data` 后做 FFT/时频。

主进程新增 `src/main/source/sourceService.ts` 与独立 IPC：

```text
source:start / source:stop / source:getStatus / source:setConfig / source:trigger
source:frame  →  SourceFrame
```

源工作台已切到 `window.api.source`，不再通过分析服务启动源。启动源后同时启动本地 `signalAnalysis` 消费者，分析 UI 页面即可收到 `signal:analysis`。

分析链路：

```text
SourceService.source:frame
  → LocalAnalysisSource.handleSourceFrame
  → SpectrumAnalyzer / SpectrogramAccumulator
  → signal:analysis
```

## 六、分析组件源接入

`src/shared/sourceAdapters.ts` 提供纯函数：

- `iqToPowerDb`：IQ → 每采样功率 dB；
- `iqToAmplitude`：IQ → 幅度；
- `iqToEyeTraces`：IQ → I 路眼图轨迹。

已接入：

| 组件      | 数据源                          |
| --------- | ------------------------------- |
| PowerTime | 仿真脉冲 / 源 IQ 功率           |
| Eye       | 仿真眼图 / 源 IQ（按 sps 切窗） |
| APD/CCDF  | 仿真 PAPR / 源 IQ 幅度          |

Demo 中显式提供“仿真/源 IQ”切换，组件本身仍是纯显示，不依赖源。

## 七、当前边界

- `LocalAnalysisSource` 已不再自产 IQ，但分析页仍通过旧 `signal:analysis` 事件接收显示帧；
- 本地分析已去掉 HTTP/socket 服务，启动不再监听端口；socket.io 仅保留给远程后端/远端 Mock；
- 源工作台启动源时会启动本地分析消费者；停止时只停止由本页启动的消费者；
- FFT/窗/重叠已迁到 `/signal/analysis-config`；`/source/advanced` 现在只保留连接/端口/远端 Mock；
- PowerTime/Eye/APD Demo 支持“源 IQ”数据源；Persistence/Smith 仍主要使用仿真/静态数据；
- 预览有 IQ 与频谱；时频/星座等分析 UI 仍各自订阅分析帧；
- 尚未接入硬件输出/文件导出/独立模拟后端。

## 八、验证

```powershell
npm run typecheck
npm run test          # 含 sourceEngine/source 目录单测
npm run build
npm run test:source   # mock preload 加载 /source，截图检查页面可渲染
```

`test:source` 输出：`playground/dist/source-workbench.png`。它不启动主进程信号服务，只验证源工作台启动/运行状态、`/signal/analysis-config` 路由、布局/无同步崩溃；真实推流仍由 `signalAnalysis` 服务测试覆盖。

## 九、后续

1. 新分析组件按源类型自动选择显示模式；
2. 真实 RF/DAC 后端与仿真后端；
3. 数字源扩展 OFDM/任意 IQ；
4. 源帧录制/导出与可重复种子。
