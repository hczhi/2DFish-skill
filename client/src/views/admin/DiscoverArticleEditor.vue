<template>
  <div class="discover-editor page">
    <div class="page-header">
      <div class="header-left">
        <router-link to="/admin/discover" class="back-link">&larr; 返回文章管理</router-link>
        <h1>{{ isEditing ? '编辑文章' : '新建文章' }}</h1>
      </div>
    </div>

    <form @submit.prevent="saveArticle" class="editor-form">
      <div class="editor-grid">
        <!-- Left: Basic Info -->
        <div class="editor-sidebar">
          <div class="form-row">
            <label>Slug *</label>
            <input v-model="form.slug" required placeholder="my-article" :disabled="isEditing" />
            <small>URL 标识，仅英文/数字/连字符</small>
          </div>
          <div class="form-row">
            <label>作者</label>
            <input v-model="form.author" placeholder="Author Name" />
          </div>
          <div class="form-row">
            <label>Icon (emoji)</label>
            <input v-model="form.icon" placeholder="💡" />
          </div>
          <div class="form-row">
            <label>封面图 URL</label>
            <input v-model="form.cover_image" placeholder="https://..." />
          </div>
          <div class="form-row">
            <label>背景色</label>
            <input v-model="form.bg_color" placeholder="#f0f5ff" />
          </div>
          <div class="form-row">
            <label>头像颜色</label>
            <input v-model="form.avatar_color" placeholder="#0077ff" />
          </div>
          <div class="form-row">
            <label>排序</label>
            <input v-model.number="form.sort_order" type="number" />
          </div>
          <div class="form-row">
            <label>状态</label>
            <select v-model="form.status">
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
            </select>
          </div>
          <div class="form-row">
            <label>展示语言（可多选）</label>
            <div class="locale-checks">
              <label><input type="checkbox" value="zh" v-model="form.visible_locales" /> 中文</label>
              <label><input type="checkbox" value="en" v-model="form.visible_locales" /> English</label>
            </div>
            <small>不选择 = 都不展示</small>
          </div>
        </div>

        <!-- Right: Content Tabs -->
        <div class="editor-content">
          <div class="locale-tabs">
            <button type="button" :class="{ active: contentTab === 'zh' }" @click="contentTab = 'zh'">中文内容</button>
            <button type="button" :class="{ active: contentTab === 'en' }" @click="contentTab = 'en'">English Content</button>
          </div>

          <div class="content-form" v-show="contentTab === 'zh'">
            <div class="form-row">
              <label>标题 *</label>
              <input v-model="form.contents.zh.title" placeholder="文章标题" />
            </div>
            <div class="form-row">
              <label>摘要</label>
              <textarea v-model="form.contents.zh.summary" rows="2" placeholder="卡片上显示的简短描述"></textarea>
            </div>
            <div class="form-row">
              <label>正文内容 (HTML)</label>
              <textarea v-model="form.contents.zh.content" rows="16" placeholder="支持 HTML 格式" class="content-textarea"></textarea>
            </div>
            <div class="form-row">
              <label>SEO 标题</label>
              <input v-model="form.contents.zh.seo_title" placeholder="留空使用文章标题" />
            </div>
            <div class="form-row">
              <label>SEO 描述</label>
              <input v-model="form.contents.zh.seo_description" placeholder="搜索结果中的描述" />
            </div>
            <div class="form-row">
              <label>SEO 关键词</label>
              <input v-model="form.contents.zh.seo_keywords" placeholder="逗号分隔" />
            </div>
          </div>

          <div class="content-form" v-show="contentTab === 'en'">
            <div class="form-row">
              <label>Title *</label>
              <input v-model="form.contents.en.title" placeholder="Article Title" />
            </div>
            <div class="form-row">
              <label>Summary</label>
              <textarea v-model="form.contents.en.summary" rows="2" placeholder="Short description for card display"></textarea>
            </div>
            <div class="form-row">
              <label>Content (HTML)</label>
              <textarea v-model="form.contents.en.content" rows="16" placeholder="HTML content" class="content-textarea"></textarea>
            </div>
            <div class="form-row">
              <label>SEO Title</label>
              <input v-model="form.contents.en.seo_title" placeholder="Leave empty to use article title" />
            </div>
            <div class="form-row">
              <label>SEO Description</label>
              <input v-model="form.contents.en.seo_description" placeholder="Search result description" />
            </div>
            <div class="form-row">
              <label>SEO Keywords</label>
              <input v-model="form.contents.en.seo_keywords" placeholder="comma separated" />
            </div>
          </div>

          <!-- Recommendations Section -->
          <div class="recommendations-section">
            <h3>热门推荐 / Recommended</h3>
            <p class="rec-hint">每个语言版本可独立配置最多 5 篇推荐文章</p>

            <div class="rec-locale-tabs">
              <button type="button" :class="{ active: recTab === 'zh' }" @click="recTab = 'zh'">中文推荐</button>
              <button type="button" :class="{ active: recTab === 'en' }" @click="recTab = 'en'">EN Recommendations</button>
            </div>

            <div class="rec-list" v-show="recTab === 'zh'">
              <div class="rec-item" v-for="(rec, idx) in form.recommendations.zh" :key="idx">
                <select v-model="rec.recommended_article_id">
                  <option value="">-- 选择文章 --</option>
                  <option v-for="a in availableArticles" :key="a.id" :value="a.id" :disabled="a.id === articleId">
                    {{ a.title_zh || a.slug }}
                  </option>
                </select>
                <button type="button" class="btn-sm btn-danger" @click="removeRec('zh', idx)">移除</button>
              </div>
              <button type="button" class="btn-sm" @click="addRec('zh')" :disabled="form.recommendations.zh.length >= 5">
                + 添加推荐（{{ form.recommendations.zh.length }}/5）
              </button>
            </div>

            <div class="rec-list" v-show="recTab === 'en'">
              <div class="rec-item" v-for="(rec, idx) in form.recommendations.en" :key="idx">
                <select v-model="rec.recommended_article_id">
                  <option value="">-- Select Article --</option>
                  <option v-for="a in availableArticles" :key="a.id" :value="a.id" :disabled="a.id === articleId">
                    {{ a.title_en || a.slug }}
                  </option>
                </select>
                <button type="button" class="btn-sm btn-danger" @click="removeRec('en', idx)">Remove</button>
              </div>
              <button type="button" class="btn-sm" @click="addRec('en')" :disabled="form.recommendations.en.length >= 5">
                + Add Recommendation ({{ form.recommendations.en.length }}/5)
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <router-link to="/admin/discover" class="btn-cancel" style="text-decoration: none; display: inline-block;">取消</router-link>
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

