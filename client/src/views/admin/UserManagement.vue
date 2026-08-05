<template>
  <div class="page">
    <div class="page-header">
      <h1>用户管理</h1>
      <button class="btn-primary" @click="showCreate = true">+ 新增用户</button>
    </div>

    <div class="hc-table-container" v-if="users.length">
      <table class="hc-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>角色</th>
            <th>AI 调用次数</th>
            <th>今日额度</th>
            <th>AI 渠道</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <div style="font-weight: 600; color: var(--c-text-main);">{{ u.username }}</div>
            </td>
            <td>
              <span :class="['hc-badge', u.role === 'admin' ? 'hc-badge-blue' : 'hc-badge-gray']">
                {{ u.role }}
              </span>
            </td>
            <td>{{ u.total_ai_calls }}</td>
            <td>
              <span v-if="u.use_dedicated_ai" style="color: var(--c-text-sub);">不限</span>
              <span v-else>{{ u.used_today ?? 0 }} / {{ u.daily_limit ?? 10 }}</span>
            </td>
            <td>
              <span :class="['hc-badge', u.use_dedicated_ai ? 'hc-badge-green' : 'hc-badge-gray']">
                {{ u.use_dedicated_ai ? '专属' : '平台' }}
              </span>
            </td>
            <td><span style="color: var(--c-text-sub); font-size: 13px;">{{ formatDate(u.created_at) }}</span></td>
            <td>
              <div class="table-actions">
                <button class="hc-btn hc-btn-secondary" @click="toggleRole(u)">
                  {{ u.role === 'admin' ? '降为用户' : '设为管理员' }}
                </button>
                <button class="hc-btn hc-btn-secondary" @click="openTokenPanel(u)">Token管理</button>
                <button class="hc-btn hc-btn-secondary" @click="openDedicatedPanel(u)">专属 AI</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <AdminPagination v-model="currentPage" :total="totalUsers" :total-pages="totalPages" />
    </div>

    <!-- Create User Dialog -->
    <HcModal v-model="showCreate" title="新增用户" max-width="400px">
      <div class="form-group">
        <label>用户名</label>
        <input v-model="newUser.username" placeholder="输入用户名" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label>密码</label>
        <input v-model="newUser.password" type="password" placeholder="至少6位" />
      </div>
      <p class="error" v-if="createError">{{ createError }}</p>

      <template #footer>
        <button class="btn-secondary" @click="showCreate = false">取消</button>
        <button class="btn-primary" @click="createUser">创建</button>
      </template>
    </HcModal>

    <!-- Token Management Modal -->
    <HcModal v-model="showTokenPanel" :title="`Token 管理 — ${tokenUser?.username || ''}`" max-width="760px">
      <div class="token-panel">
        <h3>已分配的模块 Token</h3>
        <div class="hc-table-container" v-if="userTokens.length">
          <table class="hc-table">
            <thead>
              <tr>
                <th>模块</th>
                <th>Token 前缀</th>
                <th>状态</th>
                <th>最后使用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in userTokens" :key="t.id">
                <td><strong>{{ t.module_name || t.module_id }}</strong></td>
                <td class="mono">{{ t.token_prefix }}</td>
                <td>
                  <span :class="['hc-badge', t.enabled ? 'hc-badge-green' : 'hc-badge-red']">
                    {{ t.enabled ? '启用' : '禁用' }}
                  </span>
                </td>
                <td>{{ t.last_used_at ? formatDate(t.last_used_at) : '从未' }}</td>
                <td>
                  <div class="table-actions">
                    <button class="hc-btn hc-btn-secondary" @click="toggleToken(t)">{{ t.enabled ? '禁用' : '启用' }}</button>
                    <button class="hc-btn hc-btn-danger" @click="revokeToken(t)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">暂无分配的 Token</p>

        <div class="create-token-section">
          <h3>分配新 Token</h3>
          <div class="create-row">
            <select v-model="newTokenModule">
              <option value="">-- 选择模块 --</option>
              <option v-for="m in availableModules" :key="m.id" :value="m.id">{{ m.name }} ({{ m.id }})</option>
            </select>
            <button class="btn-primary" @click="generateToken" :disabled="!newTokenModule">生成 Token</button>
          </div>
        </div>

        <div v-if="generatedToken" class="new-token-alert">
          <p><strong>Token 已生成，请立即复制（仅展示一次）：</strong></p>
          <code class="token-value">{{ generatedToken }}</code>
          <button class="copy-btn" @click="copyToken">复制</button>
        </div>

        <div class="logs-section">
          <h3>调用日志 <small>(最近 7 天)</small></h3>
          <div class="hc-table-container" v-if="tokenLogs.length">
            <table class="hc-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模块</th>
                  <th>方法</th>
                  <th>路径</th>
                  <th>状态码</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in tokenLogs" :key="log.id">
                  <td>{{ formatDateTime(log.created_at) }}</td>
                  <td>{{ log.module_name || log.module_id }}</td>
                  <td><code>{{ log.method }}</code></td>
                  <td class="path-cell"><code>{{ log.path }}</code></td>
                  <td>
                    <span :class="['status-code', log.status_code < 400 ? 'ok' : 'err']">{{ log.status_code }}</span>
                  </td>
                  <td class="mono">{{ log.ip }}</td>
                </tr>
              </tbody>
            </table>
            <AdminPagination v-model="logsPage" :total="totalLogs" :total-pages="totalLogsPages" />
          </div>
          <p v-else class="empty-hint">暂无调用记录</p>
        </div>
      </div>
    </HcModal>

    <!-- 专属 AI 渠道 -->
    <HcModal v-model="showDedicated" :title="`专属 AI 渠道 — ${dedicatedUser?.username || ''}`" max-width="820px">
      <div class="ded-panel">
        <p class="ded-intro">
          为该用户配置独立的模型接入点。开关打开后，他的<b>所有</b> AI 调用只走这里的配置，
          不再使用平台模型、也不受平台每日额度限制。
          <br />
          文本模型必须配齐 <b>default / strong / fast</b> 三档：<code>strong</code> 跑吐 JSON 的结构化任务
          （小红书搭结构 / 校验 / 诊断、标讯画像），<code>fast</code> 走量成文，<code>default</code> 兜底其余
          （对话 / 顾问 / UI 评测 / 摸鱼）。缺档不会回落平台，会直接报错。
        </p>

        <div class="ded-status" :class="dedStatus?.ready ? 'ok' : 'warn'">
          <div>
            <b>{{ dedStatus?.ready ? '配置已齐全' : '配置不完整' }}</b>
            <span v-if="dedStatus?.missingTiers?.length"> — 缺少档位：{{ dedStatus.missingTiers.join(' / ') }}</span>
            <span v-if="dedStatus?.ready && !dedStatus?.hasImage" class="ded-sub">
              （未配生图；生图适配器尚未实现，不影响文本功能）
            </span>
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

        <h3>接入点</h3>
        <div class="hc-table-container" v-if="dedProviders.length">
          <table class="hc-table">
            <thead>
              <tr>
                <th>类型</th><th>档位</th><th>名称</th><th>模型</th><th>Base URL</th><th>Key</th><th>启用</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in dedProviders" :key="p.id">
                <td>{{ p.kind }}</td>
                <td>{{ p.kind === 'llm' ? p.tier : '—' }}</td>
                <td>{{ p.label }}</td>
                <td class="mono">{{ p.model }}</td>
                <td class="mono path-cell">{{ p.base_url }}</td>
                <td class="mono">{{ p.api_key || '（未设）' }}</td>
                <td>{{ p.enabled ? '✓' : '✕' }}</td>
                <td>
                  <div class="table-actions">
                    <button class="hc-btn hc-btn-secondary" @click="editDed(p)">编辑</button>
                    <button class="hc-btn hc-btn-secondary" @click="testDed(p)" :disabled="testingId === p.id">
                      {{ testingId === p.id ? '测试中…' : '测试' }}
                    </button>
                    <button class="hc-btn hc-btn-danger" @click="removeDed(p)">删除</button>
                  </div>
                  <p v-if="testResults[p.id]" class="test-result" :class="testResults[p.id].ok ? 'ok' : 'err'">
                    {{ testResults[p.id].msg }}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">还没有接入点，用下面的表单添加。</p>

        <div class="ded-editor">
          <h3>{{ dedForm.id ? '编辑接入点' : '新增接入点' }}</h3>
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
            <label>名称
              <input v-model="dedForm.label" placeholder="如：强模型 qwen-plus" />
            </label>
            <label>模型
              <input v-model="dedForm.model" placeholder="qwen-plus" />
            </label>
            <label class="wide">Base URL
              <input v-model="dedForm.base_url" placeholder="http://your-oneapi:3000/v1" />
            </label>
            <label class="wide">API Key<small v-if="dedForm.id">（留空表示不修改）</small>
              <input v-model="dedForm.api_key" type="password" placeholder="sk-..." />
            </label>
            <label class="wide" v-if="dedForm.kind === 'image'">extra_json
              <input v-model="dedForm.extra_json" placeholder='{"protocol":"dashscope"}' />
            </label>
            <label class="inline"><input type="checkbox" v-model="dedForm.enabled" /> 启用</label>
          </div>
          <div class="create-row" style="margin-top: 12px;">
            <button class="btn-primary" @click="saveDed">{{ dedForm.id ? '保存修改' : '新增' }}</button>
            <button v-if="dedForm.id" class="hc-btn hc-btn-secondary" @click="resetDedForm">取消编辑</button>
          </div>
        </div>
      </div>
    </HcModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { api, apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'
import HcModal from '../../components/common/HcModal.vue'
import AdminPagination from '../../components/common/AdminPagination.vue'

interface UserRow {
  id: string; username: string; role: string; total_ai_calls: number;
  daily_limit: number | null; used_today: number | null;
  use_dedicated_ai: number;
  created_at: string;
}

interface Provider {
  id: string; kind: string; tier: string; label: string; base_url: string;
  api_key: string; model: string; extra_json: string; enabled: number;
}

interface DedStatus {
  enabled: boolean; missingTiers: string[]; hasImage: boolean; ready: boolean;
}

interface ModuleToken {
  id: string; module_id: string; module_name: string; token_prefix: string;
  enabled: number; expires_at: string | null; last_used_at: string | null;
}

interface ModuleConfig {
  id: string; name: string; enabled: number;
}

interface AccessLog {
  id: string; module_id: string; module_name: string; method: string;
  path: string; status_code: number; ip: string; created_at: string;
}

const PAGE_SIZE = 20
const users = ref<UserRow[]>([])
const totalUsers = ref(0)
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(totalUsers.value / PAGE_SIZE))
const showCreate = ref(false)
const newUser = ref({ username: '', password: '' })
const createError = ref('')

