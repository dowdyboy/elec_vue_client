#!/usr/bin/env python3
"""
一键本机演示：GNU Radio 单音 → ZMQ PUB → ZMQ/TCP 桥（带 ELIQ 帧头）。

    conda activate radioconda
    python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --sample-rate 100000 --freq 10000

独立双端口（显示 / 录制分开，适合远程只拉显示）：

    python tools/gnuradio/tone_pipeline.py --tcp-port 5000 --record-port 5001 `
        --sample-rate 120000 --display-sample-rate 60000 --freq 10000

输出 `READY {"port":5000,...}` 后，应用 /source/network 连接 127.0.0.1:5000；
独立端口时 READY 还带 `recordPort`。Ctrl+C 同时停止 flowgraph 与桥。
"""
import argparse
import json
import signal
import sys
import threading

from tone_zmq_sink import ToneZMQ
from zmq_to_tcp import Bridge


def main() -> int:
    parser = argparse.ArgumentParser(description="GNU Radio tone -> ZMQ -> TCP IQ pipeline")
    parser.add_argument("--zmq-address", default="tcp://127.0.0.1:5557")
    parser.add_argument("--tcp-host", default="127.0.0.1")
    parser.add_argument("--tcp-port", type=int, default=5000, help="显示端口；0=随机端口")
    parser.add_argument(
        "--record-port", type=int, default=0, help="独立录制端口；0=与显示同端口（单连接双流）"
    )
    parser.add_argument("--format", choices=["cf32", "ci16", "ci8"], default="ci16")
    parser.add_argument("--sample-rate", type=float, default=100_000)
    parser.add_argument("--freq", type=float, default=10_000)
    parser.add_argument("--freq2", type=float, default=None, help="双通道时通道 1 频率")
    parser.add_argument("--center-hz", type=float, default=0.0)
    parser.add_argument("--amplitude", type=float, default=0.5)
    parser.add_argument("--channels", type=int, choices=[1, 2], default=1)
    parser.add_argument("--dual", action="store_true", help="同一条 TCP 上 raw+显示双流")
    parser.add_argument("--display-sample-rate", type=float, default=2_000_000)
    args = parser.parse_args()

    tb = ToneZMQ(
        args.sample_rate,
        args.freq,
        args.amplitude,
        args.zmq_address,
        args.channels,
        args.freq2,
    )
    split = args.record_port > 0
    if split:
        display_bridge = Bridge(
            args.zmq_address,
            host=args.tcp_host,
            port=args.tcp_port,
            fmt=args.format,
            sample_rate=args.sample_rate,
            center_hz=args.center_hz,
            display_only=True,
            display_sample_rate=args.display_sample_rate,
            display_fmt=args.format,
            channels=args.channels,
        )
        record_bridge = Bridge(
            args.zmq_address,
            host=args.tcp_host,
            port=args.record_port,
            fmt=args.format,
            sample_rate=args.sample_rate,
            center_hz=args.center_hz,
            channels=args.channels,
        )
        bridges = [display_bridge, record_bridge]
    else:
        display_bridge = Bridge(
            args.zmq_address,
            host=args.tcp_host,
            port=args.tcp_port,
            fmt=args.format,
            sample_rate=args.sample_rate,
            center_hz=args.center_hz,
            dual=args.dual,
            display_sample_rate=args.display_sample_rate,
            channels=args.channels,
        )
        record_bridge = None
        bridges = [display_bridge]

    tb.start()
    try:
        for bridge in bridges:
            bridge.bind()
        # 先收到第一帧再 READY，避免 ZMQ slow joiner 让客户端连上空桥
        for bridge in bridges:
            bridge.prewarm(3.0)
        print(
            "READY "
            + json.dumps(
                {
                    "port": display_bridge.port,
                    "recordPort": record_bridge.port if record_bridge else 0,
                    "format": args.format,
                    "sampleRate": args.sample_rate,
                    "channels": args.channels,
                    "centerHz": args.center_hz,
                    "freq": args.freq,
                    "mode": "split" if split else "single",
                    "dual": True if split else display_bridge.dual,
                    "displaySampleRate": display_bridge.display_rate,
                }
            ),
            flush=True,
        )

        def stop(_signum, _frame):
            for bridge in bridges:
                bridge.stop()
            tb.stop()

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)

        threads = [
            threading.Thread(target=bridge.serve, name=f"bridge-{i}", daemon=True)
            for i, bridge in enumerate(bridges)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        for bridge in bridges:
            bridge.close()
        tb.stop()
        tb.wait()
    return 0


if __name__ == "__main__":
    sys.exit(main())
