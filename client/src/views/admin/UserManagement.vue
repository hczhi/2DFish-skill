<template>
  <div class="page">
    <div class="page-header">
      <h1>用户管理</h1>
      <button class="btn-primary" @click="showCreate = true">+ 新增用户</button>
    </div>

    <table class="data-table" v-if="users.length">
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
          <td><strong>{{ u.username }}</strong></td>
          <td><span class="badge" :class="u.role">{{ u.role }}</span></td>
          <td>{{ u.total_ai_calls }}</td>
          <td>{{ u.used_today ?? 0 }} / {{ u.daily_limit ?? 10 }}</td>
          <td>{{ formatDate(u.created_at) }}</td>
          <td>
            <button class="btn-sm" @click="toggleRole(u)">
              {{ u.role === 'admin' ? '降为用户' : '设为管理员' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Create User Dialog -->
    <div class="modal-overlay" v-if="showCreate" @click.self="showCreate = false">
      <div class="modal-card">
        <h3>新增用户</h3>
        <div class="form-group">
          <label>用户名</label>
          <input v-model="newUser.username" placeholder="输入用户名" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="newUser.password" type="password" placeholder="至少6位" />
        </div>
        <div class="form-actions">
          <button class="btn-secondary" @click="showCreate = false">取消</button>
          <button class="btn-primary" @click="createUser">创建</button>
        </div>
        <p class="error" v-if="createError">{{ createError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, apiGet, apiPost } from '../../lib/api'

interface UserRow {
  id: string; username: string; role: string; total_ai_calls: number;
  daily_limit: number | null; used_today: number | null;
  created_at: string;
}

const users = ref<UserRow[]>([])
const showCreate = ref(false)
const newUser = ref({ username: '', password: '' })
const createError = ref('')

async function loadUsers() {
  const data = await apiGet('/api/admin/users')
  users.value = data.users
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

onMounted(loadUsers)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-header h1 { font-family: -apple-system, sans-serif; font-size: 24px; font-weight: 600; }
.data-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.data-table th { text-align: left; padding: 12px 16px; background: #f8f9fa; font-size: 13px; color: #666; font-weight: 500; }
.data-table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.badge.admin { background: #ffe6e6; color: #c00; }
.badge.user { background: #e6f0ff; color: #0052FF; }
.btn-primary { padding: 8px 16px; background: #0052FF; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
.btn-primary:hover { background: #003ecc; }
.btn-secondary { padding: 8px 16px; background: #fff; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer; }
.btn-sm { padding: 4px 10px; font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; }
.btn-sm:hover { background: #f5f5f5; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-card { background: #fff; padding: 24px; border-radius: 12px; width: 360px; }
.modal-card h3 { margin: 0 0 16px; font-family: -apple-system, sans-serif; font-weight: 600; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; }
.form-group input { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.error { color: #c00; font-size: 13px; margin-top: 8px; }
</style>
