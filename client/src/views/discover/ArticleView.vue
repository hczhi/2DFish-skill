<template>
  <div class="article-layout">
    <SiteHeader />

    <main class="article-main">
      <div v-if="loading" class="loading">Loading...</div>
      <div v-else-if="!article" class="not-found">
        <h2>Article not found</h2>
        <router-link to="/">Back to Home</router-link>
      </div>

      <article v-else class="article-container">
        <header class="article-header">
          <h1 class="article-title">{{ article.title }}</h1>
          <div class="article-meta">
            <span class="author" v-if="article.author">{{ article.author }}</span>
          </div>
        </header>
        
        <div class="article-body" v-html="article.content"></div>

        <section class="article-recommendations" v-if="article.recommendations?.length">
          <h2 class="rec-title">{{ locale === 'en' ? 'Recommended' : '热门推荐' }}</h2>
          <div class="rec-grid">
            <router-link
              v-for="rec in article.recommendations"
              :key="rec.slug"
              :to="locale === 'en' ? `/en/discover/${rec.slug}` : `/discover/${rec.slug}`"
              class="rec-card"
            >
              <div class="rec-icon" :style="{ background: rec.bg_color }">{{ rec.icon }}</div>
              <div class="rec-info">
                <h3>{{ rec.title }}</h3>
                <p>{{ rec.summary }}</p>
              </div>
            </router-link>
          </div>
        </section>
      </article>
    </main>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const route = useRoute()

interface RecItem {
  slug: string
  icon: string
  bg_color: string
  author: string
  title: string
  summary: string
}

interface ArticleData {
  title: string
  content: string
  author: string
  summary: string
  seo_title: string
  seo_description: string
  recommendations?: RecItem[]
}

const article = ref<ArticleData | null>(null)
const loading = ref(true)
const locale = ref('zh')

async function loadArticle() {
  loading.value = true
  const slug = route.params.slug as string
  locale.value = route.path.startsWith('/en/') ? 'en' : 'zh'

  try {
    const res = await fetch(`/api/discover/articles/${slug}?locale=${locale.value}`)
    if (res.ok) {
      article.value = await res.json()
      if (article.value?.seo_title || article.value?.title) {
        document.title = article.value.seo_title || article.value.title
      }
    } else {
      article.value = null
    }
  } catch {
    article.value = null
  }
  loading.value = false
}

onMounted(loadArticle)
watch(() => route.fullPath, loadArticle)
</script>

<style scoped>
.article-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
}

.article-main {
  flex: 1;
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 100px 24px 60px; /* Top padding to account for fixed header */
}

.loading {
  text-align: center;
  padding: 60px;
  font-family: var(--font-mono, monospace);
  text-transform: uppercase;
  color: var(--c-text-sub, #555);
}

.not-found {
  text-align: center;
  padding: 60px;
  font-family: var(--font-mono, monospace);
}
.not-found h2 { color: var(--c-text-sub, #555); margin-bottom: 16px; }
.not-found a { color: #0077FF; text-transform: uppercase; font-weight: bold; text-decoration: none; }

.article-header {
  margin-bottom: 48px;
  padding-bottom: 24px;
}

.article-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 48px;
  font-weight: 800;
  line-height: 1.2;
  color: var(--c-text-main, #111827);
  margin: 0 0 24px;
  letter-spacing: -1px;
}

.article-meta {
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  color: var(--c-text-sub, #6b7280);
}

.author {
  font-weight: bold;
}

.article-body {
  font-family: var(--font-sans, sans-serif);
  font-size: 18px;
  line-height: 1.8;
  color: var(--c-text-main, #111);
}

.article-body :deep(h2) {
  font-family: var(--font-sans, sans-serif);
  font-size: 32px;
  font-weight: 800;
  margin: 48px 0 24px;
  color: var(--c-text-main, #111827);
  letter-spacing: -0.5px;
}

.article-body :deep(h3) {
  font-family: var(--font-sans, sans-serif);
  font-size: 24px;
  font-weight: 700;
  margin: 32px 0 16px;
  color: var(--c-text-main, #111827);
}

.article-body :deep(p) {
  margin: 0 0 24px;
}

.article-body :deep(img) {
  max-width: 100%;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  margin: 32px 0;
  box-shadow: 0 12px 32px rgba(0,0,0,0.06);
}

.article-body :deep(blockquote) {
  border-left: 4px solid #3B5BDB;
  background: #f9fafb;
  padding: 24px;
  border-radius: 0 16px 16px 0;
  margin: 32px 0;
  color: var(--c-text-sub, #4b5563);
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-style: italic;
  line-height: 1.6;
}

.article-body :deep(code) {
  background: #f3f4f6;
  padding: 4px 6px;
  border-radius: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  color: #ef4444;
}

.article-body :deep(pre) {
  background: #1f2937;
  color: #fff;
  padding: 24px;
  border-radius: 16px;
  overflow-x: auto;
  margin: 32px 0;
  box-shadow: 0 12px 32px rgba(0,0,0,0.1);
}

.article-body :deep(pre code) {
  background: none;
  padding: 0;
  border: none;
  color: #fff;
}

.article-body :deep(ul), .article-body :deep(ol) {
  padding-left: 24px;
  margin: 0 0 24px;
}

.article-body :deep(li) {
  margin: 8px 0;
}

.article-recommendations {
  margin-top: 64px;
  padding-top: 48px;
  border-top: 1px solid #e5e7eb;
}

.rec-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 28px;
  font-weight: 800;
  margin: 0 0 32px;
  color: var(--c-text-main, #111827);
  text-transform: uppercase;
}

.rec-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.rec-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  background: #fff;
  text-decoration: none;
  color: inherit;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  height: 100%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}
.rec-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08);
}

.rec-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  flex-shrink: 0;
}

.rec-info h3 {
  font-family: var(--font-sans, sans-serif);
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--c-text-main, #111827);
}

.rec-info p {
  font-size: 14px;
  color: var(--c-text-sub, #555);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 768px) {
  .article-title {
    font-size: 32px;
  }
  .article-body {
    font-size: 16px;
  }
  .article-body :deep(h2) {
    font-size: 24px;
  }
  .article-body :deep(blockquote) {
    font-size: 20px;
  }
  .rec-grid {
    grid-template-columns: 1fr;
  }
  .rec-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}
</style>
