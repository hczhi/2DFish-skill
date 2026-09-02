<template>
  <div class="page">
    <div class="page-header">
      <h1>系统配置</h1>
    </div>
    <p class="desc">配置平台级 AI 模型。文本模型按「任务档位」分：强模型跑结构化/吐 JSON 的硬任务，快模型走量成文，默认档兜底其余。使用平台模型的用户受每日额度限制，配置了自己 Key 的用户不受限。</p>

    <h2 class="section-title">AI 模型 Provider</h2>
    <p class="desc">
      每条 provider 是一个模型接入点。<br />
      · <b>kind=llm</b>：文本模型，按 <b>tier</b> 分 default/strong/fast，代码里的任务已归好档（如小红书搭结构/校验走 strong，成文走 fast）。<br />
      · <b>kind=image</b>：生图模型。协议默认按 Base URL 猜（OpenAI 兼容 <code>/images/generations</code>，
      阿里百炼原生走异步任务制），要指定就在 extra_json 里填 <code>{"protocol":"openai"}</code> 或
      <code>{"protocol":"dashscope"}</code>。<b>配好后点「测试」会真生成一张图并显示出来</b> ——
      注意必须是<b>生图</b>模型（如 doubao-seedream / qwen-image），视频模型（doubao-seedance）接口也返回
      200，但拿回来的是视频。<br />
      同一 tier 有多条时取最近更新的启用项；某档没配则回落到 default 档；一条都没配则回落到下方旧配置。<br />
      · 这里只列<b>平台级</b>接入点。要给某个用户配独立接口，去「用户管理 → 专属 AI」——
      那里配的接入点只属于该用户，不会出现在本列表。<br />
      · <b>应用</b>留空 = 全站通用。指定某个应用后，该应用优先用这条；<b>只对填了的应用生效，
      其他应用捡不走</b>。某应用没配到的档位，先回落到该应用自己的 default，再回落通用配置。
    </p>

    <div class="config-card">
      <table class="prov-table" v-if="providers.length">
        <thead>
          <tr><th>类型</th><th>档位</th><th>应用</th><th>名称</th><th>模型</th><th>Base URL</th><th>Key</th><th>启用</th><th>思考</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in providers" :key="p.id">
            <td>{{ p.kind }}</td>
            <td>{{ p.kind === 'llm' ? p.tier : '—' }}</td>
            <td>
              <span v-if="p.scope_app" class="scope-tag">{{ appLabel(p.scope_app) }}</span>
              <span v-else class="hint">通用</span>
            </td>
            <td>{{ p.label }}</td>
            <td class="mono">{{ p.model }}</td>
            <td class="mono ellip">{{ p.base_url }}</td>
            <td class="mono">{{ p.api_key || '（未设）' }}</td>
            <td>{{ p.enabled ? '✓' : '✕' }}</td>
            <!-- 这一列必须在列表上看得见：开关只在编辑弹层里的话，
                 「这条为什么答得这么浅」得逐条点开才看得出来。 -->
            <td>{{ p.kind !== 'llm' ? '—' : p.no_thinking ? '已关闭' : '开' }}</td>
            <td class="row-actions">
              <button class="link-btn" @click="editProvider(p)">编辑</button>
              <button class="link-btn" @click="testProvider(p)" :disabled="testingId === p.id">
                {{ testingId === p.id ? `测试中… ${testElapsed}s` : '测试' }}
              </button>
              <button class="link-btn danger" @click="removeProvider(p.id)">删除</button>
              <!-- 生图慢（30~120 秒很常见），必须有个跳动的秒数 + 说清在等什么：
                   一个不动的「测试中…」和「请求早断了」在屏幕上是同一个样子。 -->
              <p v-if="testingId === p.id" class="test-result">
                正在真的生成一张图，通常 30~120 秒；超过 {{ Math.round(IMG_TEST_CAP_MS / 1000) }} 秒会中止并报出来。
              </p>
              <p v-if="testResults[p.id]" class="test-result" :class="testResults[p.id].ok ? 'ok' : 'err'">
                {{ testResults[p.id].msg }}
              </p>
              <!-- 生图测试的结果图。加载失败也要出声：URL 返回了但图打不开
                   （落在本机磁盘却换了机器、上游给的是限时链接）在文字上和成功一样。 -->
              <a v-if="testResults[p.id]?.img" class="test-img" :href="testResults[p.id].img" target="_blank">
                <img :src="testResults[p.id].img" alt="生图结果" @error="onTestImgError(p.id)" />
              </a>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">还没有 provider，点下方「新增」添加第一个文本模型。</p>

      <div class="prov-editor">
        <h3>{{ editing.id ? '编辑 Provider' : '新增 Provider' }}</h3>
        <div class="prov-grid">
          <label>类型
            <select v-model="editing.kind" class="input">
              <option value="llm">llm 文本模型</option>
              <option value="image">image 生图</option>
            </select>
          </label>
          <label v-if="editing.kind === 'llm'">档位
            <select v-model="editing.tier" class="input">
              <option value="default">default 默认</option>
              <option value="strong">strong 强模型</option>
              <option value="fast">fast 快模型</option>
            </select>
          </label>
          <label v-if="editing.kind === 'llm'">应用<span class="sub">（留空=通用）</span>
            <!-- 选项来自服务端 apps，不在前端硬编码：scope_app 是靠字符串等于
                 gateway 的 source 来匹配的，手写一个 'ui_review' 会「保存成功但永不生效」。 -->
            <select v-model="editing.scope_app" class="input">
              <option value="">全站通用</option>
              <option v-for="a in apps" :key="a.id" :value="a.id">{{ a.name }}（{{ a.id }}）</option>
            </select>
          </label>
          <label>名称
            <input v-model="editing.label" class="input" placeholder="如：强模型 qwen-plus" />
          </label>
          <label>模型
            <input v-model="editing.model" class="input" placeholder="qwen-plus" />
          </label>
          <label class="wide">Base URL<span class="sub">（只填到 /v1，末尾的 /chat/completions 由程序自己拼）</span>
            <input v-model="editing.base_url" class="input" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </label>
          <label class="wide">API Key<span class="sub"> {{ editing.id ? '（留空表示不修改）' : '' }}</span>
            <input v-model="editing.api_key" type="password" class="input" placeholder="sk-..." />
          </label>
          <label class="wide">extra_json<span class="sub">（可选，生图/特殊参数）</span>
            <input v-model="editing.extra_json" class="input" placeholder='{"protocol":"dashscope"}' />
          </label>
          <label class="inline">
            <input type="checkbox" v-model="editing.enabled" /> 启用
          </label>
          <!-- 勾选框而不是往 extra_json 里填一个键：那是自由文本框，拼错一个字母
               完全静默（保存成功、界面和生效了一模一样，而每次调用照旧慢十倍）。 -->
          <label class="inline" v-if="editing.kind === 'llm'">
            <input type="checkbox" v-model="editing.no_thinking" /> 不使用深度思考
          </label>
          <p class="hint wide" v-if="editing.kind === 'llm'">
            勾上 = 走这条接入点的<b>所有</b>模块都不带思维链（快十倍，而且 max_tokens 全给正文，
            不再莫名截断）。代价是靠长链推理的任务结论会变浅，<b>而它不报错</b>。
            标讯（提取/评分/AI 提炼）和咨询（对话/草稿）已在代码里写死关掉，不受这个开关影响 ——
            这里只能强制关，开不回来。模型或接入点不支持时服务端日志会喊一句。
          </p>
        </div>
        <div class="prov-editor-actions">
          <button class="btn-primary" @click="saveProvider">{{ editing.id ? '保存修改' : '新增' }}</button>
          <button v-if="editing.id" class="link-btn" @click="resetEditor">取消编辑</button>
        </div>
      </div>
    </div>

    <h2 class="section-title">旧版模型配置（兼容）</h2>
    <p class="desc">迁移前的裸配置，仍作为最终回落。建议改用上方 Provider 列表；这三项可留空不用。</p>

    <div class="config-card">
      <div class="form-group">
        <label>Platform API Key</label>
        <div class="input-row">
          <input v-model="form.platform_api_key" type="password" placeholder="sk-..." class="input" />
          <button class="btn-primary" @click="save('platform_api_key', form.platform_api_key)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_api_key">当前: {{ current.platform_api_key.value }}</span>
      </div>

      <div class="form-group">
        <label>API Base URL<span class="sub">（只填到 /v1）</span></label>
        <div class="input-row">
          <input v-model="form.platform_api_base_url" placeholder="https://api.openai.com/v1" class="input" />
          <button class="btn-primary" @click="save('platform_api_base_url', form.platform_api_base_url)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_api_base_url">当前: {{ current.platform_api_base_url.value }}</span>
      </div>

      <div class="form-group">
        <label>默认模型</label>
        <div class="input-row">
          <input v-model="form.platform_model" placeholder="gpt-4o" class="input" />
          <button class="btn-primary" @click="save('platform_model', form.platform_model)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_model">当前: {{ current.platform_model.value }}</span>
      </div>
    </div>

    <h2 class="section-title">联网搜索（陪写联网补料）</h2>
    <p class="desc">配置 Tavily 搜索 Key，开启后小红书陪写台会出现「联网补料」步骤：AI 联网查回带来源的外部资料供作者勾选采纳。未配置则该功能自动隐藏。Key 申请：tavily.com</p>

    <div class="config-card">
      <div class="form-group">
        <label>Tavily API Key</label>
        <div class="input-row">
          <input v-model="form.web_search_api_key" type="password" placeholder="tvly-..." class="input" />
          <button class="btn-primary" @click="save('web_search_api_key', form.web_search_api_key)">保存</button>
        </div>
        <span class="hint" v-if="current.web_search_api_key">当前: {{ current.web_search_api_key.value }}</span>
      </div>
    </div>

    <h2 class="section-title">腾讯云 COS 对象存储</h2>
    <p class="desc">配置腾讯云 COS，用于后台图片上传。存储桶需开启公有读权限。</p>

    <div class="config-card">
      <div class="form-group">
        <label>SecretId</label>
        <div class="input-row">
          <input v-model="form.cos_secret_id" type="password" placeholder="AKIDxxxxxxxx" class="input" />
          <button class="btn-primary" @click="save('cos_secret_id', form.cos_secret_id)">保存</button>
        </div>
        <span class="hint" v-if="current.cos_secret_id">当前: {{ current.cos_secret_id.value }}</span>
      </div>

      <div class="form-group">
        <label>SecretKey</label>
        <div class="input-row">
          <input v-model="form.cos_secret_key" type="password" placeholder="xxxxxxxx" class="input" />
          <button class="btn-primary" @click="save('cos_secret_key', form.cos_secret_key)">保存</button>
        </div>
        <span class="hint" v-if="current.cos_secret_key">当前: {{ current.cos_secret_key.value }}</span>
      </div>

      <div class="form-group">
        <label>Bucket</label>
        <div class="input-row">
          <input v-model="form.cos_bucket" placeholder="qiaonan-1318719556" class="input" />
          <button class="btn-primary" @click="save('cos_bucket', form.cos_bucket)">保存</button>
        </div>
        <span class="hint" v-if="current.cos_bucket">当前: {{ current.cos_bucket.value }}</span>
      </div>

      <div class="form-group">
        <label>Region</label>
        <div class="input-row">
          <input v-model="form.cos_region" placeholder="ap-guangzhou" class="input" />
          <button class="btn-primary" @click="save('cos_region', form.cos_region)">保存</button>
        </div>
        <span class="hint" v-if="current.cos_region">当前: {{ current.cos_region.value }}</span>
      </div>
    </div>

    <p class="success" v-if="saved">已保存</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

