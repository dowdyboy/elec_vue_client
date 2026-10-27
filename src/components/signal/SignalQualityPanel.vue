<script setup lang="ts">
/**
 * SignalQualityPanel（纯指标面板）
 * - 只显示调用方/分析仪提供的指标，不计算 EVM/MER/SNR
 * - 可选 thresholds：pass/fail；不传阈值时按 unknown 展示
 * - 可作为产线测试/调试面板，与 ConstellationChart.getAnalysisStats() 配合
 */
import { computed } from 'vue'
import { translate, type ChartMessageKey } from './core/i18n'
import { evaluateSignalQuality } from './core/quality'
import type {
  SignalQualityMetrics,
  SignalQualityPanelProps,
  SignalQualityState
} from './core/types'

const props = withDefaults(defineProps<SignalQualityPanelProps>(), {
  compact: false,
  showPassFail: true
})

interface Row {
  key: keyof SignalQualityMetrics
  label: string
  value: string
  unit?: string
  state: SignalQualityState
  threshold?: string
}

const tr = (key: ChartMessageKey, params?: Record<string, string | number>): string =>
  translate(props.locale, props.messages, key, params)

const result = computed(() => evaluateSignalQuality(props.metrics ?? {}, props.thresholds ?? {}))
const byKey = computed(() => new Map(result.value.items.map((i) => [i.key, i])))

const rows = computed<Row[]>(() => {
  const m = props.metrics ?? {}
  const defs: Array<{
    key: keyof SignalQualityMetrics
    labelKey: ChartMessageKey
    unit?: string
    digits?: number
  }> = [
    { key: 'evmPercent', labelKey: 'quality.evm', unit: '%', digits: 2 },
    { key: 'merDb', labelKey: 'quality.mer', unit: 'dB', digits: 1 },
    { key: 'snrDb', labelKey: 'quality.snr', unit: 'dB', digits: 1 },
    { key: 'carrierOffsetHz', labelKey: 'quality.cfo', unit: 'Hz', digits: 1 },
    { key: 'symbolRateErrorPpm', labelKey: 'quality.symbolRate', unit: 'ppm', digits: 1 },
    { key: 'paprDb', labelKey: 'quality.papr', unit: 'dB', digits: 1 },
    { key: 'iqGainImbalanceDb', labelKey: 'quality.iqGain', unit: 'dB', digits: 2 },
    { key: 'iqPhaseImbalanceDeg', labelKey: 'quality.iqPhase', unit: '°', digits: 2 },
    { key: 'powerDbm', labelKey: 'quality.power', unit: 'dBm', digits: 1 },
    { key: 'peakPowerDbm', labelKey: 'quality.peakPower', unit: 'dBm', digits: 1 },
    { key: 'frequencyHz', labelKey: 'quality.frequency', unit: 'Hz', digits: 1 },
    { key: 'pulseWidthSec', labelKey: 'quality.pulseWidth', unit: 's', digits: 6 },
    { key: 'dutyCycle', labelKey: 'quality.duty', unit: '%', digits: 1 }
  ]
  const out: Row[] = []
  for (const d of defs) {
    const v = m[d.key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const hit = byKey.value.get(d.key)
    const value =
      d.key === 'dutyCycle' ? (v * 100).toFixed(d.digits ?? 1) : v.toFixed(d.digits ?? 1)
    out.push({
      key: d.key,
      label: tr(d.labelKey),
      value,
      unit: d.unit,
      state: hit?.state ?? 'unknown',
      threshold: hit?.threshold
    })
  }
  return out
})

const overall = computed(() => {
  if (result.value.state === 'fail') return { cls: 'fail', text: tr('quality.fail') }
  if (result.value.state === 'pass') return { cls: 'pass', text: tr('quality.pass') }
  return { cls: 'unknown', text: tr('quality.unknown') }
})
</script>

<template>
  <section class="sig-quality" :class="{ compact: props.compact }">
    <header class="sig-quality-head">
      <div>
        <div class="sig-quality-title">{{ props.title ?? tr('quality.title') }}</div>
        <div class="sig-quality-sub">{{ tr('quality.subtitle') }}</div>
      </div>
      <span v-if="props.showPassFail !== false" class="sig-quality-badge" :class="overall.cls">
        {{ overall.text }}
      </span>
    </header>
    <div v-if="rows.length === 0" class="sig-quality-empty">{{ tr('quality.empty') }}</div>
    <div v-else class="sig-quality-grid">
      <div v-for="row in rows" :key="row.key" class="sig-quality-item" :class="row.state">
        <div class="sig-quality-label">{{ row.label }}</div>
        <div class="sig-quality-value">
          {{ row.value }}<span v-if="row.unit" class="sig-quality-unit">{{ row.unit }}</span>
        </div>
        <div v-if="row.threshold" class="sig-quality-threshold">{{ row.threshold }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sig-quality {
  --sq-bg: rgba(20, 22, 28, 0.04);
  --sq-border: rgba(31, 35, 40, 0.14);
  --sq-text: #1f2328;
  --sq-muted: #65707c;
  --sq-pass: #16794a;
  --sq-fail: #c62828;
  --sq-unknown: #8a6d3b;
  background: var(--sq-bg);
  border: 1px solid var(--sq-border);
  border-radius: 8px;
  padding: 14px 16px;
  color: var(--sq-text);
  font-size: 13px;
}
.sig-quality.compact {
  padding: 10px 12px;
}
.sig-quality-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.sig-quality-title {
  font-size: 15px;
  font-weight: 600;
}
.sig-quality-sub {
  margin-top: 2px;
  color: var(--sq-muted);
  font-size: 12px;
}
.sig-quality-badge {
  flex: none;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid currentColor;
}
.sig-quality-badge.pass {
  color: var(--sq-pass);
}
.sig-quality-badge.fail {
  color: var(--sq-fail);
}
.sig-quality-badge.unknown {
  color: var(--sq-unknown);
}
.sig-quality-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}
.sig-quality-item {
  border: 1px solid var(--sq-border);
  border-radius: 6px;
  padding: 8px 10px;
  min-width: 0;
}
.sig-quality-item.fail {
  border-color: color-mix(in srgb, var(--sq-fail) 45%, transparent);
}
.sig-quality-item.pass {
  border-color: color-mix(in srgb, var(--sq-pass) 35%, transparent);
}
.sig-quality-label {
  color: var(--sq-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sig-quality-value {
  margin-top: 2px;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sig-quality-unit {
  margin-left: 3px;
  color: var(--sq-muted);
  font-size: 11px;
}
.sig-quality-threshold {
  margin-top: 2px;
  color: var(--sq-muted);
  font-size: 10px;
}
.sig-quality-empty {
  color: var(--sq-muted);
  padding: 10px 0;
}
@media (prefers-color-scheme: dark) {
  .sig-quality {
    --sq-bg: rgba(255, 255, 255, 0.03);
    --sq-border: rgba(255, 255, 255, 0.14);
    --sq-text: #e6edf3;
    --sq-muted: #9aa4b2;
    --sq-pass: #56d364;
    --sq-fail: #ff7b72;
    --sq-unknown: #d2a8ff;
  }
}
</style>
