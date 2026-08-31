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

---

# 品牌咨询 嵌入 SDK

同一个包里的第二个产物（`@qiaonan/tender-sdk/consult` / `window.ConsultSDK`），把**品牌咨询
工作台**整套挂进第三方页面。第三方同样无需后端。

## 和标讯 SDK 的区别

标讯那条是**只读取数**，UI 你可以自己画；品牌咨询是一整套带写入的工作台（建项目、补料问卷、
十二步分析、导出方案），所以这里给的是 **iframe 嵌入**：工作台本体是平台自己的页面，
你的页面只负责挂容器和递凭证。

```
平台管理员在后台「咨询接入」签发 pk（绑定账号 + 域名白名单 + 每日 AI 次数 + 项目数上限）
        ↓
你的页面引入 consult-sdk，调 mountConsult({ pk, baseUrl, externalUid, target })
        ↓
SDK 建一个 iframe 指向 <baseUrl>/consult/embed
        ↓
iframe 里的工作台向你的页面要凭证 → SDK 在**你的页面这一侧**用 pk 换 15 分钟短 token 递进去
        ↓
之后工作台自己跑，凭证过期自动再要一次
```

**换 token 只能在你的页面这一侧发**（SDK 已经这么做了）：pk 校验的是请求的 Origin，
让 iframe 自己去换的话那个 Origin 是平台的域名，域名白名单对每个 pk 都成立，等于没配。

## 先看现成的 demo

平台自己就带一个「假的第三方站点」页面，打开就能看到嵌进去的工作台：

```
https://your-platform-host/sdk/consult-demo.html
```

在后台「咨询接入」建一把 key、白名单填上这个页面所在的源，把 pk 粘进页面上的输入框点
「挂载工作台」即可。页面下方会打出 iframe 和宿主之间的消息（要凭证 / 报高度 / 报错），
接入前照着它对一遍最省事。

## 用法

```html
<div id="consult"></div>
<script src="https://your-platform-host/sdk/consult-sdk.umd.cjs"></script>
<script>
  const consult = ConsultSDK.mountConsult({
    pk: 'pk_consult_xxxxxxxx',
    baseUrl: 'https://your-platform-host',
    externalUid: currentUser.id,      // 必填，见下
    target: '#consult',
    onError: (msg) => alert(msg),     // 强烈建议接上
  })
  // 换页时： consult.destroy()
</script>
```

ESM：

```js
import { mountConsult } from 'https://your-platform-host/sdk/consult-sdk.js'
```

## `mountConsult(options)`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `pk` | ✅ | `pk_consult_` 开头的 publishable key，公开值 |
| `baseUrl` | ✅ | 平台地址，如 `https://your-platform-host` |
| `externalUid` | ✅ | 你这边终端用户的稳定 id（项目归属键） |
| `target` | ✅ | 容器选择器或 DOM 元素 |
| `path` | | 打开哪一页，默认 `/consult/projects`（项目列表） |
| `height` | | iframe 初始高度 px，默认 900；之后按内容自动调整 |
| `autoHeight` | | 传 `false` 关掉自动调高（自己给容器定高时用） |
| `onError` | | 失败回调。不接的话失败只写控制台，而页面上是一块空白 iframe |

返回 `{ iframe, destroy() }`。

## ⚠️ `externalUid` 是展示隔离，不是安全边界

它决定「这些项目属于你哪个终端用户」，**必填**（不填的话你所有用户共用一个工作台，
A 客户的品牌资料会出现在 B 客户的项目列表里，而那个列表读起来完全正常）。

但它是从你的前端传出去的：纯前端方案下，你的用户改一下就能读到同一把 key 下**别人**的项目和
客户原始资料。所以：

- **别用它装真客户的敏感品牌资料。**
- 要真隔离，你得出一个最小后端，由后端拿 pk 换 token 并签死这个值。

## 额度与上限

所有 AI 调用都记在 pk 绑定的那个平台账号上，另外每把 key 有自己的天花板：

- **每日 AI 次数**（缺省 50）：超了那几个会调 AI 的按钮返回 429，错误里带 `已用完：N/M 次`，
  服务器时间 0 点重置。
- **项目数上限**（缺省 200）：超了新建项目返回 429。

两个数字都由平台管理员按 key 调整。被挡住时工作台里会显示带具体数字的那句话 —— 看到它就是
该联系管理员调额度，不是重试。

## 常见问题

- **iframe 一片白，控制台里有 CSP `frame-ancestors` 警告**：你的域名不在这把 pk 的白名单里。
  平台只允许启用中的 key 所配的域名嵌入。
- **工作台里显示「没有拿到访问凭证」**：后面那半句就是真实成因（域名白名单 / key 已停用 /
  换取太频繁）。
- **工作台里显示「接口已关闭，请联系管理员」**：这把 key 被停用或删掉了。
