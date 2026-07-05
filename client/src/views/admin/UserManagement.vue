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
            <td>{{ u.used_today ?? 0 }} / {{ u.daily_limit ?? 10 }}</td>
            <td><span style="color: var(--c-text-sub); font-size: 13px;">{{ formatDate(u.created_at) }}</span></td>
            <td>
              <div class="table-actions">
                <button class="hc-btn hc-btn-secondary" @click="toggleRole(u)">
                  {{ u.role === 'admin' ? '降为用户' : '设为管理员' }}
                </button>
                <button class="hc-btn hc-btn-secondary" @click="openTokenPanel(u)">Token管理</button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { api, apiGet, apiPost, apiDelete } from '../../lib/api'
import HcModal from '../../components/common/HcModal.vue'
import AdminPagination from '../../components/common/AdminPagination.vue'

interface UserRow {
  id: string; username: string; role: string; total_ai_calls: number;
  daily_limit: number | null; used_today: number | null;
  created_at: string;
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

.logs-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--c-border); }
.path-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-code { padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.status-code.ok { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
.status-code.err { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
</style>
