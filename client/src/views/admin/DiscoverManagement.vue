<template>
  <div class="discover-admin">
    <div class="section-header">
      <h2>DISCOVER 文章管理</h2>
      <router-link to="/admin/discover/edit" class="btn-primary" style="text-decoration: none;">新建文章</router-link>
    </div>

    <div class="hc-table-container">
      <table class="hc-table">
        <thead>
          <tr>
            <th>排序</th>
            <th>Icon</th>
            <th>标题</th>
            <th>Slug</th>
            <th>语言</th>
            <th>状态</th>
            <th>静态页</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in articles" :key="a.id">
            <td>{{ a.sort_order }}</td>
            <td>{{ a.icon }}</td>
            <td>
              <div style="font-weight: 600; margin-bottom: 4px; color: var(--c-text-main);">{{ getTitle(a) }}</div>
              <div style="font-size: 12px; color: var(--c-text-sub); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 200px;">
                {{ getSummary(a) }}
              </div>
            </td>
            <td>
              <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">{{ a.slug }}</code>
            </td>
            <td>
              <span class="hc-badge hc-badge-blue" v-for="l in a.visible_locales" :key="l">{{ l }}</span>
              <span v-if="!a.visible_locales.length" class="hc-badge hc-badge-gray">未配置</span>
            </td>
            <td>
              <span :class="['hc-badge', a.status === 'published' ? 'hc-badge-green' : a.status === 'offline' ? 'hc-badge-red' : 'hc-badge-gray']">
                {{ a.status === 'published' ? '已发布' : a.status === 'offline' ? '已下线' : '草稿' }}
              </span>
            </td>
            <td>
              <span v-if="a.static_generated_at" class="hc-badge hc-badge-green">已生成</span>
              <span v-else class="hc-badge hc-badge-gray">未生成</span>
            </td>
            <td>
              <div class="table-actions">
                <router-link :to="`/admin/discover/edit/${a.id}`" class="hc-btn hc-btn-secondary" style="text-decoration: none; display: inline-block;">编辑</router-link>
                <button class="hc-btn hc-btn-secondary" style="color: #10B981; border-color: #10B981;" @click="generateStatic(a)" :disabled="!a.visible_locales.length">生成</button>
                <button class="hc-btn hc-btn-secondary" style="color: #F59E0B; border-color: #F59E0B;" v-if="a.status === 'published'" @click="offlineArticle(a)">下线</button>
                <button class="hc-btn hc-btn-danger" @click="deleteArticle(a.id)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="articles.length === 0" class="empty">暂无文章，点击上方按钮新建</p>

    <!-- Generate Result -->
    <HcModal v-model="showGenerateResult" title="静态页面生成结果" max-width="600px" @close="generateResult = null">
      <div v-if="generateResult" class="generate-result" :class="{ success: generateResult.success, error: !generateResult.success }">
        <div v-if="generateResult.generated.length">
          <p><strong>已生成:</strong></p>
          <ul>
            <li v-for="p in generateResult.generated" :key="p"><code>{{ p }}</code></li>
          </ul>
        </div>
        <div v-if="generateResult.errors.length">
          <p><strong>错误:</strong></p>
          <ul class="error-list">
            <li v-for="(e, i) in generateResult.errors" :key="i">{{ e }}</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="showGenerateResult = false; generateResult = null">关闭</button>
      </template>
    </HcModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { authFetch } from '../../lib/auth'
import HcModal from '../../components/common/HcModal.vue'

const showGenerateResult = computed({
  get: () => !!generateResult.value,
  set: (val) => { if (!val) generateResult.value = null }
})

interface ArticleContent {
  locale: string
  title: string
  summary: string
  content: string
  seo_title: string
  seo_description: string
  seo_keywords: string
}

interface Article {
  id: string
  slug: string
  cover_image: string
  author: string
  icon: string
  bg_color: string
  avatar_color: string
  sort_order: number
  visible_locales: string[]
  status: string
  static_generated_at: string | null
  contents: ArticleContent[]
}

