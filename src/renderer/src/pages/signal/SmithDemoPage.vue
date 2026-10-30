<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NCard, NSelect, NSlider, NTag, useMessage } from 'naive-ui'
import { SmithChart, type SmithTrace } from '@components/signal'
import type { SweepFrame } from '../../../../shared/sweep'

const message = useMessage()
const chartRef = ref<InstanceType<typeof SmithChart> | null>(null)
const points = ref(0)
const vswr = ref(0)
const dataSource = ref<'sim' | 'sweep'>(useRoute().query.src === '1' ? 'sweep' : 'sim')
const sourceMode = computed(() => dataSource.value === 'sweep')
const sweepRunning = ref(false)
const rOhm = ref(25)
const lNano = ref(100)
const cPico = ref(5)
const calDelayPs = ref(0)
const calLossDb = ref(0)
let disposeSweep: (() => void) | null = null

function makeTraces(): SmithTrace[] {
  const traces: SmithTrace[] = []
  for (let t = 0; t < 3; t++) {
    const n = 240
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const th = (2 * Math.PI * k) / n
      if (t === 0) {
        // 偏离中心的小圆（失配轨迹）
        i[k] = 0.28 + 0.16 * Math.cos(th)
        q[k] = 0.12 + 0.16 * Math.sin(th)
      } else if (t === 1) {
        // 螺旋：逐渐靠近中心（调谐）
        const r = 0.45 * (1 - k / n) + 0.05
        i[k] = r * Math.cos(th * 3)
        q[k] = r * Math.sin(th * 3)
      } else {
        // 接近匹配点的短弧
        i[k] = 0.06 + 0.04 * Math.cos(th)
        q[k] = -0.05 + 0.04 * Math.sin(th)
      }
    }
    traces.push({ i, q, name: t === 0 ? 'Antenna' : t === 1 ? 'Tune' : 'Match' })
  }
  return traces
}

function regenerate(): void {
  const traces = makeTraces()
  chartRef.value?.setData(traces)
  const s = chartRef.value?.getStats()
  points.value = s?.points ?? 0
  vswr.value = s?.maxVswr ?? 0
}

function updateStats(): void {
  const s = chartRef.value?.getStats()
  points.value = s?.points ?? 0
  vswr.value = s?.maxVswr ?? 0
}

function onSweepFrame(frame: SweepFrame): void {
  if (!sourceMode.value) return
  chartRef.value?.setData([
    {
      i: frame.gammaI,
      q: frame.gammaQ,
      name: `S11 ${frame.frequencies[0]! / 1e6}–${frame.frequencies[frame.frequencies.length - 1]! / 1e6} MHz`
    }
  ])
  updateStats()
}

async function startSweep(): Promise<void> {
  const r = (await window.api.sweep.setConfig({
    startHz: 1e6,
    stopHz: 500e6,
    points: 401,
    z0: 50,
    rOhm: rOhm.value,
    lHenry: lNano.value * 1e-9,
    cFarad: cPico.value * 1e-12,
    calDelayPs: calDelayPs.value,
    calLossDb: calLossDb.value
  })) as { ok: boolean; error?: string }
  if (!r.ok) {
    message.error(r.error || '扫频配置失败')
    return
  }
  await window.api.sweep.start()
  sweepRunning.value = true
}

async function stopSweep(): Promise<void> {
  await window.api.sweep.stop()
  sweepRunning.value = false
}

async function onSourceChange(): Promise<void> {
  chartRef.value?.clear()
  if (sourceMode.value) {
    await startSweep()
  } else {
    await stopSweep()
    regenerate()
  }
}

onMounted(async () => {
  if (sourceMode.value) await startSweep()
  else regenerate()
  disposeSweep = window.api.sweep.onFrame(onSweepFrame)
})
onUnmounted(() => {
  disposeSweep?.()
  disposeSweep = null
  void window.api.sweep.stop()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
    <NCard size="small" title="Smith 圆图">
      <template #header-extra>
        <div style="display: flex; gap: 8px">
          <NTag size="small" type="info">{{ points }} 点</NTag>
          <NTag size="small">最大 VSWR {{ vswr.toFixed(2) }}</NTag>
          <NTag v-if="sourceMode" size="small" :type="sweepRunning ? 'success' : 'default'">
            {{ sweepRunning ? '扫频中' : '扫频停止' }}
          </NTag>
        </div>
      </template>
      <div class="sm-controls">
        <label>
          数据源
          <NSelect
            v-model:value="dataSource"
            size="small"
            :options="[
              { label: '仿真轨迹', value: 'sim' },
              { label: 'S11 扫频', value: 'sweep' }
            ]"
            style="width: 130px"
            @update:value="onSourceChange"
          />
        </label>
        <template v-if="sourceMode">
          <label>
            R {{ rOhm.toFixed(0) }} Ω
            <NSlider v-model:value="rOhm" :min="5" :max="100" :step="1" style="width: 110px" />
          </label>
          <label>
            L {{ lNano.toFixed(0) }} nH
            <NSlider v-model:value="lNano" :min="10" :max="500" :step="5" style="width: 110px" />
          </label>
          <label>
            C {{ cPico.toFixed(1) }} pF
            <NSlider v-model:value="cPico" :min="1" :max="20" :step="0.5" style="width: 110px" />
          </label>
          <label>
            延时 {{ calDelayPs.toFixed(0) }} ps
            <NSlider
              v-model:value="calDelayPs"
              :min="-500"
              :max="500"
              :step="10"
              style="width: 110px"
            />
          </label>
          <label>
            补偿 {{ calLossDb.toFixed(1) }} dB
            <NSlider
              v-model:value="calLossDb"
              :min="-10"
              :max="10"
              :step="0.5"
              style="width: 110px"
            />
          </label>
          <NButton size="small" :disabled="sweepRunning" @click="startSweep">启动扫频</NButton>
          <NButton size="small" :disabled="!sweepRunning" @click="stopSweep">停止</NButton>
        </template>
        <NButton v-else size="small" @click="regenerate">重新生成</NButton>
        <NButton size="small" @click="chartRef?.clear()">清空</NButton>
      </div>
      <div v-if="sourceMode" class="source-hint">
        串联 RLC 负载的 S11 扫频（1–500 MHz，401 点）；R/L/C/校准改变后点“启动扫频”应用。
      </div>
      <SmithChart ref="chartRef" :height="520" :z0="50" theme="spectrum" />
      <div class="sm-hint">
        纯显示复反射系数轨迹；网格为等电阻圆/等电抗圆。移动鼠标查看 Γ、VSWR、回波损耗和阻抗。
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.sm-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.sm-controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #666;
  font-size: 13px;
}
.sm-hint {
  margin-top: 8px;
  color: #888;
  font-size: 12px;
}
.source-hint {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(79, 195, 247, 0.08);
  color: #4fc3f7;
  font-size: 12px;
}
</style>
