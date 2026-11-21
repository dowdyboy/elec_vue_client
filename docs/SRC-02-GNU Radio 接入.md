# SRC-02 - GNU Radio 网络源接入

> 对应源码：`src/main/source/network/`、`src/shared/sourceNetwork.ts`、`src/renderer/src/pages/source/NetworkSourcePage.vue`
> 演示页：`/source/network`（信号源 → 网络源）
> GNU Radio 侧示例：`tools/gnuradio/`（本机实测 GNU Radio 3.10.12 / radioconda）

## 一、链路

信号源原来只有「模拟源」和「录制回放」。本页新增第三种源后端：**TCP IQ 网络源**。
GNU Radio 3.10.12 的 `gr-blocks` 没有 `tcp_sink`，因此本机示例走 **ZMQ PUB → `zmq_to_tcp.py` 桥 → TCP**：

```
GNU Radio（本机 radioconda / 远程 Linux）
  AD9361 / 文件 / 信号源 → throttle → zeromq.pub_sink (complex64)
        │ ZMQ tcp://127.0.0.1:5555
        ▼
zmq_to_tcp.py（Python 桥，可运行在 GNU Radio 机器上）
  ZMQ SUB → complex64 → ci16/cf32/cf32 + ELIQ 48B 帧头 → TCP :5000
        │ TCP
        ▼
Electron 主进程 TcpIqSource
  IqStreamParser（自动识别裸流/帧头）→ IqRingBuffer → 60fps 抽取 → SourceFrame
        ├→ SourceRecorder（录制/导出/回放）
        ├→ source:frame（网络页/工作台预览）
        └→ LocalAnalysisSource → signal:analysis → 10 个组件
```

关键点：

- **组件库零改动**：网络源仍产出 `SourceFrame`；
- **本机/远程同一套代码**：只改 `host`；
- **裸流与帧头都支持**：解析器自动识别，帧头带 seq/采样率/中心频率/格式；
- **高采样率预留**：环形缓冲存原始字节，只转换显示/分析所需样本。

## 二、快速开始（不装 GNU Radio）

另开终端（带 ELIQ 帧头）：

```powershell
node scripts/gnuradio-mock-tcp.mjs --port 5000 --format ci16 --sample-rate 200000 --freq 10000 --framed
```

应用内：

1. 打开 `/source/network`；
2. 主机 `127.0.0.1`、端口 `5000`、格式 `ci16`、线上/显示采样率 `200000`；
3. 点「连接」；
4. IQ 预览出现 10 kHz 单音，频谱峰值在 10 kHz；
5. 「帧头 / 包」应显示 `ELIQ / N`；「seq 丢包」为 0；
6. 录制/导出/回放见第五节。

## 三、GNU Radio 侧（Windows radioconda）

```powershell
conda activate radioconda
python -c "from gnuradio import gr; print(gr.version())"
# 本机实测：3.10.12.0 / Python 3.12.9
```

终端 A（GNU Radio 产 ZMQ）：

```powershell
python tools/gnuradio/tone_zmq_sink.py --address tcp://127.0.0.1:5555 --sample-rate 100000 --freq 10000
```

终端 B（ZMQ → TCP 桥）：

```powershell
python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5555 --port 5000 --format ci16 --sample-rate 100000
```

应用侧：格式 `ci16`、线上采样率 `100000`，连接 `127.0.0.1:5000`。

> 3.10.12 没有 `blocks.tcp_sink`（只有 `socket_pdu`）；如果你的 GNU Radio 版本有 `tcp_sink`，
> 也可以直接用它，但本仓库示例按 ZMQ + 桥维护。

### AD9361 / FMCOMMS

把 `tone_zmq_sink.py` 里的 `analog.sig_source_c` 换成 gr-iio 的 FMCOMMS2 Source
（或 `uhd.usrp_source` / `osmosdr.source`），后面接 `zeromq.pub_sink`。
建议先用 2–5 MSPS 验证链路，再逐步升到 10/30.72 MSPS。

**本机一键演示**（本机实测可用）：

```powershell
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --sample-rate 100000 --freq 10000
# READY {"port":5000,...} 后应用连接 127.0.0.1:5000
```

`tone_pipeline.py` 把 flowgraph + ZMQ→TCP 桥放在一个进程里；Ctrl+C 同时停止两者。

