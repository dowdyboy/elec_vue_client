<script setup lang="ts">
/**
 * 串口通信演示页（Web Serial）
 * 演示：主进程放行权限 + 应用内弹窗选择端口 → navigator.serial 打开并读写
 * 无真实串口设备时，可观察"设备权限申请 → 端口选择弹窗"的完整链路
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NSpace,
  NAlert,
  NText,
  NModal,
  NList,
  NListItem,
  NTag,
  useMessage
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import serialPortCode from '../../../main/features/serialPort.ts?raw'

const message = useMessage()

/** 与主进程 serialPort.ts 推送的端口结构一致 */
interface SerialPortInfo {
  portId: string
  portName: string
  displayName: string
  vendorId: string
  productId: string
}

const supported = typeof navigator !== 'undefined' && 'serial' in navigator

const showPicker = ref(false)
const portList = ref<SerialPortInfo[]>([])
/** 本次端口选择的 token（与主进程 pendingSelects 关联，见 serialPort.ts） */
const pickToken = ref('')
const grantedPorts = ref<string[]>([])
const connecting = ref(false)

let currentPort: SerialPort | null = null
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
let disposePorts: (() => void) | null = null

const connectedName = ref('')
const received = ref('')
const sendText = ref('Hello from Electron!')

onMounted(() => {
  if (!supported) return
  // 主进程 select-serial-port 事件 → 推送 { token, ports } → 弹窗选择
  disposePorts = window.api.serial.onPorts((payload) => {
    pickToken.value = payload.token
    portList.value = payload.ports
    showPicker.value = true
  })
  refreshGranted()
})

onUnmounted(async () => {
  disposePorts?.() // 移除端口事件监听
  if (showPicker.value) cancelPick() // 弹窗未关时通知主进程取消（防 requestPort 挂起）
  await disconnect()
})

/** 列出已授权（可重复使用，无需再次弹窗）的端口 */
async function refreshGranted(): Promise<void> {
  if (!supported) return
  const ports = await navigator.serial.getPorts()
  grantedPorts.value = ports.map(
    (p) => p.getInfo().usbProductId?.toString(16) ?? p.getInfo().usbVendorId?.toString(16) ?? '未知'
  )
}

/** ① 申请端口：主进程拦截 select-serial-port → 应用内弹窗 → 回传选择 */
async function requestPort(): Promise<void> {
  if (!supported) return
  connecting.value = true
  try {
    const port = await navigator.serial.requestPort()
    await port.open({ baudRate: 115200 })
    currentPort = port
    connectedName.value = `已连接（productId: ${port.getInfo().usbProductId?.toString(16) ?? '?'}）`
    startReadLoop()
    refreshGranted()
    message.success('串口已打开（波特率 115200）')
  } catch {
    // 用户取消或选择失败（callback('') 会以 NotFoundError 拒绝）
    message.info('未选择端口（已取消）')
  } finally {
    connecting.value = false
  }
}

/** 持续读取：port.readable 是流，循环 read() 直至断开 */
async function startReadLoop(): Promise<void> {
  const port = currentPort
  if (!port) return
  const streamReader = port.readable.getReader()
  reader = streamReader
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { value, done } = await streamReader.read()
      if (done) break
      received.value += decoder.decode(value, { stream: true })
    }
  } catch {
    // 端口被拔出/关闭时 read 抛错，忽略
  }
}

/** 发送一行文本（串口设备常约定换行符为行结束标志） */
async function sendLine(): Promise<void> {
  if (!currentPort?.writable) {
    message.warning('请先连接串口')
    return
  }
  const writer = currentPort.writable.getWriter()
  await writer.write(new TextEncoder().encode(sendText.value + '\n'))
  writer.releaseLock()
  received.value += `[发送] ${sendText.value}\n`
}

