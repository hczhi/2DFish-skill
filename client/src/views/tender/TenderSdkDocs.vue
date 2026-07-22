<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const route = useRoute()
const router = useRouter()
const locale = computed(() => route.path.startsWith('/en/') ? 'en' : 'zh')
const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)

// 运行时取当前站点地址，示例代码里直接可用。
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-host'

const scriptSnippet = `<div id="tender-box"></div>
<script src="${origin}/sdk/tender-sdk.umd.cjs"><\/script>
<script>
  const sdk = TenderSDK.createTenderSDK({
    pk: 'pk_live_你的密钥',
    baseUrl: '${origin}',
  })
  sdk.mountWidget('#tender-box', { title: '为你推荐的标讯' })
<\/script>`

const esmSnippet = `import { createTenderSDK } from '${origin}/sdk/tender-sdk.js'

const sdk = createTenderSDK({
  pk: 'pk_live_你的密钥',
  baseUrl: '${origin}',
})

// 拿数据自己渲染
const { items } = await sdk.getRecommendations({ tier: 'priority' })

// 或直接挂载现成 UI
await sdk.mountWidget('#tender-box', { title: '为你推荐的标讯' })`

const copied = ref('')
function copy(text: string, key: string) {
  navigator.clipboard?.writeText(text)
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
}

function goBack() {
  router.push(locale.value === 'en' ? '/en/tender' : '/tender')
}
</script>

