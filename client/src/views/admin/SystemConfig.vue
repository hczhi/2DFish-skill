<template>
  <div class="page">
    <div class="page-header">
      <h1>系统配置</h1>
    </div>
    <p class="desc">配置平台级 LLM API Key。使用平台 Key 的用户受每日额度限制，配置了自己 Key 的用户不受限。</p>

    <div class="config-card">
      <div class="form-group">
        <label>Platform API Key</label>
        <div class="input-row">
          <input v-model="form.platform_api_key" type="password" placeholder="sk-..." class="input" />
          <button class="btn-primary" @click="save('platform_api_key', form.platform_api_key)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_api_key">当前: {{ current.platform_api_key.value }}</span>
      </div>

      <div class="form-group">
        <label>API Base URL</label>
        <div class="input-row">
          <input v-model="form.platform_api_base_url" placeholder="https://api.openai.com/v1" class="input" />
          <button class="btn-primary" @click="save('platform_api_base_url', form.platform_api_base_url)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_api_base_url">当前: {{ current.platform_api_base_url.value }}</span>
      </div>

      <div class="form-group">
        <label>默认模型</label>
        <div class="input-row">
          <input v-model="form.platform_model" placeholder="gpt-4o" class="input" />
          <button class="btn-primary" @click="save('platform_model', form.platform_model)">保存</button>
        </div>
        <span class="hint" v-if="current.platform_model">当前: {{ current.platform_model.value }}</span>
      </div>
    </div>

    <p class="success" v-if="saved">已保存</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../../lib/api'

const form = ref<Record<string, string>>({ platform_api_key: '', platform_api_base_url: '', platform_model: '' })
const current = ref<Record<string, { value: string; updated_at: string }>>({})
const saved = ref(false)

async function loadConfig() {
  const data = await apiGet('/api/admin/config')
  current.value = data.config || {}
}

async function save(key: string, value: string) {
  if (!value.trim()) return
  await apiPost('/api/admin/config', { key, value: value.trim() })
  saved.value = true
  setTimeout(() => saved.value = false, 2000)
  await loadConfig()
  form.value[key] = ''
}

onMounted(loadConfig)
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.page { max-width: 800px; }
.desc { 
  color: var(--c-text-sub); 
  font-family: var(--font-mono);
  font-size: 13px; 
  margin-bottom: 32px; 
  line-height: 1.6;
  border-left: 4px solid var(--c-blue-primary);
  padding-left: 16px;
}
.config-card { 
  background: #fff; 
  padding: 32px; 
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.05); 
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04); 
}
.form-group { margin-bottom: 32px; }
.form-group:last-child { margin-bottom: 0; }

.input-row { display: flex; gap: 16px; }
.input { 
  flex: 1; 
  padding: 12px 16px; 
  border: 1px solid #e5e7eb; 
  border-radius: 10px; 
  font-size: 14px; 
  font-family: var(--font-sans, sans-serif); 
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  background: #f9fafb;
}
.input:focus {
  outline: none;
  background: #ffffff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}

.hint { 
  font-size: 12px; 
  color: var(--c-text-sub); 
  margin-top: 8px; 
  display: block; 
  font-family: var(--font-sans, sans-serif); 
}

.success { 
  color: #10b981; 
  font-family: var(--font-mono);
  font-size: 14px; 
  font-weight: bold;
  margin-top: 24px; 
  text-transform: uppercase;
}
</style>
