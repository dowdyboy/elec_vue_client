<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  NCard,
  NSelect,
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NCheckbox,
  NSlider,
  NColorPicker,
  useMessage
} from 'naive-ui'
import IqChart from '@components/signal/IqChart.vue'
import { iqAdapters } from '@components/signal/core/adapters'
import type { ExportPayload, Theme } from '@components/signal/core/types'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'

const message = useMessage()
const iqRef = ref<InstanceType<typeof IqChart> | null>(null)
const adapterKey = ref<'passthrough' | 'jsonInterleaved'>('passthrough')
const themeKey = ref<Theme>('spectrum')
const sampleRate = ref(4096)
const spanSamples = ref(4096)
const envelopeOn = ref(false)
const persistenceVal = ref(0)
const exportDir = ref<string>(localStorage.getItem('sig-iq-export-dir') ?? '')
const hasData = ref(false)

// ── 全部对外属性演示 ──
const modeKey = ref<'line' | 'dots'>('line')
const lineWidthVal = ref(1)
const decimationKey = ref<'minmax' | 'none'>('minmax')
const colorsI = ref<string | null>(null) // null=取主题预置
const colorsQ = ref<string | null>(null)
const showAxis = ref(true)
const showXAxis = ref(true)
const showGrid = ref(true)
const showAxisLabels = ref(true)
const styleBg = ref<string | null>(null)
const styleCrosshair = ref<string | null>(null)
const styleGrid = ref<string | null>(null)
const styleBorder = ref<string | null>(null)
const styleText = ref<string | null>(null)

const styleOverrides = computed(() => {
  const s: Record<string, string> = {}
  if (styleBg.value) s.bg = styleBg.value
  if (styleCrosshair.value) s.crosshair = styleCrosshair.value
  if (styleGrid.value) s.grid = styleGrid.value
  if (styleBorder.value) s.border = styleBorder.value
  if (styleText.value) s.text = styleText.value
  return s
})
const triggerEnabled = ref(false)
const triggerSource = ref<'i' | 'q'>('i')
const triggerEdge = ref<'rising' | 'falling'>('rising')
const triggerLevel = ref(0)
const triggerMode = ref<'auto' | 'normal' | 'single'>('auto')
const triggerPre = ref(0.25)
const triggerConfig = computed(() => ({
  enabled: triggerEnabled.value,
  source: triggerSource.value,
  edge: triggerEdge.value,
  level: triggerLevel.value,
  mode: triggerMode.value,
  preTrigger: triggerPre.value
}))
function onArmTrigger(): void {
  ;(iqRef.value as unknown as { armTrigger?: () => void } | null)?.armTrigger?.()
  message.success('已重新武装（single 模式）')
}
const colorsPair = computed<[string, string] | undefined>(() => {
  const i = colorsI.value
  const q = colorsQ.value
  if (!i && !q) return undefined
  return [(i ?? undefined) as string, (q ?? undefined) as string]
})
const decimationVal = computed<'minmax' | false>(() =>
  decimationKey.value === 'none' ? false : 'minmax'
)

// ── 方法演示 ──
const vpMin = ref(0)
const vpMax = ref(2000)
function onSetViewport(): void {
  iqRef.value?.setViewport({ xMin: vpMin.value, xMax: vpMax.value, autoScale: true })
  message.info(`已设置视口 [${vpMin.value}, ${vpMax.value}]（冻结）`)
}
function onGetView(): void {
  message.info(`视口：${JSON.stringify(iqRef.value?.getView())}`)
}
function onGetLength(): void {
  message.info(`缓冲长度：${iqRef.value?.getLength()} 样本`)
}
function onResetStyle(): void {
  styleBg.value = null
  styleCrosshair.value = null
  styleGrid.value = null
  styleBorder.value = null
  styleText.value = null
  colorsI.value = null
  colorsQ.value = null
  message.success('已清除自定义颜色，恢复主题预置')
}

watch(exportDir, (v) => {
  if (v) localStorage.setItem('sig-iq-export-dir', v)
  else localStorage.removeItem('sig-iq-export-dir')
})

