# GNU Radio 接入示例

本目录放 **GNU Radio 侧** 示例，配合 Electron 的「网络源」页面（`/source/network`）使用。

> 本机实测环境：**Windows radioconda，GNU Radio 3.10.12.0，Python 3.12.9**。
> 3.10.12 的 `gr-blocks` **没有 `tcp_sink`**（只有 `socket_pdu`），所以这里走
> **ZeroMQ PUB → `zmq_to_tcp.py` 桥 → TCP**；应用侧仍按 TCP IQ 连接。

## 1. 环境

```powershell
conda activate radioconda
python -c "from gnuradio import gr; print(gr.version())"
```

如果 `python` 不是目标环境，用 `conda run -n radioconda python ...`，或直接调用
`D:\ProgramFiles\miniconda3\envs\radioconda\python.exe`。

## 2. 单音示例（不需要 SDR）

**一键（推荐本机演示）**：

```powershell
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --sample-rate 100000 --freq 10000
```

输出 `READY {"port":5000,...}` 后，应用 `/source/network` 直接连接 `127.0.0.1:5000`
（ci16 / 100000），Ctrl+C 同时停 flowgraph 与桥。

**双流（推荐 30 MSPS/AD9361 场景）**：

```powershell
# 同一条 TCP：raw + 显示抽取
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --sample-rate 120000 `
    --display-sample-rate 60000 --freq 10000 --dual

# 独立双端口：显示 5000，录制 5001（远程只拉显示）
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --record-port 5001 `
    --sample-rate 120000 --display-sample-rate 60000 --freq 10000
```

同端口双流发 `msgType=1` 全速 raw + `msgType=4` 显示抽取；独立双端口时显示端口只发
`msgType=4`，录制端口只发 `msgType=1`。应用里线上采样率 120000、显示采样率 60000；
独立端口再填「录制端口」5001。两路独立重连、独立背压。

手动分开跑两个桥（各自订阅同一个 ZMQ PUB）：

```powershell
python tools/gnuradio/tone_zmq_sink.py --address tcp://127.0.0.1:5557 --sample-rate 120000 --freq 10000
# 终端 2：显示端口
python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5557 --port 5000 `
    --sample-rate 120000 --display-sample-rate 60000 --display-only
# 终端 3：录制端口
python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5557 --port 5001 `
    --sample-rate 120000 --format ci16
```

**AD9361 双通道模拟**（无硬件时）：

```powershell
python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --record-port 5001 `
    --sample-rate 120000 --display-sample-rate 60000 `
    --channels 2 --freq 10000 --freq2 15000
```

`ToneZMQ` 用 `vector_source_c(vlen=2)` 产生 `[ch0,ch1]` 交错流；桥 `--channels 2`
写 ELIQ `channels=2`，应用选「2 通道」即可 RX0/RX1 切换。接真实 AD9361 时把 ToneZMQ
换成 `gr-iio` 的 `FMCOMMS2 Source`（`nchan=2`），桥参数不变。

> 桥按 ZMQ 块逐块 `resample_poly`，块边界会有滤波瞬态；正式测量建议 GNU Radio 侧
> `freq_xlating_fir_filter` 抽取后再发显示流。

也可以直接在 **应用内**「本机 GNU Radio」卡片启动：Python 路径、脚本目录/脚本名、
端口、采样率都可配置，配置保存在 userData；不绑定本机路径。自定义脚本只要接受
`--tcp-port --format --sample-rate --freq --center-hz` 并打印 `READY {"port":...}`。

也可以拆成两个终端（便于接真实 SDR flowgraph）：

终端 A（GNU Radio 产 ZMQ）：

```powershell
python tools/gnuradio/tone_zmq_sink.py --address tcp://127.0.0.1:5555 --sample-rate 100000 --freq 10000
```

终端 B（ZMQ → TCP，带 ELIQ 帧头）：

```powershell
python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5555 --port 5000 --format ci16 --sample-rate 100000
```

应用侧 `/source/network`：

- 主机 `127.0.0.1`、端口 `5000`
- 格式 `ci16`、线上采样率 `100000`、显示采样率 `100000`
- 点「连接」→ IQ/频谱预览出现 10 kHz 单音；`/signal/spectrum` 看完整频谱

桥默认发送 **48 字节 ELIQ 帧头 + ci16 payload**；应用会自动识别帧头/裸流，并在
「帧头 / 包」「seq 丢包」显示链路情况。`--raw` 可退化为裸流。

## 3. AD9361 / FMCOMMS 提示

把 `tone_zmq_sink.py` 里的 `analog.sig_source_c` 换成 gr-iio 的 FMCOMMS2 Source
（或 `uhd.usrp_source` / `osmosdr.source`），后面接 `zeromq.pub_sink`：

```python
self.sink = zeromq.pub_sink(gr.sizeof_gr_complex, 1, "tcp://127.0.0.1:5555", 100, False, -1)
```

- 先用 2–5 MSPS 验证链路，再逐步升到 10/30.72 MSPS；
- 1 GbE 下 30.72 MSPS ci16 约 122.9 MB/s，已接近上限；高采样率建议：
  - 本机/10 GbE：直连；
  - 1 GbE：GNU Radio 侧先 `freq_xlating_fir_filter` 抽取到 2–5 MSPS 再发显示流；
  - 全速录制时在 GNU Radio 机器本地落盘后传文件，或等应用侧双流（显示流 + raw 录制流）。

## 4. 常见问题

| 现象 | 排查 |
|---|---|
| 应用“连接超时” | 桥是否在监听？`--host 0.0.0.0`？Windows 防火墙？ |
| 连上但没数据 | GNU Radio flowgraph 是否运行？ZMQ 地址是否一致？桥日志是否有 client/数据？ |
| 频谱峰位置不对 | 应用里的线上采样率、`--sample-rate`、GNU Radio `samp_rate` 三者是否一致？ |
| 帧头格式/采样率报错 | 应用的 format/采样率与桥的 `--format`/`--sample-rate` 不一致 |
| 丢包计数增长 | 看 `seq 丢包`；降低采样率或让 GNU Radio 抽取 |
| 远程连不上 | 先用 `127.0.0.1` 验证，再换 LAN IP；WSL2 注意端口转发 |

## 5. 许可

GNU Radio 是 GPLv3。建议保持“独立进程 + TCP 协议”的边界：本仓库不链接 GNU Radio，
只通过 ZMQ/TCP 通信；分发时把 flowgraph/桥脚本作为独立程序处理。