const form = ref<Record<string, string>>({ platform_api_key: '', platform_api_base_url: '', platform_model: '', web_search_api_key: '', cos_secret_id: '', cos_secret_key: '', cos_bucket: '', cos_region: '' })
const current = ref<Record<string, { value: string; updated_at: string }>>({})
const saved = ref(false)

interface Provider {
  id: string; kind: string; tier: string; label: string;
  base_url: string; api_key: string; model: string; extra_json: string; enabled: number;
  no_thinking: number;
  scope_app: string;
}
const providers = ref<Provider[]>([])
const apps = ref<Array<{ id: string; name: string }>>([])
const appLabel = (id: string) => apps.value.find(a => a.id === id)?.name || id
const testingId = ref('')
const testResults = ref<Record<string, { ok: boolean; msg: string; img?: string }>>({})

// 前端这道闸比服务端那 180 秒略宽：服务端超时会回一句说得清成因的错误，
// 走到前端这条才是「连服务端都没回话」（反代掐了 / 服务重启了），得分开说。
const IMG_TEST_CAP_MS = 180_000
const testElapsed = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | undefined

async function testProvider(p: Provider) {
  testingId.value = p.id
  delete testResults.value[p.id]
  testElapsed.value = 0
  clearInterval(elapsedTimer)
  elapsedTimer = setInterval(() => { testElapsed.value += 1 }, 1000)
  try {
    const r = await apiPost<{
      duration_ms: number; model: string;
      image_url?: string; protocol?: string; protocol_inferred?: boolean;
      storage?: string; storage_hint?: string; url_warning?: string;
    }>(`/api/admin/providers/${p.id}/test`, {})
    let msg = `连通 ✓ ${r.model} · ${r.duration_ms}ms`
    if (r.protocol) msg += ` · 协议 ${r.protocol}${r.protocol_inferred ? '（按 Base URL 猜的，extra_json 里没写 protocol）' : ''}`
    if (r.storage) msg += ` · 存储 ${r.storage === 'cos' ? 'COS' : '本机磁盘'}`
    if (r.storage_hint) msg += `\n${r.storage_hint}`
    if (r.url_warning) msg += `\n⚠ ${r.url_warning}`
    // 生图必须把那张图显示出来：只显示「连通 ✓」的话，回了个 mp4、回了张
    // 纯黑图、回错了模型这几种在文字上都长得一样。
    testResults.value[p.id] = { ok: true, msg, img: r.image_url }
  } catch (e: any) {
    testResults.value[p.id] = { ok: false, msg: `${e.message || '测试失败'}（等了 ${testElapsed.value}s）` }
  }
  clearInterval(elapsedTimer)
  testingId.value = ''
}

