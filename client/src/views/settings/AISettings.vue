<template>
  <div class="settings-page">
    <div class="settings-card">
      <div class="card-header">
        <h2>AI 设置</h2>
        <router-link to="/" class="back-link">← 返回</router-link>
      </div>

      <form @submit.prevent="saveSettings">
        <div class="field">
          <label>API Base URL</label>
          <input v-model="form.baseURL" type="text" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="field">
          <label>API Key</label>
          <input v-model="form.apiKey" type="password" placeholder="sk-..." />
          <p class="hint" v-if="currentKey">当前: {{ currentKey }}</p>
        </div>
        <div class="field">
          <label>Model</label>
          <input v-model="form.model" type="text" placeholder="gpt-4o" />
        </div>
        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
          <span class="success" v-if="saved">已保存</span>
        </div>
      </form>

      <nav class="settings-nav">
        <router-link to="/settings/logs">AI 调用日志 →</router-link>
        <router-link to="/settings/tokens">API Token 管理 →</router-link>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../../lib/api'

const form = ref({ baseURL: '', apiKey: '', model: '' })
const currentKey = ref('')
const saving = ref(false)
const saved = ref(false)

onMounted(async () => {
  try {
    const data = await apiGet<Record<string, string>>('/api/settings')
    form.value.baseURL = data.baseURL || ''
    form.value.model = data.model || ''
    currentKey.value = data.apiKey || ''
  } catch {}
})

async function saveSettings() {
  saving.value = true
  saved.value = false
  try {
    await apiPost('/api/settings', form.value)
    saved.value = true
    if (form.value.apiKey && !form.value.apiKey.includes('...')) {
      currentKey.value = form.value.apiKey.slice(0, 7) + '...' + form.value.apiKey.slice(-4)
      form.value.apiKey = ''
    }
    setTimeout(() => { saved.value = false }, 3000)
  } catch {}
  saving.value = false
}
</script>

<style scoped>
.settings-page { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
.settings-card { width: 480px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.card-header h2 { font-size: 20px; }
.back-link { color: var(--text-muted); text-decoration: none; font-size: 13px; }

form { display: flex; flex-direction: column; gap: 20px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; color: var(--text-muted); }
.field input { padding: 10px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 14px; outline: none; }
.field input:focus { border-color: var(--primary); }
.hint { font-size: 12px; color: var(--text-muted); }

.actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.actions button { padding: 10px 24px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.actions button:disabled { opacity: 0.5; }
.success { font-size: 13px; color: #22c55e; }

.settings-nav { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
.settings-nav a { color: var(--primary-light); text-decoration: none; font-size: 14px; }
</style>
