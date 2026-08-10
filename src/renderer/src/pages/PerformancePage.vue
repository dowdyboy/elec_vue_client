<script setup lang="ts">
/**
 * 计算性能与进程模型演示页
 * 演示：主进程阻塞 vs utilityProcess 子进程 vs Web Worker + 进程资源面板
 * 教学点：主进程单线程 —— CPU 密集任务阻塞所有窗口的 IPC；
 *         正确做法是把计算放到独立进程/线程。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInputNumber,
  NAlert,
  useMessage,
  NText,
  NDataTable,
  NProgress,
  NTag,
  type DataTableColumns
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import perfCode from '../../../main/features/utilityProcess.ts?raw'

const message = useMessage()

// 计算参数：Fibonacci 指数级递归，40 约耗时 1~2 秒（可调大体验更明显，勿超过 45）
const fibN = ref(40)

// ── ① 主进程同步计算（阻塞演示）──
const syncResult = ref('')
const syncRunning = ref(false)

async function runSync(): Promise<void> {
  syncRunning.value = true
  syncResult.value = '主进程计算中...（此时尝试点击页面其他按钮，全部无响应）'
  const { value, elapsedMs } = await window.api.perf.fibSync(fibN.value)
  syncRunning.value = false
  syncResult.value = `✅ 结果: ${value}（耗时 ${elapsedMs}ms）`
  message.success('计算完成（期间主进程被阻塞）')
}

// ── ② utilityProcess 子进程计算 ──
const procResult = ref('')
const procRunning = ref(false)
const procProgress = ref(0)

let disposePerf: (() => void) | null = null
onMounted(() => {
  disposePerf = window.api.perf.onEvent((raw) => {
    const data = raw as { type: string; value?: number; elapsedMs?: number }
    if (data.type === 'result') {
      procRunning.value = false
      procProgress.value = 100
      procResult.value = `✅ 结果: ${data.value}（耗时 ${data.elapsedMs}ms，UI 全程流畅）`
      message.success('子进程计算完成')
    } else if (data.type === 'terminated') {
      procRunning.value = false
      procResult.value = '⏹ 计算已被终止'
    }
  })
})
onUnmounted(() => disposePerf?.())

async function runInProcess(): Promise<void> {
  const res = await window.api.perf.fibInProcess(fibN.value)
  if (!res.ok) {
    message.warning(res.error ?? '无法启动')
    return
  }
  procRunning.value = true
  procProgress.value = 30
  procResult.value = '子进程计算中...（本页面及主窗口照常响应，可随意点击）'
}

async function terminateProcess(): Promise<void> {
  await window.api.perf.terminate()
  message.info('已终止子进程计算')
}

// ── ③ Web Worker（渲染进程并行）──
const workerResult = ref('')
const workerRunning = ref(false)

function runWebWorker(): void {
  workerRunning.value = true
  workerResult.value = 'Web Worker 计算中...'
  let worker: Worker | null = null
  // 超时兜底：30 秒未返回视为失败（fib(40) 实际约 1-2 秒）
  const timeout = setTimeout(() => {
    worker?.terminate()
    workerRunning.value = false
    workerResult.value = '⏱ 计算超时（30 秒）——Worker 未返回结果'
  }, 30000)

  try {
    // Vite 官方 Worker 写法：自动打包为独立 chunk，dev/prod 均走同源脚本（CSP 'self' 放行）
    worker = new Worker(new URL('../workers/fibWorker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    clearTimeout(timeout)
    workerRunning.value = false
    workerResult.value = `❌ Worker 创建失败: ${error instanceof Error ? error.message : String(error)}`
    return
  }

  // 正常返回
  worker.onmessage = (e: MessageEvent<{ value: number; elapsedMs: number }>) => {
    clearTimeout(timeout)
    workerRunning.value = false
    workerResult.value = `✅ 结果: ${e.data.value}（耗时 ${e.data.elapsedMs}ms，渲染进程自身也不卡）`
    worker?.terminate()
  }

  // 错误可见化：加载失败/脚本异常都会显示在页面上（不再静默卡死）
  worker.onerror = (e: ErrorEvent): void => {
    clearTimeout(timeout)
    workerRunning.value = false
    workerResult.value = `❌ Worker 错误: ${e.message}`
  }
  worker.onmessageerror = (): void => {
    clearTimeout(timeout)
    workerRunning.value = false
    workerResult.value = '❌ Worker 消息反序列化失败'
  }

  worker.postMessage(fibN.value)
}

// ── ④ 进程资源面板 ──
interface MetricRow {
  type: string
  cpu: number
  memoryMB: number
}
const metricRows = ref<MetricRow[]>([])
const lastRefresh = ref('')

const metricColumns: DataTableColumns<MetricRow> = [
  { title: '进程类型', key: 'type', width: 140 },
  { title: 'CPU %', key: 'cpu', width: 90 },
  { title: '内存 (MB)', key: 'memoryMB' }
]

let metricsTimer: ReturnType<typeof setInterval> | null = null
async function refreshMetrics(): Promise<void> {
  const data = await window.api.perf.getMetrics()
  metricRows.value = data.appMetrics
  lastRefresh.value = new Date().toLocaleTimeString()
}

onMounted(() => {
  refreshMetrics()
  // 每 2 秒自动刷新（在运行计算任务时对比最直观）
  metricsTimer = setInterval(refreshMetrics, 2000)
})
onUnmounted(() => {
  if (metricsTimer) clearInterval(metricsTimer)
})
</script>

<template>
  <FeatureLayout
    title="计算性能与进程模型"
    api="utilityProcess / Web Worker / getAppMetrics"
    intro="Electron 进程模型的核心教训：主进程是单线程，CPU 密集任务（压缩/加解密/图像处理/大文件解析）若在主进程执行，会阻塞所有窗口的 IPC 与 UI。本页用 Fibonacci(40)（指数级耗时约 1~2 秒，可调大 n 体验更明显）对比三种方案，并实时展示各进程的 CPU 与内存。"
  >
    <n-card
      size="small"
      title="① 错误示范：主进程同步计算（观察 UI 冻结）"
      style="margin-bottom: 12px"
    >
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <n-input-number v-model:value="fibN" :min="30" :max="45" style="width: 120px" />
        <n-button type="error" :loading="syncRunning" @click="runSync">主进程同步计算</n-button>
        <n-tag size="small" type="error">⚠️ 计算期间整个应用无响应</n-tag>
      </div>
      <n-text style="display: block; margin-top: 8px; font-size: 13px">{{ syncResult }}</n-text>
      <n-alert type="warning" :show-icon="true" size="small" style="margin-top: 8px">
        点击后立刻拖动窗口/点击按钮试试：没有任何响应，直到计算完成 —— 这就是主进程被阻塞。
      </n-alert>
    </n-card>

    <n-card
      size="small"
      title="② 正确示范：utilityProcess 子进程计算（UI 流畅）"
      style="margin-bottom: 12px"
    >
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <n-button type="primary" :disabled="procRunning" @click="runInProcess">子进程计算</n-button>
        <n-button :disabled="!procRunning" @click="terminateProcess">中途终止</n-button>
        <n-tag size="small" type="success">✅ 计算期间应用照常响应</n-tag>
      </div>
      <n-progress
        v-if="procRunning"
        type="line"
        :percentage="procProgress"
        :show-indicator="false"
        style="margin-top: 8px"
      />
      <n-text style="display: block; margin-top: 8px; font-size: 13px">{{ procResult }}</n-text>
      <n-alert type="info" :show-icon="true" size="small" style="margin-top: 8px">
        计算在独立 Node.js 进程中执行（主进程 fork 子进程），主进程通过消息收发结果。 这是 Electron
        官方推荐的计算密集方案，且可随时 kill 子进程。
      </n-alert>
    </n-card>

    <n-card size="small" title="③ Web Worker（渲染进程内部并行）" style="margin-bottom: 12px">
      <n-button type="warning" :disabled="workerRunning" @click="runWebWorker"
        >Web Worker 计算</n-button
      >
      <n-text style="display: block; margin-top: 8px; font-size: 13px">{{ workerResult }}</n-text>
      <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px">
        Worker 是浏览器标准能力：同一渲染进程内的并行线程，不阻塞页面交互，也不经过主进程。
      </n-text>
    </n-card>

    <n-card size="small" title="④ 进程资源面板（app.getAppMetrics，每 2 秒刷新）">
      <n-tag size="small" type="info" round style="margin-bottom: 8px"
        >刷新于 {{ lastRefresh }}</n-tag
      >
      <n-data-table :columns="metricColumns" :data="metricRows" size="small" :bordered="false" />
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        运行②的计算任务时观察：会出现一个 cpu 高企的 utility 进程 —— 那就是计算子进程。
      </n-text>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/utilityProcess.ts" :code="perfCode" />
    </template>
  </FeatureLayout>
</template>
