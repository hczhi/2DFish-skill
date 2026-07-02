<template>
  <div class="logs-page">
    <div class="logs-container">
      <div class="page-header">
        <h2>AI 调用日志</h2>
        <router-link to="/settings" class="back-link">← 设置</router-link>
      </div>

      <div class="stats" v-if="stats">
        <div class="stat-card">
          <span class="stat-value">{{ stats.total?.count || 0 }}</span>
          <span class="stat-label">{{ stats.days }}天总调用</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ formatTokens(stats.total?.tokens) }}</span>
          <span class="stat-label">总 Token</span>
        </div>
        <div class="stat-card" v-for="s in stats.bySource" :key="s.source">
          <span class="stat-value">{{ s.count }}</span>
          <span class="stat-label">{{ sourceLabel(s.source) }}</span>
        </div>
      </div>

      <div class="filters">
        <select v-model="filterSource" @change="loadLogs">
          <option value="">全部来源</option>
          <option value="fish">摸鱼游戏</option>
          <option value="board">智慧看板</option>
          <option value="chat">对话</option>
          <option value="consultant">顾问</option>
          <option value="app">App</option>
          <option value="content">内容</option>
        </select>
      </div>

      <table class="logs-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>来源</th>
            <th>操作</th>
            <th>模型</th>
            <th>Token</th>
            <th>耗时</th>
            <th>摘要</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="time">{{ formatTime(log.created_at) }}</td>
            <td><span class="source-badge" :class="log.source">{{ sourceLabel(log.source) }}</span></td>
            <td>{{ log.operation }}</td>
            <td class="mono">{{ log.model }}</td>
            <td class="mono">{{ log.total_tokens }}</td>
            <td class="mono">{{ log.duration_ms ? `${log.duration_ms}ms` : '-' }}</td>
            <td class="summary">{{ log.request_summary || '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="logs.length === 0" class="empty">暂无日志</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet } from '../../lib/api'

interface LogEntry {
  id: string; source: string; operation: string; model: string;
  input_tokens: number; output_tokens: number; total_tokens: number;
  duration_ms: number | null; request_summary: string | null; created_at: string;
}

const logs = ref<LogEntry[]>([])
const stats = ref<any>(null)
const filterSource = ref('')

onMounted(() => { loadLogs(); loadStats() })

async function loadLogs() {
  const params = filterSource.value ? `?source=${filterSource.value}` : ''
  const data = await apiGet<{ logs: LogEntry[] }>(`/api/ai/logs${params}`)
  logs.value = data.logs
}

async function loadStats() {
  stats.value = await apiGet('/api/ai/logs/stats')
}

function sourceLabel(s: string): string {
  const map: Record<string, string> = { fish: '摸鱼', board: '看板', chat: '对话', consultant: '顾问', app: 'App', content: '内容' }
  return map[s] || s
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

function formatTokens(n: number | undefined): string {
  if (!n) return '0'
  return n > 10000 ? `${(n/1000).toFixed(1)}k` : String(n)
}
</script>

<style scoped>
.logs-page { width: 100vw; height: 100vh; overflow: auto; padding: 32px; }
.logs-container { max-width: 1000px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-header h2 { font-size: 20px; }
.back-link { color: var(--text-muted); text-decoration: none; font-size: 13px; }

.stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; min-width: 100px; text-align: center; }
.stat-value { display: block; font-size: 20px; font-weight: 700; color: var(--primary-light); }
.stat-label { font-size: 12px; color: var(--text-muted); }

.filters { margin-bottom: 16px; }
.filters select { padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; }

.logs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.logs-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 500; }
.logs-table td { padding: 8px; border-bottom: 1px solid var(--border); }
.time { white-space: nowrap; color: var(--text-muted); }
.mono { font-family: monospace; font-size: 12px; }
.summary { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }

.source-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg-hover); }
.source-badge.fish { color: #60a5fa; }
.source-badge.board { color: #a78bfa; }
.source-badge.chat { color: #34d399; }
.source-badge.consultant { color: #fbbf24; }

.empty { text-align: center; color: var(--text-muted); margin-top: 32px; }
</style>