function onTestImgError(id: string) {
  const r = testResults.value[id]
  if (!r) return
  testResults.value[id] = { ok: false, msg: `生成成功但图片打不开（${r.img}）—— 检查 COS 是否公有读，或本机 data/uploads 是否可访问。` }
}

function emptyEditor() {
  return { id: '', kind: 'llm', tier: 'default', label: '', base_url: '', api_key: '', model: '', extra_json: '', enabled: true, no_thinking: false, scope_app: '' }
}
const editing = ref(emptyEditor())

async function loadConfig() {
  const data = await apiGet('/api/admin/config')
  current.value = data.config || {}
}

async function loadProviders() {
  const data = await apiGet('/api/admin/providers')
  providers.value = data.providers || []
  apps.value = data.apps || []
}

function editProvider(p: Provider) {
  // api_key 是脱敏值，不回填到输入框（留空 = 不修改）
  // scope_app 必须回填：漏了它，随手改个名就把「xhs 专用」变成全站通用。
  editing.value = { id: p.id, kind: p.kind, tier: p.tier, label: p.label, base_url: p.base_url, api_key: '', model: p.model, extra_json: p.extra_json === '{}' ? '' : p.extra_json, enabled: !!p.enabled, no_thinking: !!p.no_thinking, scope_app: p.scope_app || '' }
}