### 应用内一键启动（不绑死环境）

`/source/network` 的「本机 GNU Radio（Python / conda，一键启动）」卡片可以直接拉起
`tone_pipeline.py`：

- **Python 路径**：可填任意 conda/venv 的 `python.exe`；默认只做候选探测
  （环境变量 `GNU_RADIO_PYTHON` / `RADIOCONDA_PYTHON`、常见 radioconda/miniconda 目录），
  找不到时留空由用户填写；
- **脚本目录 / 脚本名**：默认 dev 的 `tools/gnuradio/tone_pipeline.py`，
  打包后为 `resources/gnuradio/tone_pipeline.py`；也可换成自己的脚本；
- **端口 / 采样率 / 单音频率 / 中心频率 / 格式**：随启动参数传给脚本；
  端口 `0` 表示由脚本自选并通过 `READY` 返回；
- 配置持久化在应用 `userData/local-gnuradio.json`，换机器/换环境不需要改代码；
- 启动成功后自动回填 host/port/format/sampleRate 并连接；断开网络源时同时停止本机进程
  （Windows 用 `taskkill /T /F` 杀进程树），应用退出也会清理。

> 自定义脚本只需接受
> `--tcp-port --format --sample-rate --freq --center-hz`，并在监听成功后向 stdout 打印
> `READY {"port":<实际端口>}`（其余行会显示在页面日志里）。

## 四、ELIQ 帧头（48 字节，小端）

| 偏移 | 类型 | 字段         | 说明                                           |
| ---- | ---- | ------------ | ---------------------------------------------- |
| 0    | 4s   | magic        | `ELIQ`                                         |
| 4    | u8   | version      | 1                                              |
| 5    | u8   | msgType      | 1=IQ raw/full；4=显示抽取 IQ（桥已抽取）       |
| 6    | u16  | headerLen    | 48                                             |
| 8    | u32  | seq          | 包序号，用于丢包统计                           |
| 12   | u64  | timestampNs  | 采集墙钟（ns）                                 |
| 20   | u32  | sampleRate   | 线上采样率                                     |
| 24   | f64  | centerHz     | 中心频率                                       |
| 32   | u8   | format       | 0=cf32 / 1=ci16 / 2=ci8                        |
| 33   | u8   | channels     | 1=单通道；2=AD9361 双 RX（payload 按样本交错） |
| 34   | u16  | reserved     | 0                                              |
| 36   | u32  | payloadBytes | 后续 payload 字节数                            |
| 40   | u32  | reserved2    | 0                                              |
| 44   | u32  | reserved3    | 0                                              |

解析器行为：

- 首 4 字节为 `ELIQ` 且头部合法 → 帧头模式；否则按裸流；
- `channels=2` 时 payload 为样本交错：`[ch0 I/Q][ch1 I/Q][ch0 I/Q]...`；
- TCP 半包/粘包由解析器缓冲处理；
- 帧头格式/通道数与页面配置不一致 → 丢弃该包并在链路状态显示错误；
- 帧头采样率与配置不一致 → 显示警告（频率轴可能错误）；
- `seq` 跳变统计为「seq 丢包」；缓冲溢出统计为「缓冲丢样本」。

## 五、录制与回放

**网络源（raw，全速）**：

- 连接网络源后点「开始录制」进入 `raw` 模式：解析出的 ci16/cf32/ci8 payload **原样写盘**，
  不做 Float32 转换（适合 AD9361 高采样率）；
- 按 256 MB 分段写临时文件，`writableLength` 超过 64 MB 时暂停 TCP（背压），
  尽量不丢样本；默认总上限 4 GB，超出置 `truncated`；
- 「滚动归档」开启后每段写满自动移到 `userData/raw-archive/`（独立 `.ci16 + .json`），
  录制不再受 4 GB 限制；同时维护 `index.json`，记录所有归档段；
- 归档目录显示剩余磁盘；低于 1 GB 时状态 `lowDisk=true`，页面给告警；
- 「载入归档回放」读取 `index.json`，跨段连续播放/seek/循环，可选 RX0/RX1 和全速；
- 当前未归档段仍用「导出」；
- 「导出」生成 `<name>.ci16/.cf32/.ci8` + 同名 `.json` sidecar
  （format/channels/sampleRate/centerHz/bytes/samples/frames/segments/durationMs）；
  双通道时 `channels:2`、`samples` 按每通道计；raw 回放可选 RX0/RX1；