async function onPickExportDir(): Promise<void> {
  const dir = (await window.api.dialog.openDirectory('选择导出目录')) as string | null
  if (dir) exportDir.value = dir
}

/** 组件导出交付：配置了目录则写入自定义位置；未配置时自行执行浏览器下载回退（组件传入 handler 后不再内置下载） */
async function handleExport(p: ExportPayload): Promise<void> {
  if (!exportDir.value) {
    const a = document.createElement('a')
    if (p.kind === 'png' && p.dataUrl) {
      a.href = p.dataUrl
    } else {
      const blob = new Blob([p.text ?? ''], { type: 'text/csv;charset=utf-8' })
      a.href = URL.createObjectURL(blob)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    a.download = p.filename
    a.click()
    return
  }
  const full = (await window.api.fs.joinPath(exportDir.value, p.filename)) as string
  if (p.kind === 'png' && p.dataUrl) {
    await window.api.fs.writeFileBase64(full, p.dataUrl.split(',')[1] ?? '')
  } else if (p.kind === 'csv' && p.text !== undefined) {
    await window.api.fs.writeFile(full, p.text)
  }
  message.success(`已保存：${full}`)
}

function onExported(p: { kind: 'png' | 'csv'; filename: string }): void {
  // 未配置目录时组件走浏览器下载，在此给出反馈；配置了目录的反馈由 handleExport 负责
  if (!exportDir.value) message.success(`已导出：${p.filename}`)
}

function getAdapter(): (raw: unknown) => unknown {
  if (adapterKey.value === 'jsonInterleaved')
    return iqAdapters.jsonInterleaved as unknown as (raw: unknown) => unknown
  return iqAdapters.passthrough as unknown as (raw: unknown) => unknown
}

const sig = useSignalAnalysis({ autoSubscribe: true })

sig.onIq((iq) => {
  // 演示 adapter：若选 jsonInterleaved，则先转 {i,q} 再喂入，验证前端自转
  if (adapterKey.value === 'jsonInterleaved') {
    // Float32Array 版去交织：避免每帧 number[] 分配带来的 GC 压力
    const pairs = Math.floor(iq.length / 2)
    const i = new Float32Array(pairs)
    const q = new Float32Array(pairs)
    for (let k = 0; k < pairs; k++) {
      i[k] = iq[2 * k]
      q[k] = iq[2 * k + 1]
    }
    iqRef.value?.appendData({ i, q })
  } else {
    iqRef.value?.appendData(iq)
  }
  hasData.value = true
})

function onClear(): void {
  iqRef.value?.clear()
  hasData.value = false
  message.success('已清空')
}

function onBackToLatest(): void {
  iqRef.value?.zoomReset()
}

function onExportPNG(): void {
  iqRef.value?.exportPNG()
}

function onExportCSV(): void {
  iqRef.value?.exportCSV()
}

/** 停止推流（不切页）：组件保持挂载，约 3 秒后可观察「数据流中断」角标 */
async function onStopStream(): Promise<void> {
  try {
    await window.api.signalAnalysis.stop()
    await window.api.remoteMock.stop()
    message.success('已停止推流（组件保持挂载，可观察中断角标）')
  } catch (e) {
    message.error(`停止失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

watch(adapterKey, (v) => {
  iqRef.value?.clear()
  hasData.value = false
  message.info(`已切换适配器: ${v}，已清空历史`)
})
</script>

<template>
  <div style="padding: 16px">
    <NCard title="〰️ IQ 时域（可复制组件演示）" style="margin-bottom: 16px" size="small">
      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px">
        <span>主题</span>
        <NSelect
          v-model:value="themeKey"
          size="small"
          :options="[
            { label: 'spectrum（频谱仪黑底黄迹）', value: 'spectrum' },
            { label: 'dark', value: 'dark' },
            { label: 'light', value: 'light' },
            { label: 'auto（跟随系统）', value: 'auto' }
          ]"
          style="width: 210px"
        />
        <span>适配器</span>
        <NSelect
          v-model:value="adapterKey"
          size="small"
          :options="[
            { label: 'passthrough', value: 'passthrough' },
            { label: 'jsonInterleaved', value: 'jsonInterleaved' }
          ]"
          style="width: 140px"
        />
        <span>采样率</span>
        <NInputNumber
          v-model:value="sampleRate"
          size="small"
          :min="1"
          :step="4096"
          :show-button="false"
          style="width: 96px"
        />
        <span>窗宽</span>
        <NInputNumber
          v-model:value="spanSamples"
          size="small"
          :min="16"
          :step="4096"
          :show-button="false"
          style="width: 96px"
        />
        <NCheckbox v-model:checked="envelopeOn" size="small">包络</NCheckbox>
        <span>余辉</span>
        <NSlider
          v-model:value="persistenceVal"
          :min="0"
          :max="0.95"
          :step="0.05"
          :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
          style="width: 120px"
        />
        <span>导出目录</span>
        <NInput
          :value="exportDir"
          readonly
          placeholder="默认下载目录"
          size="small"
          style="width: 180px"
        />
        <NButton size="tiny" @click="onPickExportDir">选择…</NButton>
        <NButton size="tiny" @click="onBackToLatest">回到最新</NButton>
        <NButton size="tiny" @click="onExportPNG">截图 PNG</NButton>
        <NButton size="tiny" @click="onExportCSV">导出 CSV</NButton>
        <NButton size="tiny" @click="onStopStream">停止推流</NButton>
        <NButton size="tiny" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待服务端（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        交互：滚轮缩放（光标锚点）· Shift+滚轮缩放幅值 · 暂停后拖拽平移 / Shift+框选放大 /
        窗口自动测量 · Alt+点击添加标记（点标记即清除）/ 右键菜单批量管理 ·
        双击暂停⇆恢复（恢复清除标记）· 悬停十字光标读数 · 点击图例切换迹线 · 暂停态方向键平移 ±缩放
        · Z/Shift+Z 撤销重做缩放
      </div>
      <div style="margin-top: 4px; font-size: 12px; color: #888">
        时域图直接绘制服务端下发的原始 IQ；数据经 <code>adapter</code>（{{
          adapterKey
        }}）自转后进入组件。外观由「主题」预置驱动，亦可用 <code>style</code> 属性做字段级覆盖。
      </div>
      <div style="margin-top: 4px; font-size: 12px; color: #888">
        采样率 (Hz) 仅用于「样本 ↔ 时间」换算（时间 = 索引 ÷ 采样率），不影响数据内容； Mock 默认
        4096，即满窗 4096 样本恰好为 1 秒。真实使用时应与采集硬件的实际采样率一致。
      </div>
    </NCard>
    <NCard title="🧰 属性与方法（全部对外接口）" style="margin-bottom: 16px" size="small">
      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px">
        <span>模式</span>
        <NSelect
          v-model:value="modeKey"
          size="small"
          :options="[
            { label: 'line', value: 'line' },
            { label: 'dots', value: 'dots' }
          ]"
          style="width: 90px"
        />
        <span>线宽</span>
        <NInputNumber
          v-model:value="lineWidthVal"
          size="small"
          :min="1"
          :max="8"
          :show-button="false"
          style="width: 64px"
        />
        <span>抽稀</span>
        <NSelect
          v-model:value="decimationKey"
          size="small"
          :options="[
            { label: 'minmax', value: 'minmax' },
            { label: 'off', value: 'none' }
          ]"
          style="width: 96px"
        />
        <NCheckbox v-model:checked="showAxis" size="small">轴</NCheckbox>
        <NCheckbox v-model:checked="showXAxis" size="small">X</NCheckbox>
        <NCheckbox v-model:checked="showGrid" size="small">网格</NCheckbox>
        <NCheckbox v-model:checked="showAxisLabels" size="small">标题</NCheckbox>
      </div>
      <div
        style="
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 8px;
          font-size: 12px;
        "
      >
        <span>颜色</span>
        <span class="cp" title="I 迹线"
          ><span class="cp-i">I</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="colorsI" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="Q 迹线"
          ><span class="cp-i">Q</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="colorsQ" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="背景色"
          ><span class="cp-i">底</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="styleBg" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="网格线"
          ><span class="cp-i">网</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="styleGrid" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="轴线/边框"
          ><span class="cp-i">轴</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="styleBorder" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="刻度/读数文字"
          ><span class="cp-i">文</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="styleText" size="small" :show-alpha="false" /></span
        ></span>
        <span class="cp" title="光标/标记线"
          ><span class="cp-i">光</span
          ><span class="cp-p"
            ><NColorPicker v-model:value="styleCrosshair" size="small" :show-alpha="false" /></span
        ></span>
        <NButton size="tiny" @click="onResetStyle">重置颜色</NButton>
      </div>
      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 8px;
          font-size: 12px;
        "
      >
        <span>视口</span>
        <NInputNumber v-model:value="vpMin" size="small" :show-button="false" style="width: 84px" />
        <span>~</span>
        <NInputNumber v-model:value="vpMax" size="small" :show-button="false" style="width: 84px" />
        <NButton size="tiny" @click="onSetViewport">setViewport</NButton>
        <NButton size="tiny" @click="onGetView">getView</NButton>
        <NButton size="tiny" @click="onGetLength">getLength</NButton>
      </div>
      <div
        style="
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 8px;
          font-size: 12px;
        "
      >
        <NCheckbox v-model:checked="triggerEnabled" size="small">触发</NCheckbox>
        <span>源</span>
        <NSelect
          v-model:value="triggerSource"
          size="small"
          :options="[
            { label: 'I', value: 'i' },
            { label: 'Q', value: 'q' }
          ]"
          style="width: 56px"
        />
        <span>边沿</span>
        <NSelect
          v-model:value="triggerEdge"
          size="small"
          :options="[
            { label: '↑ 上升', value: 'rising' },
            { label: '↓ 下降', value: 'falling' }
          ]"
          style="width: 84px"
        />
        <span>电平</span>
        <NInputNumber
          v-model:value="triggerLevel"
          size="small"
          :step="0.1"
          :show-button="false"
          style="width: 72px"
        />
        <span>模式</span>
        <NSelect
          v-model:value="triggerMode"
          size="small"
          :options="[
            { label: 'auto', value: 'auto' },
            { label: 'normal', value: 'normal' },
            { label: 'single', value: 'single' }
          ]"
          style="width: 84px"
        />
        <span>屏位</span>
        <NSlider
          v-model:value="triggerPre"
          size="small"
          :min="0"
          :max="1"
          :step="0.05"
          style="width: 90px"
        />
        <NButton size="tiny" @click="onArmTrigger">arm</NButton>
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <IqChart
          ref="iqRef"
          v-model:span="spanSamples"
          :theme="themeKey"
          :adapter="getAdapter() as never"
          :sample-rate="sampleRate"
          :mode="modeKey"
          :line-width="lineWidthVal"
          :decimation="decimationVal"
          :colors="colorsPair"
          :axis="showAxis"
          :x-axis="showXAxis"
          :grid="showGrid"
          :axis-labels="showAxisLabels"
          :envelope="envelopeOn"
          :persistence="persistenceVal"
          :trigger="triggerConfig"
          :style="styleOverrides"
          :export-handler="handleExport"
          :height="420"
          @exported="onExported"
          @error="(m: string) => message.error(m)"
        />
        <NEmpty
          v-if="!hasData"
          description="暂无数据，请至“Mock 配置”页启动服务…"
          style="
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-items: center;
            justify-content: center;
            background: color-mix(in srgb, var(--n-color) 92%, transparent);
            margin: 0;
          "
        />
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.cp {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.cp-i {
  font-size: 12px;
  color: #888;
  min-width: 12px;
  text-align: center;
}
.cp-p {
  display: inline-block;
  width: 30px;
}
/* 隐藏取色器触发内的颜色文本（rgb(...)），仅显示色块 */
.cp-p :deep(.n-color-picker__value) {
  display: none;
}
</style>
