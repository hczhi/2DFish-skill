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
      · <b>kind=image</b>：生图模型（地基已就位，extra_json 里填 <code>{"protocol":"dashscope"}</code> 之类，具体适配器接入后即可用）。<br />
      同一 tier 有多条时取最近更新的启用项；某档没配则回落到 default 档；一条都没配则回落到下方旧配置。
    </p>

    <div class="config-card">
      <table class="prov-table" v-if="providers.length">
        <thead>
          <tr><th>类型</th><th>档位</th><th>名称</th><th>模型</th><th>Base URL</th><th>Key</th><th>启用</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in providers" :key="p.id">
            <td>{{ p.kind }}</td>
            <td>{{ p.kind === 'llm' ? p.tier : '—' }}</td>
            <td>{{ p.label }}</td>
            <td class="mono">{{ p.model }}</td>
            <td class="mono ellip">{{ p.base_url }}</td>
            <td class="mono">{{ p.api_key || '（未设）' }}</td>
            <td>{{ p.enabled ? '✓' : '✕' }}</td>
            <td class="row-actions">
              <button class="link-btn" @click="editProvider(p)">编辑</button>
              <button class="link-btn danger" @click="removeProvider(p.id)">删除</button>
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
          <label>名称
            <input v-model="editing.label" class="input" placeholder="如：强模型 qwen-plus" />
          </label>
          <label>模型
            <input v-model="editing.model" class="input" placeholder="qwen-plus" />
          </label>
          <label class="wide">Base URL
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
        <label>API Base URL</label>
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
}
const providers = ref<Provider[]>([])

function emptyEditor() {
  return { id: '', kind: 'llm', tier: 'default', label: '', base_url: '', api_key: '', model: '', extra_json: '', enabled: true }
}
const editing = ref(emptyEditor())

async function loadConfig() {
  const data = await apiGet('/api/admin/config')
  current.value = data.config || {}
}

async function loadProviders() {
  const data = await apiGet('/api/admin/providers')
  providers.value = data.providers || []
}

function editProvider(p: Provider) {
  // api_key 是脱敏值，不回填到输入框（留空 = 不修改）
  editing.value = { id: p.id, kind: p.kind, tier: p.tier, label: p.label, base_url: p.base_url, api_key: '', model: p.model, extra_json: p.extra_json === '{}' ? '' : p.extra_json, enabled: !!p.enabled }
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
.row-actions { display: flex; gap: 10px; white-space: nowrap; }
.link-btn { border: none; background: none; color: #3B5BDB; cursor: pointer; font-size: 13px; padding: 0; }
.link-btn.danger { color: #dc2626; }

.prov-editor { border-top: 1px dashed #e5e7eb; padding-top: 20px; }
.prov-editor h3 { font-size: 15px; margin: 0 0 16px; }
.prov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.prov-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; }
.prov-grid label.wide { grid-column: 1 / -1; }
.prov-grid label.inline { flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }
.prov-grid .sub { font-weight: 400; color: var(--c-text-sub); font-size: 12px; }
.prov-editor-actions { display: flex; gap: 16px; align-items: center; margin-top: 20px; }
</style>
