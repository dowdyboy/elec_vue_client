import { describe, it, expect } from 'vitest'
import {
  SpectrumAutoRange,
  SpectrumTraceBuffer,
  robustMinMax,
  zoomXWindow,
  zoomYWindow,
  findPeak,
  findPeaks,
  nextPeak,
  dbToUnit,
  unitLabel,
  VbwFilter,
  channelPowerDb,
  occupiedBandwidth,
  ndbBandwidth,
  decimateTrace,
  bandStats,
  acprBands,
  buildLimitArray,
  evaluateLimit
} from './spectrum'

describe('SpectrumTraceBuffer', () => {
  it('clear：直通最新帧，且输入缓冲可复用', () => {
    const b = new SpectrumTraceBuffer()
    const buf = new Float32Array([1, 2, 3])
    b.push(buf)
    buf[0] = 9
    b.push(buf)
    expect(Array.from(b.get()!)).toEqual([9, 2, 3])
  })

  it('maxHold / minHold：逐 bin 保持', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('maxHold')
    b.push(new Float32Array([1, 5, 3]))
    b.push(new Float32Array([4, 2, 6]))
    expect(Array.from(b.get()!)).toEqual([4, 5, 6])
    b.setMode('minHold')
    // 模式切换以最新帧为种子 → 再推入一帧后取 min
    b.push(new Float32Array([4, 2, 1]))
    expect(Array.from(b.get()!)).toEqual([4, 2, 1])
  })

  it('average：最近 N 帧滑动平均（环形覆盖正确；log 对数口径）', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('average')
    b.setAverageMode('log') // 本用例验证对数平均（默认已改为功率平均）
    b.setAverageCount(3)
    b.push(new Float32Array([1, 1, 1]))
    expect(Array.from(b.get()!)).toEqual([1, 1, 1])
    b.push(new Float32Array([2, 2, 2]))
    expect(Array.from(b.get()!)).toEqual([1.5, 1.5, 1.5])
    b.push(new Float32Array([3, 3, 3]))
    expect(Array.from(b.get()!)).toEqual([2, 2, 2])
    b.push(new Float32Array([4, 4, 4])) // 覆盖最老的 1 → (2+3+4)/3
    expect(Array.from(b.get()!)).toEqual([3, 3, 3])
  })

  it('average 默认功率(RMS)平均：dB 域按线性功率平均', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('average')
    b.setAverageCount(2)
    b.push(new Float32Array([0]))
    b.push(new Float32Array([-10]))
    // (10^0 + 10^-1)/2 = 0.55 → 10log10(0.55)
    expect(b.get()![0]).toBeCloseTo(10 * Math.log10(0.55), 5)
  })

  it('average 线性域：平方平均开方；环形覆盖在功率域扣旧值', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('average')
    b.setDbScale(false)
    b.setAverageCount(2)
    b.push(new Float32Array([3]))
    b.push(new Float32Array([4]))
    expect(b.get()![0]).toBeCloseTo(Math.sqrt((9 + 16) / 2), 5)

    const p = new SpectrumTraceBuffer()
    p.setMode('average')
    p.setAverageCount(2)
    p.push(new Float32Array([0]))
    p.push(new Float32Array([10]))
    expect(p.get()![0]).toBeCloseTo(10 * Math.log10((1 + 10) / 2), 5)
    p.push(new Float32Array([10])) // 覆盖 0dB 帧 → (10+10)/2 = 10
    expect(p.get()![0]).toBeCloseTo(10, 5)
  })

  it('帧长变化自动重置累计', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('maxHold')
    b.push(new Float32Array([1, 2]))
    b.push(new Float32Array([5, 5, 5]))
    expect(Array.from(b.get()!)).toEqual([5, 5, 5])
    expect(b.getLength()).toBe(3)
  })

  it('模式切换以最新帧为种子（切换瞬间不黑屏）', () => {
    const b = new SpectrumTraceBuffer()
    b.push(new Float32Array([1, 2, 3]))
    b.setMode('average')
    expect(Array.from(b.get()!)).toEqual([1, 2, 3])
  })

  it('clear() 清空全部累计', () => {
    const b = new SpectrumTraceBuffer()
    b.push(new Float32Array([1, 2, 3]))
    b.clear()
    expect(b.get()).toBeNull()
  })
})