- 「全速」raw 回放不做 2 MSPS 抽取（高频下 UI 可能卡顿）；
- 「载入 raw 回放」读取 raw + sidecar，默认按 `min(sampleRate, 2 MSPS)` 抽取后走
  `RawIqPlayback`（逐帧读文件，不整体载入内存）；支持循环/暂停/单步/倍速/seek；
- 未导出时页面会阻止「断开网络源」，避免当前临时段被清理；
- 临时目录为 `os.tmpdir()/elec-raw-*`；显式断开/退出会等待删除，应用启动时还会清理
  上次崩溃/测试遗留的目录（`RawIqRecorder.cleanupStaleTempDirs`）。

**模拟源（显示率）**：

- 「开始录制」默认内存模式（`SourceRecorder`，上限 400 万复数样本）；打开「流式落盘」走
  `SourceStreamRecorder`（临时 `.f32` 分段，导出时拼接）；
- 「导出」生成 `.f32 + .json`（与既有录制/导入 IQ 格式一致）；
- 「载入录制并回放」复用 `SourcePlayback`，支持暂停/单步/倍速/循环；
- 网络源与模拟源/回放互斥：连接网络源会停掉模拟源并停止正在进行的录制。

## 六、配置字段

| 字段                | 说明                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `host`              | `127.0.0.1`（本机）或 LAN IP（远程）；不要带 `http://`                                     |
| `port`              | `zmq_to_tcp.py` / `tcp_sink` 的监听端口                                                    |
| `format`            | `cf32`（8 B/样本）、`ci16`（4 B/样本）、`ci8`（2 B/样本）                                  |
| `channels`          | 1（单通道）或 2（AD9361 RX0/RX1，payload 按样本交错）                                      |
| `sampleRate`        | 线上全速采样率，必须与 GNU Radio/桥一致                                                    |
| `centerHz`          | 源中心频率，用于显示/分析读数                                                              |
| `displaySampleRate` | 显示/分析采样率（≤ `sampleRate`）；单流时应用简单抽取；双流时桥按此抽取后以 msgType=4 发送 |
| `dualStream`        | `true` 时开双流：msgType=1 全速 raw 用于录制，msgType=4 显示包只用于 FFT/展示              |
| `recordPort`        | `>0` 时启用独立录制 TCP（与 `port` 不同）；`0`=同端口双流                                  |
| `recordHost`        | 录制连接主机，默认同 `host`                                                                |
| `recordFormat`      | 录制流格式，默认同 `format`                                                                |
| `recordSampleRate`  | 录制启动前兜底采样率；帧头到达后以帧头为准                                                 |
| `pointsPerFrame`    | 每帧复数样本数；`0` = 自动（`displaySampleRate / 60`）                                     |
| `maxBufferBytes`    | 环形缓冲上限（默认 32 MB）                                                                 |
| `reconnect`         | 断线自动重连（指数退避，最多 10s）                                                         |

> `displaySampleRate < sampleRate` 时：单流是**简单抽取**（每 stride 个取 1 个，不做抗混叠）；
> 双流由桥用 `scipy.signal.resample_poly` 做带抗混叠的抽取，应用不再二次抽取。
> 同端口双流带宽 = raw + 显示；独立端口把 raw 拆到另一条 TCP，远程可只连显示端口。

## 七、速率预算（重要）

| 场景                           | 线上格式 | 带宽           |
| ------------------------------ | -------- | -------------- |
| 2 MSPS 显示                    | cf32     | 16 MB/s        |
| 2 MSPS 显示                    | ci16     | 8 MB/s         |
| 30.72 MSPS 全速                | ci16     | **122.9 MB/s** |
| 30.72 MSPS 全速                | cf32     | 245.8 MB/s     |
| 61.44 MSPS 全速（AD9361 上限） | ci16     | 245.8 MB/s     |

