<template>
  <div class="page">
    <div class="page-header">
      <h1>专题管理</h1>
      <button class="btn-primary" @click="openCreate">+ 新建专题</button>
    </div>

    <div class="hc-table-container" v-if="topics.length">
      <table class="hc-table">
        <thead>
          <tr>
            <th>专题</th>
            <th>Slug</th>
            <th>模板</th>
            <th>语言</th>
            <th>状态</th>
            <th>SSG</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in topics" :key="t.id">
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 24px;">{{ t.icon }}</span>
                <div>
                  <div style="font-weight: 600;">{{ getTitle(t, 'zh') || getTitle(t, 'en') || t.slug }}</div>
                  <div style="font-size: 12px; color: var(--c-text-sub);">{{ getTitle(t, 'en') }}</div>
                </div>
              </div>
            </td>
            <td><code>{{ t.slug }}</code></td>
            <td><code>{{ t.template }}</code></td>
            <td>
              <span class="hc-badge hc-badge-blue" v-for="l in t.visible_locales" :key="l" style="margin-right: 4px;">{{ l }}</span>
            </td>
            <td>
              <span :class="['hc-badge', statusBadge(t.status)]">{{ t.status }}</span>
            </td>
            <td>
              <span v-if="t.static_generated_at" style="font-size: 12px; color: var(--c-text-sub);">{{ formatDate(t.static_generated_at) }}</span>
              <span v-else style="font-size: 12px; color: #999;">—</span>
            </td>
            <td>
              <div class="table-actions">
                <button class="hc-btn hc-btn-secondary" @click="openEdit(t)">编辑</button>
                <button class="hc-btn hc-btn-secondary" style="color: #10B981;" @click="generateStatic(t)" :disabled="!t.visible_locales.length">生成</button>
                <button class="hc-btn hc-btn-secondary" style="color: #F59E0B;" v-if="t.status === 'published'" @click="offlineTopic(t)">下线</button>
                <button class="hc-btn hc-btn-danger" @click="deleteTopic(t)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else style="color: var(--c-text-sub);">暂无专题，点击上方按钮创建</p>

    <!-- Edit / Create Modal -->
    <HcModal v-model="showEditor" :title="editing ? '编辑专题' : '新建专题'" max-width="640px">
      <div class="form-group">
        <label>Slug (URL 标识)</label>
        <input v-model="form.slug" placeholder="my-topic" :disabled="!!editing" />
      </div>
      <div class="form-group">
        <label>图标 (Emoji)</label>
        <input v-model="form.icon" placeholder="📚" />
      </div>
      <div class="form-group">
        <label>背景色</label>
        <input v-model="form.bg_color" type="color" style="width: 60px; height: 36px; padding: 2px;" />
      </div>
      <div class="form-group">
        <label>封面图 URL</label>
        <input v-model="form.cover_image" placeholder="https://..." />
      </div>
      <div class="form-group">
        <label>模板</label>
        <input v-model="form.template" placeholder="default" />
        <small style="color: var(--c-text-sub);">对应 views/discover/topics/ 下的 Vue 组件名，不填则为 default</small>
      </div>
      <div class="form-group">
        <label>状态</label>
        <select v-model="form.status">
          <option value="draft">草稿</option>
          <option value="published">发布</option>
        </select>
      </div>
      <div class="form-group">
        <label>可见语言</label>
        <div style="display: flex; gap: 12px;">
          <label><input type="checkbox" value="zh" v-model="form.visible_locales" /> 中文</label>
          <label><input type="checkbox" value="en" v-model="form.visible_locales" /> English</label>
        </div>
      </div>

      <hr style="margin: 24px 0; border: none; border-top: 1px solid var(--c-border);" />
      <h3 style="font-size: 15px; margin-bottom: 16px;">中文内容</h3>
      <div class="form-group">
        <label>标题</label>
        <input v-model="form.zh_title" placeholder="专题标题" />
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea v-model="form.zh_description" rows="3" placeholder="专题描述..."></textarea>
      </div>
      <div class="form-group">
        <label>SEO 标题</label>
        <input v-model="form.zh_seo_title" />
      </div>
      <div class="form-group">
        <label>SEO 描述</label>
        <input v-model="form.zh_seo_description" />
      </div>

      <hr style="margin: 24px 0; border: none; border-top: 1px solid var(--c-border);" />
      <h3 style="font-size: 15px; margin-bottom: 16px;">English Content</h3>
      <div class="form-group">
        <label>Title</label>
        <input v-model="form.en_title" placeholder="Topic title" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea v-model="form.en_description" rows="3" placeholder="Topic description..."></textarea>
      </div>
      <div class="form-group">
        <label>SEO Title</label>
        <input v-model="form.en_seo_title" />
      </div>
      <div class="form-group">
        <label>SEO Description</label>
        <input v-model="form.en_seo_description" />
      </div>

      <template #footer>
        <button class="btn-secondary" @click="showEditor = false">取消</button>
        <button class="btn-primary" @click="saveTopic">{{ editing ? '保存' : '创建' }}</button>
      </template>
    </HcModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, apiGet, apiPost, apiDelete } from '../../lib/api'