<template>
  <div>
    <SiteHeader />
    <main class="sdk-docs">
      <div class="docs-container">
        <button class="back-link" @click="goBack">← {{ t('返回标讯推荐', 'Back to Tenders') }}</button>

        <h1>{{ t('标讯智能推荐 · 前端 SDK', 'Tender Recommendation · Frontend SDK') }}</h1>
        <p class="lead">
          {{ t(
            '把标讯智能推荐嵌入到你自己的网站，无需后端。第三方页面引入 SDK 并配置密钥（pk）后，即可展示所绑定账号的标讯推荐。',
            'Embed tender recommendations into your own site — no backend required. Include the SDK and configure your publishable key (pk) to display recommendations for the bound account.'
          ) }}
        </p>

        <!-- 如何拿到 pk -->
        <section class="docs-card">
          <h2>{{ t('第一步：获取密钥（pk）', 'Step 1: Get your key (pk)') }}</h2>
          <p>
            {{ t(
              'pk 由平台管理员在后台签发，并绑定你的账号与允许使用的域名白名单。请联系管理员获取属于你的 pk。',
              'The pk is issued by the platform administrator, bound to your account and an allowed-domain whitelist. Contact the administrator to obtain your pk.'
            ) }}
          </p>
          <ul class="notes">
            <li>{{ t('pk 是公开的，可以直接写在前端代码里，不怕被看到。', 'The pk is public — it can be placed directly in frontend code.') }}</li>
            <li>{{ t('安全靠“绑定账号 + 域名白名单 + 只读权限”，不靠保密。', 'Security comes from account binding + domain whitelist + read-only scope, not secrecy.') }}</li>
            <li>{{ t('务必告知管理员你要嵌入的域名，否则换取 token 会被拒绝。', 'Tell the admin which domains you will embed on, or token exchange will be rejected.') }}</li>
          </ul>
        </section>

        <!-- script 引入 -->
        <section class="docs-card">
          <h2>{{ t('第二步（方式一）：<script> 直接引入', 'Step 2 (Option A): <script> tag') }}</h2>
          <p>{{ t('适合任意静态页面，复制即用：', 'Works on any static page — copy and paste:') }}</p>
          <div class="code-block">
            <button class="copy-btn" @click="copy(scriptSnippet, 'script')">
              {{ copied === 'script' ? t('已复制', 'Copied') : t('复制', 'Copy') }}
            </button>
            <pre><code>{{ scriptSnippet }}</code></pre>
          </div>
        </section>

        <!-- ESM 引入 -->
        <section class="docs-card">
          <h2>{{ t('第二步（方式二）：ESM 模块引入', 'Step 2 (Option B): ESM import') }}</h2>
          <p>{{ t('在支持 ES 模块的项目里，直接从平台地址 import：', 'In any ES-module project, import directly from the platform URL:') }}</p>
          <div class="code-block">
            <button class="copy-btn" @click="copy(esmSnippet, 'esm')">
              {{ copied === 'esm' ? t('已复制', 'Copied') : t('复制', 'Copy') }}
            </button>
            <pre><code>{{ esmSnippet }}</code></pre>
          </div>
        </section>

        <!-- API -->
        <section class="docs-card">
          <h2>{{ t('API 说明', 'API Reference') }}</h2>
          <table class="api-table">
            <thead>
              <tr>
                <th>{{ t('方法', 'Method') }}</th>
                <th>{{ t('说明', 'Description') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>createTenderSDK({ pk, baseUrl, refreshSkewMs? })</code></td>
                <td>{{ t('创建实例。SDK 内部自动换取 15 分钟只读 token 并在到期前静默续期。', 'Create an instance. Automatically exchanges a 15-min read-only token and silently refreshes it.') }}</td>
              </tr>
              <tr>
                <td><code>sdk.getRecommendations({ tier?, page?, pageSize? })</code></td>
                <td>{{ t('获取推荐列表。tier：all / priority / consider / watch。', 'Get recommendations. tier: all / priority / consider / watch.') }}</td>
              </tr>
              <tr>
                <td><code>sdk.getDetail(id)</code></td>
                <td>{{ t('获取单条标讯详情。', 'Get a single tender detail.') }}</td>
              </tr>
              <tr>
                <td><code>sdk.list({ search?, platform?, keyword?, page?, pageSize? })</code></td>
                <td>{{ t('浏览全部标讯。', 'Browse all tenders.') }}</td>
              </tr>
              <tr>
                <td><code>sdk.mountWidget(target, { tier?, pageSize?, title? })</code></td>
                <td>{{ t('把现成的推荐列表 UI 挂载到指定容器（选择器或 DOM 元素）。', 'Mount a ready-made recommendation list UI into a container (selector or DOM element).') }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- FAQ -->
        <section class="docs-card">
          <h2>{{ t('常见问题', 'FAQ') }}</h2>
          <dl class="faq">
            <dt>403 Origin not allowed</dt>
            <dd>{{ t('当前页面域名不在该 pk 的白名单里，联系管理员添加。', 'The current domain is not whitelisted for this pk. Ask the admin to add it.') }}</dd>
            <dt>401 Invalid or disabled key</dt>
            <dd>{{ t('pk 无效或已被禁用。', 'The pk is invalid or has been disabled.') }}</dd>
            <dt>429 Too many token requests</dt>
            <dd>{{ t('换取 token 太频繁；SDK 已自动缓存 token，正常不会触发。', 'Token exchange too frequent; the SDK caches tokens, so this normally won’t occur.') }}</dd>
          </dl>
        </section>
      </div>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.sdk-docs { min-height: 70vh; padding: 32px 16px 64px; background: #f8fafc; }
.docs-container { max-width: 860px; margin: 0 auto; }
.back-link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 16px; }
h1 { font-size: 26px; margin: 0 0 8px; color: #0f172a; }
.lead { color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
.docs-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 22px 24px; margin-bottom: 18px; }
.docs-card h2 { font-size: 17px; margin: 0 0 12px; color: #0f172a; }
.docs-card p { color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
.notes { margin: 0; padding-left: 18px; color: #475569; font-size: 13px; }
.notes li { margin: 5px 0; }
.code-block { position: relative; margin: 10px 0; }
.code-block pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 16px; overflow-x: auto; margin: 0; }
.code-block code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 13px; line-height: 1.6; }
.copy-btn { position: absolute; top: 10px; right: 10px; background: #334155; color: #fff; border: none; border-radius: 5px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.copy-btn:hover { background: #475569; }
.api-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.api-table th, .api-table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
.api-table th { color: #64748b; font-weight: 600; }
.api-table code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; }
.faq dt { font-weight: 600; color: #0f172a; font-size: 13px; margin-top: 10px; }
.faq dd { margin: 4px 0 0; color: #475569; font-size: 13px; }
</style>