const showTokenPanel = ref(false)
const tokenUser = ref<UserRow | null>(null)
const userTokens = ref<ModuleToken[]>([])
const tokenLogs = ref<AccessLog[]>([])
const totalLogs = ref(0)
const logsPage = ref(1)
const totalLogsPages = computed(() => Math.ceil(totalLogs.value / PAGE_SIZE))
const availableModules = ref<ModuleConfig[]>([])
const newTokenModule = ref('')
const generatedToken = ref('')

// --- 专属 AI 渠道 ---
const showDedicated = ref(false)
const dedicatedUser = ref<UserRow | null>(null)
const dedProviders = ref<Provider[]>([])
const dedStatus = ref<DedStatus | null>(null)
const dedError = ref('')
const testingId = ref('')
const testResults = ref<Record<string, { ok: boolean; msg: string }>>({})

function emptyDedForm() {
  return { id: '', kind: 'llm', tier: 'default', label: '', base_url: '', api_key: '', model: '', extra_json: '', enabled: true }
}
const dedForm = ref(emptyDedForm())
function resetDedForm() { dedForm.value = emptyDedForm() }

async function openDedicatedPanel(u: UserRow) {
  dedicatedUser.value = u
  dedError.value = ''
  testResults.value = {}
  resetDedForm()
  showDedicated.value = true
  await loadDedicated()
}

