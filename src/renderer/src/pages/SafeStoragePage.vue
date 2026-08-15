<script setup lang="ts">
/**
 * 加密存储演示页
 * 演示：safeStorage 加密往返（OS 级密钥保护敏感数据）
 */
import { onMounted, ref } from 'vue'
import { NCard, NButton, NInput, NSpace, NAlert, NText, useMessage } from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import safeStorageCode from '../../../main/features/safeStorage.ts?raw'

const message = useMessage()

const available = ref<boolean | null>(null)
const backend = ref('')
const platform = ref('')

const plainText = ref('超级秘密的 API Token: sk-1234567890')
const cipherText = ref('')
const decrypted = ref('')

onMounted(async () => {
  const info = await window.api.safeStorage.isAvailable()
  available.value = info.available
  backend.value = info.backend
  platform.value = info.platform
})

async function encrypt(): Promise<void> {
  if (!plainText.value.trim()) {
    message.warning('请输入要加密的明文')
    return
  }
  try {
    cipherText.value = await window.api.safeStorage.encrypt(plainText.value)
    decrypted.value = ''
    message.success('加密成功（密文可安全落盘）')
  } catch (error) {
    message.error((error as Error).message)
  }
}

async function decrypt(): Promise<void> {
  if (!cipherText.value.trim()) {
    message.warning('请先加密（或粘贴一段密文）')
    return
  }
  try {
    decrypted.value = await window.api.safeStorage.decrypt(cipherText.value)
    message.success('解密成功')
  } catch {
    message.error('解密失败：密文与当前用户/设备不匹配，或已被篡改')
  }
}
</script>

<template>
  <FeatureLayout
    title="加密存储（safeStorage）"
    api="safeStorage.encryptString / decryptString"
    intro="保存密码、API 令牌、私钥等敏感数据的正确姿势：交给操作系统加密。Windows 用 DPAPI（绑定当前用户），macOS 用 Keychain，Linux 用 kwallet/gnome-libsecret。加密结果与用户身份绑定——换用户、换机器都无法解密，比把密钥硬编码在代码里安全得多。注意：safeStorage 只负责加密/解密，密文的持久化仍需自己写文件（见 docs/33）。"
  >
    <n-card size="small" title="当前系统加密能力" style="margin-bottom: 12px">
      <n-alert
        :type="available ? 'success' : 'warning'"
        :show-icon="true"
        size="small"
        style="margin-bottom: 8px"
      >
        <template v-if="available === null">检测中…</template>
        <template v-else-if="available">
          可用 ✅ 平台: {{ platform }} · 后端: {{ backend }}
        </template>
        <template v-else
          >不可用 ❌（Linux 未安装 keyring 服务，如 gnome-keyring / kwallet）</template
        >
      </n-alert>
      <n-text depth="3" style="font-size: 12px">
        isEncryptionAvailable 是必须的前置检查：Linux 桌面环境缺少 keyring 时 API 会抛错。
      </n-text>
    </n-card>

    <n-card size="small" title="加密 / 解密往返">
      <n-input
        v-model:value="plainText"
        placeholder="输入要加密的敏感信息"
        style="margin-bottom: 8px"
      />
      <n-space>
        <n-button type="primary" :disabled="available === false" @click="encrypt">加密</n-button>
        <n-button :disabled="available === false" @click="decrypt">解密</n-button>
      </n-space>
      <n-input
        v-model:value="cipherText"
        type="textarea"
        :rows="3"
        placeholder="密文（base64）"
        style="margin-top: 8px"
      />
      <n-text v-if="decrypted" depth="2" style="display: block; margin-top: 8px; font-size: 13px">
        解密结果: <b>{{ decrypted }}</b>
      </n-text>
      <n-alert type="info" size="small" :show-icon="true" style="margin-top: 8px">
        教学要点：密文可以放心写入文件/数据库（配合 electron-store 或 sqlite.ts）；
        解密只在你登录的这台机器上可行——这正是指纹解锁类应用"记住密码"功能的实现原理。
      </n-alert>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/safeStorage.ts" :code="safeStorageCode" />
    </template>
  </FeatureLayout>
</template>
