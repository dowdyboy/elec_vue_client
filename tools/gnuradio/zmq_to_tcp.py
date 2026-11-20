#!/usr/bin/env python3
"""
ZeroMQ SUB → TCP IQ 桥（给 Electron /source/network 用）

GNU Radio 3.10.12 没有 gr-blocks tcp_sink，所以用 ZMQ PUB + 本桥转成 TCP。
默认发送带 ELIQ 帧头的 ci16/cf32 数据；--raw 只发裸流（兼容 Phase 1）。
--dual 时在同一连接上发 msgType=1（full raw）+ msgType=4（FIR 抽取显示）。

    conda activate radioconda
    python tools/gnuradio/zmq_to_tcp.py --zmq tcp://127.0.0.1:5555 --port 5000 \
        --format ci16 --sample-rate 100000 --center-hz 0

帧头布局（48 字节，小端）：
  magic 4s | ver B | msg_type B | header_len H | seq I | timestamp_ns Q
  sample_rate I | center_hz d | format B | channels B | reserved H
  payload_bytes I | reserved2 I | reserved3 I
"""
import argparse
import signal
import socket
import struct
import threading
import time
import traceback

import numpy as np
import zmq

HEADER = struct.Struct("<4sBBHIQIdBBHIII")
HEADER_LEN = HEADER.size
MAGIC = b"ELIQ"
FORMAT_CODE = {"cf32": 0, "ci16": 1, "ci8": 2}
MAX_PAYLOAD = 32 * 1024 * 1024


def convert(iq: np.ndarray, fmt: str) -> bytes:
    if fmt == "cf32":
        return iq.astype(np.complex64).tobytes()
    if fmt == "ci16":
        out = np.empty(iq.size * 2, dtype=np.int16)
        out[0::2] = np.clip(np.round(iq.real * 32767), -32768, 32767).astype(np.int16)
        out[1::2] = np.clip(np.round(iq.imag * 32767), -32768, 32767).astype(np.int16)
        return out.tobytes()
    out = np.empty(iq.size * 2, dtype=np.int8)
    out[0::2] = np.clip(np.round(iq.real * 127), -128, 127).astype(np.int8)
    out[1::2] = np.clip(np.round(iq.imag * 127), -128, 127).astype(np.int8)
    return out.tobytes()


