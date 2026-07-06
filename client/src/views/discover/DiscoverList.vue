<template>
  <div class="discover-layout">
    <SiteHeader @locale-changed="handleLocaleChange" />

    <main class="discover-main">

      <header class="discover-header">
        <h1 class="discover-title">{{ locale === 'en' ? 'Discover' : '发现' }}</h1>
        <p class="discover-subtitle">{{ locale === 'en' ? 'Explore all articles and topics' : '浏览全部文章与专题' }}</p>
      </header>

      <!-- Search -->
      <div class="search-bar">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="locale === 'en' ? 'Search articles...' : '搜索文章...'"
          class="search-input"
        />
      </div>

      <!-- Topic filter tags -->
      <nav class="topic-filters" aria-label="Topic filters" v-if="topics.length > 0">
        <router-link
          class="topic-tag"
          :class="{ active: !activeTopic }"
          :to="locale === 'en' ? '/en/discover' : '/discover'"
        >
          {{ locale === 'en' ? 'All' : '全部' }}
        </router-link>
        <router-link
          v-for="t in topics"
          :key="t.id"
          class="topic-tag"
          :class="{ active: activeTopic === t.slug }"
          :to="locale === 'en' ? `/en/discover/topic/${t.slug}` : `/discover/topic/${t.slug}`"
        >
          {{ t.title || t.slug }}
        </router-link>
      </nav>

      <!-- Articles grid -->
      <div v-if="loading" class="loading">Loading...</div>
      <div v-else-if="articles.length === 0" class="empty">
        {{ searchQuery ? (locale === 'en' ? 'No matching articles found.' : '未找到匹配的文章') : (locale === 'en' ? 'No articles yet.' : '暂无文章') }}
      </div>
      <div v-else class="articles-grid">
        <article v-for="item in paginatedArticles" :key="item.id" class="article-card">
          <router-link
            :to="locale === 'en' ? `/en/discover/${item.slug}` : `/discover/${item.slug}`"
            class="article-link"
          >
            <div class="article-cover" :style="{ background: item.bg_color || '#f0f5ff' }">
              <img
                v-if="item.cover_image"
                :src="item.cover_image"
                class="cover-img"
                alt=""
                loading="lazy"
              />
              <span v-else class="cover-icon">{{ item.icon }}</span>
            </div>
            <div class="article-info">
              <h2 class="article-title">{{ item.title }}</h2>
              <p class="article-summary" v-if="item.summary">{{ item.summary }}</p>
              <div class="article-meta">
                <div class="article-author" v-if="item.author">
                  <div class="author-avatar" :style="{ background: item.avatar_color || '#0077ff' }"></div>
                  <span>{{ item.author }}</span>
                </div>
              </div>
            </div>
          </router-link>
        </article>
      </div>

      <!-- Pagination -->
      <nav class="pagination" aria-label="Pagination" v-if="totalPages > 1">
        <button
          class="page-btn"
          :disabled="currentPage <= 1"
          @click="currentPage--"
        >
          &larr;
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="page-btn"
          :disabled="currentPage >= totalPages"
          @click="currentPage++"
        >
          &rarr;
        </button>
      </nav>
    </main>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const route = useRoute()

interface DiscoverArticle {
  id: string
  slug: string
  title: string
  summary: string
  author: string
  icon: string
  bg_color: string
  avatar_color: string
  cover_image?: string
}

interface TopicItem {
  id: string
  slug: string
  title: string
  description: string
}

const articles = ref<DiscoverArticle[]>([])
const topics = ref<TopicItem[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = 12
const totalArticles = ref(0)
const activeTopic = ref<string | null>(null)
const searchQuery = ref('')

const locale = computed(() => route.path.startsWith('/en') ? 'en' : 'zh')

const totalPages = computed(() => Math.ceil(totalArticles.value / pageSize))

const paginatedArticles = computed(() => articles.value)

function handleLocaleChange() {
  loadArticles()
  loadTopics()
}

async function loadArticles() {
  loading.value = true
  try {
    const q = searchQuery.value.trim()
    let url = `/api/discover/articles?locale=${locale.value}&limit=${pageSize}&page=${currentPage.value}`
    if (q) url += `&q=${encodeURIComponent(q)}`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      articles.value = data.items || data
      totalArticles.value = data.total || 0
    }
  } catch { /* silent */ }
  loading.value = false
}

async function loadTopics() {
  try {
    const res = await fetch(`/api/discover/topics?locale=${locale.value}`)
    if (res.ok) topics.value = await res.json()
  } catch { /* silent */ }
}

onMounted(async () => {
  await Promise.all([loadArticles(), loadTopics()])
  const ssgCss = document.getElementById('ssg-critical-css')
  if (ssgCss) ssgCss.remove()
})

watch(locale, () => {
  currentPage.value = 1
  loadArticles()
  loadTopics()
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  currentPage.value = 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadArticles, 300)
})

watch(currentPage, () => {
  loadArticles()
})
</script>

<style scoped>
.discover-layout {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background-color: #fafafa;
  overflow-x: clip;
}

.discover-main {
  flex: 1;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 100px 24px 80px;
}

.discover-header {
  margin-bottom: 32px;
}

.search-bar {
  margin-bottom: 24px;
}

.search-input {
  width: 100%;
  max-width: 480px;
  padding: 12px 20px;
  font-size: 15px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  color: #111827;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-input:focus {
  border-color: #4361EE;
  box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.1);
}

.search-input::placeholder {
  color: #9ca3af;
}

.discover-title {
  font-size: 48px;
  font-weight: 900;
  margin: 0 0 8px;
  letter-spacing: -2px;
  color: #111827;
}

.discover-subtitle {
  font-size: 16px;
  color: #6b7280;
  margin: 0;
}

/* Topic filters */
.topic-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 40px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.topic-tag {
  display: inline-block;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  color: #4b5563;
  background: #f3f4f6;
  border: 1px solid rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
}

.topic-tag:hover {
  background: #e5e7eb;
  color: #111827;
}

.topic-tag.active {
  background: #4361EE;
  color: #fff;
  border-color: #4361EE;
}

/* Articles grid */
.articles-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 28px;
}

.article-card {
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
  transition: box-shadow 0.3s ease, transform 0.3s ease;
}

.article-card:hover {
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.article-link {
  display: block;
  text-decoration: none;
  color: inherit;
}

.article-cover {
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-icon {
  font-size: 48px;
}

.article-info {
  padding: 20px;
}

.article-title {
  font-size: 17px;
  font-weight: 700;
  margin: 0 0 8px;
  color: #111827;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-summary {
  font-size: 14px;
  color: #6b7280;
  margin: 0 0 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-meta {
  display: flex;
  align-items: center;
}

.article-author {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

.author-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

/* Loading and empty states */
.loading, .empty {
  text-align: center;
  padding: 60px;
  color: #6b7280;
  font-size: 15px;
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 48px;
}

.page-btn {
  padding: 8px 16px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: #f3f4f6;
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 14px;
  color: #6b7280;
}

/* Responsive */
@media (max-width: 768px) {
  .discover-layout {
    overflow: visible;
  }
  .discover-main {
    padding: 88px 16px 56px;
  }
  .discover-title {
    font-size: 32px;
  }
  .topic-filters {
    gap: 10px;
    margin-bottom: 28px;
    padding-bottom: 20px;
  }
  .topic-tag {
    padding: 8px 14px;
  }
  .articles-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .article-cover {
    height: 160px;
  }
}
</style>