async function loadDedicated() {
  if (!dedicatedUser.value) return
  const r = await apiGet<{ providers: Provider[]; status: DedStatus }>(
    `/api/admin/users/${dedicatedUser.value.id}/dedicated-ai`
  )
  dedProviders.value = r.providers
  dedStatus.value = r.status
}

async function saveDed() {
  if (!dedicatedUser.value) return
  dedError.value = ''
  try {
    await apiPost('/api/admin/providers', {
      ...dedForm.value,
      id: dedForm.value.id || undefined,
      enabled: dedForm.value.enabled ? 1 : 0,
      extra_json: dedForm.value.extra_json || '{}',
      owner_user_id: dedicatedUser.value.id,
    })
    resetDedForm()
    await loadDedicated()
  } catch (e: any) {
    dedError.value = e.message || '保存失败'
  }
}

function editDed(p: Provider) {
  // api_key 是脱敏值，不回填——回填会把脱敏串当新 key 存回去。留空即「不修改」。
  dedForm.value = {
    id: p.id, kind: p.kind, tier: p.tier || 'default', label: p.label,
    base_url: p.base_url, api_key: '', model: p.model,
    extra_json: p.extra_json === '{}' ? '' : p.extra_json, enabled: !!p.enabled,
  }
}

async function removeDed(p: Provider) {
  if (!confirm(`确定删除接入点「${p.label || p.model || p.id}」？`)) return
  await apiDelete(`/api/admin/providers/${p.id}`)
  if (dedForm.value.id === p.id) resetDedForm()
  await loadDedicated()
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
  if (!dedicatedUser.value) return
  const target = ev.target as HTMLInputElement
  const want = target.checked
  dedError.value = ''
  try {
    // 必须用 apiPatch 而不是裸 api()：后者不会对 4xx 抛错，
    // 后端「缺档不许启用」的 400 会被静默吃掉，界面显示成开关生效了。
    await apiPatch(`/api/admin/users/${dedicatedUser.value.id}/dedicated-ai`, { enabled: want })
    await loadDedicated()
    await loadUsers()
    // 列表刷新后同步弹窗里那份引用，否则再次开关拿的是旧值
    const fresh = users.value.find(u => u.id === dedicatedUser.value!.id)
    if (fresh) dedicatedUser.value = fresh
  } catch (e: any) {
    target.checked = !want   // 后端拒绝了就把勾选状态还原
    dedError.value = e.message || '切换失败'
  }
}

