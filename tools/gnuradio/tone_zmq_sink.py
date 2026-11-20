#!/usr/bin/env python3
"""
GNU Radio 复数单音 → ZeroMQ PUB（配合 tools/gnuradio/zmq_to_tcp.py 使用）

GNU Radio 3.10.12 的 gr-blocks 不再提供 tcp_sink，因此本机示例走 ZMQ PUB：
    conda activate radioconda
    python tools/gnuradio/tone_zmq_sink.py --address tcp://127.0.0.1:5555 --sample-rate 100000 --freq 10000

双通道（模拟 AD9361 RX0/RX1）：
    python tools/gnuradio/tone_zmq_sink.py --channels 2 --freq 10000 --freq2 15000 ...

另开终端启动桥：
    python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5555 --port 5000 --format ci16 --sample-rate 100000

应用 /source/network 连接 127.0.0.1:5000（ci16、100000；双通道时 channels=2）。
"""
import argparse

import numpy as np
from gnuradio import analog, blocks, gr, zeromq


class ToneZMQ(gr.top_block):
    def __init__(
        self,
        sample_rate: float,
        freq: float,
        amplitude: float,
        address: str,
        channels: int = 1,
        freq2: float | None = None,
    ):
        super().__init__("Tone ZMQ IQ")
        self.sample_rate = sample_rate
        self.channels = 2 if channels == 2 else 1

        if self.channels == 1:
            # 复数单音（基带）；接 AD9361 时把 src 换成 gr-iio 的 FMCOMMS2 Source
            self.src = analog.sig_source_c(sample_rate, analog.GR_COS_WAVE, freq, amplitude, 0)
            self.throttle = blocks.throttle(gr.sizeof_gr_complex, sample_rate, True)
            self.sink = zeromq.pub_sink(gr.sizeof_gr_complex, 1, address, 100, False, -1)
            self.connect((self.src, 0), (self.throttle, 0))
            self.connect((self.throttle, 0), (self.sink, 0))
            return

        # 双通道模拟：生成一个重复的 1 秒/最多 1M 样本块，按样本交错 [ch0,ch1]。
        # 真实 AD9361 用 gr-iio 的 FMCOMMS2 Source（nchan=2），这里只模拟协议/UI。
        n = min(int(max(1000, sample_rate)), 1_000_000)
        t = np.arange(n, dtype=np.float64) / sample_rate
        f1 = freq if freq2 is None else freq2
        vec = np.empty(n * 2, dtype=np.complex64)
        vec[0::2] = amplitude * np.exp(2j * np.pi * freq * t)
        vec[1::2] = amplitude * np.exp(2j * np.pi * f1 * t)
        self.src = blocks.vector_source_c(vec, True, 2)
        self.throttle = blocks.throttle(gr.sizeof_gr_complex * 2, sample_rate, True)
        self.sink = zeromq.pub_sink(gr.sizeof_gr_complex, 2, address, 100, False, -1)
        self.connect((self.src, 0), (self.throttle, 0))
        self.connect((self.throttle, 0), (self.sink, 0))


def main() -> None:
    parser = argparse.ArgumentParser(description="GNU Radio tone -> ZMQ PUB")
    parser.add_argument("--address", default="tcp://127.0.0.1:5555", help="ZMQ PUB 地址")
    parser.add_argument("--sample-rate", type=float, default=100_000, help="采样率 S/s")
    parser.add_argument("--freq", type=float, default=10_000, help="通道 0 单音频率 Hz（基带）")
    parser.add_argument("--freq2", type=float, default=None, help="通道 1 单音频率 Hz；默认 1.5×freq")
    parser.add_argument("--amplitude", type=float, default=0.5, help="幅度（0~1）")
    parser.add_argument("--channels", type=int, choices=[1, 2], default=1, help="RX 通道数")
    args = parser.parse_args()

    tb = ToneZMQ(
        args.sample_rate,
        args.freq,
        args.amplitude,
        args.address,
        args.channels,
        args.freq2,
    )
    print(
        f"[tone_zmq_sink] publishing {args.address} complex64 channels={tb.channels} "
        f"{args.sample_rate:.0f} S/s f0={args.freq:.0f} Hz "
        f"f1={(args.freq2 if args.freq2 is not None else args.freq * 1.5):.0f} Hz"
    )
    try:
        tb.run()
    except KeyboardInterrupt:
        tb.stop()
        tb.wait()


if __name__ == "__main__":
    main()