- 1 GbE 理论 125 MB/s、实际约 118 MB/s：**30.72 MSPS ci16 已到上限，不可靠**；
- 远程高采样率：GNU Radio 侧先抽取到 2–5 MSPS 发显示流；需要全速时用 10 GbE 或本机落盘；
- 30.72 MSPS ci16 录制约 **442 GB/小时**，必须分段轮转 + 容量告警，建议触发式短录制。

页面在远程 + 超过 80 MB/s 时会显示链路预算警告。

## 八、排错

| 现象                | 排查                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| 连接超时            | 桥是否监听？`--host 0.0.0.0`？Windows 防火墙？                                         |
| 连上无数据          | GNU Radio flowgraph 是否运行？ZMQ 地址是否一致？桥日志是否有 client？                  |
| 峰值位置不对        | 应用 `sampleRate`、桥 `--sample-rate`、GNU Radio `samp_rate` 是否一致？                |
| 帧头格式/采样率报错 | 应用 format/采样率与桥 `--format`/`--sample-rate` 不一致                               |
| 丢包计数增长        | 看「seq 丢包」；降低采样率或让 GNU Radio 抽取                                          |
| 远程连不上          | 先用 `127.0.0.1` 验证，再换 LAN IP；WSL2 注意端口转发                                  |
| 重连后时间轴跳变    | 断线期间样本缺失，`timestamp` 按显示样本连续累计；需要严格时间戳时后续接 `rx_time` tag |

## 九、双流（raw + 显示）

30 MSPS 场景如果应用自己全速收 IQ 再抽取，主进程压力很大。双流把“录制”和“显示”分开：

- **同端口双流**（`--dual`）：一条 TCP 上发两个 ELIQ 包：
  - `msgType=1`：全速 raw（ci16/cf32），应用只写 raw recorder；
  - `msgType=4`：`scipy.signal.resample_poly` 抽取后的显示 IQ，应用只喂 FFT/组件；
- **独立双端口**（`--record-port`）：显示和录制各一条 TCP：
  - 显示端口只发显示抽取包，应用只连它就能远程看频谱；
  - 录制端口发全速 raw，可以只监听在 GNU Radio 机器本地/内网；
  - 两个连接独立重连、独立背压，显示断开不影响录制（反之亦然）。

本机示例：

```powershell
# 同端口双流
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 `
    --sample-rate 120000 --display-sample-rate 60000 --freq 10000 --dual

# 独立双端口：显示 5000，录制 5001
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --record-port 5001 `
    --sample-rate 120000 --display-sample-rate 60000 --freq 10000
```

应用：线上采样率 `120000`、显示采样率 `60000`，勾选「双流」；独立端口再填「录制端口」`5001`。
页面「模式」显示「独立双端口」，「录制连接」显示录制链路状态；raw 录制仍按 raw 流采样率/格式写盘。

> 桥对每个 ZMQ 块单独 `resample_poly`，块边界会有滤波器瞬态；演示/预览足够，
> 正式测量建议在 GNU Radio 侧用 `freq_xlating_fir_filter` 抽取后再发显示流。
> 显示包格式目前必须与应用 `format` 一致；桥的 `--display-format` 默认跟随 `--format`。

## 十、AD9361 双通道（GNU Radio 模拟）

没有双通道 SDR 时，用 GNU Radio 生成两路单音模拟 AD9361 RX0/RX1：

```powershell
# 显示 5000，录制 5001；channels=2；RX0=10 kHz，RX1=15 kHz
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --record-port 5001 `
    --sample-rate 120000 --display-sample-rate 60000 `
    --channels 2 --freq 10000 --freq2 15000
```

- `tone_zmq_sink.py --channels 2` 用 `blocks.vector_source_c(..., vlen=2)` 产生交错双通道；
- 桥 `--channels 2` 把 `channels=2` 写进 ELIQ 头；显示抽取按通道分别
  `resample_poly(axis=0)`，避免混道；
- 应用「RX 通道数」选 2；页面出现 RX0/RX1 切换按钮，图表/分析只消费当前通道；
- 网络源页面同时提供 **RX0/RX1 并排 IQ/频谱预览**，两路独立订阅，不占主分析通道；
- 主分析页新增 `/signal/dual`：RX0/RX1 各一套 IQ + 频谱，可勾选「同步缩放」；
- raw 录制写**双通道交错**文件，sidecar `channels: 2`，`samples` 按每通道计；
- 双通道 raw 回放在「回放通道」里选 RX0/RX1；可选「全速」不做 2 MSPS 抽取；
- 「滚动归档」开启后每段写满约 256 MB 自动落到 `userData/raw-archive/`，
  省去单文件 4 GB 上限；当前未归档段仍可用「导出」导出。

