# SRC-01 - 信号源工作台

> `src/renderer/src/pages/source/SourceWorkbenchPage.vue`
>
> 状态：Phase 0/18 已完成——SourceEngine/SourceFrame、独立 source IPC/SourceService、OutputBackend、源工作台、OFDM（含远端 Mock）、任意 IQ 文件源、录制（内存/流式分段与背压）/回放、S11 扫频与 Smith 端口校准、源类型推荐并自动切源数据。
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
- OFDM（可调有效子载波/CP，适合频谱、持续谱、APD）

每个源有：

```ts
{
  id, label, description,
  waveform, modType?,
  capabilities: {
    outputModes: ['real','complex'],
    supportsDigital,
    usesSamplesPerSymbol
  },
  analysis: [{ label: '频谱', path: '/signal/spectrum' }, ...]
}
```

工作台会根据源类型显示“推荐分析”入口，例如 Pulse→PowerTime、Digital→Eye/Constellation、OFDM→Persistence/APD。推荐链接带 `?src=1`，Demo 打开后自动切到“源数据”模式。

源类型与分析配置的映射由 `sourceKindOf/sourceKindPatch` 统一，避免页面各自拼 `waveform/modType`。

## 四、工作台能力（Phase 1）

- 源类型选择；
- real/complex 输出；
- 载波、幅度、AWGN；
- 采样率、每帧点数；
- 每符号采样数（数字源）；
- OFDM 有效子载波 / CP 比例；
- AM/FM/Pulse/双音参数；
- 启动/停止/单帧、运行中应用参数；
- 导入任意 little-endian interleaved f32 IQ（最多 8M 样本）；
- 回放录制 / 导入 IQ / 流式录制；
- IQ 实时预览；
- 频谱实时预览（分析消费者生成）；
- 源帧元数据：seq/outputMode/waveform/carrierHz；
- 推荐分析入口；
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

OFDM 生成：

- 64 点 IFFT，有效子载波 2~52（默认 32，QPSK）；
- 循环前缀比例 0~0.5（默认 0.25）；
- 跨帧连续，输出仍为交织 IQ；
- real 输出时 Q 严格为 0。

主进程新增 `src/main/source/sourceService.ts` 与独立 IPC：

```text
source:start / source:stop / source:getStatus / source:setConfig / source:trigger
source:frame  →  SourceFrame
```

源工作台已切到 `window.api.source`，不再通过分析服务启动源。启动源后同时启动本地 `signalAnalysis` 消费者，分析 UI 页面即可收到 `signal:analysis`。

OutputBackend 层（`src/shared/sourceBackend.ts`）：

```text
SourceOutputBackend
  ├─ SimulatedOutputBackend  → SourceEngine
  └─ PlaybackOutputBackend   → SourcePlayback
```

硬件 RF/DAC 后端后续按同一接口接入，不改 SourceService 的帧分发。

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
- `iqToEyeTraces`：IQ → I 路眼图轨迹；
- `spectrumToBins`：频谱行 → 固定显示 bins；
- `linearToDb`：线性幅度 → dB。

已接入：

| 组件        | 数据源                                 |
| ----------- | -------------------------------------- |
| PowerTime   | 仿真脉冲 / 源 IQ 功率                  |
| Eye         | 仿真眼图 / 源 IQ（按 sps 切窗）        |
| APD/CCDF    | 仿真 PAPR / 源 IQ 幅度                 |
| Persistence | 仿真频谱 / 源频谱（重采样到固定 bins） |
| Smith       | 仿真轨迹 / S11 扫频                    |

Demo 中显式提供“仿真/源数据”切换，组件本身仍是纯显示，不依赖源。

## 七、源帧录制 / 导出

源工作台支持：

- 开始/停止录制；
- 显示录制帧数/样本数/时长；
- 达到上限后标记截断并停止；
- 导出为 `.f32` + `.json`。

文件格式：

```text
source-recording-*.f32   little-endian interleaved IQ
source-recording-*.json  {
  format: 'source-iq-f32-v1',
  endianness: 'little',
  layout: 'interleaved IQ',
  sampleRate,
  totalSamples,
  frames: [{ seq, timestamp, sampleRate, centerFrequencyHz,
             outputMode, waveform, modType, samplesPerSymbol,
             amplitude, sampleCount }]
}
```