function resetEditor() { editing.value = emptyEditor() }

async function saveProvider() {
  const e = editing.value
  await apiPost('/api/admin/providers', {
    id: e.id || undefined,
    kind: e.kind,
    tier: e.tier,
    label: e.label.trim(),
    base_url: e.base_url.trim(),
    api_key: e.api_key,               // 空串 = 不改
    model: e.model.trim(),
    extra_json: e.extra_json.trim() || '{}',
    enabled: e.enabled,
    no_thinking: e.no_thinking,
    // image 类型没有应用维度，别把上一次选的 app 带过去
    scope_app: e.kind === 'llm' ? e.scope_app : '',
  })
  saved.value = true
  setTimeout(() => saved.value = false, 2000)
  resetEditor()
  await loadProviders()
}

async function removeProvider(id: string) {
  if (!confirm('删除这个 provider？')) return
  await apiDelete(`/api/admin/providers/${id}`)
  await loadProviders()
}

async function save(key: string, value: string) {
  if (!value.trim()) return
  await apiPost('/api/admin/config', { key, value: value.trim() })
  saved.value = true
  setTimeout(() => saved.value = false, 2000)
  await loadConfig()
  form.value[key] = ''
}

onMounted(() => { loadConfig(); loadProviders() })
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.page { max-width: 800px; }
.desc { 
  color: var(--c-text-sub); 
  font-family: var(--font-mono);
  font-size: 13px; 
  margin-bottom: 32px; 
  line-height: 1.6;
  border-left: 4px solid var(--c-blue-primary);
  padding-left: 16px;
}
.config-card { 
  background: #fff; 
  padding: 32px; 
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05); 
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04); 
}
.form-group { margin-bottom: 32px; }
.form-group:last-child { margin-bottom: 0; }

