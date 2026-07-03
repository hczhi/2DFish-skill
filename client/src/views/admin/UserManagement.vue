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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, apiGet, apiPost } from '../../lib/api'
import HcModal from '../../components/common/HcModal.vue'

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
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复的组件样式 */
.page { max-width: 1200px; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; }
.error { color: #dc2626; font-size: 13px; margin-top: 12px; font-weight: bold; }
</style>