const articleId = computed(() => route.params.id as string | undefined)
const isEditing = computed(() => !!articleId.value)

const contentTab = ref<'zh' | 'en'>('zh')
const recTab = ref<'zh' | 'en'>('zh')
const saving = ref(false)

interface ArticleContent {
  locale: string
  title: string
  summary: string
  content: string
  seo_title: string
  seo_description: string
  seo_keywords: string
}

interface RecItem {
  recommended_article_id: string
}

interface AvailableArticle {
  id: string
  slug: string
  title_zh: string
  title_en: string
}

const availableArticles = ref<AvailableArticle[]>([])

const defaultContent = () => ({ title: '', summary: '', content: '', seo_title: '', seo_description: '', seo_keywords: '' })
const defaultForm = () => ({
  slug: '',
  author: '',
  icon: '',
  cover_image: '',
  bg_color: '#f0f5ff',
  avatar_color: '#0077ff',
  sort_order: 0,
  status: 'draft',
  visible_locales: [] as string[],
  contents: { zh: defaultContent(), en: defaultContent() },
  recommendations: { zh: [] as RecItem[], en: [] as RecItem[] },
})

const form = ref(defaultForm())

function addRec(locale: 'zh' | 'en') {
  if (form.value.recommendations[locale].length >= 5) return
  form.value.recommendations[locale].push({ recommended_article_id: '' })
}

function removeRec(locale: 'zh' | 'en', idx: number) {
  form.value.recommendations[locale].splice(idx, 1)
}

onMounted(async () => {
  await loadAvailableArticles()
  if (isEditing.value) {
    await loadArticle(articleId.value!)
  }
})

async function loadAvailableArticles() {
  try {
    const res = await authFetch('/api/discover/admin/articles')
    const articles = await res.json()
    availableArticles.value = articles.map((a: any) => ({
      id: a.id,
      slug: a.slug,
      title_zh: a.contents?.find((c: any) => c.locale === 'zh')?.title || '',
      title_en: a.contents?.find((c: any) => c.locale === 'en')?.title || '',
    }))
  } catch { /* silent */ }
}

async function loadArticle(id: string) {
  try {
    const res = await authFetch(`/api/discover/admin/articles/${id}`)
    if (!res.ok) {
      alert('文章不存在')
      router.push('/admin/discover')
      return
    }
    const article = await res.json()
    const zhContent = article.contents?.find((c: any) => c.locale === 'zh')
    const enContent = article.contents?.find((c: any) => c.locale === 'en')

    const zhRecs = (article.recommendations || [])
      .filter((r: any) => r.locale === 'zh')
      .map((r: any) => ({ recommended_article_id: r.recommended_article_id }))
    const enRecs = (article.recommendations || [])
      .filter((r: any) => r.locale === 'en')
      .map((r: any) => ({ recommended_article_id: r.recommended_article_id }))

    form.value = {
      slug: article.slug,
      author: article.author,
      icon: article.icon,
      cover_image: article.cover_image,
      bg_color: article.bg_color,
      avatar_color: article.avatar_color,
      sort_order: article.sort_order,
      status: article.status,
      visible_locales: [...article.visible_locales],
      contents: {
        zh: zhContent ? { ...zhContent } : defaultContent(),
        en: enContent ? { ...enContent } : defaultContent(),
      },
      recommendations: {
        zh: zhRecs,
        en: enRecs,
      },
    }
  } catch (e) {
    console.error(e)
    alert('加载失败')
  }
}

