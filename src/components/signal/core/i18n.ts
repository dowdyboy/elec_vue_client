/**
 * 组件内置文案与多语言（零依赖，可拷贝）
 *
 * - 默认 zh-CN；`locale="en-US"` 切换内置英文
 * - `messages` 可按 key 覆盖任意文案（优先级高于 locale）
 * - 旧的 `labels`（轴标题/角标/图例/aria）优先级最高，保持向后兼容
 *
 * key 采用扁平命名，便于宿主只覆盖少数几条；支持 `{name}` 插值。
 */

export type ChartLocale = 'zh-CN' | 'en-US'

export const zhCN = {
  'common.auto': '自动',
  'common.linear': '（线性）',
  'common.peak': '峰值',
  'common.off': '关',
  'common.stale': '数据流中断',
  'common.staleTitle': '超过 3 秒未收到新数据',
  'common.adapterNull': 'adapter 返回 null，无法解析数据',
  'common.pngEncodeFailed': 'PNG 编码失败',
  'common.pngMissing': 'PNG 导出缺少 dataUrl/blob',

  'iq.aria': 'IQ 时域图',
  'iq.paused': '已暂停跟随 · 双击恢复',
  'iq.pausedTitle':
    '恢复跟随最新数据（保留当前缩放窗宽）。暂停期间数据持续接收（不丢样本），缓冲满后视图随环形淘汰滑动',
  'iq.triggerTitle': '触发对齐显示：虚线为电平（可拖拽），下方三角为触发点',
  'iq.legendTitle': '点击切换迹线显隐',
  'iq.statusWaiting': '等待触发',
  'iq.statusLocked': '触发锁定',
  'iq.statusCaptured': '已捕获',
  'iq.axisY': '幅度',
  'iq.axisXTime': '时间',
  'iq.axisXSamples': '样本',
  'iq.windowSamples': '窗口 {n} 样本',
  'iq.mean': '均值',
  'iq.deltaSamples': 'Δ {n} 样本',
  'iq.menuAdd': '在此处标记',
  'iq.menuRemove': '清除该标记',
  'iq.menuClear': '清除全部标记',
  'iq.menuPause': '暂停刷新',
  'iq.menuResume': '恢复刷新（清除标记）',
  'iq.webglUnsupported': '当前环境不支持 WebGL2/Canvas2D，IQ 图无法渲染',

  'spectrum.aria': '频谱图',
  'spectrum.paused': '已冻结 · 点击恢复',
  'spectrum.pausedTitle': '点击恢复实时更新（重新接收并合并新帧）',
  'spectrum.legendActiveTitle': '当前活动迹线（标记/测量作用对象）；点击隐藏，Alt+点击切换活动',
  'spectrum.legendInactiveTitle': '点击隐藏（后台继续累计）；Alt+点击设为活动迹线',
  'spectrum.legendClear': '实时',
  'spectrum.legendAverage': '平均',
  'spectrum.legendMaxHold': '最大保持',
  'spectrum.legendMinHold': '最小保持',
  'spectrum.axisYDb': '幅度 ({unit})',
  'spectrum.axisY': '幅度',
  'spectrum.axisX': '频率',
  'spectrum.limitPass': '限制通过',
  'spectrum.limitFail': '限制超限 ×{n}',
  'spectrum.menuAdd': '在此处标记',
  'spectrum.menuRemove': '清除该标记',
  'spectrum.menuClear': '清除全部标记',
  'spectrum.menuPeak': '峰值搜索',
  'spectrum.menuToCenter': '最近标记 → 中心',
  'spectrum.menuToRef': '最近标记 → 参考电平',
  'spectrum.menuBand': '区间功率 / 密度（M1–M2）',
  'spectrum.menuNoise': '噪声标记（最近）',
  'spectrum.menuAcpr': 'ACPR 邻道功率',
  'spectrum.menuReset': '全带宽复位',
  'spectrum.webglUnsupported': '当前环境不支持 WebGL2/Canvas2D，频谱图无法渲染',

  'spectrogram.aria': '时频图',
  'spectrogram.paused': '已冻结 · 双击恢复',
  'spectrogram.pausedTitle': '恢复跟随最新行（数据仍在累积）',
  'spectrogram.axisX': '频率',
  'spectrogram.axisY': '时间',
  'spectrogram.levelAxis': '电平 ({unit})',
  'spectrogram.noData': '等待数据…',
  'spectrogram.info': '{rows} 行 · {cols} bin',
  'spectrogram.menuPause': '冻结画面',
  'spectrogram.menuResume': '恢复跟随',
  'spectrogram.menuClear': '清空瀑布',
  'spectrogram.menuReset': '复位频率视图',
  'spectrogram.menuExportPng': '导出 PNG',
  'spectrogram.menuExportCsv': '导出 CSV',
  'spectrogram.exportEmpty': '没有可导出的行',
  'spectrogram.webglUnsupported': '当前环境不支持 WebGL2/Canvas2D，时频图无法渲染'
} as const