async function disconnect(): Promise<void> {
  try {
    await reader?.cancel()
  } catch {
    /* 忽略 */
  }
  reader = null
  try {
    await currentPort?.close()
  } catch {
    /* 忽略 */
  }
  currentPort = null
  connectedName.value = ''
}

function pick(portId: string): void {
  showPicker.value = false
  // 按 token 回传给主进程的 callback，requestPort 的 Promise 随之 resolve
  window.api.serial.selectPort(pickToken.value, portId)
}

function cancelPick(): void {
  showPicker.value = false
  if (pickToken.value) window.api.serial.cancel(pickToken.value)
}

// ── 无设备自检（无需真实串口即可验证链路，详见 docs/30 第六节）──
const selfTestItems = ref<{ name: string; result: string }[]>([])
const selfTesting = ref(false)

async function runSelfTest(): Promise<void> {
  selfTestItems.value = []
  selfTesting.value = true
  try {
    // ① API 可用性
    selfTestItems.value.push({
      name: 'Web Serial API 可用性',
      result: supported
        ? '✅ navigator.serial 存在'
        : '❌ 当前环境不支持（换 Electron/新版 Chromium）'
    })

    // ② 已授权端口数（首次应为 0；选过设备后 >0 说明会话级授权持久化正常）
    if (supported) {
      const ports = await navigator.serial.getPorts()
      selfTestItems.value.push({
        name: 'getPorts() 已授权端口',
        result: `${ports.length} 个（首次自检应为 0）`
      })
    }

    // ③ 请求→取消链路：requestPort 后 1.5s 自动取消
    // 无设备：主进程直接 callback('') → NotFoundError（预期）
    // 有设备：弹窗出现 → 自动取消 → NotFoundError（预期）
    // 1.5s 内手动选中设备：成功打开 → 立即关闭并报告"授权链路完整可用"
    if (supported) {
      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        const port = await Promise.race([
          navigator.serial.requestPort(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              if (showPicker.value) cancelPick() // 有端口弹窗时主动取消
              reject(Object.assign(new Error('SELF_TEST_TIMEOUT'), { name: 'TimeoutError' }))
            }, 1500)
          })
        ])
        if (timer) clearTimeout(timer)
        // 1.5s 内手动选中了真实设备：打开后立即关闭（自检不干扰正常使用）
        await port.open({ baudRate: 115200 })
        await port.close()
        selfTestItems.value.push({
          name: '请求→授权链路（含读写打开）',
          result: '✅ 有真实设备且授权/打开/关闭全链路成功'
        })
      } catch (error) {
        if (timer) clearTimeout(timer)
        const err = error as Error
        if (err.name === 'NotFoundError') {
          // 无端口（主进程 callback('')）或弹窗被取消——预期拒绝
          selfTestItems.value.push({
            name: '请求→取消链路（主进程 handler + token 回传）',
            result:
              '✅ NotFoundError 预期拒绝：devicePermissionHandler 放行 + select-serial-port 拦截 + token 链路贯通'
          })
        } else if (err.name === 'TimeoutError') {
          selfTestItems.value.push({
            name: '请求→取消链路',
            result: '⚠️ 请求超时未返回（主进程 callback 可能未调用，检查 serialPort.ts）'
          })
        } else {
          selfTestItems.value.push({
            name: '请求→取消链路',
            result: `⚠️ 异常类型 ${err.name}（预期 NotFoundError，详见 docs/30）`
          })
        }
      }
    }
  } finally {
    selfTesting.value = false
  }
}
</script>