async function loadUsers() {
  const data = await apiGet(`/api/admin/users?page=${currentPage.value}&page_size=${PAGE_SIZE}`)
  users.value = data.users
  totalUsers.value = data.total
}

async function createUser() {
  createError.value = ''
  try {
    await apiPost('/api/admin/users', newUser.value)
    showCreate.value = false
    newUser.value = { username: '', password: '' }
    await loadUsers()
  } catch (e: any) {
    createError.value = e.message
  }
}

async function toggleRole(u: UserRow) {
  const newRole = u.role === 'admin' ? 'user' : 'admin'
  await api(`/api/admin/users/${u.id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: newRole }),
  })
  await loadUsers()
}

async function openTokenPanel(u: UserRow) {
  tokenUser.value = u
  generatedToken.value = ''
  newTokenModule.value = ''
  showTokenPanel.value = true
  await Promise.all([loadUserTokens(u.id), loadModules(), loadUserLogs(u.id)])
}

async function loadUserTokens(userId: string) {
  const data = await apiGet<{ tokens: ModuleToken[] }>(`/api/admin/users/${userId}/tokens`)
  userTokens.value = data.tokens
}

async function loadModules() {
  const data = await apiGet<{ modules: ModuleConfig[]; total: number }>('/api/admin/modules?page_size=100')
  availableModules.value = data.modules.filter(m => m.enabled)
}

async function loadUserLogs(userId: string) {
  const data = await apiGet<{ logs: AccessLog[]; total: number }>(`/api/admin/users/${userId}/token-logs?days=7&page=${logsPage.value}&page_size=${PAGE_SIZE}`)
  tokenLogs.value = data.logs
  totalLogs.value = data.total
}

async function generateToken() {
  if (!tokenUser.value || !newTokenModule.value) return
  try {
    const data = await apiPost<{ token: string }>(`/api/admin/users/${tokenUser.value.id}/tokens`, {
      module_id: newTokenModule.value,
    })
    generatedToken.value = data.token
    newTokenModule.value = ''
    await loadUserTokens(tokenUser.value.id)
  } catch (e: any) {
    alert(e.message || '生成失败')
  }
}

async function toggleToken(t: ModuleToken) {
  await api(`/api/admin/tokens/${t.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: t.enabled ? 0 : 1 }),
  })
  if (tokenUser.value) await loadUserTokens(tokenUser.value.id)
}