import HcModal from '../../components/common/HcModal.vue'

interface TopicContentRow {
  locale: string
  title: string
  description: string
  seo_title: string
  seo_description: string
  seo_keywords: string
}

interface TopicRow {
  id: string
  slug: string
  cover_image: string
  icon: string
  bg_color: string
  template: string
  sort_order: number
  visible_locales: string[]
  status: string
  static_generated_at: string | null
  contents: TopicContentRow[]
}

const topics = ref<TopicRow[]>([])
const showEditor = ref(false)
const editing = ref<TopicRow | null>(null)
const form = ref(emptyForm())

function emptyForm() {
  return {
    slug: '', icon: '', bg_color: '#f0f5ff', cover_image: '', template: 'default', status: 'draft',
    visible_locales: [] as string[],
    zh_title: '', zh_description: '', zh_seo_title: '', zh_seo_description: '',
    en_title: '', en_description: '', en_seo_title: '', en_seo_description: '',
  }
}

function getTitle(t: TopicRow, locale: string): string {
  const c = t.contents?.find(c => c.locale === locale)
  return c?.title || ''
}

function statusBadge(s: string) {
  if (s === 'published') return 'hc-badge-green'
  if (s === 'offline') return 'hc-badge-red'
  return 'hc-badge-gray'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

async function loadTopics() {
  const data = await apiGet<TopicRow[]>('/api/discover/topics/admin/list')
  topics.value = data
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  showEditor.value = true
}

function openEdit(t: TopicRow) {
  editing.value = t
  const zh = t.contents?.find(c => c.locale === 'zh')
  const en = t.contents?.find(c => c.locale === 'en')
  form.value = {
    slug: t.slug,
    icon: t.icon,
    bg_color: t.bg_color,
    cover_image: t.cover_image,
    template: t.template,
    status: t.status,
    visible_locales: [...t.visible_locales],
    zh_title: zh?.title || '', zh_description: zh?.description || '',
    zh_seo_title: zh?.seo_title || '', zh_seo_description: zh?.seo_description || '',
    en_title: en?.title || '', en_description: en?.description || '',
    en_seo_title: en?.seo_title || '', en_seo_description: en?.seo_description || '',
  }
  showEditor.value = true
}

async function saveTopic() {
  const contents = []
  if (form.value.zh_title || form.value.visible_locales.includes('zh')) {
    contents.push({
      locale: 'zh', title: form.value.zh_title, description: form.value.zh_description,
      seo_title: form.value.zh_seo_title, seo_description: form.value.zh_seo_description, seo_keywords: '',
    })
  }
  if (form.value.en_title || form.value.visible_locales.includes('en')) {
    contents.push({
      locale: 'en', title: form.value.en_title, description: form.value.en_description,
      seo_title: form.value.en_seo_title, seo_description: form.value.en_seo_description, seo_keywords: '',
    })
  }

  const body = {
    slug: form.value.slug,
    icon: form.value.icon,
    bg_color: form.value.bg_color,
    cover_image: form.value.cover_image,
    template: form.value.template || 'default',
    status: form.value.status,
    visible_locales: form.value.visible_locales,
    contents,
  }

  if (editing.value) {
    await api(`/api/discover/topics/admin/${editing.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  } else {
    await apiPost('/api/discover/topics/admin', body)
  }

  showEditor.value = false
  await loadTopics()
}

async function generateStatic(t: TopicRow) {
  await apiPost(`/api/discover/topics/admin/${t.id}/generate`, {})
  await loadTopics()
}

async function offlineTopic(t: TopicRow) {
  await apiPost(`/api/discover/topics/admin/${t.id}/offline`, {})
  await loadTopics()
}

async function deleteTopic(t: TopicRow) {
  if (!confirm(`确定删除专题「${getTitle(t, 'zh') || t.slug}」？其下文章不会被删除，仅取消关联。`)) return
  await apiDelete(`/api/discover/topics/admin/${t.id}`)
  await loadTopics()
}

onMounted(loadTopics)
</script>

<style scoped>
.page { max-width: 1200px; }
</style>
