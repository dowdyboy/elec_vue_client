<script setup lang="ts">
import { ref, watch } from 'vue'
import { NCard, NSelect, NButton, NEmpty, useMessage } from 'naive-ui'
import IqChart from '@components/signal/IqChart.vue'
import { iqAdapters } from '@components/signal/core/adapters'
import type { Theme } from '@components/signal/core/types'
import { useSignalAnalysis } from '@renderer/composables/useSignalAnalysis'

const message = useMessage()
const iqRef = ref<InstanceType<typeof IqChart> | null>(null)
const adapterKey = ref<'passthrough' | 'jsonInterleaved'>('passthrough')
const themeKey = ref<Theme>('spectrum')
const hasData = ref(false)

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
        <NButton size="small" @click="onBackToLatest">回到最新</NButton>
        <NButton size="small" @click="onClear">清空</NButton>
        <span v-if="!hasData && !sig.remoteError.value" style="color: #18a058; font-size: 12px"
          >等待服务端（请至“Mock 配置”页启动）…</span
        >
        <span v-else-if="sig.remoteError.value" style="color: #d03050; font-size: 12px"
          >远程错误: {{ sig.remoteError.value }}</span
        >
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #888">
        交互：滚轮缩放时间轴（光标锚点）· Shift+滚轮缩放幅值 · 拖拽平移 · 悬停十字光标读数 ·
        双击或点角标恢复跟随
      </div>
      <div style="margin-top: 4px; font-size: 12px; color: #888">
        时域图直接绘制服务端下发的原始 IQ；数据经 <code>adapter</code>（{{
          adapterKey
        }}）自转后进入组件。外观由「主题」预置驱动，亦可用
        <code>style</code> 属性做字段级覆盖（迹线/背景/网格/刻度带等）。
      </div>
    </NCard>
    <NCard content-style="padding: 0">
      <div style="position: relative; height: 420px">
        <IqChart ref="iqRef" :theme="themeKey" :adapter="getAdapter() as never" :height="420" />
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
