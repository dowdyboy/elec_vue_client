// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SignalQualityPanel from './SignalQualityPanel.vue'

/**
 * SignalQualityPanel 的 DOM 级测试：
 * - 纯 DOM 组件（无 canvas），适合作为组件 DOM 测试基建的第一块
 * - 覆盖 powerUnit 可选单位（PowerTime/APD 页用 dBFS，默认 dBm）与 pass/fail 徽标
 */
describe('SignalQualityPanel（DOM）', () => {
  it('功率单位默认 dBm，可用 powerUnit 覆盖为 dBFS', () => {
    const dbm = mount(SignalQualityPanel, {
      props: { metrics: { powerDbm: -5 } }
    })
    expect(dbm.find('.sig-quality-unit').text()).toBe('dBm')
    expect(dbm.text()).toContain('-5.0')

    const dbfs = mount(SignalQualityPanel, {
      props: { metrics: { powerDbm: -5 }, powerUnit: 'dBFS' }
    })
    expect(dbfs.find('.sig-quality-unit').text()).toBe('dBFS')
  })

  it('阈值判定：范围内 PASS、超上限 FAIL，可关闭徽标', () => {
    const pass = mount(SignalQualityPanel, {
      props: {
        metrics: { powerDbm: -5 },
        thresholds: { powerDbmMin: -10, powerDbmMax: 0 }
      }
    })
    expect(pass.find('.sig-quality-badge.pass').exists()).toBe(true)

    const fail = mount(SignalQualityPanel, {
      props: {
        metrics: { powerDbm: 3 },
        thresholds: { powerDbmMin: -10, powerDbmMax: 0 }
      }
    })
    expect(fail.find('.sig-quality-badge.fail').exists()).toBe(true)

    const hidden = mount(SignalQualityPanel, {
      props: {
        metrics: { powerDbm: -5 },
        thresholds: { powerDbmMin: -10, powerDbmMax: 0 },
        showPassFail: false
      }
    })
    expect(hidden.find('.sig-quality-badge').exists()).toBe(false)
  })

  it('未知指标显示为空态而不是错误的 PASS', () => {
    const empty = mount(SignalQualityPanel, { props: { metrics: {} } })
    expect(empty.find('.sig-quality-empty').exists()).toBe(true)
    expect(empty.find('.sig-quality-badge.unknown').exists()).toBe(true)
  })
})
