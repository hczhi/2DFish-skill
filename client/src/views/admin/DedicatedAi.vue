<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>专属 AI 渠道</h1>
        <p class="page-sub" v-if="user">用户 <b>{{ user.username }}</b></p>
      </div>
      <button class="btn-secondary" @click="back">&larr; 返回用户管理</button>
    </div>

    <p class="error" v-if="loadError">{{ loadError }}</p>

    <template v-if="user">
      <p class="ded-intro">
        为该用户配置独立的模型接入点。开关打开后，他的<b>所有</b> AI 调用只走这里的配置，
        不再使用平台模型、也不受平台每日额度限制。
        <br />
        文本模型必须配齐 <b>default / strong / fast</b> 三档：<code>strong</code> 跑吐 JSON 的结构化任务
        （小红书搭结构 / 校验 / 诊断、标讯画像），<code>fast</code> 走量成文，<code>default</code> 兜底其余
        （对话 / 顾问 / UI 评测 / 摸鱼）。缺档不会回落平台，会直接报错。
      </p>

      <div class="ded-status" :class="broken ? 'danger' : (dedStatus?.ready ? 'ok' : 'warn')">
        <div>
          <b>{{ dedStatus?.ready ? '配置已齐全' : '配置不完整' }}</b>
          <span v-if="dedStatus?.missingTiers?.length"> — 缺少档位：{{ dedStatus.missingTiers.join(' / ') }}</span>
          <span v-if="dedStatus?.ready && !dedStatus?.hasImage" class="ded-sub">
            （未配生图；生图适配器尚未实现，不影响文本功能）
          </span>
          <!-- 后端只在「开启时」卡完备性，删/停用接入点不会自动关开关。
               所以删掉最后一条 strong 之后，开关还开着而该用户一调 strong 就 503。
               这行是唯一会告诉管理员的地方。 -->
          <p class="broken-warn" v-if="broken">
            开关仍是开启状态，但缺档不会回落平台 —— 该用户现在调用这些档位会直接报错。
            请补齐上面缺的档位，或关掉开关让他改用平台模型。
          </p>
        </div>
        <label class="ded-switch" :class="{ disabled: !dedStatus?.ready && !dedStatus?.enabled }">
          <input
            type="checkbox"
            :checked="dedStatus?.enabled"
            :disabled="!dedStatus?.ready && !dedStatus?.enabled"
            @change="toggleDedicated"
          />
          启用专属渠道
        </label>
      </div>
      <p class="error" v-if="dedError">{{ dedError }}</p>

      <section class="block">
        <div class="block-head">
          <h2>接入点</h2>
          <button class="btn-primary" @click="startCreate()">+ 新增接入点</button>
        </div>

        <!-- 卡片而不是宽表格：原来的弹窗里「编辑 / 测试 / 删除」那一列被挤出可视区，
             配好之后就再也改不动、删不掉了。卡片布局保证操作按钮永远在视野内。 -->
        <div class="prov-list" v-if="dedProviders.length">
          <div
            v-for="p in dedProviders"
            :key="p.id"
            class="prov-card"
            :class="{ editing: dedForm.id === p.id, off: !p.enabled }"
          >
            <div class="prov-head">
              <span class="tag tag-kind">{{ p.kind }}</span>
              <span class="tag tag-tier" v-if="p.kind === 'llm'">{{ p.tier }}</span>
              <span class="scope-tag" v-if="p.scope_app">{{ appName(p.scope_app) }}</span>
              <span class="tag tag-plain" v-else>通用</span>
              <span class="tag tag-off" v-if="!p.enabled">已停用</span>
              <span class="tag tag-editing" v-if="dedForm.id === p.id">正在编辑</span>
            </div>
            <div class="prov-name">{{ p.label || '（未命名）' }}</div>
            <dl class="prov-meta">
              <div><dt>模型</dt><dd class="mono">{{ p.model || '—' }}</dd></div>
              <div><dt>Base URL</dt><dd class="mono break">{{ p.base_url || '—' }}</dd></div>
              <div><dt>Key</dt><dd class="mono">{{ p.api_key || '（未设）' }}</dd></div>
            </dl>
            <div class="prov-actions">
              <button class="hc-btn hc-btn-secondary" @click="editDed(p)">编辑</button>
              <button class="hc-btn hc-btn-secondary" @click="testDed(p)" :disabled="testingId === p.id">
                {{ testingId === p.id ? '测试中…' : '测试' }}
              </button>
              <button
                v-if="p.kind === 'llm'"
                class="hc-btn hc-btn-secondary"
                @click="makeRelayKey(p)"
                :disabled="relayBusyId === p.id"
              >
                {{ relayBusyId === p.id ? '生成中…' : '生成对外接口' }}
              </button>
              <button class="hc-btn hc-btn-danger" @click="removeDed(p)">删除</button>
            </div>
            <p v-if="testResults[p.id]" class="test-result" :class="testResults[p.id].ok ? 'ok' : 'err'">
              {{ testResults[p.id].msg }}
            </p>
          </div>
        </div>
        <p v-else class="empty-hint">还没有接入点，点上面「新增接入点」添加。</p>
      </section>

      <section class="block ded-editor" ref="editorEl">
        <div class="block-head">
          <h2>{{ dedForm.id ? '编辑接入点' : '新增接入点' }}</h2>
          <span class="ded-sub" v-if="dedForm.id">正在改「{{ editingLabel }}」</span>
        </div>
        <div class="ded-grid">
          <label>类型
            <select v-model="dedForm.kind">
              <option value="llm">llm 文本模型</option>
              <option value="image">image 生图</option>
            </select>
          </label>
          <label v-if="dedForm.kind === 'llm'">档位
            <select v-model="dedForm.tier">
              <option value="default">default 默认</option>
              <option value="strong">strong 强模型</option>
              <option value="fast">fast 快模型</option>
            </select>
          </label>
          <label v-if="dedForm.kind === 'llm'">应用<small>（留空=该用户通用）</small>
            <select v-model="dedForm.scope_app">
              <option value="">通用（所有应用）</option>
              <option v-for="a in dedApps" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <label>名称
            <input v-model="dedForm.label" placeholder="如：强模型 qwen-plus" />
          </label>
          <label>模型
            <input v-model="dedForm.model" placeholder="qwen-plus" />
          </label>
          <label class="wide">Base URL<small>（只填到 /v1，末尾的 /chat/completions 由程序自己拼）</small>
            <input v-model="dedForm.base_url" placeholder="https://your-oneapi:3000/v1" />
          </label>
          <label class="wide">API Key<small v-if="dedForm.id">（留空表示不修改）</small>
            <input v-model="dedForm.api_key" type="password" placeholder="sk-..." />
          </label>
          <label class="wide" v-if="dedForm.kind === 'image'">extra_json
            <input v-model="dedForm.extra_json" placeholder='{"protocol":"dashscope"}' />
          </label>
          <label class="inline"><input type="checkbox" v-model="dedForm.enabled" /> 启用</label>
        </div>
        <div class="create-row" style="margin-top: 24px;">
          <button class="btn-primary" @click="saveDed" :disabled="saving">
            {{ saving ? '保存中…' : (dedForm.id ? '保存修改' : '新增') }}
          </button>
          <button v-if="dedForm.id" class="hc-btn hc-btn-secondary" @click="resetDedForm">取消编辑</button>
          <span class="ok-text" v-if="savedNotice">{{ savedNotice }}</span>
        </div>
      </section>

      <!-- 对外中转接口（migration 082） -->
      <section class="block" ref="relayEl">
        <h2>对外中转接口</h2>
        <p class="ded-intro">
          给上面某条 <b>llm</b> 接入点生成一把 key，下游用 OpenAI 协议调<b>我们的域名</b>，
          我们拿那条接入点的 key 转发。调用记在 <b>{{ user.username }}</b> 头上（用量、限流都按人算）。
          <br />
          · <b>模型由接入点决定</b>，下游 body 里的 <code>model</code> 传什么都没用，也不支持流式。
          <br />
          · <b>接入点停用或删除后这把 key 立刻不能用</b>，下游会收到「接口已关闭，请联系管理员」。
        </p>

        <!-- 明文 key 只有这一次。库里只有 sha256，关掉这块就再也看不到了 —— 所以这里
             既要显眼、又必须把「复制失败」说出来：静默失败的话管理员以为已经复制走了。 -->
        <div class="relay-new" v-if="newRelay">
          <div class="relay-new-head">
            <b>接口已生成 —— 下面这把 key 只显示这一次</b>
            <button class="hc-btn hc-btn-secondary" @click="newRelay = null">我已复制，关闭</button>
          </div>
          <dl class="relay-fields">
            <div>
              <dt>Base URL</dt>
              <dd class="mono break">{{ relayBaseUrl }}</dd>
              <button class="hc-btn hc-btn-secondary" @click="copy(relayBaseUrl)">复制</button>
            </div>
            <div>
              <dt>API Key</dt>
              <dd class="mono break key">{{ newRelay.key }}</dd>
              <button class="hc-btn hc-btn-primary" @click="copy(newRelay.key)">复制</button>
            </div>
            <div>
              <dt>模型</dt>
              <dd class="mono">{{ newRelay.model || '（接入点没填模型名）' }}</dd>
              <span class="ded-sub">下游填什么都会被换成这个</span>
            </div>
          </dl>
          <p class="copy-note" :class="copyState.ok ? 'ok' : 'err'" v-if="copyState.msg">{{ copyState.msg }}</p>
          <p class="ded-sub">
            走的是这条接入点：<b>{{ newRelay.providerLabel }}</b>。
            下游把 base_url 填成上面那个地址即可用任何 OpenAI 客户端调用，
            端点是 <code>POST {{ relayBaseUrl }}/chat/completions</code>（不支持流式）。
          </p>
          <div class="relay-curl">
            <code class="mono break">{{ curlSample }}</code>
            <button class="hc-btn hc-btn-secondary" @click="copy(curlSample)">复制 curl</button>
          </div>
        </div>

        <!-- 用量 + 限流。两件事放一起：看到「今天已经 800 次」才会想到去填那个上限。 -->
        <div class="relay-usage">
          <div class="usage-nums">
            <div><b>{{ relayUsage.today_calls }}</b><span>今日调用</span></div>
            <div><b>{{ relayUsage.week_calls }}</b><span>近 7 天调用</span></div>
            <div><b>{{ fmtTokens(relayUsage.week_tokens) }}</b><span>近 7 天 tokens</span></div>
          </div>
          <div class="usage-quota">
            <label>每日调用上限
              <input v-model="relayQuotaInput" placeholder="留空 = 不限" style="width: 110px;" />
            </label>
            <button class="btn-primary" @click="saveRelayQuota">保存上限</button>
            <span class="ded-sub" v-if="relayQuota">
              今日已用 {{ relayQuota.used }} / {{ relayQuota.limit }}，剩 {{ relayQuota.remaining }}
            </span>
            <span class="ded-sub" v-else>当前不限</span>
          </div>
        </div>
        <p class="ded-sub">
          <!-- 合计数摆到某一行 key 旁边的话，管理员会照着它判「哪个下游在烧」，
               而那个数字里混着另外几把 key 的调用。所以这里必须写明口径。 -->
          以上是这个用户<b>所有对外 key 的合计</b>（日志里没有单把 key 的维度，每把 key 只有「最近调用」）。
          上限 = 对外接口每天最多调多少次，撞了下游收到 429；填 <b>0</b> = 立刻掐停，留空 = 不限。
          它和「按应用单独配置」里的<b>「对外中转接口」是同一个数</b>，改哪边都一样。
        </p>
        <p class="error" v-if="relayQuotaError">{{ relayQuotaError }}</p>

        <div class="hc-table-container" v-if="relayKeys.length">
          <table class="hc-table relay-table">
            <thead>
              <tr><th>Key</th><th>用途</th><th>走哪条接入点</th><th>状态</th><th>最近调用</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="k in relayKeys" :key="k.id" :class="{ dead: !!k.revoked_at }">
                <td class="mono">{{ k.key_prefix }}</td>
                <td>{{ k.label || '—' }}</td>
                <td>
                  <!-- 接入点被删之后这一格必须说清楚，否则下游收到「接口已关闭」而这边
                       只看到一行 key，看不出是被什么牵连废掉的。 -->
                  <span v-if="relayProvider(k)">
                    {{ relayProvider(k)!.label || relayProvider(k)!.id }}
                    <span class="mono ded-sub">{{ relayProvider(k)!.model }}</span>
                    <span class="warn-text" v-if="!relayProvider(k)!.enabled"> · 接入点已停用</span>
                  </span>
                  <span class="err-text" v-else>接入点已删除</span>
                </td>
                <td>
                  <span class="ok-text" v-if="!k.revoked_at">有效</span>
                  <span class="err-text" v-else>已失效 · {{ k.revoke_reason || '未记录原因' }}</span>
                </td>
                <td class="ded-sub">{{ k.last_used_at ? fmtTime(k.last_used_at) : '还没被调用过' }}</td>
                <td>
                  <button
                    v-if="!k.revoked_at"
                    class="hc-btn hc-btn-danger"
                    @click="revokeRelay(k)"
                  >吊销</button>
                  <span v-else class="ded-sub">{{ fmtTime(k.revoked_at) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">还没有对外接口。在上面某条 llm 接入点上点「生成对外接口」。</p>
        <p class="error" v-if="relayError">{{ relayError }}</p>
      </section>

      <!-- 按应用：单独指定 token + 单独限额 -->
      <section class="block">
        <h2>按应用单独配置</h2>
        <p class="ded-intro">
          在上面「该用户通用」之下再加一层：给某个应用单独指定 token 和每日额度。
          <br />
          · 解析顺序：<b>该应用专用的这一档 → 该应用专用的 default 档 → 该用户通用的这一档 → 通用 default</b>。
          一路都在这个用户自己的配置里找，<b>不会跨到平台</b>。
          <br />
          · 应用额度是<b>额外的天花板，不替代账号总额</b>；没填 = 该应用不限。专属渠道用户不受账号总额限制，
          但<b>仍然受应用额度限制</b>——这一层就是为「按应用分额度」而加的。
        </p>

        <div class="app-picker">
          <label>选择应用
            <select v-model="focusApp">
              <option value="">— 请选择 —</option>
              <option v-for="a in dedApps" :key="a.id" :value="a.id">
                {{ a.name }}{{ configuredApps.includes(a.id) ? ' ●' : '' }}
              </option>
            </select>
          </label>
          <span class="ded-sub" v-if="configuredApps.length">● = 已配了专用接入点</span>
        </div>

        <template v-if="focusApp">
          <div class="hc-table-container">
            <table class="hc-table app-res-table">
              <thead>
                <tr><th>档位</th><th>实际使用</th><th>模型</th><th>来源</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in focusResolutions" :key="r.tier">
                  <td class="mono">{{ r.tier }}</td>
                  <td>
                    <span v-if="r.providerId">{{ r.label }}</span>
                    <span v-else class="err-text">未配置 —— 该用户调用这一档会直接报错</span>
                  </td>
                  <td class="mono">{{ r.model || '—' }}</td>
                  <td>
                    <!-- 这一列是这个面板存在的主要理由：只给 xhs 配了 fast、忘了 strong 时，
                         strong 会静默回落到通用配置（可能是贵得多的模型），运行时看不出来。 -->
                    <span v-if="!r.providerId">—</span>
                    <span v-else-if="r.fallbackToShared" class="warn-text">回落到通用配置</span>
                    <span v-else class="ok-text">本应用专用</span>
                  </td>
                  <td>
                    <button class="hc-btn hc-btn-secondary" @click="newProviderForApp(r.tier)">
                      为本应用配这一档
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="ded-sub" v-if="!focusProviders.length">
            「{{ appName(focusApp) }}」还没有专用接入点，三档全部走该用户的通用配置。
          </p>

          <div class="app-quota-row">
            <label>「{{ appName(focusApp) }}」每日额度
              <input v-model="quotaInput" placeholder="留空 = 不限" style="width: 120px;" />
            </label>
            <button class="btn-primary" @click="saveAppQuota">保存额度</button>
            <span class="ded-sub" v-if="focusQuota">
              今日已用 {{ focusQuota.used }} / {{ focusQuota.limit }}，剩 {{ focusQuota.remaining }}
            </span>
            <span class="ded-sub" v-else>当前不限</span>
          </div>
          <p class="ded-sub">
            填 <b>0</b> = 一次都不许调（临时掐停这个应用）；<b>留空并保存</b> = 取消限制。
            改上限不会清掉今天已用的次数。
          </p>
          <p class="error" v-if="quotaError">{{ quotaError }}</p>
        </template>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../../lib/api'

interface Provider {
  id: string; kind: string; tier: string; label: string; base_url: string;
  api_key: string; model: string; extra_json: string; enabled: number;
  scope_app: string;
}

interface DedStatus {
  enabled: boolean; missingTiers: string[]; hasImage: boolean; ready: boolean;
}

interface AppDef { id: string; name: string }

/** 某应用某一档实际会命中的配置。fallbackToShared = 这一档其实走的是通用配置。 */
interface AppTierResolution {
  tier: string; providerId: string | null; label: string; model: string; fallbackToShared: boolean;
}

interface AppQuota { app: string; used: number; limit: number; remaining: number }

/** 对外中转接口的一把 key（migration 082）。明文只在生成那一次拿到，这里只有前缀。 */
interface RelayKey {
  id: string; user_id: string; provider_id: string; key_prefix: string; label: string;
  enabled: number; revoked_at: string | null; revoke_reason: string;
  last_used_at: string | null; created_at: string;
}

const route = useRoute()
const router = useRouter()
const userId = route.params.id as string

const user = ref<{ id: string; username: string } | null>(null)
const dedProviders = ref<Provider[]>([])
const dedStatus = ref<DedStatus | null>(null)
const loadError = ref('')
const dedError = ref('')
const savedNotice = ref('')
const saving = ref(false)
const testingId = ref('')
const testResults = ref<Record<string, { ok: boolean; msg: string }>>({})
const editorEl = ref<HTMLElement | null>(null)

// --- 按应用（migrations/062）---
const dedApps = ref<AppDef[]>([])
const appResolutions = ref<Record<string, AppTierResolution[]>>({})
const appQuotas = ref<AppQuota[]>([])
/** 当前在「按应用」区块里查看的应用。空串 = 还没选，只看通用配置。 */
const focusApp = ref('')
const quotaInput = ref<string>('')
const quotaError = ref('')

// --- 对外中转接口（migrations/082）---
const relayKeys = ref<RelayKey[]>([])
const relayError = ref('')
const relayBusyId = ref('')
const relayEl = ref<HTMLElement | null>(null)
/** 刚生成的那把：明文 key 只在这里存在，刷新一次就没了。 */
const newRelay = ref<{ key: string; model: string; providerLabel: string } | null>(null)
const copyState = ref<{ ok: boolean; msg: string }>({ ok: true, msg: '' })

// 下游要填的地址。写死域名的话，换个部署环境（本机 / 测试 / 线上）复制出去的地址
// 就是错的，而下游那边的报错是「连不上」，读起来像我们的服务挂了。
const relayBaseUrl = computed(() => `${window.location.origin}/api/v1`)

/** 对外接口的 app id（= core/llm/apps.ts 里的那一行，额度也按它记）。 */
const RELAY_APP = 'relay'
const relayUsage = ref({ today_calls: 0, today_tokens: 0, week_calls: 0, week_tokens: 0 })
const relayQuotaInput = ref('')
const relayQuotaError = ref('')
const relayQuota = computed(() => appQuotas.value.find(q => q.app === RELAY_APP) || null)
const fmtTokens = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n))

