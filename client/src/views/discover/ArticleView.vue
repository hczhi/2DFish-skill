<template>
  <div class="article-layout">
    <SiteHeader />

    <main class="article-main">
      <div v-if="loading" class="loading">Loading...</div>
      <div v-else-if="!article" class="not-found">
        <h2>Article not found</h2>
        <router-link to="/">Back to Home</router-link>
      </div>

      <div v-else class="article-two-col">
        <!-- Left: Article Content -->
        <article class="article-container">
          <!-- Breadcrumb -->
          <nav class="breadcrumb" aria-label="breadcrumb">
            <router-link to="/">{{ locale === 'en' ? 'Home' : '首页' }}</router-link>
            <span class="sep">/</span>
            <router-link :to="locale === 'en' ? '/en/discover' : '/discover'">Discover</router-link>
            <span class="sep">/</span>
            <span class="current">{{ article.title }}</span>
          </nav>

          <header class="article-header">
            <h1 class="article-title">{{ article.title }}</h1>
            <div class="article-meta">
              <span class="author" v-if="article.author">{{ article.author }}</span>
            </div>
          </header>

          <!-- Ad slot: top (leaderboard 728x90) -->
          <AdSlot position="top" />

          <div class="article-body" v-html="sanitizedContent"></div>

          <!-- Ad slot: in-content (native in-feed) -->
          <AdSlot position="in-content" />

          <section class="article-recommendations" v-if="article.recommendations?.length">
            <h2 class="rec-title">{{ locale === 'en' ? 'Recommended' : '热门推荐' }}</h2>
            <div class="rec-grid">
              <router-link
                v-for="rec in article.recommendations"
                :key="rec.slug"
                :to="locale === 'en' ? `/en/discover/${rec.slug}` : `/discover/${rec.slug}`"
                class="rec-item-wrapper"
              >
                <div class="rec-image-card" :style="{ background: rec.bg_color }">
                  <img v-if="rec.cover_image" :src="rec.cover_image" class="rec-cover-img" alt="cover" loading="lazy" />
                  <span v-else class="rec-emoji">{{ rec.icon }}</span>
                </div>
                <div class="rec-info-external">
                  <h3 class="rec-text-external">{{ rec.title }}</h3>
                  <div class="rec-meta-external">
                    <div class="rec-author-external">
                      <div class="author-avatar-external" :style="{ background: rec.avatar_color }"></div>
                      <span>{{ rec.author }}</span>
                    </div>
                  </div>
                </div>
              </router-link>
            </div>
          </section>

          <!-- Previous/Next article navigation -->
          <nav class="article-nav" v-if="prevArticle || nextArticle">
            <router-link
              v-if="prevArticle"
              :to="locale === 'en' ? `/en/discover/${prevArticle.slug}` : `/discover/${prevArticle.slug}`"
              class="article-nav-link article-nav-prev"
            >
              &larr; {{ prevArticle.title }}
            </router-link>
            <router-link
              v-if="nextArticle"
              :to="locale === 'en' ? `/en/discover/${nextArticle.slug}` : `/discover/${nextArticle.slug}`"
              class="article-nav-link article-nav-next"
            >
              {{ nextArticle.title }} &rarr;
            </router-link>
          </nav>

        </article>

        <!-- Right: Sticky Sidebar -->
        <aside class="article-sidebar">
          <div class="sidebar-sticky">
            <!-- Ad slot: sidebar (300x250) -->
            <AdSlot position="sidebar" />

            <!-- Article metadata below ad -->
            <div class="sidebar-meta" v-if="article.author || article.updated_at">
              <div class="sidebar-meta-item" v-if="article.author">
                <span class="sidebar-meta-label">{{ locale === 'en' ? 'Author' : '作者' }}</span>
                <span class="sidebar-meta-value">{{ article.author }}</span>
              </div>
              <div class="sidebar-meta-item" v-if="article.updated_at">
                <span class="sidebar-meta-label">{{ locale === 'en' ? 'Updated' : '更新时间' }}</span>
                <span class="sidebar-meta-value">{{ formatDate(article.updated_at) }}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import DOMPurify from 'dompurify'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import AdSlot from '../../components/common/AdSlot.vue'

const route = useRoute()

interface RecItem {
  slug: string
  icon: string
  bg_color: string
  avatar_color: string
  author: string
  title: string
  summary: string
  cover_image?: string
}

interface ArticleData {
  title: string
  content: string
  author: string
  summary: string
  seo_title: string
  seo_description: string
  seo_keywords: string
  updated_at?: string
  recommendations?: RecItem[]
}

const article = ref<ArticleData | null>(null)
const loading = ref(true)
const locale = ref('zh')
const prevArticle = ref<RecItem | null>(null)
const nextArticle = ref<RecItem | null>(null)

const sanitizedContent = computed(() => {
  if (!article.value?.content) return ''
  return DOMPurify.sanitize(article.value.content)
})