export type ChartMessageKey = keyof typeof zhCN
export type ChartMessages = Partial<Record<ChartMessageKey, string>>

export const enUS: Record<ChartMessageKey, string> = {
  'common.auto': 'Auto',
  'common.linear': ' (linear)',
  'common.peak': 'Peak',
  'common.off': 'off',
  'common.stale': 'No data',
  'common.staleTitle': 'No new data for over 3 seconds',
  'common.adapterNull': 'Adapter returned null; unable to parse data',
  'common.pngEncodeFailed': 'PNG encoding failed',
  'common.pngMissing': 'PNG export missing dataUrl/blob',

  'iq.aria': 'IQ time-domain chart',
  'iq.paused': 'Paused · double-click to follow',
  'iq.pausedTitle':
    'Resume following (keeps current span). Data keeps arriving while paused; the view follows the ring buffer when full.',
  'iq.triggerTitle':
    'Trigger-aligned display: dashed line = level (draggable); triangle = trigger point',
  'iq.legendTitle': 'Click to toggle trace visibility',
  'iq.statusWaiting': 'Waiting for trigger',
  'iq.statusLocked': 'Trigger locked',
  'iq.statusCaptured': 'Captured',
  'iq.axisY': 'Amplitude',
  'iq.axisXTime': 'Time',
  'iq.axisXSamples': 'Samples',
  'iq.windowSamples': 'Window {n} samples',
  'iq.mean': 'Mean',
  'iq.deltaSamples': 'Δ {n} samples',
  'iq.menuAdd': 'Add marker here',
  'iq.menuRemove': 'Remove this marker',
  'iq.menuClear': 'Clear all markers',
  'iq.menuPause': 'Pause refresh',
  'iq.menuResume': 'Resume refresh (clears markers)',
  'iq.webglUnsupported': 'WebGL2/Canvas2D unavailable; IQ chart cannot render',

  'spectrum.aria': 'Spectrum chart',
  'spectrum.paused': 'Frozen · click to resume',
  'spectrum.pausedTitle': 'Click to resume live updates',
  'spectrum.legendActiveTitle':
    'Active trace (target of markers/measurements); click to hide, Alt+click to switch active',
  'spectrum.legendInactiveTitle':
    'Click to hide (still accumulating); Alt+click to set as active trace',
  'spectrum.legendClear': 'Live',
  'spectrum.legendAverage': 'Average',
  'spectrum.legendMaxHold': 'Max hold',
  'spectrum.legendMinHold': 'Min hold',
  'spectrum.axisYDb': 'Amplitude ({unit})',
  'spectrum.axisY': 'Amplitude',
  'spectrum.axisX': 'Frequency',
  'spectrum.limitPass': 'LIMIT PASS',
  'spectrum.limitFail': 'LIMIT FAIL ×{n}',
  'spectrum.menuAdd': 'Add marker here',
  'spectrum.menuRemove': 'Remove this marker',
  'spectrum.menuClear': 'Clear all markers',
  'spectrum.menuPeak': 'Peak search',
  'spectrum.menuToCenter': 'Nearest marker → center',
  'spectrum.menuToRef': 'Nearest marker → ref level',
  'spectrum.menuBand': 'Band power / density (M1–M2)',
  'spectrum.menuNoise': 'Noise marker (nearest)',
  'spectrum.menuAcpr': 'ACPR adjacent channel',
  'spectrum.menuReset': 'Reset full span',
  'spectrum.webglUnsupported': 'WebGL2/Canvas2D unavailable; spectrum chart cannot render',

  'spectrogram.aria': 'Spectrogram',
  'spectrogram.paused': 'Frozen · double-click to resume',
  'spectrogram.pausedTitle': 'Resume following the newest row (data still accumulating)',
  'spectrogram.axisX': 'Frequency',
  'spectrogram.axisY': 'Time',
  'spectrogram.levelAxis': 'Level ({unit})',
  'spectrogram.noData': 'Waiting for data…',
  'spectrogram.info': '{rows} rows · {cols} bins',
  'spectrogram.menuPause': 'Freeze',
  'spectrogram.menuResume': 'Resume',
  'spectrogram.menuClear': 'Clear waterfall',
  'spectrogram.menuReset': 'Reset frequency view',
  'spectrogram.menuExportPng': 'Export PNG',
  'spectrogram.menuExportCsv': 'Export CSV',
  'spectrogram.exportEmpty': 'No rows to export',
  'spectrogram.webglUnsupported': 'WebGL2/Canvas2D unavailable; spectrogram cannot render'
}

/** 解析文案：messages > locale 内置 > key 本身；支持 {name} 插值 */
export function translate(
  locale: ChartLocale | undefined,
  messages: ChartMessages | undefined,
  key: ChartMessageKey,
  vars?: Record<string, string | number>
): string {
  const dict = locale === 'en-US' ? enUS : zhCN
  let out = messages?.[key] ?? dict[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value))
    }
  }
  return out
}
