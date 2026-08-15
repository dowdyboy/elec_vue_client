/**
 * 【特性】加密存储（safeStorage —— 用操作系统能力加密敏感数据）
 * 【API】safeStorage.encryptString / decryptString / isEncryptionAvailable
 * 【复制】1. 复制本文件到新工程 src/main/features/safeStorage.ts
 *         2. 在 index.ts 中调用 registerSafeStorage()
 *         3. 渲染进程调用 window.api.safeStorage.*
 * 【说明】保存密码 / API 令牌 / 私钥等敏感信息的正确姿势：
 *         - Windows 用 DPAPI（CryptProtectData，绑定当前用户）
 *         - macOS 用 Keychain；Linux 依赖 kwallet/gnome-libsecret（需检测 isEncryptionAvailable）
 *         - 加密结果是 Buffer，密文本身可以放心落盘（配合 electron-store / 文件写入）
 *         对比：明文写 JSON、代码里硬编码密钥、自定义"异或加密"都是错误示范。
 *         教学要点：safeStorage 只负责"加密/解密"，持久化仍需自己写文件
 *         （本演示只做内存往返，落盘见 docs/33 的配合示例）。
 */

import { ipcMain, safeStorage } from 'electron'

export function registerSafeStorage(): void {
  // ── 能力检测：Linux 无 keyring 时不可用（Windows/macOS 恒可用）──
  ipcMain.handle('safeStorage:isAvailable', () => {
    return {
      available: safeStorage.isEncryptionAvailable(),
      platform: process.platform,
      backend:
        process.platform === 'linux'
          ? safeStorage.getSelectedStorageBackend()
          : process.platform === 'win32'
            ? 'DPAPI'
            : 'Keychain'
    }
  })

  // ── 加密：明文字符串 → Buffer（页面侧转 base64 展示）──
  ipcMain.handle('safeStorage:encrypt', (_e, plainText: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持 safeStorage（Linux 需要安装 keyring 服务）')
    }
    const buffer = safeStorage.encryptString(plainText)
    return buffer.toString('base64')
  })

  // ── 解密：base64 密文 → 明文 ──
  ipcMain.handle('safeStorage:decrypt', (_e, base64Cipher: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持 safeStorage（Linux 需要安装 keyring 服务）')
    }
    return safeStorage.decryptString(Buffer.from(base64Cipher, 'base64'))
  })
}
