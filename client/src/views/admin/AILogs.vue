<template>
  <div class="page">
    <div class="page-header">
      <h1>AI 通信日志</h1>
      <div class="filters">
        <select v-model="source" class="select" @change="reload">
          <option value="">全部模块</option>
          <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="providerOwner" class="select" @change="reload">
          <option value="">全部渠道</option>
          <option value="platform">平台渠道</option>
          <option value="dedicated">用户专属</option>
        </select>
        <select v-model="model" class="select" @change="reload">
          <option value="">全部模型</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
        <select v-model="userId" class="select" @change="reload">
          <option value="">全部用户</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
        </select>
        <button class="select" @click="reload">刷新</button>
      </div>
    </div>

    <p class="hint">
      每一行是一次与 LLM 的完整往返。点「查看」看完整输入（含系统拼装的 skill / 禁用库等上下文）、完整输出与 token。
      「渠道」列区分这次调用烧的是平台的 key 还是该用户专属渠道的 key。
    </p>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>模块</th>
            <th>操作</th>
            <th>模型</th>
            <th>渠道</th>
            <th>输入 tok</th>
            <th>输出 tok</th>
            <th>耗时</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="mono">{{ fmtTime(log.created_at) }}</td>
            <td><span class="hc-badge hc-badge-blue">{{ log.source }}</span></td>
            <td>{{ log.operation }}</td>
            <td class="mono dim">{{ log.model }}</td>
            <td>
              <span :class="['hc-badge', log.provider_owner === 'dedicated' ? 'hc-badge-green' : 'hc-badge-gray']">
                {{ log.provider_owner === 'dedicated' ? '专属' : '平台' }}
              </span>
            </td>
            <td class="num">{{ log.input_tokens }}</td>
            <td class="num">{{ log.output_tokens }}</td>
            <td class="num dim">{{ log.duration_ms != null ? log.duration_ms + 'ms' : '—' }}</td>
            <td><button class="view-btn" @click="openDetail(log.id)">查看</button></td>
          </tr>
          <tr v-if="!logs.length">
            <td colspan="9" class="empty">暂无记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager" v-if="total > pageSize">
      <button class="select" :disabled="offset === 0" @click="prevPage">上一页</button>
      <span class="page-info">{{ offset + 1 }} – {{ Math.min(offset + pageSize, total) }} / {{ total }}</span>
      <button class="select" :disabled="offset + pageSize >= total" @click="nextPage">下一页</button>
    </div>

    <!-- 详情抽屉 -->
    <div v-if="detailOpen" class="d-mask" @click.self="detailOpen = false">
      <div class="d-panel">
        <div class="d-head">
          <div>
            <span class="hc-badge hc-badge-blue">{{ detail?.source }}</span>
            <span class="d-op">{{ detail?.operation }}</span>
          </div>
          <button class="d-x" @click="detailOpen = false">✕</button>
        </div>

        <div class="d-body" v-if="detail">
          <div class="d-meta">
            <span>模型 <b class="mono">{{ detail.model }}</b></span>
            <span>输入 <b>{{ detail.input_tokens }}</b> tok</span>
            <span>输出 <b>{{ detail.output_tokens }}</b> tok</span>
            <span>耗时 <b>{{ detail.duration_ms != null ? detail.duration_ms + 'ms' : '—' }}</b></span>
            <span>渠道 <b>{{ detail.provider_owner === 'dedicated' ? '用户专属' : '平台' }}</b></span>
            <span v-if="detail.provider_id">provider <b class="mono">{{ detail.provider_id }}</b></span>
            <span>{{ fmtTime(detail.created_at) }}</span>
          </div>

          <div class="d-sec">
            <div class="d-sec-head">
              <span>完整输入（messages）</span>
              <button class="copy-btn" @click="copy(prettyRequest)">复制</button>
            </div>
            <pre class="d-pre">{{ prettyRequest }}</pre>
          </div>

          <div class="d-sec">
            <div class="d-sec-head">
              <span>完整输出</span>
              <button class="copy-btn" @click="copy(detail.response_body || '')">复制</button>
            </div>
            <pre class="d-pre">{{ detail.response_body || '（无内容 / 老记录未记全文）' }}</pre>
          </div>
        </div>
        <div class="d-body" v-else>
          <p class="empty">加载中…</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiGet } from '../../lib/api'