接真实 AD9361（FMCOMMS2/3）时，把 `tone_zmq_sink.py` 里的 `ToneZMQ` 换成
`gr-iio` 的 `FMCOMMS2 Source`（`nchan=2`），桥参数 `--channels 2` 不变；应用侧协议/UI 已就绪。

**完全不用 GNU Radio**：打开 `/signal/dual`，点「启动内置双通道模拟」即可用应用内
`SourceEngine` 生成 RX0/RX1（频率、相位差可调）；跨通道面板显示幅度比、相位差、相关系数。
勾选「时频/星座」还会显示两路时频与星座图。

> 主分析/图表一次显示一个通道；网络源页面的 RX0/RX1 预览是并排的。双通道 raw 已保存，
> 回放时可选通道 0/1。

## 十一、当前限制与后续

当前（Phase 4）：

- 支持裸流 + ELIQ 帧头自动识别、seq 丢包统计、帧头采样率/中心频率显示；
- 应用内可配置 Python/脚本一键启动本机 GNU Radio（不绑死环境）；
- 网络源录制为全速 raw（ci16/cf32/ci8 直写 + sidecar JSON），默认 ≤2 MSPS 抽取回放，可选全速；
- 双流：桥端 FIR 抽取显示包（msgType=4）+ 全速 raw（msgType=1）；支持同端口和独立双端口两条链路；
- AD9361 双通道：`channels=2` 交错 payload、RX0/RX1 切换、双通道 raw + sidecar `channels=2`；
- 双通道并排：网络源页 + `/signal/dual` 主分析页（IQ/频谱/时频/星座，可同步缩放）；
- 跨通道测量：幅度比、相位差、相关系数；应用内双通道模拟源无需 GNU Radio；
- 双通道 raw 回放可选通道；滚动归档每段 256 MB 自动落 `userData/raw-archive`，
  带 `index.json`、磁盘剩余告警、跨段连续回放；
- 只支持小端；
- 单流模式仍是简单抽取（双流模式桥端抗混叠）；
- 主分析页一次显示一个通道的常规图表；`/signal/dual` 专门并排两路；
- 本机启动依赖用户配置的 Python/脚本（默认自动探测 radioconda/miniconda）。

后续：

1. 归档保留策略（按天/GB 自动清理）与更长时间压测；
2. `/signal/dual` 的瀑布/更多组件与同步联动扩展；
3. `rx_time`/`freq` tag → 帧头扩展字段；
4. 远程链路鉴权/TLS（独立端口已支持只拉显示）。

## 十二、代码结构

