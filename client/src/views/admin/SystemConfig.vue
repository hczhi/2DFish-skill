<template>
  <div class="page">
    <h1>系统配置</h1>
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
h1 { font-family: -apple-system, sans-serif; font-size: 24px; font-weight: 600; margin-bottom: 8px; }
.desc { color: #666; font-size: 14px; margin-bottom: 24px; }
.config-card { background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.form-group { margin-bottom: 20px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: #333; margin-bottom: 6px; }
.input-row { display: flex; gap: 8px; }
.input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; font-family: monospace; }
.hint { font-size: 12px; color: #888; margin-top: 4px; display: block; font-family: monospace; }
.btn-primary { padding: 8px 16px; background: #0052FF; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; white-space: nowrap; }
.btn-primary:hover { background: #003ecc; }
.success { color: #00a854; font-size: 14px; margin-top: 16px; }
</style>
