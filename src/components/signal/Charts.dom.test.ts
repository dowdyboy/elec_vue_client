// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'

import IqChart from './IqChart.vue'
import SpectrumChart from './SpectrumChart.vue'
import SpectrogramChart from './SpectrogramChart.vue'
import ConstellationChart from './ConstellationChart.vue'
import PowerTimeChart from './PowerTimeChart.vue'
import PersistenceSpectrumChart from './PersistenceSpectrumChart.vue'
import SmithChart from './SmithChart.vue'
import ApdCcdfChart from './ApdCcdfChart.vue'
import EyeDiagramChart from './EyeDiagramChart.vue'

/**
 * 10 个图表组件的 DOM 级契约测试（happy-dom，无 GPU）
 *
 * 这里不验证"画得对不对"（那是像素回归 + smoke 的职责），只验证**宿主可见的契约**：
 *   ① 能挂载、不抛错、不产生 console.error（无 WebGL2/Canvas2D 环境下的降级路径）
 *   ② 根节点的 class / role / aria-label（无障碍与样式钩子）
 *   ③ width/height/theme/locale/labels 这些公共 prop 真的生效
 *   ④ defineExpose 的方法齐全（宿主调用面，重构时最容易被误删）
 *   ⑤ setData/appendData 摄入数据不崩（数据路径，覆盖 adapter/meta 归一化）
 *
 * 这些是 SpectrumChart 拆分等重构的安全网：改动后接口/挂载行为不变就能立刻发现。
 */

/** I/Q 交织样本（IQ/星座/Smith/眼图 用） */
const IQ_SAMPLES = (() => {
  const a = new Float32Array(128)
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(i / 5) * 0.8
  return a
})()

/** 幅度谱 bins（频谱/时频/持续谱/功率/APD 用） */
const BINS = (() => {
  const a = new Float32Array(64)
  for (let i = 0; i < a.length; i++) a[i] = -80 + (i % 8) * 6
  return a
})()

/** APD 曲线对象（纯显示模式需要完整曲线，见 core/types ApdCcdfData） */
const APD_CURVES = (() => {
  const n = 32
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = -20 + i
    y[i] = 100 - i * 3
  }
  return {
    apd: { x, y },
    ccdf: { x: x.slice(), y: y.slice() },
    meanDb: -6,
    peakDb: 2,
    paprDb: 8,
    p01Db: 1,
    p1Db: 0,
    sampleCount: n
  }
})()

interface Case {
  name: string
  comp: Component
  rootClass: string
  role: string
  zhAria: string
  data: unknown
  hasStats: boolean
  /** aria 文案本身是中英通用（如 APD/CCDF），en-US 下不变属预期 */
  ariaSameInEn?: boolean
}

const CASES: Case[] = [
  {
    name: 'IqChart',
    comp: IqChart,
    rootClass: 'sig-iq',
    role: 'application',
    zhAria: 'IQ 时域图',
    data: IQ_SAMPLES,
    hasStats: false
  },
  {
    name: 'SpectrumChart',
    comp: SpectrumChart,
    rootClass: 'sig-spectrum',
    role: 'application',
    zhAria: '频谱图',
    data: BINS,
    hasStats: true
  },
  {
    name: 'SpectrogramChart',
    comp: SpectrogramChart,
    rootClass: 'sig-specgram',
    role: 'application',
    zhAria: '时频图',
    data: BINS,
    hasStats: true
  },
  {
    name: 'ConstellationChart',
    comp: ConstellationChart,
    rootClass: 'sig-const',
    role: 'application',
    zhAria: '星座图',
    data: IQ_SAMPLES,
    hasStats: true
  },
  {
    name: 'PowerTimeChart',
    comp: PowerTimeChart,
    rootClass: 'sig-power',
    role: 'img',
    zhAria: '功率-时间图',
    data: BINS,
    hasStats: true
  },
  {
    name: 'PersistenceSpectrumChart',
    comp: PersistenceSpectrumChart,
    rootClass: 'sig-persist',
    role: 'img',
    zhAria: '持续谱/密度谱',
    data: BINS,
    hasStats: true
  },
  {
    name: 'SmithChart',
    comp: SmithChart,
    rootClass: 'sig-smith',
    role: 'img',
    zhAria: '史密斯圆图',
    data: IQ_SAMPLES,
    hasStats: true
  },
  {
    name: 'ApdCcdfChart',
    comp: ApdCcdfChart,
    rootClass: 'sig-apd',
    role: 'img',
    zhAria: 'APD/CCDF',
    data: APD_CURVES,
    hasStats: true,
    ariaSameInEn: true
  },
  {
    name: 'EyeDiagramChart',
    comp: EyeDiagramChart,
    rootClass: 'sig-eye',
    role: 'img',
    zhAria: '眼图',
    data: IQ_SAMPLES,
    hasStats: true
  }
]

