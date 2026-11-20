/**
 * 本机 GNU Radio 一键启动的共享类型（main / preload / renderer 共用）。
 * Python 路径、脚本目录、端口等都可配置，不绑定具体环境。
 */
import type { NetworkFormat } from './sourceNetwork'

export interface LocalGnuRadioSettings {
  /** radioconda/miniconda 环境里的 python.exe；空=未配置 */
  pythonPath: string
  /** 脚本所在目录（默认 dev 的 tools/gnuradio 或打包后的 resources/gnuradio） */
  scriptDir: string
  /** 脚本名（默认 tone_pipeline.py） */
  scriptName: string
  sampleRate: number
  centerHz: number
  format: NetworkFormat
  /** 单音频率（tone_pipeline.py 的 --freq；接真实 SDR 时脚本可忽略） */
  toneFreq: number
  /** 双流：raw(full) + 显示抽取（tone_pipeline/zmq_to_tcp --dual） */
  dualStream: boolean
  /** 双流显示采样率 */
  displaySampleRate: number
  /** RX 通道数（1/2） */
  channels: 1 | 2
  /** TCP 端口；0=由脚本随机选并通过 READY 返回 */
  tcpPort: number
  /** 独立录制端口；0=与显示同端口（单连接双流） */
  recordPort: number
}

export interface LocalGnuRadioStatus {
  running: boolean
  pid: number
  port: number
  format: NetworkFormat
  sampleRate: number
  /** READY 返回的双流标志/显示采样率 */
  dual: boolean
  displaySampleRate: number
  /** READY 返回的独立录制端口（0=未启用） */
  recordPort: number
  /** READY 返回的通道数 */
  channels: number
  startedAt: number
  lastError: string
  /** 最近日志（最多 200 行，供页面排错） */
  log: string[]
}

export interface LocalGnuRadioDefaults {
  settings: LocalGnuRadioSettings
  /** 自动探测到的 Python（可能与 settings.pythonPath 不同） */
  detectedPython: string
  scriptDir: string
  scriptPath: string
  scriptExists: boolean
  pythonExists: boolean
}