`SourceRecorder` 位于 `src/shared/sourceRecorder.ts`，默认上限 4,000,000 样本。

流式录制：

- 工作台“流式”开关；
- `SourceStreamRecorder` 将每个 SourceFrame 的 IQ 直接写入临时 `.f32`；
- 内存只保留帧元数据；
- 导出时复制临时文件并写 `.json`；
- 不受内存样本上限约束，适合长时间录制；
- 流式录制按 16MB 分段，导出时按顺序拼接；
- 写队列超过 64MB 会标记截断并停止；
- 导出对话框取消时临时文件保留到下次录制/退出。

回放：

- 源工作台“回放录制”选择 `.f32/.json`；
- 主进程解析并重建 SourceFrame；
- 按 60fps 顺序循环回放；
- 回放帧同样进入源工作台预览与分析消费者；
- `SourcePlayback` 位于 `src/shared/sourcePlayback.ts`。

任意 IQ 导入：

- “导入 IQ”选择 `.f32/.bin/.raw`；
- 按 little-endian interleaved f32 解析；
- 使用源工作台当前采样率/载波/输出模式；
- 按 `pointsPerFrame` 切帧后走 PlaybackOutputBackend；
- 最多导入 8,000,000 样本，超出截断提示；
- 不读取外部元数据。

## 八、S11 扫频源

`src/shared/sweep.ts` 生成串联 RLC 的复反射系数：

```text
Z = R + j(ωL - 1/ωC)
Γ = (Z - Z0) / (Z + Z0)
```

- 1–500 MHz 等间隔频点；
- 默认 401 点；
- `SweepService` 以 `sweep:frame` 推送；
- Smith 圆图“S11 扫频”模式消费，R/L/C 可调；
- 校准/去嵌入支持端口延时 `calDelayPs` 与补偿损耗 `calLossDb`；
- Γ 校准：`Γ' = Γ · 10^(calLossDb/20) · e^{j2πf·calDelayPs}`；
- 与 IQ SourceFrame 属于不同测量域，不混入 `source:frame`。

## 九、当前边界

- `LocalAnalysisSource` 已不再自产 IQ，但分析页仍通过旧 `signal:analysis` 事件接收显示帧；
- 本地分析已去掉 HTTP/socket 服务，启动不再监听端口；socket.io 仅保留给远程后端/远端 Mock；
- 源工作台启动源时会启动本地分析消费者；停止时只停止由本页启动的消费者；
- FFT/窗/重叠已迁到 `/signal/analysis-config`；`/source/advanced` 现在只保留连接/端口/远端 Mock；
- PowerTime/Eye/APD/Persistence Demo 支持“源数据”数据源；Smith 支持“S11 扫频”；
- 录制支持内存与流式落盘；流式模式只保留元数据，导出时复制临时 f32；
- 回放支持暂停/继续/单步/定位、0.5x/1x/2x/4x 变速、固定 60fps 或按原始时间戳调度，以及循环开关；
- 时间戳模式按帧时间差调度，处理耗时会导致轻微漂移；
- 源目录含 OFDM；有效子载波/CP 可调；远端 Mock 也实现了同一 OFDM 生成；
- 工作台按源类型显示推荐分析入口，推荐链接自动切源数据；
- 预览有 IQ 与频谱；时频/星座等分析 UI 仍各自订阅分析帧；
- 硬件 RF/DAC 后端未接；OutputBackend 目前只有模拟与回放实现。

## 十、验证

```powershell
npm run typecheck
npm run test          # 含 sourceEngine/source 目录单测
npm run build
npm run test:source   # mock preload 加载 /source，截图检查页面可渲染
```

`test:source` 输出：`playground/dist/source-workbench.png`。它不启动主进程信号服务，只验证源工作台启动/运行状态、`/signal/analysis-config` 路由、布局/无同步崩溃；真实推流仍由 `signalAnalysis` 服务测试覆盖。

## 十一、后续

1. 真实 RF/DAC 硬件后端；
2. Smith 完整 SOLT 校准与夹具去嵌入；
3. 流式录制定时/滚动归档；
4. 任意 IQ 文件元数据自动识别（sampleRate/center/格式）；
5. 录制可重复种子与远端 Mock 场景扩展。