class Bridge:
    """ZMQ SUB -> TCP server；bind() 后才确定端口，serve() 阻塞直到 stop。"""

    def __init__(
        self,
        zmq_addr: str,
        host: str = "127.0.0.1",
        port: int = 0,
        fmt: str = "ci16",
        sample_rate: float = 100_000,
        center_hz: float = 0.0,
        raw: bool = False,
        dual: bool = False,
        display_sample_rate: float = 2_000_000,
        display_fmt: str | None = None,
        display_only: bool = False,
        channels: int = 1,
        batch: int = 8,
    ):
        self.zmq_addr = zmq_addr
        self.host = host
        self.requested_port = port
        self.fmt = fmt
        self.sample_rate = sample_rate
        self.center_hz = center_hz
        self.channels = 2 if channels == 2 else 1
        self.batch = max(1, min(64, int(batch)))
        self.raw = raw
        self.display_only = display_only and not raw
        self.dual = dual and not raw and not self.display_only
        self.display_fmt = display_fmt or fmt
        self.display_factor = max(1, round(sample_rate / max(1.0, display_sample_rate)))
        self.display_rate = sample_rate / self.display_factor
        self.port = 0
        self.stop_event = threading.Event()
        self.conn = None
        self.pending: list[bytes] = []

        self.ctx = zmq.Context()
        self.sub = self.ctx.socket(zmq.SUB)
        self.sub.setsockopt(zmq.SUBSCRIBE, b"")
        self.sub.setsockopt(zmq.RCVHWM, 100)
        self.sub.connect(zmq_addr)

        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.settimeout(1.0)

    def bind(self) -> int:
        self.server.bind((self.host, self.requested_port))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        return self.port

    def prewarm(self, timeout: float = 3.0) -> bool:
        """等第一帧 ZMQ 数据再宣布 READY，避免 ZMQ 慢连接让客户端先连上空桥。"""
        poller = zmq.Poller()
        poller.register(self.sub, zmq.POLLIN)
        deadline = time.time() + timeout
        while time.time() < deadline and not self.stop_event.is_set():
            events = dict(poller.poll(100))
            if self.sub not in events:
                continue
            msg = self.sub.recv(0)
            if msg:
                self.pending.append(msg)
                return True
        return False

    def serve(self) -> None:
        seq = 0
        poller = zmq.Poller()
        poller.register(self.sub, zmq.POLLIN)
        try:
            while not self.stop_event.is_set():
                if self.conn is None:
                    try:
                        self.conn, addr = self.server.accept()
                        self.conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                        self.conn.settimeout(2.0)
                        print(f"[zmq-tcp] client {addr[0]}:{addr[1]} connected", flush=True)
                    except socket.timeout:
                        continue

                if self.pending:
                    first = self.pending.pop(0)
                else:
                    events = dict(poller.poll(500))
                    if self.sub not in events:
                        continue
                    first = self.sub.recv(0)
                if not first:
                    continue
                messages = [first]
                # 批量发送：减少 sendall/系统调用，2ch 10 MSPS 下收益明显
                while len(messages) < self.batch:
                    try:
                        messages.append(self.sub.recv(0, zmq.NOBLOCK))
                    except zmq.Again:
                        break
                chunks: list[bytes] = []
                for msg in messages:
                    iq = np.frombuffer(msg, dtype=np.complex64)
                    if iq.size == 0:
                        continue
                    packet, seq = self._packet_for(iq, seq)
                    if packet:
                        chunks.append(packet)
                if not chunks:
                    continue
                try:
                    self.conn.sendall(b"".join(chunks))
                except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
                    print("[zmq-tcp] client disconnected", flush=True)
                    self._close_conn()
        except Exception:
            traceback.print_exc()
        finally:
            self.close()

    def _packet_for(self, iq: np.ndarray, seq: int) -> tuple[bytes, int]:
        if self.raw:
            return convert(iq, self.fmt), seq + 1
        if self.display_only:
            dec = self._decimate(iq)
            if dec.size == 0:
                return b"", seq
            seq += 1
            return (
                self._frame(4, self.display_rate, self.display_fmt, convert(dec, self.display_fmt), seq),
                seq,
            )
        seq += 1
        packet = self._frame(1, self.sample_rate, self.fmt, convert(iq, self.fmt), seq)
        if self.dual:
            dec = self._decimate(iq)
            if dec.size > 0:
                seq += 1
                packet += self._frame(
                    4, self.display_rate, self.display_fmt, convert(dec, self.display_fmt), seq
                )
        return packet, seq

    def _decimate(self, iq: np.ndarray) -> np.ndarray:
        if self.display_factor <= 1:
            return iq
        try:
            from scipy.signal import resample_poly

            if self.channels == 1:
                return resample_poly(iq, 1, self.display_factor)
            iq2 = iq.reshape(-1, self.channels)
            dec = resample_poly(iq2, 1, self.display_factor, axis=0)
            return dec.reshape(-1)
        except Exception:  # scipy 不可用时退化为简单抽取（仅预览）
            if self.channels == 1:
                return iq[:: self.display_factor]
            return iq.reshape(-1, self.channels)[:: self.display_factor].reshape(-1)

    def _frame(self, msg_type: int, sample_rate: float, fmt: str, payload: bytes, seq: int) -> bytes:
        header = HEADER.pack(
            MAGIC,
            1,
            msg_type,
            HEADER_LEN,
            seq & 0xFFFFFFFF,
            time.time_ns() & 0xFFFFFFFFFFFFFFFF,
            int(sample_rate) & 0xFFFFFFFF,
            float(self.center_hz),
            FORMAT_CODE[fmt],
            self.channels,
            0,
            len(payload) & 0xFFFFFFFF,
            0,
            0,
        )
        return header + payload

    def stop(self) -> None:
        self.stop_event.set()
        self._close_conn()

    def _close_conn(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except OSError:
                pass
            self.conn = None

    def close(self) -> None:
        self._close_conn()
        try:
            self.server.close()
        except OSError:
            pass
        try:
            self.sub.close()
        except OSError:
            pass
        try:
            self.ctx.term()
        except zmq.ZMQError:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="ZMQ complex64 SUB -> TCP IQ bridge")
    parser.add_argument("--zmq", default="tcp://127.0.0.1:5555", help="ZMQ PUB 地址")
    parser.add_argument("--host", default="127.0.0.1", help="TCP 监听地址（0.0.0.0 允许远程）")
    parser.add_argument("--port", type=int, default=5000, help="TCP 监听端口（0=随机）")
    parser.add_argument("--format", choices=["cf32", "ci16", "ci8"], default="ci16")
    parser.add_argument("--sample-rate", type=float, default=100_000)
    parser.add_argument("--center-hz", type=float, default=0.0)
    parser.add_argument("--raw", action="store_true", help="不发 ELIQ 帧头，只发裸流")
    parser.add_argument("--dual", action="store_true", help="同一条 TCP 上发 raw(full)+显示抽取两路")
    parser.add_argument("--display-sample-rate", type=float, default=2_000_000)
    parser.add_argument("--display-format", choices=["cf32", "ci16", "ci8"], default=None)
    parser.add_argument("--display-only", action="store_true", help="只发 msgType=4 显示抽取包")
    parser.add_argument("--channels", type=int, choices=[1, 2], default=1, help="RX 通道数")
    parser.add_argument("--batch", type=int, default=8, help="每次 sendall 最多合并的 ZMQ 块数")
    args = parser.parse_args()

    bridge = Bridge(
        args.zmq,
        args.host,
        args.port,
        args.format,
        args.sample_rate,
        args.center_hz,
        args.raw,
        args.dual,
        args.display_sample_rate,
        args.display_format,
        args.display_only,
        args.channels,
        args.batch,
    )
    bridge.bind()
    bridge.prewarm(2.0)
    print(
        f"[zmq-tcp] listening {args.host}:{bridge.port} fmt={args.format} "
        f"sr={args.sample_rate:.0f} header={'off' if args.raw else 'on'} "
        f"dual={'on' if bridge.dual else 'off'} "
        f"display_only={'on' if bridge.display_only else 'off'} "
        f"channels={bridge.channels} batch={bridge.batch} "
        f"display={bridge.display_rate:.0f} S/s <- {args.zmq}",
        flush=True,
    )

    def stop(_signum, _frame):
        bridge.stop()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    bridge.serve()
    print("[zmq-tcp] stopped", flush=True)


if __name__ == "__main__":
    main()
