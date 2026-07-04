<template>
  <div class="default-topic">
    <section class="topic-hero">
      <div class="hero-media" :style="{ background: topic.bg_color || '#dbe4ff' }">
        <img
          v-if="topic.cover_image"
          :src="topic.cover_image"
          :alt="topic.title"
          class="hero-image"
          referrerpolicy="no-referrer"
        />
      </div>

      <div class="hero-overlay"></div>
      <div class="hero-noise"></div>

      <div class="hero-copy">
        <span class="hero-kicker">{{ locale === 'en' ? 'Featured Topic' : '精选专题' }}</span>
        <h1 class="hero-title">{{ topic.title }}</h1>

        <div class="hero-meta">
          <span class="hero-badge">{{ locale === 'en' ? 'Editorial Selection' : '编辑精选' }}</span>
          <span class="hero-badge">{{ locale === 'en' ? 'Deep Reading' : '深度阅读' }}</span>
        </div>
      </div>
    </section>

    <section class="articles-section">
      <div class="article-list">
        <router-link
          v-for="(article, index) in articles"
          :key="article.slug"
          :to="locale === 'en' ? `/en/discover/${article.slug}` : `/discover/${article.slug}`"
          class="article-item"
        >
          <div class="article-cover" :style="{ background: article.bg_color || '#eef2ff' }">
            <img v-if="article.cover_image" :src="article.cover_image" class="article-img" alt="cover" referrerpolicy="no-referrer" />
            <span v-else class="article-icon-fallback">{{ article.icon }}</span>
          </div>

          <div class="article-content">
            <div class="article-main-info">
              <h3 class="article-title">{{ article.title }}</h3>
              <p v-if="article.summary" class="article-summary">{{ article.summary }}</p>
            </div>

            <div class="article-meta-footer">
              <span class="article-author">{{ article.author }}</span>
              <span class="article-date" v-if="(article as any).created_at">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                {{ new Date((article as any).created_at).toISOString().split('T')[0] }}
              </span>
            </div>
          </div>
        </router-link>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  topic: {
    title: string
    description: string
    icon: string
    bg_color: string
    cover_image?: string
  }
  articles: Array<{
    slug: string
    icon: string
    cover_image: string
    bg_color: string
    avatar_color: string
    author: string
    title: string
    summary: string
  }>
  locale: string
}>()
</script>

<style scoped>
.default-topic {
  display: flex;
  flex-direction: column;
  gap: 28px;
  font-family: var(--font-sans, sans-serif);
}

.topic-hero {
  position: relative;
  min-height: 240px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(15, 23, 42, 0.08), 0 10px 24px rgba(15, 23, 42, 0.04);
  background: #0f172a;
}

.hero-media,
.hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.hero-image {
  object-fit: cover;
  transform: scale(1.01);
  transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.topic-hero:hover .hero-image {
  transform: scale(1.06);
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.14) 0%, rgba(15, 23, 42, 0.26) 32%, rgba(15, 23, 42, 0.78) 100%);
}

.hero-noise {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.18), transparent 26%),
    radial-gradient(circle at left center, rgba(177, 151, 252, 0.2), transparent 32%);
  pointer-events: none;
}

.hero-copy {
  position: relative;
  z-index: 1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  padding: 32px;
  color: #fff;
}

.hero-kicker,
.article-author,
.article-readmore {
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
}

.hero-kicker {
  color: rgba(255, 255, 255, 0.72);
}

.hero-title {
  max-width: 760px;
  margin: 0;
  font-family: var(--font-sans, sans-serif);
  font-size: clamp(32px, 5vw, 56px);
  line-height: 1;
  letter-spacing: -0.04em;
  font-weight: 700;
  text-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.hero-meta,
.article-bottomline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hero-badge,
.bottom-chip {
  display: inline-flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  line-height: 1;
  backdrop-filter: blur(16px);
}

.articles-section {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.article-list {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.article-item {
  display: flex;
  align-items: stretch;
  gap: 24px;
  text-decoration: none;
  color: inherit;
  transition: opacity 0.2s ease;
}

.article-item:hover {
  opacity: 0.8;
}

.article-cover {
  flex: 0 0 240px;
  height: 140px;
  border-radius: 8px;
  overflow: hidden;
  background-color: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.article-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.article-icon-fallback {
  font-size: 48px;
  line-height: 1;
}

.article-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 4px 0;
  min-width: 0;
}

.article-main-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.article-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
  font-weight: 600;
  color: #111827;
  font-family: var(--font-sans, sans-serif);
}

.article-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #6b7280;
}

.article-meta-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #9ca3af;
}

.article-author {
  color: #9ca3af;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}

.article-date {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 1024px) {
}

@media (max-width: 768px) {
  .default-topic {
    gap: 20px;
  }

  .topic-hero,
  .hero-copy {
    min-height: 200px;
  }

  .hero-copy {
    padding: 28px 24px;
  }

  .article-list {
    gap: 24px;
  }

  .article-item {
    flex-direction: column;
    gap: 16px;
  }

  .article-cover {
    flex: none;
    width: 100%;
    height: 180px;
  }
}
</style>
