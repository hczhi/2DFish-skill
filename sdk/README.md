# 标讯智能推荐 SDK

供第三方**纯前端**项目嵌入标讯智能推荐。第三方无需后端。

## 工作原理

```
平台管理员在后台「标讯管理 → SDK 接入」签发 pk（绑定账号 + 域名白名单）
        ↓
第三方页面引入本 SDK，配置 pk
        ↓
SDK 用 pk 向平台换取 15 分钟只读短 token（平台校验 pk + 请求来源域名）
        ↓
SDK 用短 token 拉取推荐，到期前自动续期
```

- **pk 是公开的**，可以直接写在前端代码里。安全靠「绑定账号 + 域名白名单 + 只读 scope」，不靠保密。
- 一个 pk = 平台一个账号 = 一份推荐，第三方整站看到同一份。
- 短 token 只能读推荐（`tender:read`），碰不到写操作、别的用户或管理接口。

## 安装

### 方式一：ESM 模块引入

在支持 ES 模块的项目里，直接从平台地址 import（无需 npm install）：

```js
import { createTenderSDK } from 'https://your-platform-host/sdk/tender-sdk.js'

const sdk = createTenderSDK({
  pk: 'pk_live_xxxxxxxx',
  baseUrl: 'https://your-platform-host',
})

// 拿数据自己渲染
const { items } = await sdk.getRecommendations({ tier: 'priority' })

// 或直接挂载现成 UI
await sdk.mountWidget('#tender-box', { title: '为你推荐的标讯' })
```

### 方式二：`<script>` 直接引入

```html
<div id="tender-box"></div>
<script src="https://your-platform-host/sdk/tender-sdk.umd.cjs"></script>
<script>
  const sdk = TenderSDK.createTenderSDK({
    pk: 'pk_live_xxxxxxxx',
    baseUrl: 'https://your-platform-host',
  })
  sdk.mountWidget('#tender-box', { title: '为你推荐的标讯' })
</script>
```

## API

### `createTenderSDK({ pk, baseUrl, refreshSkewMs? })`

创建实例。`refreshSkewMs` 为 token 提前续期的毫秒数，默认 60000。

### `sdk.getRecommendations({ tier?, page?, pageSize? })`

返回 `{ items, total, page, page_size }`。`tier`：`all` | `priority` | `consider` | `watch`。

### `sdk.getDetail(id)`

返回单条标讯详情。

### `sdk.list({ search?, platform?, keyword?, page?, pageSize? })`

浏览全部标讯。

### `sdk.mountWidget(target, { tier?, pageSize?, title? })`

把现成的推荐列表 UI 挂载到 `target`（选择器字符串或 DOM 元素）。

## 常见问题

- **403 Origin not allowed**：当前页面域名不在该 pk 的白名单里，联系平台管理员添加。
- **401 Invalid or disabled key**：pk 无效或已被禁用。
- **429 Too many token requests**：换取 token 太频繁，SDK 已自动缓存 token，正常不会触发。
