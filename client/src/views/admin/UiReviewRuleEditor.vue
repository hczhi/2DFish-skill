<template>
  <div class="page">
    <div class="page-header">
      <h1>{{ isEdit ? '编辑规则' : '新建规则' }}</h1>
      <button class="btn-secondary" @click="$router.back()">&larr; 返回</button>
    </div>

    <div class="editor-card">
      <form @submit.prevent="saveRule">
        <div class="form-grid">
          <div class="form-row">
            <label>名称 *</label>
            <input v-model="form.name" required placeholder="如: 颜色对比度检测" />
          </div>
          <div class="form-row">
            <label>维度 *</label>
            <select v-model="form.dimension" required>
              <option value="contrast">对比度</option>
              <option value="typography">排版</option>
              <option value="spacing">间距</option>
              <option value="color">配色</option>
              <option value="layout">布局</option>
              <option value="interaction">交互</option>
            </select>
          </div>
          <div class="form-row full">
            <label>描述</label>
            <textarea v-model="form.description" rows="3" placeholder="检测逻辑说明..."></textarea>
          </div>
          <div class="form-row">
            <label>检测类型</label>
            <select v-model="form.detection_type">
              <option value="dom">DOM</option>
              <option value="css">CSS</option>
              <option value="performance">性能</option>
              <option value="accessibility">可访问性</option>
            </select>
          </div>
          <div class="form-row">
            <label>严重程度</label>
            <select v-model="form.severity">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div class="form-row">
            <label>权重 (0-10)</label>
            <input v-model.number="form.weight" type="number" min="0" max="10" step="0.1" />
          </div>
          <div class="form-row">
            <label>排序</label>
            <input v-model.number="form.sort_order" type="number" />
          </div>
          <div class="form-row full">
            <label>检测配置 (JSON)</label>
            <textarea v-model="form.detection_config_str" rows="5" placeholder='{"threshold": 4.5, "selector": "..."}'></textarea>
          </div>
          <div class="form-row full">
            <label>行业权重 (JSON)</label>
            <textarea v-model="form.industry_weights_str" rows="3" placeholder='{"ecommerce": 1.2, "saas": 0.8}'></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-cancel" @click="$router.back()">取消</button>
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </form>
    </div>

    <!-- Debug Panel -->
    <div v-if="isEdit" class="debug-panel">
      <h3>调试此规则</h3>
      <div class="debug-input-row">
        <input v-model="debugUrl" placeholder="输入测试网址..." class="debug-input" />
        <button class="btn-primary" @click="runDebug" :disabled="debugLoading">
          {{ debugLoading ? '检测中...' : '运行检测' }}
        </button>
      </div>
      <div v-if="debugResult" class="debug-result">
        <pre>{{ JSON.stringify(debugResult, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, apiGet, apiPost } from '../../lib/api'

const router = useRouter()
const route = useRoute()
const isEdit = computed(() => !!route.params.id)
const saving = ref(false)

const form = ref({
  name: '',
  dimension: 'contrast',
  description: '',
  detection_type: 'dom',
  detection_config_str: '{}',
  weight: 1.0,
  severity: 'warning',
  industry_weights_str: '{}',
  sort_order: 0,
})

const debugUrl = ref('')
const debugResult = ref<any>(null)
const debugLoading = ref(false)

async function loadRule() {
  if (!route.params.id) return
  const rules = await apiGet('/api/ui-review/admin/rules')
  const rule = rules.find((r: any) => r.id === route.params.id)
  if (rule) {
    form.value = {
      name: rule.name,
      dimension: rule.dimension,
      description: rule.description,
      detection_type: rule.detection_type,
      detection_config_str: rule.detection_config || '{}',
      weight: rule.weight,
      severity: rule.severity,
      industry_weights_str: rule.industry_weights || '{}',
      sort_order: rule.sort_order,
    }
  }
}

async function saveRule() {
  saving.value = true
  try {
    let detection_config = {}
    let industry_weights = {}
    try { detection_config = JSON.parse(form.value.detection_config_str) } catch {}
    try { industry_weights = JSON.parse(form.value.industry_weights_str) } catch {}

    const payload = {
      name: form.value.name,
      dimension: form.value.dimension,
      description: form.value.description,
      detection_type: form.value.detection_type,
      detection_config,
      weight: form.value.weight,
      severity: form.value.severity,
      industry_weights,
      sort_order: form.value.sort_order,
    }

    if (isEdit.value) {
      await api(`/api/ui-review/admin/rules/${route.params.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await apiPost('/api/ui-review/admin/rules', payload)
    }
    router.push('/admin/ui-review-rules')
  } finally {
    saving.value = false
  }
}

async function runDebug() {
  if (!debugUrl.value || !route.params.id) return
  debugLoading.value = true
  debugResult.value = null
  try {
    debugResult.value = await apiPost(`/api/ui-review/admin/rules/${route.params.id}/debug`, { url: debugUrl.value })
  } catch (e: any) {
    debugResult.value = { error: e.message }
  } finally {
    debugLoading.value = false
  }
}

onMounted(loadRule)
</script>

<style scoped>
.editor-card {
  background: #fff;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.05);
  box-shadow: 0 8px 24px rgba(0,0,0,0.04);
  padding: 32px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.form-row.full {
  grid-column: 1 / -1;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}
.debug-panel {
  margin-top: 32px;
  padding: 24px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.debug-panel h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
}
.debug-input-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.debug-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}
.debug-result {
  margin-top: 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
}
.debug-result pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