/** 挂载并把 console.error 收走：组件在无 GL 环境下必须安静降级 */
function mountQuiet(
  c: Case,
  props: Record<string, unknown> = {}
): {
  wrapper: ReturnType<typeof mount>
  errors: unknown[]
} {
  const errors: unknown[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
  try {
    const wrapper = mount(c.comp, {
      props: { data: c.data, ...props } as never,
      attachTo: document.body
    })
    return { wrapper, errors }
  } finally {
    spy.mockRestore()
  }
}

describe('图表组件公共契约（DOM）', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('无 GPU 环境下能挂载且不报错', () => {
        const { wrapper, errors } = mountQuiet(c)
        expect(wrapper.element).toBeTruthy()
        expect(errors).toEqual([])
        expect(wrapper.find(`.${c.rootClass}`).exists()).toBe(true)
        expect(wrapper.attributes('role')).toBe(c.role)
        wrapper.unmount()
      })

      it('aria-label 走 i18n，可被 labels.aria 覆盖', () => {
        const zh = mountQuiet(c)
        expect(zh.wrapper.attributes('aria-label')).toBe(c.zhAria)

        const en = mountQuiet(c, { locale: 'en-US' })
        const enLabel = en.wrapper.attributes('aria-label') ?? ''
        expect(enLabel.length).toBeGreaterThan(0)
        // 真的切换了文案（APD/CCDF 这类中英通用文案除外）
        if (!c.ariaSameInEn) expect(enLabel).not.toBe(c.zhAria)

        const custom = mountQuiet(c, { labels: { aria: '自定义画布' } })
        expect(custom.wrapper.attributes('aria-label')).toBe('自定义画布')

        zh.wrapper.unmount()
        en.wrapper.unmount()
        custom.wrapper.unmount()
      })

      it('width/height 生效：数字补 px、字符串原样', () => {
        const px = mountQuiet(c, { width: 320, height: 200 })
        const style = (px.wrapper.element as HTMLElement).getAttribute('style') ?? ''
        expect(style).toContain('width: 320px')
        expect(style).toContain('height: 200px')
        px.wrapper.unmount()

        const pct = mountQuiet(c, { width: '60%', height: '12rem' })
        const style2 = (pct.wrapper.element as HTMLElement).getAttribute('style') ?? ''
        expect(style2).toContain('width: 60%')
        expect(style2).toContain('height: 12rem')
        pct.wrapper.unmount()
      })

      it('theme 切换会反映到根节点 class（dark/light）', () => {
        const dark = mountQuiet(c, { theme: 'dark' })
        expect(dark.wrapper.classes()).toContain('sig-dark')
        dark.wrapper.unmount()

        const light = mountQuiet(c, { theme: 'light' })
        expect(light.wrapper.classes()).toContain('sig-light')
        light.wrapper.unmount()
      })

      it('defineExpose 的宿主调用面齐全', () => {
        const { wrapper } = mountQuiet(c)
        const vm = wrapper.vm as unknown as Record<string, unknown>
        for (const fn of ['setData', 'appendData', 'clear', 'exportPNG', 'exportCSV']) {
          expect(typeof vm[fn], `${c.name}.${fn}`).toBe('function')
        }
        if (c.hasStats) expect(typeof vm.getStats).toBe('function')
        wrapper.unmount()
      })

      it('setData / appendData 摄入数据不抛错', async () => {
        const { wrapper } = mountQuiet(c, { data: undefined })
        const vm = wrapper.vm as unknown as {
          setData: (d: unknown) => void
          appendData: (d: unknown) => void
          clear: () => void
        }
        expect(() => vm.setData(c.data)).not.toThrow()
        expect(() => vm.appendData(c.data)).not.toThrow()
        expect(() => vm.clear()).not.toThrow()
        await new Promise((r) => setTimeout(r, 0))
        expect(() => wrapper.unmount()).not.toThrow()
      })
    })
  }
})

describe('组件专属回归', () => {
  it('ApdCcdf：data 直接传功率样本时不崩（曾因绕过 setData 在 .toFixed 处抛 TypeError）', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a)
    })
    const wrapper = mount(ApdCcdfChart, {
      props: { data: BINS } as never,
      attachTo: document.body
    })
    spy.mockRestore()
    // 无 analysis 时按"需要曲线"处理：emit error，而不是崩掉
    expect(errors).toEqual([])
    expect(wrapper.emitted('error')).toBeTruthy()
    wrapper.unmount()
  })

  it('ApdCcdf：同时给 analysis 时把样本转成曲线并产出统计', async () => {
    const wrapper = mount(ApdCcdfChart, {
      props: { data: BINS, analysis: { enabled: true, bins: 16 } } as never,
      attachTo: document.body
    })
    await new Promise((r) => setTimeout(r, 0))
    const stats = (wrapper.vm as unknown as { getStats: () => { sampleCount?: number } }).getStats()
    expect(stats?.sampleCount).toBe(BINS.length)
    wrapper.unmount()
  })

  it('SpectrumChart：setData 后可读到可见数据与统计', () => {
    const wrapper = mount(SpectrumChart, {
      props: { data: BINS, sampleRate: 1000, fftSize: 128, dbScale: true } as never,
      attachTo: document.body
    })
    const vm = wrapper.vm as unknown as {
      getStats: () => { bins?: number }
      getVisibleData: () => { data: Float32Array } | null
    }
    expect(vm.getStats().bins).toBe(BINS.length)
    expect(vm.getVisibleData()).toBeTruthy()
    wrapper.unmount()
  })

  it('IqChart：setData 后样本数可读，且 interleaved 长度按 2 折算', () => {
    const wrapper = mount(IqChart, {
      props: { data: IQ_SAMPLES } as never,
      attachTo: document.body
    })
    const vm = wrapper.vm as unknown as { getLength: () => number }
    expect(vm.getLength()).toBe(IQ_SAMPLES.length / 2)
    wrapper.unmount()
  })
})