interface GenerateResult {
  success: boolean
  generated: string[]
  errors: string[]
}

const articles = ref<Article[]>([])
const generateResult = ref<GenerateResult | null>(null)

onMounted(() => { loadArticles() })

async function loadArticles() {
  const res = await authFetch('/api/discover/admin/articles')
  articles.value = await res.json()
}

function getTitle(a: Article): string {
  const zh = a.contents?.find(c => c.locale === 'zh')
  const en = a.contents?.find(c => c.locale === 'en')
  return zh?.title || en?.title || '(无标题)'
}

function getSummary(a: Article): string {
  const zh = a.contents?.find(c => c.locale === 'zh')
  const en = a.contents?.find(c => c.locale === 'en')
  const s = zh?.summary || en?.summary || ''
  return s.length > 40 ? s.slice(0, 40) + '...' : s
}

async function deleteArticle(id: string) {
  if (!confirm('确定删除该文章？所有语言版本和静态页都将被删除。')) return
  await authFetch(`/api/discover/admin/articles/${id}`, { method: 'DELETE' })
  loadArticles()
}

async function offlineArticle(article: Article) {
  if (!confirm('确定将该文章下线？静态缓存页面将被删除，线上将无法访问。')) return
  try {
    await authFetch(`/api/discover/admin/articles/${article.id}/offline`, { method: 'POST' })
    loadArticles()
  } catch (e: any) {
    alert('下线失败: ' + (e.message || 'Network error'))
  }
}

async function generateStatic(article: Article) {
  try {
    const res = await authFetch(`/api/discover/admin/articles/${article.id}/generate`, { method: 'POST' })
    generateResult.value = await res.json()
    loadArticles()
  } catch (e: any) {
    generateResult.value = { success: false, generated: [], errors: [e.message || 'Network error'] }
  }
}
</script>

<style scoped>
/* 使用 AdminLayout 注入的全局 Brutalist 样式，移除重复样式 */
.discover-admin { max-width: 1200px; }

.section-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  margin-bottom: 32px; 
}
.section-header h2 { 
  font-size: 24px; 
  margin: 0; 
}

.data-table code { background: #f5f5f5; padding: 4px 8px; border: 1px solid var(--c-border); font-family: var(--font-mono); font-size: 11px; }
.data-table small { color: var(--c-text-sub); display: block; margin-top: 4px; }
.actions-cell { white-space: nowrap; }

.btn-generate { color: #059669; border-color: #059669; }
.btn-generate:hover { background: #059669; color: #fff; box-shadow: 4px 4px 0 var(--c-text-main); }
.btn-generate:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.btn-offline { color: #d97706; border-color: #d97706; }
.btn-offline:hover { background: #d97706; color: #fff; box-shadow: 4px 4px 0 var(--c-text-main); }
.badge-red { background: #fef2f2; color: #991b1b; }
.btn-close { background: none; border: none; font-size: 32px; cursor: pointer; color: var(--c-text-main); padding: 0; line-height: 1; transition: transform 0.2s; }
.btn-close:hover { transform: scale(1.1) rotate(90deg); color: #dc2626; }

.empty { text-align: center; color: var(--c-text-sub); padding: 60px; font-family: var(--font-mono); text-transform: uppercase; border: 2px dashed #ddd; }

.generate-result { 
  padding: 24px; 
  border: 2px solid var(--c-text-main); 
  font-size: 13px; 
  margin: 16px 0; 
  font-family: var(--font-mono);
}
.generate-result.success { background: #ecfdf5; box-shadow: 8px 8px 0 #10b981; }
.generate-result.error { background: #fef2f2; box-shadow: 8px 8px 0 #dc2626; }
.generate-result ul { padding-left: 24px; margin: 8px 0; }
.generate-result code { background: #fff; border: 1px solid var(--c-text-main); padding: 2px 6px; }
.error-list li { color: #dc2626; font-weight: bold; }
</style>
