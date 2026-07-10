<template>
  <div class="page">
    <div class="page-header">
      <h1>UI 评测记录</h1>
    </div>

    <div class="filter-bar">
      <input v-model="filterUrl" placeholder="搜索网址..." class="filter-input" @input="debouncedLoad" />
      <select v-model="filterStatus" @change="loadRecords">
        <option value="">全部状态</option>
        <option value="completed">已完成</option>
        <option value="pending">待处理</option>
        <option value="failed">失败</option>
      </select>
    </div>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>截图</th>
            <th>网址</th>
            <th>用户</th>
            <th>行业</th>
            <th>评分</th>
            <th>状态</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="review in reviews" :key="review.id">
            <td>
              <img v-if="review.screenshot_url" :src="review.screenshot_url" class="review-thumb" />
              <span v-else class="no-thumb">-</span>
            </td>
            <td class="url-cell" :title="review.url">{{ review.url }}</td>
            <td>{{ review.user_id }}</td>
            <td>{{ review.industry_type || '-' }}</td>
            <td>
              <span v-if="review.total_score" class="score-badge">{{ Math.round(review.total_score) }}</span>
              <span v-else>-</span>
            </td>
            <td>
              <span :class="['hc-badge', statusClass(review.status)]">{{ review.status }}</span>
            </td>
            <td>{{ formatDate(review.created_at) }}</td>
            <td class="table-actions">
              <router-link :to="`/admin/ui-review-records/${review.id}`" class="btn-sm">详情</router-link>
              <button class="btn-sm btn-danger" @click="deleteReview(review.id)">删除</button>
            </td>
          </tr>
          <tr v-if="reviews.length === 0">
            <td colspan="8" style="text-align:center; color: #999;">暂无评测记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <AdminPagination v-if="total > 0" v-model="currentPage" :total="total" :total-pages="totalPages" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { apiGet, apiDelete } from '../../lib/api'
import AdminPagination from '../../components/common/AdminPagination.vue'

interface Review {
  id: string
  user_id: string
  url: string
  status: string
  industry_type: string
  total_score: number
  screenshot_url: string
  created_at: string
}

const reviews = ref<Review[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = 20
const totalPages = computed(() => Math.ceil(total.value / pageSize))

const filterUrl = ref('')
const filterStatus = ref('')

let debounceTimer: any = null
function debouncedLoad() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadRecords, 300)
}

async function loadRecords() {
  const params = new URLSearchParams({
    page: String(currentPage.value),
    page_size: String(pageSize),
  })
  if (filterStatus.value) params.set('status', filterStatus.value)
  const data = await apiGet(`/api/ui-review/admin/reviews?${params}`)
  reviews.value = data.items
  total.value = data.total
}

function statusClass(status: string) {
  if (status === 'completed') return 'hc-badge-green'
  if (status === 'failed') return 'hc-badge-red'
  if (status === 'pending') return 'hc-badge-gray'
  return 'hc-badge-blue'
}

function formatDate(iso: string) {
  if (!iso) return '-'
  return iso.slice(0, 16).replace('T', ' ')
}

async function deleteReview(id: string) {
  if (!confirm('确定删除此记录？')) return
  await apiDelete(`/api/ui-review/admin/reviews/${id}`)
  loadRecords()
}

watch(currentPage, loadRecords)
onMounted(loadRecords)
</script>

<style scoped>
.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.filter-input {
  flex: 1;
  max-width: 300px;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}
.filter-bar select {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}
.review-thumb {
  width: 60px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
}
.no-thumb {
  color: #999;
}
.url-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.score-badge {
  display: inline-block;
  background: #4361EE;
  color: #fff;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
</style>