interface LogRow {
  id: string
  source: string
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  duration_ms: number | null
  request_summary: string | null
  user_id: string | null
  provider_id?: string | null
  provider_owner?: 'platform' | 'dedicated' | null
  created_at: string
  request_body?: string | null
  response_body?: string | null
}

const logs = ref<LogRow[]>([])
const total = ref(0)
const offset = ref(0)
const pageSize = 50
const source = ref('')
const providerOwner = ref('')
const model = ref('')
const userId = ref('')

// 筛选项从后端实际日志里取，不在前端写死枚举——写死会漏掉新模块。
const sources = ref<string[]>([])
const models = ref<string[]>([])
const users = ref<{ id: string; username: string }[]>([])

const detailOpen = ref(false)
const detail = ref<LogRow | null>(null)

async function reload() {
  offset.value = 0
  await load()
}
async function load() {
  const q = new URLSearchParams({ limit: String(pageSize), offset: String(offset.value) })
  if (source.value) q.set('source', source.value)
  if (providerOwner.value) q.set('provider_owner', providerOwner.value)
  if (model.value) q.set('model', model.value)
  if (userId.value) q.set('user_id', userId.value)
  const r = await apiGet<{ logs: LogRow[]; total: number }>(`/api/ai/logs?${q.toString()}`)
  logs.value = r.logs || []
  total.value = r.total || 0
}

async function loadFilters() {
  try {
    const r = await apiGet<{ sources: string[]; models: string[]; users: { id: string; username: string }[] }>(
      '/api/ai/logs/filters'
    )
    sources.value = r.sources || []
    models.value = r.models || []
    users.value = r.users || []
  } catch { /* 筛选项拉不到不该挡住日志列表 */ }
}
function nextPage() { offset.value += pageSize; load() }
function prevPage() { offset.value = Math.max(0, offset.value - pageSize); load() }

async function openDetail(id: string) {
  detail.value = null
  detailOpen.value = true
  const r = await apiGet<{ log: LogRow }>(`/api/ai/logs/${id}`)
  detail.value = r.log
}

// 请求体存的是 messages 的 JSON 串，尽量美化展示；解析失败就原样显示。
const prettyRequest = computed(() => {
  const raw = detail.value?.request_body
  if (!raw) return '（无内容 / 老记录未记全文）'
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
})

function fmtTime(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function copy(text: string) {
  navigator.clipboard?.writeText(text)
}

onMounted(() => { load(); loadFilters() })
</script>

<style scoped>
.page { max-width: 1200px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.hint { color: #6B7280; font-size: 13px; margin: 0 0 16px; }
.select {
  font-family: var(--font-sans, sans-serif); font-size: 14px; font-weight: 600;
  padding: 8px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;
  cursor: pointer; color: #374151; transition: all 0.2s;
}
.select:hover:not(:disabled) { background: #fff; border-color: #3B5BDB; }
.select:disabled { opacity: .5; cursor: not-allowed; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dim { color: #9CA3AF; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.empty { text-align: center; color: #9CA3AF; padding: 32px 0; }
.view-btn {
  border: 1px solid #e5e7eb; background: #fff; border-radius: 6px; padding: 4px 12px;
  font-size: 13px; cursor: pointer; color: #3B5BDB; font-weight: 600;
}
.view-btn:hover { background: #EEF2FF; border-color: #3B5BDB; }

.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; }
.page-info { color: #6B7280; font-size: 13px; }

/* 详情抽屉 */
.d-mask { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 1000; display: flex; justify-content: flex-end; }
.d-panel { width: min(760px, 96vw); height: 100%; background: #fff; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.12); }
.d-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #E5E7EB; }
.d-op { margin-left: 10px; font-weight: 600; color: #374151; }
.d-x { border: none; background: none; font-size: 16px; color: #9CA3AF; cursor: pointer; }
.d-body { padding: 20px; overflow-y: auto; flex: 1; }
.d-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: #6B7280; margin-bottom: 20px; }
.d-meta b { color: #111827; }
.d-sec { margin-bottom: 20px; }
.d-sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #374151; }
.copy-btn { border: 1px solid #e5e7eb; background: #fff; border-radius: 6px; padding: 2px 10px; font-size: 12px; cursor: pointer; color: #6B7280; }
.copy-btn:hover { background: #f3f4f6; }
.d-pre {
  margin: 0; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; max-height: 40vh; overflow-y: auto; color: #1F2937;
}
</style>