/** 一条能直接粘到终端里跑的验证命令 —— key 只显示这一次，顺手把它验掉最省事。 */
const curlSample = computed(() =>
  newRelay.value
    ? `curl ${relayBaseUrl.value}/chat/completions -H "Authorization: Bearer ${newRelay.value.key}" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"你好"}]}'`
    : ''
)

const relayProvider = (k: RelayKey) => dedProviders.value.find(p => p.id === k.provider_id) || null
const fmtTime = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false })

const appName = (id: string) => dedApps.value.find(a => a.id === id)?.name || id
const focusResolutions = computed(() => (focusApp.value ? appResolutions.value[focusApp.value] || [] : []))
const focusQuota = computed(() => appQuotas.value.find(q => q.app === focusApp.value) || null)
/** 该应用有几条自己的专用接入点 —— 0 条时整档都在回落通用。 */
const focusProviders = computed(() => dedProviders.value.filter(p => p.scope_app === focusApp.value))
/** 配了专用 token 的应用，给顶部一眼看出「哪些应用被单独接过」。 */
const configuredApps = computed(() => {
  const s = new Set(dedProviders.value.filter(p => p.scope_app).map(p => p.scope_app))
  return [...s]
})
/** 开关开着但配置已经不齐 —— 删掉/停用某一档之后会落到这个状态。 */
const broken = computed(() => !!dedStatus.value?.enabled && !dedStatus.value?.ready)
const editingLabel = computed(() => {
  const p = dedProviders.value.find(x => x.id === dedForm.value.id)
  return p ? (p.label || p.model || p.id) : ''
})

