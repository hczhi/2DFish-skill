<template>
  <div class="tokens-page">
    <div class="tokens-container">
      <div class="page-header">
        <h2>API Token 管理</h2>
        <router-link to="/settings" class="back-link">← 设置</router-link>
      </div>

      <p class="desc">创建 API Token 后，外部系统可通过 <code>Authorization: Bearer mmPla_xxx</code> 调用本平台 API。</p>

      <div class="create-section">
        <input v-model="newName" placeholder="Token 名称（如：我的脚本）" />
        <select v-model="expireDays">
          <option value="">永不过期</option>
          <option value="7">7天</option>
          <option value="30">30天</option>
          <option value="90">90天</option>
        </select>
        <button @click="createToken" :disabled="!newName.trim()">创建</button>
      </div>

      <div v-if="newToken" class="new-token-alert">
        <p><strong>新 Token 已创建，请立即复制保存：</strong></p>
        <code class="token-value">{{ newToken }}</code>
        <button class="copy-btn" @click="copyToken">复制</button>
      </div>

      <table class="tokens-table" v-if="tokens.length > 0">
        <thead>
          <tr><th>名称</th><th>前缀</th><th>创建时间</th><th>过期时间</th><th>最后使用</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tokens" :key="t.id">
            <td>{{ t.name }}</td>
            <td class="mono">{{ t.token_prefix }}</td>
            <td>{{ formatDate(t.created_at) }}</td>
            <td>{{ t.expires_at ? formatDate(t.expires_at) : '永久' }}</td>
            <td>{{ t.last_used_at ? formatDate(t.last_used_at) : '从未' }}</td>
            <td><button class="revoke-btn" @click="revokeToken(t.id)">撤销</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无 Token</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

interface TokenInfo { id: string; name: string; token_prefix: string; created_at: string; expires_at: string | null; last_used_at: string | null }

const tokens = ref<TokenInfo[]>([])
const newName = ref('')
const expireDays = ref('')
const newToken = ref('')

onMounted(loadTokens)

async function loadTokens() {
  const data = await apiGet<{ tokens: TokenInfo[] }>('/api/tokens')
  tokens.value = data.tokens
}

async function createToken() {
  const data = await apiPost<{ token: string }>('/api/tokens', {
    name: newName.value,
    expires_in_days: expireDays.value || undefined,
  })
  newToken.value = data.token
  newName.value = ''
  loadTokens()
}

async function revokeToken(id: string) {
  if (!confirm('确定撤销此 Token？')) return
  await apiDelete(`/api/tokens/${id}`)
  loadTokens()
}

function copyToken() {
  navigator.clipboard.writeText(newToken.value)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.tokens-page { width: 100vw; height: 100vh; overflow: auto; padding: 32px; }
.tokens-container { max-width: 800px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { font-size: 20px; }
.back-link { color: var(--text-muted); text-decoration: none; font-size: 13px; }
.desc { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
.desc code { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 12px; }

.create-section { display: flex; gap: 12px; margin-bottom: 24px; }
.create-section input { flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); font-size: 14px; outline: none; }
.create-section select { padding: 10px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); font-size: 13px; }
.create-section button { padding: 10px 20px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.create-section button:disabled { opacity: 0.4; }

.new-token-alert { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 24px; }
.new-token-alert p { font-size: 13px; margin-bottom: 8px; }
.token-value { display: block; font-size: 12px; word-break: break-all; background: var(--bg); padding: 8px; border-radius: 4px; margin-bottom: 8px; }
.copy-btn { padding: 4px 12px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; font-size: 12px; }

.tokens-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tokens-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-muted); }
.tokens-table td { padding: 8px; border-bottom: 1px solid var(--border); }
.mono { font-family: monospace; font-size: 12px; }
.revoke-btn { padding: 4px 10px; background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; cursor: pointer; font-size: 12px; }
.empty { color: var(--text-muted); text-align: center; margin-top: 32px; }
</style>
