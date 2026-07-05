<template>
  <div class="module-editor page">
    <div class="page-header">
      <div class="header-left">
        <router-link to="/admin/home" class="back-link">&larr; 返回首页内容管理</router-link>
        <h1>{{ isEditing ? '编辑首页模块' : '添加首页模块' }}</h1>
      </div>
    </div>

    <form @submit.prevent="saveModule" class="editor-form">
      <div class="editor-grid">
        <div class="editor-main">
          <div class="form-row">
            <label>标题 *</label>
            <input v-model="form.title" required placeholder="模块主标题" />
          </div>
          <div class="form-row">
            <label>描述</label>
            <input v-model="form.description" placeholder="一句话描述" />
          </div>
          <div class="form-row">
            <label>跳转路径</label>
            <input v-model="form.path" placeholder="/some-path" />
          </div>
          
          <div class="form-row-inline">
            <div class="form-row">
              <label>Icon (emoji)</label>
              <input v-model="form.icon" placeholder="🐟" />
            </div>
            <div class="form-row">
              <label>分类标签</label>
              <input v-model="form.category" placeholder="Game" />
            </div>
          </div>
          
          <div class="form-row-inline">
            <div class="form-row">
              <label>背景色</label>
              <input v-model="form.bg_color" placeholder="#f0f5ff" />
            </div>
            <div class="form-row">
              <label>排序</label>
              <input v-model.number="form.sort_order" type="number" />
            </div>
          </div>

          <div class="form-row">
            <label>背景图 URL</label>
            <input v-model="form.image_url" placeholder="https://..." />
            <small>有图片时将覆盖背景色</small>
          </div>

          <div class="form-row">
            <label>网格布局尺寸</label>
            <select v-model="form.grid_span">
              <option value="1x1">1x1 (标准小块)</option>
              <option value="2x2">2x2 (超大正方形)</option>
              <option value="2x1">2x1 (横向长条)</option>
              <option value="1x2">1x2 (竖向长条)</option>
            </select>
          </div>

          <div class="form-checks">
            <label><input type="checkbox" v-model="form.featured" /> 推荐模块（大号标题展示）</label>
            <label><input type="checkbox" v-model="form.require_auth" /> 需要登录</label>
            <label><input type="checkbox" v-model="form.visible" /> 首页可见</label>
          </div>
        </div>

        <div class="editor-preview">
          <div class="preview-label">效果预览 (1x1 比例参考)</div>
          <div class="bento-card-preview" :class="{'is-featured': form.featured}">
            <div class="card-bg">
              <img v-if="form.image_url" :src="form.image_url" class="bg-image" />
              <div v-else class="bg-pattern" :style="{ background: form.bg_color || '#f8faff' }"></div>
            </div>
            <div class="card-content">
              <div class="card-header">
                <span class="icon">{{ form.icon || '📌' }}</span>
                <span class="badge" v-if="form.require_auth">AUTH</span>
              </div>
              <div class="card-body">
                <h2 class="card-title">{{ form.title || '模块标题' }}</h2>
                <p class="card-desc">{{ form.description || '模块的简短描述文字...' }}</p>
              </div>
              <div class="card-footer" v-if="form.featured">
                <span class="meta-tag">{{ form.category || 'TAG' }}</span>
                <span class="arrow">→</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <router-link to="/admin/home" class="btn-cancel" style="text-decoration: none; display: inline-block;">取消</router-link>
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../../lib/auth'

const route = useRoute()
const router = useRouter()

const moduleId = computed(() => route.params.id as string | undefined)
const isEditing = computed(() => !!moduleId.value)

const saving = ref(false)

const defaultForm = () => ({
  title: '', description: '', icon: '', path: '', category: '',
  bg_color: '', image_url: '', grid_span: '1x1', sort_order: 0,
  featured: false, require_auth: false, visible: true,
})

const form = ref(defaultForm())

onMounted(async () => {
  if (isEditing.value) {
    await loadModule(moduleId.value!)
  }
})

