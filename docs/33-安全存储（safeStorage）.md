# 33 - 加密存储（safeStorage）

> 对应源码：`src/main/features/safeStorage.ts` | 演示页：加密存储

## 一、敏感数据该放哪里

密码、API 令牌、私钥、Cookie 等敏感数据的存储错误示范：

| 做法 | 问题 |
|------|------|
| 明文写 JSON/数据库 | 任何人/任何进程可读 |
| 代码里硬编码密钥再"加密" | 密钥随代码分发，等于没加密 |
| 自定义"异或/凯撒加密" | 自制密码学，安全为零 |

**正确姿势**：把加密交给操作系统密钥体系——`safeStorage`：

| 平台 | 后端 | 说明 |
|------|------|------|
| Windows | DPAPI（CryptProtectData） | 绑定当前用户账户 |
| macOS | Keychain | 系统钥匙串 |
| Linux | kwallet / gnome-libsecret | 依赖桌面环境，**必须先检测可用性** |

## 二、基本用法

```ts
import { safeStorage } from 'electron'

// ① 能力检测（Linux 无 keyring 时抛错，必须前置检查）
if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持')

// ② 加密：明文 → Buffer（可转 base64 落盘）
const cipher = safeStorage.encryptString('sk-1234567890')
fs.writeFileSync(join(app.getPath('userData'), 'secret.bin'), cipher)

// ③ 解密：Buffer → 明文
const plain = safeStorage.decryptString(fs.readFileSync(secretPath))
```

**核心特性**：密文与**当前用户/机器**绑定——把密文拷到另一台机器或另一个用户登录，
`decryptString` 会抛错。这正是"记住密码/指纹解锁"功能的实现原理：
应用不存密码明文，只存"只有本机本用户能解开的密文"。

## 三、与 electron-store / 数据库配合

safeStorage 只负责加解密，**持久化仍要自己做**。两种常见组合：

```ts
// 方案 A：electron-store 存配置（值加密后写入）
const store = new Store()
store.set('apiToken', safeStorage.encryptString(token).toString('base64'))
const token = safeStorage.decryptString(Buffer.from(store.get('apiToken'), 'base64'))

// 方案 B：SQLite 存敏感列（本工程 sqlite.ts 的 notes 表加一列 secret）
db.prepare('INSERT INTO secrets (name, cipher) VALUES (?, ?)')
  .run('apiToken', safeStorage.encryptString(token).toString('base64'))
```

## 四、复制到新工程的步骤

1. 复制 `src/main/features/safeStorage.ts`，`index.ts` 中调用 `registerSafeStorage()`
2. 渲染进程调用 `window.api.safeStorage.*`（加密往返）
3. 落盘部分按需写自己的文件/数据库逻辑

## 五、注意事项

- **不要在主进程内存中长期保留明文**：用完即弃（GC 也无法保证立刻清除，但比落盘明文好得多）
- Linux 用户可能没装 keyring → `isEncryptionAvailable()` 返回 false 时给出明确提示（引导安装 gnome-keyring）
- 跨平台同步（如网盘同步 userData）：密文在新机器解不开属正常现象，需要"重输密码 + 重新加密"的降级流程
- 需要"应用级主密码"（不依赖 OS 账户）时改用 `keytar` 或自实现加盐 PBKDF2——但那属于应用层方案，safeStorage 是 OS 层方案
