<template>
  <div class="page">
    <div class="page-header">
      <h1>额度管理</h1>
    </div>
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
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.page { max-width: 1200px; }
.desc { 
  color: var(--c-text-sub); 
  font-family: var(--font-mono);
  font-size: 13px; 
  margin-bottom: 32px; 
  line-height: 1.6;
  border-left: 4px solid var(--c-blue-primary);
  padding-left: 16px;
}
.inline-input { 
  width: 100px; 
  padding: 8px; 
  border: 1px solid var(--c-text-main); 
  border-radius: 0; 
  font-family: var(--font-mono);
  font-size: 14px; 
  font-weight: bold;
  text-align: center; 
  transition: all 0.2s;
}
.inline-input:focus {
  outline: none;
  box-shadow: 4px 4px 0 var(--c-blue-primary);
}
.empty { 
  color: var(--c-text-sub); 
  font-family: var(--font-mono);
  text-transform: uppercase;
  font-size: 14px; 
  margin-top: 32px; 
  text-align: center;
  padding: 40px;
  border: 2px dashed #ddd;
}
</style>