.input-row { display: flex; gap: 16px; }
.input { 
  flex: 1; 
  padding: 12px 16px; 
  border: 1px solid #e5e7eb; 
  border-radius: 10px; 
  font-size: 14px; 
  font-family: var(--font-sans, sans-serif); 
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  background: #f9fafb;
}
.input:focus {
  outline: none;
  background: #ffffff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}

.hint { 
  font-size: 12px; 
  color: var(--c-text-sub); 
  margin-top: 8px; 
  display: block; 
  font-family: var(--font-sans, sans-serif); 
}

.section-title {
  font-size: 20px;
  font-weight: 700;
  margin: 48px 0 12px;
}

.success {
  color: #10b981;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: bold;
  margin-top: 24px;
  text-transform: uppercase;
}

/* Provider 列表 */
.prov-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
.prov-table th, .prov-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef0f3; }
.prov-table th { color: var(--c-text-sub); font-weight: 600; font-size: 12px; }
.prov-table .mono { font-family: var(--font-mono); font-size: 12px; }
.prov-table .ellip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope-tag { display: inline-block; padding: 1px 6px; border: 1px solid #3B5BDB; color: #3B5BDB; border-radius: 3px; font-size: 11px; white-space: nowrap; }
.row-actions { display: flex; gap: 10px; white-space: nowrap; flex-wrap: wrap; }
.link-btn { border: none; background: none; color: #3B5BDB; cursor: pointer; font-size: 13px; padding: 0; }
.link-btn.danger { color: #dc2626; }
.link-btn:disabled { opacity: .5; cursor: not-allowed; }
.test-result { flex-basis: 100%; font-size: 11px; margin: 2px 0 0; white-space: pre-line; line-height: 1.4; }
.test-img { flex-basis: 100%; display: block; margin-top: 6px; }
.test-img img { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
.test-result.ok { color: #16a34a; }
.test-result.err { color: #dc2626; }

.prov-editor { border-top: 1px dashed #e5e7eb; padding-top: 20px; }
.prov-editor h3 { font-size: 15px; margin: 0 0 16px; }
.prov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.prov-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; }
.prov-grid label.wide { grid-column: 1 / -1; }
.prov-grid label.inline { flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }
.prov-grid .sub { font-weight: 400; color: var(--c-text-sub); font-size: 12px; }
.prov-editor-actions { display: flex; gap: 16px; align-items: center; margin-top: 20px; }
</style>
