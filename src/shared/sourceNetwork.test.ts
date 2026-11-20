import { describe, expect, it } from 'vitest'
import {
  networkBytesPerSample,
  resolveDecimation,
  resolveDisplaySampleRate,
  resolvePointsPerFrame,
  sanitizeNetworkConfig,
  type NetworkSourceConfig
} from './sourceNetwork'

const base: NetworkSourceConfig = {
  host: '127.0.0.1',
  port: 5000,
  format: 'ci16',
  sampleRate: 2_000_000,
  centerHz: 0,
  displaySampleRate: 2_000_000,
  pointsPerFrame: 0
}

describe('sourceNetwork 契约', () => {
  it('sanitizeNetworkConfig 接受合法配置并补齐默认值', () => {
    const r = sanitizeNetworkConfig({
      host: ' 127.0.0.1 ',
      port: 5000,
      format: 'ci16',
      sampleRate: 2_000_000,
      centerHz: 0,
      displaySampleRate: 2_000_000
    })
    expect(r.ok).toBe(true)
    expect(r.value?.host).toBe('127.0.0.1')
    expect(r.value?.pointsPerFrame).toBe(0)
    expect(r.value?.reconnect).toBe(true)
    expect(r.value?.maxBufferBytes).toBe(32 * 1024 * 1024)
  })

  it('sanitizeNetworkConfig 拒绝非法端口/格式/采样率关系', () => {
    expect(sanitizeNetworkConfig({ ...base, port: 0 }).ok).toBe(false)
    expect(sanitizeNetworkConfig({ ...base, port: 65536 }).ok).toBe(false)
    expect(sanitizeNetworkConfig({ ...base, format: 's16' }).ok).toBe(false)
    expect(sanitizeNetworkConfig({ ...base, displaySampleRate: base.sampleRate + 1 }).ok).toBe(
      false
    )
    expect(sanitizeNetworkConfig({ ...base, sampleRate: 0 }).ok).toBe(false)
    expect(sanitizeNetworkConfig({ ...base, host: 'http://127.0.0.1' }).ok).toBe(false)
  })

  it('channels 只接受 1/2，缺省 1', () => {
    const two = sanitizeNetworkConfig({ ...base, channels: 2 })
    expect(two.ok && two.value.channels).toBe(2)
    const bad = sanitizeNetworkConfig({ ...base, channels: 3 })
    expect(bad.ok && bad.value.channels).toBe(1)
  })

  it('recordPort 独立录制端口校验', () => {
    const r = sanitizeNetworkConfig({ ...base, recordPort: 5001 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.recordPort).toBe(5001)
      expect(r.value.recordHost).toBe(base.host)
      expect(r.value.recordFormat).toBe(base.format)
    }
    expect(sanitizeNetworkConfig({ ...base, recordPort: base.port }).ok).toBe(false)
    expect(sanitizeNetworkConfig({ ...base, recordPort: 70000 }).ok).toBe(false)
    const fallback = sanitizeNetworkConfig({ ...base, recordPort: 5001, recordFormat: 's16' })
    expect(fallback.ok).toBe(true)
    if (fallback.ok) expect(fallback.value.recordFormat).toBe(base.format)
  })

  it('resolvePointsPerFrame：0=按显示率/60 自动，显式值夹取', () => {
    expect(resolvePointsPerFrame({ ...base, displaySampleRate: 2_000_000 })).toBe(33_333)
    expect(resolvePointsPerFrame({ ...base, pointsPerFrame: 4096 })).toBe(4096)
    expect(resolvePointsPerFrame({ ...base, pointsPerFrame: 1 })).toBe(64)
    expect(resolvePointsPerFrame({ ...base, pointsPerFrame: 1_000_000 })).toBe(65_536)
  })

  it('抽取步长与实际显示率一致', () => {
    const cfg: NetworkSourceConfig = {
      ...base,
      sampleRate: 30_720_000,
      displaySampleRate: 2_000_000
    }
    const stride = resolveDecimation(cfg)
    expect(stride).toBe(15)
    expect(resolveDisplaySampleRate(cfg)).toBe(2_048_000)
  })

  it('格式字节数', () => {
    expect(networkBytesPerSample('cf32')).toBe(8)
    expect(networkBytesPerSample('ci16')).toBe(4)
    expect(networkBytesPerSample('ci8')).toBe(2)
  })
})
