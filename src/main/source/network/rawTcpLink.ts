/**
 * 独立录制 TCP 连接：只接收 msgType=1 的 raw/full IQ，喂给 RawIqRecorder。
 * 与显示连接完全解耦：显示断开/重连不影响录制，反之亦然。
 */
import net from 'node:net'
import type { NetworkFormat } from '../../../shared/sourceNetwork'
import { IqStreamParser, type IqPacketMeta } from './iqStreamParser'

const CONNECT_TIMEOUT_MS = 5000

export interface RawTcpLinkStatus {
  connected: boolean
  reconnects: number
  packets: number
  bytesPerSecond: number
  lastError: string
}

export class RawTcpLink {
  private socket: net.Socket | null = null
  private readonly parser: IqStreamParser
  private stopped = false
  private connected = false
  private everConnected = false
  private connecting = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private rateTimer: NodeJS.Timeout | null = null
  private resumeTimer: NodeJS.Timeout | null = null
  private reconnects = 0
  private packets = 0
  private bytesWindow = 0
  private bytesPerSecond = 0
  private rateAt = Date.now()
  private lastError = ''
  private meta: IqPacketMeta | null = null

  constructor(
    private readonly host: string,
    private readonly port: number,
    format: NetworkFormat,
    private readonly onPacket: (payload: Uint8Array, meta: IqPacketMeta) => void,
    private readonly shouldPause: () => boolean,
    private readonly onStatus: () => void
  ) {
    this.parser = new IqStreamParser(format)
  }

  async start(): Promise<void> {
    this.stopped = false
    this.connected = false
    this.everConnected = false
    this.connecting = false
    this.reconnects = 0
    this.packets = 0
    this.bytesWindow = 0
    this.bytesPerSecond = 0
    this.lastError = ''
    this.meta = null
    this.parser.reset()
    await this.connectOnce()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.rateTimer) {
      clearInterval(this.rateTimer)
      this.rateTimer = null
    }
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer)
      this.resumeTimer = null
    }
    const socket = this.socket
    this.socket = null
    this.connected = false
    this.parser.reset()
    socket?.destroy()
  }

  /** raw recorder 背压解除后恢复录制 socket */
  maybeResume(): void {
    const socket = this.socket
    if (!socket?.isPaused()) return
    if (!this.shouldPause()) socket.resume()
  }

  getStatus(): RawTcpLinkStatus {
    return {
      connected: this.connected,
      reconnects: this.reconnects,
      packets: this.packets,
      bytesPerSecond: this.bytesPerSecond,
      lastError: this.lastError
    }
  }

  get metadata(): IqPacketMeta | null {
    return this.meta
  }

  private connectOnce(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('录制连接已停止'))
    if (this.connecting) return Promise.reject(new Error('录制连接正在连接'))
    this.connecting = true
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const socket = net.connect({ host: this.host, port: this.port })
      this.socket = socket
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.connecting = false
        this.lastError = `录制连接超时（${this.host}:${this.port}）`
        this.onStatus()
        socket.destroy()
        reject(new Error(this.lastError))
      }, CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.connecting = false
        this.connected = true
        this.everConnected = true
        this.lastError = ''
        this.parser.reset()
        this.packets = 0
        this.bytesWindow = 0
        this.resetRate()
        this.rateTimer = setInterval(() => {
          const now = Date.now()
          this.bytesPerSecond = this.bytesWindow / Math.max(0.001, (now - this.rateAt) / 1000)
          this.bytesWindow = 0
          this.rateAt = now
          this.onStatus()
        }, 1000)
        this.onStatus()
        resolve()
      })

      socket.on('data', (chunk: Buffer) => {
        if (this.socket !== socket) return
        this.bytesWindow += chunk.length
        this.parser.push(chunk, (payload, meta) => {
          if (!meta || meta.msgType !== 1) return
          this.packets++
          this.meta = meta
          this.onPacket(payload, meta)
          if (this.shouldPause()) {
            socket.pause()
            this.scheduleResume(socket)
          }
        })
      })

      socket.once('error', (err: Error) => {
        if (this.socket !== socket) return
        this.lastError = err.message
        this.onStatus()
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.connecting = false
        this.connected = false
        reject(err)
      })

      socket.once('close', () => {
        if (this.socket !== socket) return
        clearTimeout(timer)
        const wasConnected = this.connected
        this.connected = false
        this.connecting = false
        if (this.rateTimer) {
          clearInterval(this.rateTimer)
          this.rateTimer = null
        }
        if (this.resumeTimer) {
          clearTimeout(this.resumeTimer)
          this.resumeTimer = null
        }
        if (wasConnected) this.onStatus()
        if (this.everConnected && !this.stopped) this.scheduleReconnect()
      })
    })
  }

  /** 录制 socket 被背压暂停后，独立轮询恢复（不依赖显示连接的 60fps drain） */
  private scheduleResume(socket: net.Socket): void {
    if (this.resumeTimer) return
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null
      if (this.stopped || this.socket !== socket) return
      if (!this.shouldPause()) {
        if (socket.isPaused()) socket.resume()
        return
      }
      this.scheduleResume(socket)
    }, 50)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const attempt = Math.min(this.reconnects, 3)
    const delay = Math.min(10_000, 1000 * 2 ** attempt)
    this.reconnects++
    this.lastError = `录制连接断开，${delay / 1000}s 后重连（第 ${this.reconnects} 次）`
    this.onStatus()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      this.connectOnce().catch(() => {
        // close/error 继续安排下一次
      })
    }, delay)
  }

  private resetRate(): void {
    this.rateAt = Date.now()
  }
}