<template>
  <FeatureLayout
    title="串口通信（Web Serial）"
    api="session.setDevicePermissionHandler / on('select-serial-port')"
    intro="硬件工具、IoT、固件烧录类应用的标配能力。渲染进程不能直接枚举串口（浏览器安全模型），必须由主进程放行：devicePermissionHandler 决定'页面能否申请'，select-serial-port 事件决定'用户选哪个端口'。本页把 Chromium 默认的设备选择器换成应用内弹窗——这也是 Arduino IDE / 打印机配置工具的常见做法。"
  >
    <n-card size="small" title="连接与读写">
      <n-alert
        :type="supported ? 'info' : 'warning'"
        size="small"
        :show-icon="true"
        style="margin-bottom: 8px"
      >
        <template v-if="!supported">当前环境不支持 Web Serial API</template>
        <template v-else>
          无真实串口设备时：点下方"无设备自检"卡片一键验证主进程链路；
          手动点"选择串口"看到"未选择端口（已取消）"也说明取消链路正常。
        </template>
      </n-alert>
      <n-space>
        <n-button type="primary" :disabled="!supported" :loading="connecting" @click="requestPort">
          选择串口（requestPort）
        </n-button>
        <n-button :disabled="!currentPort" @click="disconnect">断开</n-button>
      </n-space>
      <n-text
        v-if="connectedName"
        depth="2"
        style="display: block; margin-top: 8px; font-size: 13px"
      >
        {{ connectedName }}
      </n-text>
      <n-text
        v-if="grantedPorts.length"
        depth="3"
        style="display: block; margin-top: 4px; font-size: 12px"
      >
        已授权端口: {{ grantedPorts.join(', ') }}（getPorts 可复用，无需再次授权）
      </n-text>

      <n-space style="margin-top: 12px">
        <n-input v-model:value="sendText" placeholder="发送内容" style="width: 260px" />
        <n-button :disabled="!currentPort" @click="sendLine">发送一行</n-button>
      </n-space>
      <n-input
        v-model:value="received"
        type="textarea"
        :rows="4"
        placeholder="接收区（发送与收到的数据都会显示在这里）"
        style="margin-top: 8px"
      />
    </n-card>

    <n-card
      size="small"
      title="无设备自检（无需真实串口，验证主进程链路）"
      style="margin-top: 12px"
    >
      <n-space>
        <n-button type="primary" :disabled="!supported" :loading="selfTesting" @click="runSelfTest">
          运行自检
        </n-button>
        <n-text depth="3" style="font-size: 12px">
          自检覆盖：API 可用性 → getPorts 授权状态 → requestPort 请求→取消链路（1.5s 自动取消，
          期间可手动选设备验证授权全链路）。完整验证方法（虚拟串口对/硬件回环）见 docs/30 第六节。
        </n-text>
      </n-space>
      <div v-if="selfTestItems.length" style="margin-top: 8px; font-size: 13px">
        <div v-for="(item, i) in selfTestItems" :key="i">{{ item.result }} —— {{ item.name }}</div>
      </div>
    </n-card>

    <!-- 端口选择弹窗（替代 Chromium 默认选择器） -->
    <n-modal
      :show="showPicker"
      :mask-closable="false"
      @update:show="(v: boolean) => !v && cancelPick()"
    >
      <n-card style="width: 480px" title="选择串口设备">
        <template v-if="portList.length === 0">
          <n-alert type="warning" size="small">没有可用串口（回调空串口将取消本次请求）</n-alert>
        </template>
        <n-list v-else bordered clickable>
          <n-list-item v-for="port in portList" :key="port.portId" @click="pick(port.portId)">
            <div style="display: flex; justify-content: space-between; align-items: center">
              <div>
                <n-text strong>{{ port.displayName || port.portName }}</n-text>
                <div style="font-size: 12px; color: var(--text-color-3)">
                  vendorId: {{ port.vendorId }} · productId: {{ port.productId }}
                </div>
              </div>
              <n-tag size="small" type="info">{{ port.portName }}</n-tag>
            </div>
          </n-list-item>
        </n-list>
        <template #footer>
          <n-space justify="end">
            <n-button @click="cancelPick">取消</n-button>
          </n-space>
        </template>
      </n-card>
    </n-modal>

    <template #code>
      <CodeBlock file="src/main/features/serialPort.ts" :code="serialPortCode" />
    </template>
  </FeatureLayout>
</template>
