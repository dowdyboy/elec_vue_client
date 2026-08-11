/**
 * 【特性】证书校验（setCertificateVerifyProc）
 * 【API】session.setCertificateVerifyProc
 * 【复制】1. 复制本文件到新工程 src/main/features/certificate.ts
 *         2. 在 index.ts 中调用 registerCertificate()
 *         3. 渲染进程调用 window.api.cert.setVerifyMode()
 * 【说明】HTTPS 证书校验策略：
 *         - default：系统默认校验（生产必须保持）
 *         - trustAll：放行所有证书（企业内网自签证书、测试环境；生产禁用！）
 *         ⚠️ 教学警告：trustAll 会带来中间人攻击风险，仅用于演示与调试。
 */

import { ipcMain, session } from 'electron'

export function registerCertificate(): void {
  ipcMain.handle('cert:setVerifyMode', (_e, mode: 'default' | 'trustAll') => {
    if (mode === 'default') {
      // 恢复默认校验（传 null 移除自定义处理器）
      session.defaultSession.setCertificateVerifyProc(null)
    } else {
      // 放行所有证书（0 = 通过；回调 (isTrusted: boolean)）
      session.defaultSession.setCertificateVerifyProc((_request, callback) => {
        callback(0)
      })
    }
    return { mode }
  })
}
