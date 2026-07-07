<template>
  <div class="discover-admin">
    <div class="section-header">
      <h2>DISCOVER 文章管理</h2>
      <div class="header-actions">
        <button class="hc-btn hc-btn-secondary" style="color: #10B981; border-color: #10B981;" @click="batchGenerate" :disabled="batchProgress !== null">批量生成静态页</button>
        <router-link to="/admin/discover/edit" class="btn-primary" style="text-decoration: none;">新建文章</router-link>
      </div>
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
    <AdminPagination v-if="articles.length" v-model="currentPage" :total="totalArticles" :total-pages="totalPages" />
    <p v-if="articles.length === 0" class="empty">暂无文章，点击上方按钮新建</p>

    <!-- Batch Generate Progress -->
    <HcModal v-model="showBatchModal" :title="batchDone ? '批量生成完成' : '批量生成静态页'" max-width="500px" :show-close="batchDone">
      <div class="batch-progress" v-if="batchProgress">
        <div class="progress-bar-wrap">
          <div class="progress-bar" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="progress-stats">
          <span>{{ batchProgress.current }} / {{ batchProgress.total }}</span>
          <span>{{ progressPercent }}%</span>
        </div>
        <div class="progress-detail">
          <span class="stat-success">成功: {{ batchProgress.success }}</span>
          <span class="stat-failed" v-if="batchProgress.failed">失败: {{ batchProgress.failed }}</span>
        </div>
        <div class="progress-current" v-if="!batchDone">
          正在生成: <code>{{ batchProgress.slug }}</code>
        </div>
      </div>
      <template #footer>
        <button v-if="batchDone" class="btn-primary" @click="closeBatchModal">关闭</button>
      </template>
    </HcModal>

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
import { ref, computed, watch, onMounted } from 'vue'
import { authFetch } from '../../lib/auth'
import HcModal from '../../components/common/HcModal.vue'
import AdminPagination from '../../components/common/AdminPagination.vue'

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

const PAGE_SIZE = 20
const articles = ref<Article[]>([])
const totalArticles = ref(0)
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(totalArticles.value / PAGE_SIZE))
const generateResult = ref<GenerateResult | null>(null)

interface BatchProgress {
  current: number
  total: number
  success: number
  failed: number
  slug: string
  ok: boolean
  done?: boolean
}

const batchProgress = ref<BatchProgress | null>(null)
const batchDone = ref(false)
const showBatchModal = computed({
  get: () => batchProgress.value !== null,
  set: (val) => { if (!val) { batchProgress.value = null; batchDone.value = false } }
})
const progressPercent = computed(() => {
  if (!batchProgress.value) return 0
  return Math.round((batchProgress.value.current / batchProgress.value.total) * 100)
})

watch(currentPage, loadArticles)
onMounted(() => { loadArticles() })

async function loadArticles() {
  const res = await authFetch(`/api/discover/admin/articles?page=${currentPage.value}&page_size=${PAGE_SIZE}`)
  const data = await res.json()
  articles.value = data.items
  totalArticles.value = data.total
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

async function batchGenerate() {
  if (!confirm('将为所有已发布文章重新生成静态页面，确定继续？')) return

  batchProgress.value = { current: 0, total: 0, success: 0, failed: 0, slug: '', ok: true }
  batchDone.value = false

  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/discover/admin/articles/batch-generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })

    const reader = res.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = JSON.parse(line.slice(6))
        if (data.done) {
          batchDone.value = true
          batchProgress.value = { current: data.total, total: data.total, success: data.success, failed: data.failed, slug: '', ok: true }
        } else {
          batchProgress.value = data
        }
      }
    }

    batchDone.value = true
    loadArticles()
  } catch (e: any) {
    batchDone.value = true
    if (batchProgress.value) {
      batchProgress.value.failed = (batchProgress.value.failed || 0) + 1
    }
  }
}

function closeBatchModal() {
  batchProgress.value = null
  batchDone.value = false
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
.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.batch-progress { padding: 16px 0; }
.progress-bar-wrap {
  width: 100%;
  height: 24px;
  background: #f3f4f6;
  border: 2px solid var(--c-text-main);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: #10B981;
  transition: width 0.3s ease;
}
.progress-stats {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
}
.progress-detail {
  margin-top: 12px;
  display: flex;
  gap: 16px;
  font-size: 13px;
}
.stat-success { color: #10B981; font-weight: 600; }
.stat-failed { color: #dc2626; font-weight: 600; }
.progress-current {
  margin-top: 12px;
  font-size: 12px;
  color: var(--c-text-sub);
}
.progress-current code {
  background: #f3f4f6;
  padding: 2px 6px;
  border: 1px solid var(--c-border);
  font-family: var(--font-mono);
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
