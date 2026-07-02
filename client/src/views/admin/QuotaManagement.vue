<template>
  <div class="page">
    <h1>额度管理</h1>
    <p class="desc">管理每个用户的每日 AI 调用限额。用户使用平台 Key 时受此限制，配置了自己 Key 的用户不受限。</p>

    <table class="data-table" v-if="quotas.length">
      <thead>
        <tr>
          <th>用户</th>
          <th>每日限额</th>
          <th>今日已用</th>
          <th>最后重置</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="q in quotas" :key="q.user_id">
          <td><strong>{{ q.username }}</strong></td>
          <td>
            <input type="number" :value="q.daily_limit" min="0" class="inline-input"
              @change="updateLimit(q.user_id, ($event.target as HTMLInputElement).value)" />
          </td>
          <td>{{ q.used_today }}</td>
          <td>{{ q.last_reset_date }}</td>
          <td>
            <button class="btn-sm" @click="updateLimit(q.user_id, '999')">解除限制</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">暂无额度记录（用户首次调用 AI 时自动创建）</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet } from '../../lib/api'
import { api } from '../../lib/api'

interface QuotaRow {
  user_id: string; username: string; daily_limit: number; used_today: number; last_reset_date: string;
}

const quotas = ref<QuotaRow[]>([])

async function loadQuotas() {
  const data = await apiGet('/api/admin/quotas')
  quotas.value = data.quotas
}

async function updateLimit(userId: string, value: string) {
  const limit = parseInt(value, 10)
  if (isNaN(limit) || limit < 0) return
  await api(`/api/admin/quotas/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ daily_limit: limit }),
  })
  await loadQuotas()
}

onMounted(loadQuotas)
</script>

<style scoped>
h1 { font-family: -apple-system, sans-serif; font-size: 24px; font-weight: 600; margin-bottom: 8px; }
.desc { color: #666; font-size: 14px; margin-bottom: 24px; }
.data-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.data-table th { text-align: left; padding: 12px 16px; background: #f8f9fa; font-size: 13px; color: #666; font-weight: 500; }
.data-table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.inline-input { width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center; }
.btn-sm { padding: 4px 10px; font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; }
.btn-sm:hover { background: #f5f5f5; }
.empty { color: #999; font-size: 14px; margin-top: 24px; }
</style>