| 文件                                                              | 作用                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/shared/sourceNetwork.ts`                                     | 配置/状态类型、校验、自动点数/抽取计算                     |
| `src/main/source/localGnuRadio.ts`                                | 本机 Python/脚本一键启动、READY 解析、进程树清理           |
| `src/main/source/network/iqStreamParser.ts`                       | 裸流/ELIQ 帧头解析、seq 丢包、格式校验                     |
| `src/main/source/network/rawIqRecorder.ts`                        | 全速 raw 录制（分段/背压/导出）                            |
| `src/main/source/network/rawTcpLink.ts`                           | 独立录制 TCP 连接（只收 msgType=1，独立重连/背压）         |
| `src/main/source/network/iqChannelSplit.ts`                       | 双通道交错 payload 解交织（ci16/cf32/ci8）                 |
| `src/main/source/network/rawIqPlayback.ts`                        | raw 录制回放（逐帧读文件 + 抽取）                          |
| `src/main/source/network/rawArchivePlayback.ts`                   | 滚动归档目录跨段连续回放                                   |
| `src/shared/sourceDualSim.ts`                                     | 应用内双通道合成源配置/校验                                |
| `src/shared/sourceDualMetrics.ts`                                 | 跨通道幅度比/相位差/相关系数                               |
| `src/main/source/network/iqRingBuffer.ts`                         | 原始字节环形缓冲（按 stride 抽取读取）                     |
| `src/main/source/network/tcpIqSource.ts`                          | TCP 连接、60fps drain、重连、状态                          |
| `src/main/source/sourceService.ts`                                | `startNetwork/stopNetwork/networkStatus`，与模拟/回放互斥  |
| `src/main/source/sourceIpc.ts`                                    | `source:*` 通道注册（含网络源启停与录制/回放控制）         |
| `src/main/source/sourceFiles.ts`                                  | raw 录制/任意 IQ 的对话框与 sidecar 解析                   |
| `src/preload/index.ts`                                            | `window.api.source.startNetwork/stopNetwork/networkStatus` |
| `src/renderer/src/pages/source/NetworkSourcePage.vue`             | 连接参数、链路状态、IQ/频谱预览、录制/回放                 |
| `src/renderer/src/pages/signal/DualChannelPage.vue`               | RX0/RX1 并排 IQ+频谱、同步缩放                             |
| `scripts/gnuradio-mock-tcp.mjs`                                   | 无 GNU Radio 的 Mock（支持 `--framed`）                    |
| `scripts/gnuradio-e2e.cjs` + `run-gnuradio-e2e.mjs`               | 真实 Electron E2E（默认 framed）                           |
| `scripts/gnuradio-split-e2e.cjs` + `run-gnuradio-split-e2e.mjs`   | 独立双端口 E2E                                             |
| `scripts/gnuradio-dualch-e2e.cjs` + `run-gnuradio-dualch-e2e.mjs` | 双通道模拟 E2E                                             |
| `scripts/gnuradio-perf-e2e.cjs` + `run-gnuradio-perf-e2e.mjs`     | 10 MSPS 吞吐测试                                           |
| `tools/gnuradio/tone_zmq_sink.py`                                 | GNU Radio 单音 → ZMQ                                       |
| `tools/gnuradio/zmq_to_tcp.py`                                    | ZMQ → TCP IQ 桥（默认 ELIQ 帧头）                          |

## 十三、验证

```powershell
npm run typecheck
npm test                    # 含 sourceNetwork / iqRingBuffer / iqStreamParser
npm run test:gnuradio       # 构建 + framed Mock + Electron E2E
npm run test:raw-playback   # raw 录制回放 E2E（临时 ci16 + sidecar）
npm run test:gnuradio-split # 独立双 TCP 端口 E2E
npm run test:gnuradio-dualch # AD9361 双通道模拟 E2E（2ch 解交织/RX0-RX1/raw）
npm run test:dual-sim     # 应用内双通道模拟 E2E（无 GNU Radio）
npm run test:local-gnuradio # 本机有 GNU Radio 时验证一键启动（不进 CI）
npm run test:gnuradio-perf  # 10 MSPS 吞吐冒烟（Mock，本机；不进 CI）
```

10 MSPS 本机真实 GNU Radio 实测（display 2 MSPS / record 10 MSPS，独立端口，4 秒）：

```text
[gnuradio-perf] samples=39976607 throughput=9.99 MS/s ratio=99.9%
[gnuradio-perf] PASS
```

> Mock 的 JS 波形生成/回环约 6 MS/s，`test:gnuradio-perf` 默认阈值 50% 只做冒烟；
> 真实 10 MSPS 用 `GNU_PERF_EXTERNAL=1` + `tone_pipeline.py --record-port`，
> 建议 `GNU_PERF_MIN_RATIO=0.9`。
>
> 双通道 10 MSPS 用 Python/ZMQ 模拟桥在 `--batch`（默认 8）下实测约 **9.01 MS/s/通道
> （90.1%）**，32 MB 分段滚动归档 8 段；批量 `sendall` 明显优于逐块发送。

E2E 覆盖：连接 framed Mock ci16 单音 → `source:frame` 到达 → `signal:analysis` 的
spectrum 帧到达 → 帧头 `framed/packets` 断言 → 录制帧/样本 > 0 → 停止。

真实 GNU Radio 验证（本机 radioconda 3.10.12）：

```powershell
# 终端 A
python tools/gnuradio/tone_zmq_sink.py --address tcp://127.0.0.1:5555 --sample-rate 100000 --freq 10000
# 终端 B
python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5555 --port 5000 --format ci16 --sample-rate 100000
# 然后应用连接 127.0.0.1:5000
```