async function saveArticle() {
  saving.value = true
  try {
    const contents: ArticleContent[] = []
    if (form.value.contents.zh.title) {
      contents.push({ locale: 'zh', ...form.value.contents.zh })
    }
    if (form.value.contents.en.title) {
      contents.push({ locale: 'en', ...form.value.contents.en })
    }

    const recommendations: Array<{ recommended_article_id: string; locale: string; sort_order: number }> = []
    for (const [idx, r] of form.value.recommendations.zh.entries()) {
      if (r.recommended_article_id) {
        recommendations.push({ recommended_article_id: r.recommended_article_id, locale: 'zh', sort_order: idx })
      }
    }
    for (const [idx, r] of form.value.recommendations.en.entries()) {
      if (r.recommended_article_id) {
        recommendations.push({ recommended_article_id: r.recommended_article_id, locale: 'en', sort_order: idx })
      }
    }

    const body = {
      slug: form.value.slug,
      author: form.value.author,
      icon: form.value.icon,
      cover_image: form.value.cover_image,
      bg_color: form.value.bg_color,
      avatar_color: form.value.avatar_color,
      sort_order: form.value.sort_order,
      status: form.value.status,
      visible_locales: form.value.visible_locales,
      contents,
      recommendations,
    }

    if (isEditing.value) {
      await authFetch(`/api/discover/admin/articles/${articleId.value}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } else {
      await authFetch('/api/discover/admin/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    router.push('/admin/discover')
  } catch (e) {
    console.error(e)
    alert('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* 采用 Brutalist 全局样式 */
.discover-editor { max-width: 1200px; margin: 0 auto; }

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
  grid-template-columns: 320px 1fr; 
  gap: 0; 
}
.editor-sidebar { 
  border-right: 2px solid var(--c-text-main); 
  padding: 32px; 
  background: #f8f8f8; 
}
.editor-content { 
  padding: 32px; 
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

.content-textarea { 
  font-family: var(--font-mono); 
  font-size: 13px; 
  line-height: 1.6; 
  min-height: 400px; 
  resize: vertical;
}

.locale-checks { 
  display: flex; 
  gap: 16px; 
  margin-top: 12px; 
}
.locale-checks label { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  font-size: 13px; 
  cursor: pointer; 
  font-family: var(--font-mono); 
  font-weight: bold; 
  margin-bottom: 0 !important;
}
.locale-checks input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--c-blue-primary);
}

.locale-tabs { 
  display: flex; 
  gap: 16px; 
  margin-bottom: 32px; 
  border-bottom: 2px solid var(--c-text-main); 
}
.locale-tabs button { 
  padding: 12px 24px; 
  background: none; 
  border: 2px solid transparent; 
  font-family: var(--font-mono); 
  font-size: 14px; 
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer; 
  color: var(--c-text-sub); 
  margin-bottom: -2px; 
  transition: all 0.2s;
}
.locale-tabs button:hover { color: var(--c-text-main); }
.locale-tabs button.active { 
  color: var(--c-text-main); 
  border: 2px solid var(--c-text-main); 
  border-bottom-color: #fff; 
  background: #fff; 
}

.form-actions { 
  display: flex; 
  justify-content: flex-end; 
  gap: 16px; 
  padding: 24px 32px; 
  border-top: 2px solid var(--c-text-main); 
  background: #f8f8f8;
}

.recommendations-section {
  margin-top: 32px;
  padding-top: 32px;
  border-top: 2px solid var(--c-text-main);
}
.recommendations-section h3 {
  font-family: var(--font-serif);
  font-size: 18px;
  margin: 0 0 8px;
}
.rec-hint {
  font-size: 12px;
  color: var(--c-text-sub);
  font-family: var(--font-mono);
  margin: 0 0 16px;
}

.rec-locale-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 2px solid var(--c-text-main);
}
.rec-locale-tabs button {
  padding: 8px 16px;
  background: none;
  border: 2px solid transparent;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  color: var(--c-text-sub);
  margin-bottom: -2px;
}
.rec-locale-tabs button.active {
  color: var(--c-text-main);
  border: 2px solid var(--c-text-main);
  border-bottom-color: #fff;
  background: #fff;
}

.rec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rec-item {
  display: flex;
  gap: 8px;
  align-items: center;
}
.rec-item select {
  flex: 1;
}

@media (max-width: 900px) {
  .editor-grid { grid-template-columns: 1fr; }
  .editor-sidebar { border-right: none; border-bottom: 2px solid var(--c-text-main); }
}
</style>
