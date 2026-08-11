# 23 - 网络会话（Cookie 与请求拦截）

> 对应源码：`src/main/features/cookies.ts` + `src/main/features/webRequest.ts` | 演示页：会话管理

## 一、Cookie 管理（session.cookies）

**用途**：登录态管理——免登录（同步网页端 Cookie）、排查、登出清理。

```ts
const cookies = await session.defaultSession.cookies.get({}) // 读取全部
await session.defaultSession.cookies.set({ url: 'https://example.com', name: 'token', value: 'xxx' })
await session.defaultSession.cookies.remove('https://example.com', 'token')
```

注意：`cookies.set` 的 url **必须带协议**（`https://`）；`expirationDate` 为 null 表示会话级 Cookie。

## 二、请求拦截（session.webRequest）

**用途**：注入请求头（token/UA）、广告拦截（cancel）、抓包日志。

```ts
session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
  details.requestHeaders['X-Token'] = 'xxx'
  // ⚠️ 必须调用 callback，否则请求永久挂起！（经典 bug）
  callback({ requestHeaders: details.requestHeaders })
})
```

常用拦截点：
| 事件 | 时机 | 用途 |
|------|------|------|
| `onBeforeRequest` | 请求发出前 | 广告拦截（cancel）、重定向 |
| `onBeforeSendHeaders` | 发送请求头前 | 注入/修改请求头 |
| `onHeadersReceived` | 收到响应头时 | 修改响应头 |
| `onCompleted` | 请求完成 | 日志统计 |

**注意**：拦截的是 **Chromium 网络栈**（渲染进程 fetch、下载、页面资源）；主进程的 axios 请求不走此栈，拦截不到。

## 三、复制到新工程的步骤

1. 复制 `cookies.ts` + `webRequest.ts`，`index.ts` 中调用 `registerCookies()` + `registerWebRequest(getMainWindow)`
2. 渲染进程：

```ts
const cookies = await window.api.session.getAllCookies()
await window.api.session.setCookie({ url, name, value })
window.api.session.onRequestLog((log) => console.log(log))
```

## 四、会话分区（`src/main/features/partition.ts`：无痕模式 / 多账号）

`webPreferences.partition` 让窗口使用独立会话（Cookie/存储互不干扰）：

```ts
// 无痕：内存会话，关窗即销毁
new BrowserWindow({ webPreferences: { partition: `incognito-${Date.now()}`, ... } })
// 持久分区：数据落盘 userData/Partitions/work（多账号隔离）
new BrowserWindow({ webPreferences: { partition: 'persist:work', ... } })
```

渲染进程：`window.api.partition.openIncognito()` / `openPersistent()`
验证：主会话写入 Cookie → 无痕窗口查询不到（存储隔离）。

> 注意：分区会话是**完全独立的 session**——本页的 Cookie 操作、webRequest 拦截、
> 代理/UA 设置都只作用于 defaultSession（主会话），分区窗口的请求不受影响。这是分区隔离的特性。

## 五、会话缓存清理与代理/UA

- 缓存清理：`session.clearCache()` / `clearStorageData()`（sessionCleanup.ts，登出清理）
- 代理：`session.setProxy`（fixed_servers/direct/system）+ `resolveProxy` 调试
- UA：`session.setUserAgent`
- 详见 docs/28-会话配置与证书.md