async function loadArticle() {
  loading.value = true
  const slug = route.params.slug as string
  locale.value = route.path.startsWith('/en/') ? 'en' : 'zh'

  try {
    const res = await fetch(`/api/discover/articles/${slug}?locale=${locale.value}`)
    if (res.ok) {
      article.value = await res.json()
      if (article.value) {
        const a = article.value
        document.title = a.seo_title || a.title
        setMeta('description', a.seo_description || a.summary || '')
        setMeta('keywords', a.seo_keywords || '')
        setMetaProperty('og:title', a.seo_title || a.title)
        setMetaProperty('og:description', a.seo_description || a.summary || '')
        setMetaProperty('twitter:title', a.seo_title || a.title)
        setMetaProperty('twitter:description', a.seo_description || a.summary || '')
      }
      // Derive prev/next from recommendations
      const recs = article.value?.recommendations
      if (recs && recs.length >= 2) {
        prevArticle.value = recs[0]
        nextArticle.value = recs[1]
      } else if (recs && recs.length === 1) {
        prevArticle.value = null
        nextArticle.value = recs[0]
      } else {
        prevArticle.value = null
        nextArticle.value = null
      }
    } else {
      article.value = null
      prevArticle.value = null
      nextArticle.value = null
    }
  } catch {
    article.value = null
    prevArticle.value = null
    nextArticle.value = null
  }
  loading.value = false
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setMetaProperty(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

onMounted(loadArticle)
watch(() => route.fullPath, loadArticle)
</script>

<style scoped>
.article-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background-color: #ffffff;
}

.article-main {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 120px 24px 80px;
  /* To make sticky work properly inside flex, parent needs to not have overflow hidden/auto or we use position sticky on the parent container */
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

/* Two-column layout */
.article-two-col {
  display: flex;
  gap: 48px;
  align-items: flex-start;
}

.article-container {
  flex: 1;
  min-width: 0;
  max-width: 780px;
}

.article-sidebar {
  width: 300px;
  flex-shrink: 0;
  align-self: flex-start;
  position: sticky;
  top: 100px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.sidebar-sticky {
  position: relative;
}

.sidebar-meta {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 8px;
}

.sidebar-meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-meta-label {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  text-transform: uppercase;
  color: var(--c-text-sub, #6b7280);
  letter-spacing: 0.5px;
}

.sidebar-meta-value {
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-main, #111827);
}

/* Breadcrumb */
.breadcrumb {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  margin-bottom: 32px;
  color: var(--c-text-sub, #6b7280);
}

.breadcrumb a {
  color: var(--c-text-sub, #6b7280);
  text-decoration: none;
  transition: color 0.2s;
}

.breadcrumb a:hover {
  color: var(--c-blue-primary, #3B5BDB);
}

.breadcrumb .sep {
  margin: 0 8px;
  opacity: 0.5;
}

.breadcrumb .current {
  color: var(--c-text-main, #111827);
  font-weight: 500;
  display: inline-block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* Ad slots */
.ad-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 90px;
  margin: 24px 0;
  background: #f9fafb;
  border-radius: 4px;
}

.ad-slot-sidebar {
  min-height: 250px;
  width: 300px;
}

.ad-slot-top {
  min-height: 90px;
}

.ad-slot-in-content {
  min-height: 90px;
}

.ad-slot-bottom {
  min-height: 90px;
}

/* Article header */
.article-header {
  margin-bottom: 48px;
}

.article-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 56px;
  font-weight: 900;
  line-height: 1.15;
  color: var(--c-text-main, #111827);
  margin: 0 0 32px;
  letter-spacing: -2px;
}

.article-meta {
  font-family: var(--font-sans, sans-serif);
  font-size: 15px;
  color: var(--c-text-sub, #6b7280);
  padding-bottom: 32px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.author {
  font-weight: bold;
}

/* Article body typography */
.article-body {
  font-family: var(--font-sans, sans-serif);
  font-size: 17px;
  line-height: 1.8;
  color: var(--c-text-main, #111);
  letter-spacing: -0.01em;
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
  margin-bottom: 2em;
}

.article-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  margin: 32px 0;
  box-shadow: 0 12px 32px rgba(0,0,0,0.06);
}

.article-body :deep(blockquote) {
  margin: 40px 0;
  padding: 24px 32px;
  border-left: 4px solid var(--c-blue-primary, #3B5BDB);
  background: rgba(67, 97, 238, 0.03);
  border-radius: 0 16px 16px 0;
  font-size: 18px;
  font-style: italic;
  color: var(--c-text-sub, #4b5563);
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
  border-radius: 10px;
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

/* Recommendations */
.article-recommendations {
  margin-top: 80px;
  padding-top: 64px;
  border-top: 1px solid rgba(0,0,0,0.06);
}

.rec-title {
  font-family: var(--font-sans, sans-serif);
  font-size: 20px;
  font-weight: 800;
  margin: 0 0 24px;
  color: var(--c-text-main, #111827);
  letter-spacing: -0.5px;
}

.rec-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.rec-item-wrapper {
  display: block;
  text-decoration: none;
  color: inherit;
  margin-bottom: 24px;
  cursor: pointer;
  position: relative;
}

.rec-image-card {
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 12px;
  position: relative;
  border: 1px solid rgba(0,0,0,0.04);
}

.rec-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rec-info-external {
  padding: 0 4px;
}

.rec-text-external {
  font-family: var(--font-sans, sans-serif);
  font-size: 15px;
  font-weight: 500;
  margin: 0 0 8px;
  color: var(--c-text-main, #111827);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rec-meta-external {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--c-text-sub, #6b7280);
}

.rec-author-external {
  display: flex;
  align-items: center;
  gap: 6px;
}

.author-avatar-external {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.05);
}

/* Previous/Next article navigation */
.article-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 48px;
  padding: 24px 0;
  border-top: 1px solid rgba(0,0,0,0.06);
  gap: 16px;
}

.article-nav-link {
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 500;
  color: var(--c-blue-primary, #3B5BDB);
  text-decoration: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.article-nav-link:hover {
  opacity: 0.7;
}

.article-nav-next {
  margin-left: auto;
  text-align: right;
}

/* Responsive: mobile < 1024px */
@media (max-width: 1023px) {
  .article-two-col {
    flex-direction: column;
  }

  .article-sidebar {
    width: 100%;
    margin-top: 48px;
    position: static;
    max-height: none;
    overflow-y: visible;
  }

  .sidebar-sticky {
    position: static;
  }

  .ad-slot-sidebar {
    width: 100%;
    max-width: 300px;
    margin: 0 auto;
  }
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
}
</style>