function emptyDedForm() {
  return { id: '', kind: 'llm', tier: 'default', label: '', base_url: '', api_key: '', model: '', extra_json: '', enabled: true, scope_app: '' }
}
const dedForm = ref(emptyDedForm())
function resetDedForm() { dedForm.value = emptyDedForm(); dedError.value = '' }

function back() { router.push({ name: 'admin-users' }) }

async function scrollToEditor() {
  await nextTick()
  editorEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function startCreate() {
  resetDedForm()
  savedNotice.value = ''
  scrollToEditor()
}

async function loadDedicated() {
  loadError.value = ''
  try {
    const r = await apiGet<{
      user: { id: string; username: string };
      providers: Provider[]; status: DedStatus; apps: AppDef[];
      app_resolutions: Record<string, AppTierResolution[]>; app_quotas: AppQuota[];
      relay_keys: RelayKey[];
      relay_usage: { today_calls: number; today_tokens: number; week_calls: number; week_tokens: number };
    }>(`/api/admin/users/${userId}/dedicated-ai`)
    user.value = r.user
    dedProviders.value = r.providers
    dedStatus.value = r.status
    relayKeys.value = r.relay_keys || []
    relayUsage.value = r.relay_usage || { today_calls: 0, today_tokens: 0, week_calls: 0, week_tokens: 0 }
    // 应用清单由后端给（= core/llm/apps.ts 的白名单）。前端硬编码一份的话，
    // 加了新模块只改一边，漏掉的那个应用配了也永远不生效。
    dedApps.value = r.apps || []
    appResolutions.value = r.app_resolutions || {}
    appQuotas.value = r.app_quotas || []
    syncQuotaInput()
    relayQuotaInput.value = relayQuota.value ? String(relayQuota.value.limit) : ''
  } catch (e: any) {
    loadError.value = e.message || '加载失败'
  }
}

function syncQuotaInput() {
  // 空输入框 = 不限（没有配额行）。0 是另一回事：一次都不许调。
  quotaInput.value = focusQuota.value ? String(focusQuota.value.limit) : ''
}

watch(focusApp, () => { quotaError.value = ''; syncQuotaInput() })

/**
 * 保存某应用的每日额度。留空 = 取消限制（后端删行）。返回错误文案，空串 = 成功。
 *
 * 两个输入框（按应用那块、对外接口那块）共用这一份校验：各写一遍的话，一边接受 0
 * 一边把 0 当空值，而 0 的含义是「一次都不许调」—— 从哪个框保存的看不出来。
 */
async function putAppQuota(app: string, raw: string): Promise<string> {
  let daily_limit: number | null = null
  const s = raw.trim()
  if (s !== '') {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 0) return '请填非负整数，或留空表示不限制'
    daily_limit = n
  }
  try {
    await apiPut(`/api/admin/users/${userId}/app-quota`, { app, daily_limit })
    await loadDedicated()
    return ''
  } catch (e: any) {
    return e.message || '保存失败'
  }
}

