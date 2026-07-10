<template>
  <div class="page">
    <div class="page-header">
      <h1>{{ isEdit ? '编辑 Skill' : '新建 Skill' }}</h1>
      <button class="btn-secondary" @click="$router.back()">&larr; 返回</button>
    </div>

    <div class="editor-card">
      <form @submit.prevent="saveSkill">
        <div class="form-grid">
          <div class="form-row">
            <label>名称 *</label>
            <input v-model="form.name" required placeholder="如: Linear 风格" />
          </div>
          <div class="form-row">
            <label>行业类型</label>
            <select v-model="form.industry_type">
              <option value="">通用</option>
              <option value="ecommerce">电商</option>
              <option value="saas">SaaS</option>
              <option value="content">内容站</option>
              <option value="corporate">企业官网</option>
            </select>
          </div>
          <div class="form-row full">
            <label>描述</label>
            <textarea v-model="form.description" rows="2" placeholder="简要描述这个风格的特点..."></textarea>
          </div>
          <div class="form-row full">
            <label>缩略图</label>
            <ImageUpload v-model="form.thumbnail_url" />
          </div>
          <div class="form-row full">
            <label>设计特征 (JSON)</label>
            <textarea v-model="form.design_features_str" rows="8" placeholder='{"palette": [...], "spacing_style": "..."}'></textarea>
          </div>
          <div class="form-row full">
            <label>Skill 模板 (Markdown)</label>
            <textarea v-model="form.skill_template" rows="12" placeholder="# Style Skill..."></textarea>
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
      <h3>调试此 Skill</h3>
      <div class="debug-input-row">
        <input v-model="debugUrl" placeholder="输入测试网址..." class="debug-input" />
        <button class="btn-primary" @click="runDebug" :disabled="debugLoading">
          {{ debugLoading ? '生成中...' : '生成预览' }}
        </button>
      </div>
      <div v-if="debugHtml || debugSkillDoc" class="debug-preview">
        <div class="preview-tabs">
          <button :class="{ active: debugTab === 'preview' }" @click="debugTab = 'preview'">预览</button>
          <button :class="{ active: debugTab === 'skill' }" @click="debugTab = 'skill'">Skill 文档</button>
        </div>
        <iframe v-if="debugTab === 'preview'" :srcdoc="debugHtml" class="preview-iframe" sandbox="allow-scripts"></iframe>
        <pre v-else class="skill-preview">{{ debugSkillDoc }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, apiGet, apiPost } from '../../lib/api'
import ImageUpload from '../../components/common/ImageUpload.vue'

const router = useRouter()
const route = useRoute()
const isEdit = computed(() => !!route.params.id)
const saving = ref(false)

const form = ref({
  name: '',
  description: '',
  thumbnail_url: '',
  industry_type: '',
  design_features_str: '{}',
  skill_template: '',
})

const debugUrl = ref('')
const debugHtml = ref('')
const debugSkillDoc = ref('')
const debugLoading = ref(false)
const debugTab = ref<'preview' | 'skill'>('preview')

async function loadSkill() {
  if (!route.params.id) return
  const skills = await apiGet('/api/ui-review/admin/skills')
  const skill = skills.find((s: any) => s.id === route.params.id)
  if (skill) {
    form.value = {
      name: skill.name,
      description: skill.description,
      thumbnail_url: skill.thumbnail_url,
      industry_type: skill.industry_type,
      design_features_str: skill.design_features || '{}',
      skill_template: skill.skill_template,
    }
  }
}

async function saveSkill() {
  saving.value = true
  try {
    let design_features = {}
    try { design_features = JSON.parse(form.value.design_features_str) } catch {}

    const payload = {
      name: form.value.name,
      description: form.value.description,
      thumbnail_url: form.value.thumbnail_url,
      industry_type: form.value.industry_type,
      design_features,
      skill_template: form.value.skill_template,
    }

    if (isEdit.value) {
      await api(`/api/ui-review/admin/skills/${route.params.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await apiPost('/api/ui-review/admin/skills', payload)
    }
    router.push('/admin/ui-style-skills')
  } finally {
    saving.value = false
  }
}

async function runDebug() {
  if (!debugUrl.value || !route.params.id) return
  debugLoading.value = true
  debugHtml.value = ''
  debugSkillDoc.value = ''
  try {
    const result = await apiPost(`/api/ui-review/admin/skills/${route.params.id}/debug`, { url: debugUrl.value })
    debugHtml.value = result.preview_html || ''
    debugSkillDoc.value = result.skill_markdown || ''
  } catch (e: any) {
    debugHtml.value = `<p style="color:red;">${e.message}</p>`
  } finally {
    debugLoading.value = false
  }
}

onMounted(loadSkill)
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
.debug-preview {
  margin-top: 16px;
}
.preview-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.preview-tabs button {
  padding: 6px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.preview-tabs button.active {
  background: #4361EE;
  color: #fff;
  border-color: #4361EE;
}
.preview-iframe {
  width: 100%;
  height: 500px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
}
.skill-preview {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 500px;
  overflow-y: auto;
}
</style>
