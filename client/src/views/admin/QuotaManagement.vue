<template>
  <div class="page">
    <div class="page-header">
      <h1>额度管理</h1>
    </div>
    <p class="desc">管理每个用户的每日 AI 调用限额。用户使用平台 Key 时受此限制，配置了自己 Key 的用户不受限。</p>

    <div class="hc-table-container" v-if="quotas.length">
      <table class="hc-table">
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
            <td>
              <div style="font-weight: 600; color: var(--c-text-main);">{{ q.username }}</div>
            </td>
            <td>
              <input
                type="number"
                :value="q.daily_limit"
                min="0"
                @change="updateLimit(q.user_id, ($event.target as HTMLInputElement).value)"
                style="width: 80px; padding: 6px 12px; border: 1px solid var(--c-border); border-radius: 6px; text-align: center; outline: none; transition: border-color 0.2s;"
                onfocus="this.style.borderColor='var(--c-blue-primary)'"
                onblur="this.style.borderColor='var(--c-border)'"
              />
            </td>
            <td>{{ q.used_today }}</td>
            <td><span style="color: var(--c-text-sub); font-size: 13px;">{{ q.last_reset_date }}</span></td>
            <td>
              <div class="table-actions">
                <button class="hc-btn hc-btn-secondary" @click="updateLimit(q.user_id, '999')">解除限制</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <AdminPagination v-model="currentPage" :total="totalQuotas" :total-pages="totalPages" />
    </div>
    <p v-else class="empty">暂无额度记录（用户首次调用 AI 时自动创建）</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { apiGet } from '../../lib/api'
import { api } from '../../lib/api'
import AdminPagination from '../../components/common/AdminPagination.vue'

const PAGE_SIZE = 20

interface QuotaRow {
  user_id: string; username: string; daily_limit: number; used_today: number; last_reset_date: string;
}

const quotas = ref<QuotaRow[]>([])
const totalQuotas = ref(0)
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(totalQuotas.value / PAGE_SIZE))

async function loadQuotas() {
  const data = await apiGet(`/api/admin/quotas?page=${currentPage.value}&page_size=${PAGE_SIZE}`)
  quotas.value = data.quotas
  totalQuotas.value = data.total
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

watch(currentPage, loadQuotas)
onMounted(loadQuotas)
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.page { max-width: 1200px; }
.desc { 
  color: var(--c-text-sub); 
  font-family: var(--font-sans, sans-serif);
  font-size: 13px; 
  margin-bottom: 32px; 
  line-height: 1.6;
  border-left: 4px solid #3B5BDB;
  padding-left: 16px;
}
.inline-input { 
  width: 100px; 
  padding: 8px; 
  border: 1px solid #e5e7eb; 
  border-radius: 8px; 
  font-family: var(--font-sans, sans-serif);
  font-size: 14px; 
  font-weight: 600;
  text-align: center; 
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.inline-input:focus {
  outline: none;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}
.empty { 
  color: var(--c-text-sub); 
  font-family: var(--font-sans, sans-serif);
  font-size: 14px; 
  margin-top: 32px; 
  text-align: center;
  padding: 40px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
}
</style>