async function saveAppQuota() {
  if (!focusApp.value) return
  quotaError.value = await putAppQuota(focusApp.value, quotaInput.value)
}

async function saveRelayQuota() {
  relayQuotaError.value = await putAppQuota(RELAY_APP, relayQuotaInput.value)
}

/** 在编辑器里直接为当前应用新增一条接入点（省掉「新增后还要记得选应用」这一步）。 */
function newProviderForApp(tier: string) {
  resetDedForm()
  dedForm.value.scope_app = focusApp.value
  dedForm.value.tier = tier
  savedNotice.value = ''
  scrollToEditor()
}

async function saveDed() {
  dedError.value = ''
  savedNotice.value = ''
  saving.value = true
  const wasEdit = !!dedForm.value.id
  try {
    await apiPost('/api/admin/providers', {
      ...dedForm.value,
      id: dedForm.value.id || undefined,
      enabled: dedForm.value.enabled ? 1 : 0,
      extra_json: dedForm.value.extra_json || '{}',
      owner_user_id: userId,
      // 生图没有应用维度，别把上次选的应用带过去
      scope_app: dedForm.value.kind === 'llm' ? dedForm.value.scope_app : '',
    })
    resetDedForm()
    savedNotice.value = wasEdit ? '已保存修改' : '已新增接入点'
    await loadDedicated()
  } catch (e: any) {
    dedError.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

function editDed(p: Provider) {
  // api_key 是脱敏值，不回填——回填会把脱敏串当新 key 存回去。留空即「不修改」。
  // scope_app 必须回填：漏了它，「改个模型名」就把这条应用专用配置变成该用户的通用配置。
  dedForm.value = {
    id: p.id, kind: p.kind, tier: p.tier || 'default', label: p.label,
    base_url: p.base_url, api_key: '', model: p.model,
    extra_json: p.extra_json === '{}' ? '' : p.extra_json, enabled: !!p.enabled,
    scope_app: p.scope_app || '',
  }
  dedError.value = ''
  savedNotice.value = ''
  scrollToEditor()
}

async function removeDed(p: Provider) {
  // 先把「有几把对外 key 绑在它上面」摆到确认框里：不说的话，删完那几个下游明天
  // 开始收到「接口已关闭」，而这边只看到一句「已删除接入点」。
  const bound = relayKeys.value.filter(k => k.provider_id === p.id && !k.revoked_at).length
  const extra = bound ? `\n\n注意：有 ${bound} 把对外接口 key 绑在它上面，会一起失效，下游立刻调不通。` : ''
  if (!confirm(`确定删除接入点「${p.label || p.model || p.id}」？${extra}`)) return
  dedError.value = ''
  try {
    const r = await apiDelete<{ revoked_relay_keys?: number }>(`/api/admin/providers/${p.id}`)
    if (dedForm.value.id === p.id) resetDedForm()
    savedNotice.value = r?.revoked_relay_keys
      ? `已删除接入点，顺带吊销了 ${r.revoked_relay_keys} 把对外接口 key`
      : '已删除接入点'
    await loadDedicated()
  } catch (e: any) {
    dedError.value = e.message || '删除失败'
  }
}

/** 给这条接入点生成一把对外 key。明文只在返回值里出现一次。 */
async function makeRelayKey(p: Provider) {
  relayError.value = ''
  copyState.value = { ok: true, msg: '' }
  const label = prompt(`这把 key 给谁用？（记个用途，方便以后吊销对的那一把）`, p.label || '')
  if (label === null) return
  relayBusyId.value = p.id
  try {
    const r = await apiPost<{ key: string; relay_key: RelayKey }>(`/api/admin/users/${userId}/relay-keys`, {
      provider_id: p.id,
      label,
    })
    newRelay.value = { key: r.key, model: p.model, providerLabel: p.label || p.model || p.id }
    await loadDedicated()
    await nextTick()
    relayEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch (e: any) {
    relayError.value = e.message || '生成失败'
  } finally {
    relayBusyId.value = ''
  }
}

async function revokeRelay(k: RelayKey) {
  if (!confirm(`吊销 ${k.key_prefix}${k.label ? `（${k.label}）` : ''}？下游会立刻调不通，且不能恢复。`)) return
  relayError.value = ''
  try {
    await apiDelete(`/api/admin/relay-keys/${k.id}`)
    await loadDedicated()
  } catch (e: any) {
    relayError.value = e.message || '吊销失败'
  }
}

/**
 * 复制。失败必须出声 —— 明文 key 只显示这一次，静默失败的话管理员以为已经复制走了，
 * 关掉这块之后那把 key 就只能重新生成。
 */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = { ok: true, msg: '已复制到剪贴板' }
  } catch {
    copyState.value = { ok: false, msg: '复制失败（浏览器不允许），请手动选中上面那串文字复制' }
  }
}

async function testDed(p: Provider) {
  testingId.value = p.id
  delete testResults.value[p.id]
  try {
    const r = await apiPost<{ duration_ms: number; model: string }>(`/api/admin/providers/${p.id}/test`, {})
    testResults.value[p.id] = { ok: true, msg: `连通 ✓ ${r.model} · ${r.duration_ms}ms` }
  } catch (e: any) {
    testResults.value[p.id] = { ok: false, msg: e.message || '测试失败' }
  }
  testingId.value = ''
}

async function toggleDedicated(ev: Event) {
  const target = ev.target as HTMLInputElement
  const want = target.checked
  dedError.value = ''
  try {
    // 必须用 apiPatch 而不是裸 api()：后者不会对 4xx 抛错，
    // 后端「缺档不许启用」的 400 会被静默吃掉，界面显示成开关生效了。
    await apiPatch(`/api/admin/users/${userId}/dedicated-ai`, { enabled: want })
    await loadDedicated()
  } catch (e: any) {
    target.checked = !want   // 后端拒绝了就把勾选状态还原
    dedError.value = e.message || '切换失败'
  }
}

onMounted(loadDedicated)
</script>

<style scoped>
.page { max-width: 1100px; }
.page-sub { margin: 8px 0 0; font-size: 14px; color: #6b7280; }
.page-sub b { color: #111827; }
.error { color: #dc2626; font-size: 13px; margin-top: 12px; font-weight: bold; }
.mono { font-family: monospace; font-size: 12px; }
.mono.break { word-break: break-all; }
.empty-hint { font-size: 13px; color: var(--c-text-sub); }
.ded-sub { color: #6b7280; font-size: 13px; }

.block { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; }
.block h2 { font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 12px; letter-spacing: -0.3px; }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.block-head h2 { margin: 0; }

.ded-intro { font-size: 14px; line-height: 1.6; color: #6b7280; margin: 0 0 24px; }
.ded-intro code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #374151; font-family: monospace; }

.ded-status {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 20px; border-radius: 10px; font-size: 14px; border: 1px solid transparent;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  transition: all 0.3s ease;
}
.ded-status.ok { background: rgba(34, 197, 94, 0.04); border-color: rgba(34, 197, 94, 0.2); }
.ded-status.warn { background: rgba(245, 158, 11, 0.05); border-color: rgba(245, 158, 11, 0.25); }
.ded-status.danger { background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3); }
.broken-warn { margin: 8px 0 0; font-size: 13px; line-height: 1.6; color: #dc2626; font-weight: 500; }
.ded-status b { color: #111827; }
.ded-switch { display: flex; align-items: center; gap: 8px; white-space: nowrap; cursor: pointer; font-weight: 600; color: #374151; }
.ded-switch.disabled { opacity: .45; cursor: not-allowed; }

/* 接入点卡片 */
.prov-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.prov-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.prov-card.editing { border-color: #3B5BDB; box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.12); }
.prov-card.off { background: #fafafa; }
.prov-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.prov-name { margin-top: 12px; font-size: 15px; font-weight: 700; color: #111827; }
.prov-meta { margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
.prov-meta > div { display: flex; gap: 12px; align-items: baseline; }
.prov-meta dt { flex-shrink: 0; width: 62px; font-size: 12px; color: #9ca3af; font-weight: 600; }
.prov-meta dd { margin: 0; color: #374151; min-width: 0; }
.prov-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid #f3f4f6; }

.tag {
  display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
  white-space: nowrap;
}
.tag-kind { background: #f3f4f6; color: #4b5563; font-family: monospace; }
.tag-tier { background: #e0e7ff; color: #3B5BDB; font-family: monospace; }
.tag-plain { background: transparent; color: #9ca3af; font-weight: 500; }
.tag-off { background: #fef2f2; color: #dc2626; }
.tag-editing { background: rgba(59, 91, 219, 0.1); color: #3B5BDB; }
.scope-tag {
  display: inline-block; padding: 2px 8px; border: 1px solid rgba(59, 91, 219, 0.3); color: #3B5BDB;
  border-radius: 6px; font-size: 12px; font-weight: 500; background: rgba(59, 91, 219, 0.05); white-space: nowrap;
}

.ded-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ded-grid label { display: flex; flex-direction: column; gap: 8px; font-size: 13px; font-weight: 600; color: #4b5563; }
.ded-grid label.wide { grid-column: 1 / -1; }
.ded-grid label.inline { flex-direction: row; align-items: center; gap: 8px; grid-column: 1 / -1; font-weight: 500; color: #374151; }
.ded-grid input:not([type="checkbox"]), .ded-grid select {
  padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 14px;
  background: #f9fafb; color: #111827; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box; width: 100%;
}
.ded-grid input:not([type="checkbox"]):focus, .ded-grid select:focus {
  outline: none; background: #ffffff; border-color: #3B5BDB; box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}
.ded-grid small { color: #9ca3af; font-weight: normal; font-size: 12px; margin-left: 4px; }

.create-row { display: flex; gap: 16px; align-items: center; }

.test-result { font-size: 12px; margin: 12px 0 0; line-height: 1.4; font-weight: 500; }
.test-result.ok { color: #16a34a; }
.test-result.err { color: #dc2626; }

/* 对外中转接口 */
.relay-new {
  border: 1px solid rgba(59, 91, 219, 0.35); background: rgba(59, 91, 219, 0.04);
  border-radius: 12px; padding: 20px; margin-bottom: 24px;
}
.relay-new-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.relay-new-head b { color: #3B5BDB; font-size: 14px; }
.relay-fields { margin: 16px 0 0; display: flex; flex-direction: column; gap: 12px; }
.relay-fields > div { display: flex; align-items: center; gap: 12px; }
.relay-fields dt { flex-shrink: 0; width: 72px; font-size: 12px; color: #9ca3af; font-weight: 600; }
.relay-fields dd { margin: 0; color: #111827; min-width: 0; flex: 1; }
.relay-fields dd.key { user-select: all; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-weight: 600; }
.relay-curl {
  display: flex; align-items: center; gap: 12px; margin-top: 12px;
  background: #111827; color: #e5e7eb; border-radius: 8px; padding: 12px 14px;
}
.relay-curl code { flex: 1; min-width: 0; font-size: 11px; line-height: 1.5; user-select: all; }
.copy-note { font-size: 12px; margin: 12px 0 0; font-weight: 500; }
.copy-note.ok { color: #16a34a; }
.copy-note.err { color: #dc2626; }
.relay-usage {
  display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
  padding: 16px 20px; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 12px; background: #fafafa;
}
.usage-nums { display: flex; gap: 32px; }
.usage-nums > div { display: flex; flex-direction: column; gap: 4px; }
.usage-nums b { font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px; }
.usage-nums span { font-size: 12px; color: #6b7280; }
.usage-quota { display: flex; align-items: center; gap: 12px; font-size: 13px; flex-wrap: wrap; }
.usage-quota label { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #4b5563; }
.usage-quota input {
  padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px;
  background: #fff; color: #111827;
}
.usage-quota input:focus { outline: none; border-color: #3B5BDB; box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15); }
.relay-table { font-size: 13px; }
.relay-table tr.dead { background: #fafafa; color: #9ca3af; }

/* 按应用配置 */
.app-picker { display: flex; align-items: flex-end; gap: 16px; margin: 16px 0 20px; font-size: 13px; }
.app-picker label { display: flex; flex-direction: column; gap: 8px; font-size: 13px; font-weight: 600; color: #4b5563; }
.app-picker select {
  padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 14px; min-width: 240px;
  background: #f9fafb; color: #111827; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.app-picker select:focus { outline: none; background: #ffffff; border-color: #3B5BDB; box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15); }
.app-res-table { font-size: 13px; }
.app-quota-row { display: flex; align-items: center; gap: 16px; margin-top: 24px; font-size: 13px; flex-wrap: wrap; }
.app-quota-row label { display: flex; align-items: center; gap: 12px; font-weight: 600; color: #4b5563; }
.app-quota-row input {
  padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px;
  background: #f9fafb; color: #111827; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.app-quota-row input:focus { outline: none; background: #ffffff; border-color: #3B5BDB; box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15); }
.ok-text { color: #16a34a; font-weight: 500; }
.warn-text { color: #d97706; font-weight: 600; }
.err-text { color: #dc2626; font-weight: 500; }

@media (max-width: 720px) {
  .ded-grid { grid-template-columns: 1fr; }
  .ded-status { flex-direction: column; align-items: flex-start; }
}
</style>