describe('峰值搜索', () => {
  // 局部极大：2(0)、6(10)、8(9.2，肩峰)
  const data = new Float32Array([-30, -20, 0, -10, -25, -15, 10, 8.5, 9.2, 9.0, -20, -25, -30])

  it('findPeak：区间最大点；空区间返回 null', () => {
    expect(findPeak(data, 0, data.length)).toEqual({ bin: 6, value: 10 })
    expect(findPeak(data, 0, 0)).toBeNull()
  })

  it('findPeaks：局部极大按幅度降序', () => {
    const peaks = findPeaks(data, 0, data.length)
    expect(peaks.map((p) => p.bin)).toEqual([6, 8, 2])
  })

  it('findPeaks：excursion 过滤肩峰，threshold 过滤低峰', () => {
    const withExcursion = findPeaks(data, 0, data.length, { excursion: 3 })
    expect(withExcursion.map((p) => p.bin)).toEqual([6, 2])
    const withThreshold = findPeaks(data, 0, data.length, { threshold: 5 })
    expect(withThreshold.map((p) => p.bin)).toEqual([6, 8])
  })

  it('nextPeak：取低于当前峰 excursion 以上中的最高峰', () => {
    const peaks = findPeaks(data, 0, data.length)
    const next = nextPeak(peaks, { bin: 6, value: 10 }, 3)
    expect(next).toEqual({ bin: 2, value: 0 })
    const next0 = nextPeak(peaks, { bin: 6, value: 10 }, 0)
    expect(next0?.bin).toBe(8)
    expect(next0?.value).toBeCloseTo(9.2, 5)
  })
})

describe('zoomXWindow（X 轴缩放窗口）', () => {
  it('放大：锚点保持屏上相对位置、窗宽按比例', () => {
    const w = zoomXWindow(100, 200, 150, 0.5, 500, 8)
    expect(w.full).toBe(false)
    expect(w.max - w.min).toBeCloseTo(50)
    expect((150 - w.min) / (w.max - w.min)).toBeCloseTo(0.5)
  })

  it('缩小：边缘钳制，连续缩小最终精确达到全带宽', () => {
    let win = { min: 100, max: 200, full: false }
    for (let i = 0; i < 10 && !win.full; i++) {
      win = zoomXWindow(win.min, win.max, 150, 1.2, 200, 8)
      expect(win.min).toBeGreaterThanOrEqual(0)
      expect(win.max).toBeLessThanOrEqual(200)
    }
    expect(win.full).toBe(true)
    expect(win.min).toBe(0)
    expect(win.max).toBe(200)
  })

  it('已全带宽再缩小幂等（不会产生可拖动余量）', () => {
    const w = zoomXWindow(0, 200, 100, 1.2, 200, 8)
    expect(w).toEqual({ min: 0, max: 200, full: true })
  })

  it('锚点越出窗口时钳制到边缘；最小窗宽生效', () => {
    const left = zoomXWindow(0, 50, -10, 0.5, 100, 8)
    expect(left.min).toBe(0)
    expect(left.max - left.min).toBeCloseTo(25)
    const minSpan = zoomXWindow(100, 104, 102, 0.5, 1000, 8)
    expect(minSpan.max - minSpan.min).toBeCloseTo(8)
  })
})

describe('zoomYWindow（Y 轴光标锚定缩放）', () => {
  it('放大/缩小：锚点屏上相对位置保持不变', () => {
    const inW = zoomYWindow(-80, 0, -20, 0.5, 2.5, 250)
    expect((-20 - inW.min) / (inW.max - inW.min)).toBeCloseTo((-20 - -80) / 80)
    expect(inW.max - inW.min).toBeCloseTo(40)
    const outW = zoomYWindow(-80, 0, -20, 1.25, 2.5, 250)
    expect((-20 - outW.min) / (outW.max - outW.min)).toBeCloseTo(0.75)
  })

  it('跨度钳制：不超出 [minSpan, maxSpan]', () => {
    const tooSmall = zoomYWindow(-80, 0, -20, 0.001, 2.5, 250)
    expect(tooSmall.max - tooSmall.min).toBeCloseTo(2.5)
    const tooBig = zoomYWindow(-80, 0, -20, 100, 2.5, 250)
    expect(tooBig.max - tooBig.min).toBeCloseTo(250)
  })
})

