/// <reference types="vite/client" />

/**
 * Web Serial API 最小类型声明（WICG 草案，未进入 TS 标准 DOM lib；
 * 完整类型可用 @types/w3c-web-serial，本教学项目内联声明避免额外依赖）
 */
interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface Serial {
  requestPort(): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface Navigator {
  readonly serial: Serial
}
