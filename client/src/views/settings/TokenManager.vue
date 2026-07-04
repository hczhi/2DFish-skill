<template>
  <div class="tokens-page">
    <div class="tokens-container">
      <div class="page-header">
        <h2>我的 API Token</h2>
        <router-link to="/" class="back-link">← 返回首页</router-link>
      </div>

      <p class="desc">以下是管理员为你分配的子模块 API Token，可通过 <code>Authorization: Bearer mmPla_xxx</code> 调用对应模块的 API。</p>

      <table class="tokens-table" v-if="tokens.length > 0">
        <thead>
          <tr>
            <th>模块</th>
            <th>Token 前缀</th>
            <th>状态</th>
            <th>过期时间</th>
            <th>最后使用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tokens" :key="t.id">
            <td><strong>{{ t.module_name || t.module_id }}</strong></td>
            <td class="mono">{{ t.token_prefix }}</td>
            <td>
              <span class="status" :class="t.enabled ? 'active' : 'disabled'">
                {{ t.enabled ? '启用' : '已禁用' }}
              </span>
            </td>
            <td>{{ t.expires_at ? formatDate(t.expires_at) : '永久' }}</td>
            <td>{{ t.last_used_at ? formatDate(t.last_used_at) : '从未' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无分配的 Token，请联系管理员开通。</p>

      <nav class="settings-nav">
        <router-link to="/settings/logs">AI 调用日志 →</router-link>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet } from '../../lib/api'

interface TokenInfo {
  id: string
  module_id: string
  module_name: string
  token_prefix: string
  enabled: number
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

const tokens = ref<TokenInfo[]>([])

onMounted(loadTokens)

async function loadTokens() {
  const data = await apiGet<{ tokens: TokenInfo[] }>('/api/tokens')
  tokens.value = data.tokens
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
.desc { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
.desc code { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 12px; }

.tokens-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tokens-table th { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; }
.tokens-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.mono { font-family: monospace; font-size: 12px; }

.status { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.status.active { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
.status.disabled { background: rgba(239, 68, 68, 0.1); color: #dc2626; }

.empty { color: var(--text-muted); text-align: center; margin-top: 32px; }

.settings-nav { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
.settings-nav a { color: var(--primary-light); text-decoration: none; font-size: 14px; }
</style>