async function loadModule(id: string) {
  try {
    const res = await authFetch('/api/home/admin/modules?page_size=100')
    const data = await res.json()
    const modules = data.items || data
    const mod = modules.find((m: any) => m.id === id)
    if (mod) {
      form.value = {
        title: mod.title, description: mod.description, icon: mod.icon, path: mod.path,
        category: mod.category, bg_color: mod.bg_color, image_url: mod.image_url,
        grid_span: mod.grid_span, sort_order: mod.sort_order,
        featured: !!mod.featured, require_auth: !!mod.require_auth, visible: !!mod.visible,
      }
    } else {
      alert('模块不存在')
      router.push('/admin/home')
    }
  } catch (e) {
    console.error(e)
    alert('加载失败')
  }
}

async function saveModule() {
  saving.value = true
  try {
    const body = { ...form.value }
    if (isEditing.value) {
      await authFetch(`/api/home/admin/modules/${moduleId.value}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } else {
      await authFetch('/api/home/admin/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }
    router.push('/admin/home')
  } catch (e) {
    console.error(e)
    alert('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.module-editor { max-width: 1000px; margin: 0 auto; }

.header-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.back-link {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-sub);
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color 0.2s;
}
.back-link:hover { color: var(--c-blue-primary); }

.editor-form {
  background: #fff;
  border: 2px solid var(--c-text-main);
  box-shadow: 12px 12px 0 var(--c-blue-primary);
}

.editor-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 0;
}

.editor-main {
  padding: 32px;
  border-right: 2px solid var(--c-text-main);
}

.editor-preview {
  padding: 32px;
  background: #f8f8f8;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.preview-label {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: bold;
  color: var(--c-text-sub);
  margin-bottom: 24px;
  text-transform: uppercase;
}

.form-row { margin-bottom: 24px; }
.form-row:last-child { margin-bottom: 0; }
.form-row small { 
  display: block; 
  font-size: 11px; 
  color: var(--c-text-sub); 
  margin-top: 8px; 
  font-family: var(--font-mono); 
}

.form-row-inline {
  display: flex;
  gap: 24px;
}
.form-row-inline .form-row {
  flex: 1;
}

.form-checks { 
  display: flex; 
  flex-direction: column;
  gap: 16px; 
  margin-top: 32px; 
  padding-top: 24px;
  border-top: 2px dashed var(--c-border);
}
.form-checks label { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  font-size: 13px; 
  cursor: pointer; 
  font-family: var(--font-mono); 
  font-weight: bold; 
  margin-bottom: 0 !important;
}
.form-checks input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--c-blue-primary);
}

.form-actions { 
  display: flex; 
  justify-content: flex-end; 
  gap: 16px; 
  padding: 24px 32px; 
  border-top: 2px solid var(--c-text-main); 
  background: #f8f8f8;
}

/* Bento Card Preview Styles (Copied from Home.vue) */
.bento-card-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--c-text-main);
  background: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 6px 6px 0 var(--c-blue-primary);
}

.card-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 0;
}
.bg-image { width: 100%; height: 100%; object-fit: cover; }
.bg-pattern { width: 100%; height: 100%; opacity: 0.8; }

.card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  background: linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 100%);
  backdrop-filter: blur(2px);
}

.card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: auto; }
.card-header .icon { font-size: 28px; }
.badge { background: var(--c-blue-primary); color: #fff; font-family: var(--font-mono); font-size: 10px; padding: 4px 8px; }

.card-body { margin-top: 20px; }
.card-title { font-family: var(--font-sans); font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: var(--c-text-main); }
.is-featured .card-title { font-size: 24px; }
.card-desc { font-size: 13px; color: var(--c-text-sub); margin: 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.card-footer { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; }
.meta-tag { background: #000; color: #fff; font-family: var(--font-mono); font-size: 10px; padding: 4px 8px; text-transform: uppercase; }
.arrow { font-family: var(--font-mono); font-size: 16px; color: var(--c-blue-primary); }

@media (max-width: 900px) {
  .editor-grid { grid-template-columns: 1fr; }
  .editor-main { border-right: none; border-bottom: 2px solid var(--c-text-main); }
  .editor-preview { padding: 24px; }
  .bento-card-preview { max-width: 320px; }
}
</style>
