# SRC-01 - 信号源工作台

> `src/renderer/src/pages/source/SourceWorkbenchPage.vue`
>
> 状态：Phase 0/1 已完成——信息架构拆分、源类型目录、源工作台、IQ 预览。
> 当前复用主进程 `signalAnalysis` 的本地源；后续迁移为独立 SourceEngine/OutputBackend。

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
└─ 源/服务高级配置    /source/advanced

信号分析 UI 组件
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
- 源帧元数据：seq/outputMode/waveform/carrierHz；
- 高级配置入口。

## 五、当前边界

- 仍复用 `signalAnalysis` 的本地源与 IPC；
- `SourceEngine`/`OutputBackend` 尚未独立，源和 FFT 分析仍共享主进程服务；
- 高级配置页 `/source/advanced` 暂时仍含 FFT/窗/重叠，后续拆到分析配置；
- 预览只有 IQ，频谱/时频等分析 UI 仍各自订阅分析帧；
- 尚未接入硬件输出/文件导出/确定性种子。

## 六、验证

```powershell
npm run typecheck
npm run test
npm run build
npm run test:source   # 构建后用 mock preload 加载 /source，截图检查页面可渲染
```

`test:source` 输出：`playground/dist/source-workbench.png`。它不启动主进程信号服务，只验证源工作台路由/布局/无同步崩溃；真实推流仍由 `signalAnalysis` 服务测试覆盖。

## 七、后续

1. 主进程抽出 `SourceEngine`，让 source 输出与 FFT 分析解耦；
2. `SourceFrame` 正式契约；
3. 源工作台加频谱预览/输出路由；
4. 真实 RF/DAC 后端与仿真后端；
5. 数字源扩展 OFDM/任意 IQ；
6. 分析页按源场景接入（Pulse→PowerTime、Digital→Eye 等）。