async function revokeToken(t: ModuleToken) {
  if (!confirm(`确定删除 ${t.module_name || t.module_id} 模块的 Token？`)) return
  await apiDelete(`/api/admin/tokens/${t.id}`)
  if (tokenUser.value) await loadUserTokens(tokenUser.value.id)
}

function copyToken() {
  navigator.clipboard.writeText(generatedToken.value)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

watch(currentPage, loadUsers)
watch(logsPage, () => {
  if (tokenUser.value) loadUserLogs(tokenUser.value.id)
})

onMounted(loadUsers)
</script>

<style scoped>
.page { max-width: 1200px; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; }
.error { color: #dc2626; font-size: 13px; margin-top: 12px; font-weight: bold; }

.token-panel h3 { font-size: 16px; margin: 24px 0 12px; }
.token-panel h3:first-child { margin-top: 0; }
.token-panel h3 small { font-weight: normal; color: var(--c-text-sub); }
.mono { font-family: monospace; font-size: 12px; }
.empty-hint { font-size: 13px; color: var(--c-text-sub); }

.create-token-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--c-border); }
.create-row { display: flex; gap: 12px; align-items: center; }
.create-row select { flex: 1; padding: 8px 12px; border: 1px solid var(--c-border); border-radius: 6px; font-size: 13px; }

.new-token-alert { background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 16px; margin-top: 16px; }
.new-token-alert p { font-size: 13px; margin: 0 0 8px; }
.token-value { display: block; font-size: 11px; word-break: break-all; background: #fff; padding: 8px; border-radius: 4px; margin-bottom: 8px; border: 1px solid var(--c-border); }
.copy-btn { padding: 4px 12px; background: var(--c-blue-primary, #0077ff); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }

/* 专属 AI 渠道面板 */
.ded-panel h3 { font-size: 15px; margin: 20px 0 10px; }
.ded-intro { font-size: 13px; line-height: 1.7; color: var(--c-text-sub); margin: 0 0 16px; }
.ded-intro code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 12px; }

.ded-status {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 14px; border-radius: 8px; font-size: 13px; border: 1px solid;
}
.ded-status.ok { background: rgba(34, 197, 94, .07); border-color: rgba(34, 197, 94, .3); }
.ded-status.warn { background: rgba(245, 158, 11, .08); border-color: rgba(245, 158, 11, .35); }
.ded-sub { color: var(--c-text-sub); }
.ded-switch { display: flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer; font-weight: 600; }
.ded-switch.disabled { opacity: .45; cursor: not-allowed; }

.ded-editor { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--c-border); }
.ded-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ded-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--c-text-sub); }
.ded-grid label.wide { grid-column: 1 / -1; }
.ded-grid label.inline { flex-direction: row; align-items: center; gap: 6px; grid-column: 1 / -1; }
.ded-grid input, .ded-grid select {
  padding: 7px 10px; border: 1px solid var(--c-border); border-radius: 6px; font-size: 13px;
}
.ded-grid small { color: var(--c-text-sub); font-weight: normal; }

.test-result { font-size: 11px; margin: 4px 0 0; line-height: 1.4; }
.test-result.ok { color: #16a34a; }
.test-result.err { color: #dc2626; }

.logs-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--c-border); }
.path-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-code { padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.status-code.ok { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
.status-code.err { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
</style>
