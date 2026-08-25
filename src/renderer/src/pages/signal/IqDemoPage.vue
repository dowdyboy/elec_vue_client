<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NCard,
  NSelect,
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NCheckbox,
  NSlider,
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

watch(adapterKey, (v) => {
  iqRef.value?.clear()
  hasData.value = false
  message.info(`已切换适配器: ${v}，已清空历史`)
})
</script>

<template>
  <div style="padding: 16px">
    <NCard title="〰️ IQ 时域（可复制组件演示）" style="margin-bottom: 16px">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center">
        <span>主题</span>
        <NSelect
          v-model:value="themeKey"
          :options="[
            { label: 'spectrum（频谱仪黑底黄迹）', value: 'spectrum' },
            { label: 'dark', value: 'dark' },
            { label: 'light', value: 'light' },
            { label: 'auto（跟随系统）', value: 'auto' }
          ]"
          style="width: 240px"
        />
        <span>适配器</span>
        <NSelect
          v-model:value="adapterKey"
          :options="[
            { label: 'passthrough (Float32Array)', value: 'passthrough' },
            { label: 'jsonInterleaved ({i,q})', value: 'jsonInterleaved' }
          ]"
          style="width: 200px"
        />
        <span>采样率 (Hz)</span>
        <NInputNumber
          v-model:value="sampleRate"
          :min="1"
          :step="4096"
          :show-button="false"
          style="width: 130px"
        />
        <span>窗宽 (样本)</span>
        <NInputNumber
          v-model:value="spanSamples"
          :min="16"
          :step="4096"
          :show-button="false"
          style="width: 130px"
        />
        <NCheckbox v-model:checked="envelopeOn">幅度包络</NCheckbox>
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
        <NInput :value="exportDir" readonly placeholder="默认下载目录" style="width: 220px" />
        <NButton size="small" @click="onPickExportDir">选择…</NButton>
        <NButton size="small" @click="onBackToLatest">回到最新</NButton>
        <NButton size="small" @click="onExportPNG">截图 PNG</NButton>
        <NButton size="small" @click="onExportCSV">导出 CSV</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
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
        双击暂停⇆恢复（恢复清除标记）· 悬停十字光标读数 · 点击图例切换迹线
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
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <IqChart
          ref="iqRef"
          v-model:span="spanSamples"
          :theme="themeKey"
          :adapter="getAdapter() as never"
          :sample-rate="sampleRate"
          :envelope="envelopeOn"
          :persistence="persistenceVal"
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