describe('robustMinMax（稳健极值）', () => {
  it('峰值取真实最大；底部取分位忽略单 bin 深谷', () => {
    const data = new Float32Array(100)
    for (let i = 0; i < 100; i++) data[i] = -60 + i * 0.1
    data[7] = -90 // 单 bin 深谷
    data[42] = -5 // 载波
    const mm = robustMinMax(data, 0, data.length, 0.03)!
    expect(mm.max).toBe(-5)
    expect(mm.min).toBeGreaterThan(-90) // 深谷被分位忽略
    expect(mm.min).toBeLessThan(-55)
  })
  it('空区间返回 null', () => {
    expect(robustMinMax(new Float32Array(0), 0, 0)).toBeNull()
  })
})

describe('SpectrumAutoRange（自动量程稳定性）', () => {
  // 确定性伪随机（LCG），保证用例可复现
  function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  }

  it('稳健输入下量程稳定：无自动收窄、档位变化 ≤2（含偶发峰值毛刺）', () => {
    const rnd = lcg(42)
    const ar = new SpectrumAutoRange()
    let prevTier: { min: number; max: number } | null = null
    let tierChanges = 0
    let shrinkCount = 0
    for (let i = 0; i < 1200; i++) {
      const min = -66 + (rnd() * 3 - 1.5)
      let max = -7 + (rnd() * 3 - 1.5)
      if (i % 197 < 2) max += 8 // 偶发毛刺（真实峰值，允许顶部档位扩张一次）
      ar.update(min, max, true)
      const tier = ar.tier()!
      if (prevTier && (tier.min !== prevTier.min || tier.max !== prevTier.max)) {
        tierChanges++
        if (tier.min > prevTier.min || tier.max < prevTier.max) shrinkCount++
      }
      prevTier = tier
    }
    expect(tierChanges).toBeLessThanOrEqual(2)
    expect(shrinkCount).toBe(0)
  })

  it('数据超出档位时立即扩张（不裁切）', () => {
    const ar = new SpectrumAutoRange()
    ar.update(-90, -10)
    const before = ar.display()!
    ar.update(-200, -10) // 下沿大幅下移 → 立即扩张
    const after = ar.display()!
    expect(after.min).toBeLessThan(before.min)
    expect(after.min).toBeLessThanOrEqual(-200)
  })

  it('默认 mock 实测数据：顶部锚定贴合，底噪靠底、峰值靠顶', () => {
    const ar = new SpectrumAutoRange()
    // 实测统计：p3 稳健底 -66.3 / 峰值 -7.4 / 底噪中位 -52.8（sine+snr20+FFT1024）
    ar.update(-66.3, -7.4, true)
    const tier = ar.tier()!
    const d = ar.display()!
    expect(d).toEqual(tier)
    expect(tier.min).toBeGreaterThanOrEqual(-90)
    expect(tier.min).toBeLessThanOrEqual(-60)
    expect(tier.max).toBeGreaterThanOrEqual(-7.4)
    expect(tier.max).toBeLessThanOrEqual(10)
    const pos = (v: number): number => (v - tier.min) / (tier.max - tier.min)
    expect(pos(-52.8)).toBeGreaterThan(0.15) // 底噪中位位于底部 15%~35%
    expect(pos(-52.8)).toBeLessThan(0.35)
    expect(pos(-7.4)).toBeGreaterThan(0.8) // 峰值靠顶
  })

  it('线性幅度模式：底部钉 0，顶部 1/2/5 档上取', () => {
    const ar = new SpectrumAutoRange()
    ar.update(0.01, 0.5, false)
    const d = ar.display()!
    expect(d.min).toBe(0)
    expect(d.max).toBeGreaterThanOrEqual(0.5)
    expect(d.max).toBeLessThanOrEqual(1)
  })

  it('收窄需驻留：未达驻留不收，驻留后收档', () => {
    const ar = new SpectrumAutoRange({ shrinkDwell: 10 })
    ar.update(-150, -10)
    const wide = ar.tier()!
    // 窄数据 + 每帧重置驻留 → 不收档
    for (let i = 0; i < 400; i++) {
      ar.update(-40, -20)
      ar.resetShrink()
    }
    expect(ar.tier()).toEqual(wide)
    // 不再重置驻留，包络衰减 + 连续驻留后收档
    for (let i = 0; i < 500; i++) ar.update(-40, -20)
    expect(ar.tier()!.min).toBeGreaterThan(wide.min)
  })

  it('数据长期显著变小后仍会保守收窄（默认 ≈3s 驻留 + 平滑滑入）', () => {
    const ar = new SpectrumAutoRange()
    for (let i = 0; i < 300; i++) ar.update(-150, -10)
    const wide = ar.tier()!
    let narrowedAt = -1
    for (let i = 0; i < 2000; i++) {
      ar.update(-40, -10)
      if (narrowedAt < 0 && ar.tier()!.min > wide.min) narrowedAt = i
    }
    expect(narrowedAt).toBeGreaterThan(0) // 包络衰减 + 驻留后收窄
    const shown = ar.display()!
    expect(shown.min).toBeLessThanOrEqual(ar.tier()!.max)
  })

  it('display() 为纯读取：重复调用不改变结果（缓动按帧推进）', () => {
    const ar = new SpectrumAutoRange()
    ar.update(-90, -10)
    const a = ar.display()!
    const b = ar.display()!
    const c = ar.display()!
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('resetTier 保留显示范围（帧长变化不闪默认量程）', () => {
    const ar = new SpectrumAutoRange()
    ar.update(-90, -10)
    const before = ar.display()!
    ar.resetTier()
    expect(ar.display()).toEqual(before) // 仍保持原显示范围
    expect(ar.tier()).toBeNull()
    ar.update(-95, -5) // 新帧重建档位并平滑衔接
    expect(ar.display()).not.toBeNull()
  })

  it('reset 清空状态；display 未初始化返回 null', () => {
    const ar = new SpectrumAutoRange()
    expect(ar.display()).toBeNull()
    ar.update(-80, -10)
    expect(ar.display()).not.toBeNull()
    ar.reset()
    expect(ar.display()).toBeNull()
    expect(ar.tier()).toBeNull()
  })
})

describe('dbToUnit / unitLabel', () => {
  it('dBm 直通；dBW=dBm-30', () => {
    expect(dbToUnit(-40, 'dBm')).toBe(-40)
    expect(dbToUnit(-40, 'dBW')).toBeCloseTo(-70)
  })
  it('50Ω/75Ω 阻抗换算：dBµV=dBm+107/+108.75，dBmV=dBm+46.99/+48.75', () => {
    expect(dbToUnit(-40, 'dBuV', 50)).toBeCloseTo(66.99)
    expect(dbToUnit(-40, 'dBuV', 75)).toBeCloseTo(68.75)
    expect(dbToUnit(-40, 'dBmV', 50)).toBeCloseTo(6.99)
    expect(dbToUnit(-40, 'dBmV', 75)).toBeCloseTo(8.75)
  })
  it('unitLabel：dBµV 用 µ 符号', () => {
    expect(unitLabel('dBuV')).toBe('dBµV')
    expect(unitLabel('dBm')).toBe('dBm')
  })
})

describe('VbwFilter（比例模型 α=1−VBW/RBW）', () => {
  it('关闭时直通（vbw 缺省/0/≥RBW/RBW 未知）', () => {
    const f = new VbwFilter()
    const frame = new Float32Array([1, 2, 3])
    expect(f.apply(frame, undefined, 250)).toBe(frame)
    expect(f.apply(frame, 0, 250)).toBe(frame)
    expect(f.apply(frame, 250, 250)).toBe(frame)
    expect(f.apply(frame, 1000, 250)).toBe(frame)
    expect(f.apply(frame, 100, undefined)).toBe(frame)
  })
  it('恒定输入收敛到输入值；首帧直通不跳变', () => {
    const f = new VbwFilter()
    const frame = new Float32Array([10, -10])
    expect(Array.from(f.apply(frame, 100, 250))).toEqual([10, -10]) // 首帧种子
    let out = frame
    for (let i = 0; i < 200; i++) out = f.apply(frame, 100, 250)
    expect(out[0]).toBeCloseTo(10, 3)
    expect(out[1]).toBeCloseTo(-10, 3)
  })
  it('阶跃响应精确等于 α=1−VBW/RBW（与帧率无关）', () => {
    const step = (vbw: number, rbw: number): number => {
      const f = new VbwFilter()
      f.apply(new Float32Array([0]), vbw, rbw) // 种子 0
      return f.apply(new Float32Array([10]), vbw, rbw)[0]!
    }
    expect(step(100, 1000)).toBeCloseTo(1.0, 5) // α=0.9 → 10×(1−α)
    expect(step(500, 1000)).toBeCloseTo(5.0, 5) // α=0.5
    expect(step(100, 250)).toBeCloseTo(4.0, 5) // α=0.6
  })
  it('α 上钳 0.95（VBW≪RBW 不发散）且平滑强度随 VBW 单调', () => {
    const f = new VbwFilter()
    f.apply(new Float32Array([0]), 1, 1000)
    expect(f.apply(new Float32Array([10]), 1, 1000)[0]!).toBeCloseTo(0.5, 5) // 10×(1−0.95)
    const step = (vbw: number): number => {
      const g = new VbwFilter()
      g.apply(new Float32Array([0]), vbw, 1000)
      return g.apply(new Float32Array([10]), vbw, 1000)[0]!
    }
    expect(step(100)).toBeLessThan(step(300)) // VBW 越小输出上升越慢
    expect(step(300)).toBeLessThan(step(700))
  })
  it('帧长变化/reset 后以新帧为种子', () => {
    const f = new VbwFilter()
    f.apply(new Float32Array([1, 1]), 100, 250)
    const out = f.apply(new Float32Array([5, 5, 5]), 100, 250)
    expect(Array.from(out)).toEqual([5, 5, 5])
    f.reset()
    const out2 = f.apply(new Float32Array([7, 7, 7]), 100, 250)
    expect(Array.from(out2)).toEqual([7, 7, 7])
  })
})

describe('频谱测量（channelPowerDb / occupiedBandwidth / ndbBandwidth）', () => {
  // 构造：噪声底 -80 dB，bin 100 处 0 dB 单音
  const mkData = (): Float32Array => {
    const d = new Float32Array(512).fill(-80)
    d[100] = 0
    return d
  }

  it('channelPowerDb：单音功率 ≈ 其 dB 值（其余为噪声底）', () => {
    const p = channelPowerDb(mkData(), 0, 512)!
    expect(p).toBeGreaterThan(-1)
    expect(p).toBeLessThan(2)
  })

  it('occupiedBandwidth：99% 功率边界夹住单音 bin', () => {
    const r = occupiedBandwidth(mkData(), 0, 512, 0.99)!
    expect(r.loBin).toBeLessThanOrEqual(100)
    expect(r.hiBin).toBeGreaterThanOrEqual(100)
    expect(r.hiBin - r.loBin).toBeLessThan(50) // 高 SNR 下带宽应远小于全 span
  })

  it('ndbBandwidth：三角峰 3dB 宽度正确（含插值）', () => {
    // 峰值 bin 100=0dB，两侧线性滚降 1dB/bin → 3dB 带宽应为 6 bin
    const d = new Float32Array(512).fill(-100)
    for (let k = -10; k <= 10; k++) d[100 + k] = -Math.abs(k)
    const r = ndbBandwidth(d, 0, 512, 3)!
    expect(r.peakBin).toBe(100)
    expect(r.hiBin - r.loBin).toBeCloseTo(6, 1)
  })

  it('ndbBandwidth 抗噪：噪声平台裸测极窄，平滑+连续判定恢复平台宽度', () => {
    // 平台 bin 200..320 高 35dB，叠加 ±8dB 高频波纹（相邻 bin 剧烈翻转）
    const d = new Float32Array(512)
    for (let i = 0; i < 512; i++) {
      const inBand = i >= 200 && i <= 320 ? 35 : 0
      d[i] = -90 + inBand + 8 * Math.sin(i * 2.7)
    }
    const bare = ndbBandwidth(d, 0, 512, 3)!
    const robust = ndbBandwidth(d, 0, 512, 3, { smooth: 5, hold: 3 })!
    expect(bare.hiBin - bare.loBin).toBeLessThan(20) // 裸测：被波纹噪谷骗到峰值旁
    expect(robust.hiBin - robust.loBin).toBeGreaterThan(80) // 抗噪：恢复到平台宽度
    expect(robust.hiBin - robust.loBin).toBeGreaterThan((bare.hiBin - bare.loBin) * 5)
    expect(robust.peakBin).toBe(bare.peakBin) // 报告峰值仍为原始峰值
  })

  it('ndbBandwidth 抗噪参数不影响干净信号量级', () => {
    const d = new Float32Array(512).fill(-100)
    for (let k = -10; k <= 10; k++) d[100 + k] = -Math.abs(k)
    const r = ndbBandwidth(d, 0, 512, 3, { smooth: 3, hold: 3 })!
    expect(r.hiBin - r.loBin).toBeGreaterThan(4)
    expect(r.hiBin - r.loBin).toBeLessThan(9)
  })

  it('区间无效/功率全零时返回 null', () => {
    expect(channelPowerDb(new Float32Array(0), 0, 1)).toBeNull()
    expect(occupiedBandwidth(new Float32Array(1), 0, 1)).toBeNull()
    expect(ndbBandwidth(new Float32Array([1]), 0, 1)).toBeNull()
  })
})

describe('decimateTrace 检波器', () => {
  const data = new Float32Array([0, -10, 5, -20, 3, 7, -5, 1])

  it('minmax：桶内极小/极大成对输出（保持索引顺序）', () => {
    const out = decimateTrace(data, 0, 8, 4, 'minmax')
    expect(Array.from(out)).toEqual([0, -10, 5, -20, 3, 7, -5, 1])
  })
  it('posPeak / negPeak / sample', () => {
    expect(Array.from(decimateTrace(data, 0, 8, 4, 'posPeak'))).toEqual([0, 5, 7, 1])
    expect(Array.from(decimateTrace(data, 0, 8, 4, 'negPeak'))).toEqual([-10, -20, 3, -5])
    expect(Array.from(decimateTrace(data, 0, 8, 4, 'sample'))).toEqual([0, 5, 3, -5])
  })
  it('rms：dB 域线性功率平均；线性域平方平均开方', () => {
    const dbOut = decimateTrace(new Float32Array([0, -10]), 0, 2, 1, 'rms')
    expect(dbOut[0]).toBeCloseTo(10 * Math.log10((1 + 0.1) / 2), 5)
    const linOut = decimateTrace(new Float32Array([3, 4]), 0, 2, 1, 'rms', false)
    expect(linOut[0]).toBeCloseTo(Math.sqrt((9 + 16) / 2), 5)
  })
  it('average：桶内算术平均（对数口径）', () => {
    const out = decimateTrace(new Float32Array([0, -10]), 0, 2, 1, 'average')
    expect(out[0]).toBeCloseTo(-5, 5)
  })
  it('len ≤ target 直通全分辨率', () => {
    expect(Array.from(decimateTrace(data, 1, 5, 10, 'posPeak'))).toEqual([-10, 5, -20, 3])
  })
})

describe('bandStats / acprBands / 限制线', () => {
  it('bandStats：总功率与功率谱密度（RBW=binHz 口径）', () => {
    const d = new Float32Array(10).fill(-30)
    const r = bandStats(d, 0, 10, 100)!
    expect(r.powerDb).toBeCloseTo(-30 + 10 * Math.log10(10), 5) // -20
    expect(r.densityDbPerHz).toBeCloseTo(-20 - 10 * Math.log10(1000), 5) // -50
  })

  it('acprBands：主/邻信道功率', () => {
    const d = new Float32Array(200).fill(-120)
    d[100] = 0
    d[95] = d[105] = -30
    const r = acprBands(d, 0, 200, 100, 3, 3)!
    expect(r.mainDb).toBeCloseTo(0, 1)
    expect(r.lowerDb).toBeCloseTo(-30, 1)
    expect(r.upperDb).toBeCloseTo(-30, 1)
  })

  it('buildLimitArray：线性插值 + 两端水平延伸', () => {
    const arr = buildLimitArray(
      [
        { bin: 2, level: -10 },
        { bin: 6, level: -20 }
      ],
      8
    )!
    expect(arr[0]).toBe(-10)
    expect(arr[2]).toBe(-10)
    expect(arr[4]).toBeCloseTo(-15, 5)
    expect(arr[6]).toBe(-20)
    expect(arr[7]).toBe(-20)
  })

  it('evaluateLimit：upper/lower 判定与最差余量', () => {
    const lim = new Float32Array([-10, -10, -10])
    const up = evaluateLimit(new Float32Array([-5, -15, -25]), 0, 3, lim, 'upper')!
    expect(up.pass).toBe(false)
    expect(up.violations).toBe(1)
    expect(up.worstMarginDb).toBeCloseTo(-5, 5)
    const ok = evaluateLimit(new Float32Array([-20, -20]), 0, 2, lim, 'upper')!
    expect(ok.pass).toBe(true)
    expect(ok.worstMarginDb).toBeCloseTo(10, 5)
    const low = evaluateLimit(new Float32Array([-20, -5]), 0, 2, lim, 'lower')!
    expect(low.pass).toBe(false)
    expect(low.violations).toBe(1)
    expect(low.worstMarginDb).toBeCloseTo(-10, 5)
  })
})

describe('回归：ACPR / 平均 / 保持 / 稳健极值', () => {
  it('ACPR：主/邻等宽（各 50+ bin）时结果约 -20 dB，邻道不再只积分一半', () => {
    const d = new Float32Array(512).fill(-120)
    const c = 256
    const half = 25
    for (let i = 0; i < 512; i++) {
      if (Math.abs(i - c) <= half) d[i] = -30
      else if (i > c + half && i <= c + 3 * half) d[i] = -50
    }
    const r = acprBands(d, 0, 512, c, half, half)!
    // 主信道 51 bin * -30；邻道 50 bin * -50 → 比值约 -20.1 dB
    expect(r.upperDb - r.mainDb).toBeCloseTo(-20, 0)
  })

  it('averageCount=1 时直通最新帧（不再冻结在 reseed 时的种子帧）', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('average')
    b.setAverageCount(3)
    b.push(new Float32Array([1]))
    b.push(new Float32Array([2]))
    b.push(new Float32Array([3]))
    b.setAverageCount(1)
    b.push(new Float32Array([9]))
    expect(b.get()![0]).toBeCloseTo(9, 5)
    b.push(new Float32Array([9]))
    expect(b.get()![0]).toBeCloseTo(9, 5)
  })

  it('调整平均帧数不会清空 maxHold/minHold 历史', () => {
    const b = new SpectrumTraceBuffer()
    b.setMode('maxHold')
    b.push(new Float32Array([1, 10]))
    b.push(new Float32Array([5, 2]))
    expect(Array.from(b.get()!)).toEqual([5, 10])
    b.setAverageCount(4)
    b.push(new Float32Array([3, 3]))
    expect(Array.from(b.get()!)).toEqual([5, 10])
    b.setMode('minHold')
    b.push(new Float32Array([2, 8]))
    b.setAverageMode('log')
    b.push(new Float32Array([1, 9]))
    expect(Array.from(b.get()!)).toEqual([1, 3])
  })

  it('大区间 robustMinMax 走直方图近似（O(n)），单 bin 深谷仍被忽略', () => {
    const n = 20000
    const d = new Float32Array(n)
    for (let i = 0; i < n; i++) d[i] = -60 + (i % 100) * 0.02
    d[123] = -110
    const mm = robustMinMax(d, 0, n, 0.03)!
    expect(mm.max).toBeCloseTo(-58.02, 5)
    expect(mm.min).toBeGreaterThan(-61) // 未被 -110 深谷带偏
    expect(mm.min).toBeLessThan(-59)
  })
})
