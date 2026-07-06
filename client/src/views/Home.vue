<template>
  <div class="home-container">
    <div class="bg-grid"></div>

    <SiteHeader @locale-changed="handleLocaleChange" />

    <!-- 左侧大字号标题 -->
    <aside class="left-panel">
      <div class="brand-group" @mousemove="handleLogoMouseMove" @mouseleave="handleLogoMouseLeave">
        <div class="label">CURRENT PLATFORM</div>
        <h1 class="brand-name" ref="brandNameRef">
          <span class="letter" style="animation-delay: 0.0s">Q</span>
          <span class="letter" style="animation-delay: 0.05s">i</span>
          <span class="letter" style="animation-delay: 0.1s">a</span>
          <span class="letter" style="animation-delay: 0.15s">o</span>
          <span class="letter" style="animation-delay: 0.2s">N</span>
          <span class="letter" style="animation-delay: 0.25s">a</span>
          <span class="letter" style="animation-delay: 0.3s">n</span>
          <span class="brand-dot"></span>
        </h1>
      </div>
      
      <div class="sidebar-modules">
        <!-- Interactive 2D Fish Widget -->
        <div class="fish-widget-container module-box">
          <div class="fish-bowl" ref="bowlRef">
            <canvas ref="fishCanvas" class="fish-canvas"></canvas>
          </div>
        </div>

        <!-- 每日一句模块 -->
        <div class="quote-group module-box">
          <div class="label">QUOTE OF THE DAY</div>
          <blockquote class="quote-text">
            "Design is intelligence made visible."
          </blockquote>
          <cite class="quote-author">— Alina Wheeler</cite>
        </div>
      </div>

      <div class="left-panel-footer">
        <div class="footer-links">
          <router-link :to="locale === 'en' ? '/en/privacy' : '/privacy'">PRIVACY</router-link>
          <router-link :to="locale === 'en' ? '/en/terms' : '/terms'">TERMS</router-link>
          <a href="mailto:364317853@qq.com">CONTACT</a>
          <a href="/sitemap.xml">SITEMAP</a>
        </div>
        <div class="footer-copyright">
          &copy; {{ new Date().getFullYear() }} QiaoNan. All rights reserved.
        </div>
      </div>
    </aside>

    <!-- 右侧内容列表 -->
    <main class="main-content">
      <AdSlot position="top" />

      <div class="bento-grid">
        <router-link
          v-for="item in navItems"
          :key="item.id"
          :to="item.path"
          target="_blank"
          class="bento-card"
          :class="[getGridClass(item), item.featured ? 'is-featured' : '', item.image_url ? 'is-editorial' : '']"
        >
          <div class="card-bg">
            <div class="bg-pattern" :style="{ background: item.bg_color || '#f8faff' }"></div>
            <!-- 方案 1: 杂志封面全尺寸底层图 -->
            <img 
              v-if="item.image_url" 
              :src="item.image_url" 
              class="editorial-bg-image" 
              alt="bg" 
              referrerpolicy="no-referrer"
              @error="(e) => (e.target as HTMLElement).style.opacity = '0'" 
            />
            <div class="editorial-overlay" v-if="item.image_url"></div>
          </div>

          <div class="card-content">
            <div class="card-header">
              <span class="icon" v-if="!item.image_url">{{ item.icon }}</span>
              <span class="badge" v-if="item.require_auth && !user">AUTH</span>
            </div>
            
            <div class="card-info-panel">
              <div class="card-body">
                <h2 class="card-title">{{ item.title }}</h2>
                <p class="card-desc">{{ item.description }}</p>
              </div>
              <div class="card-footer" v-if="item.featured">
                <span class="meta-tag">{{ item.category || 'Tool' }}</span>
                <span class="arrow">→</span>
              </div>
            </div>
          </div>
        </router-link>
      </div>

      <!-- 专题推荐 (大画幅磁贴画廊排版) -->
      <div class="topics-section" v-if="topics.length > 0">
        <div class="gallery-header">
          <h2 class="gallery-title">FEATURED TOPICS</h2>
          <span class="gallery-subtitle">Explore Our Curated Collections</span>
        </div>
        
        <div class="gallery-grid">
          <router-link
            v-for="(t, index) in topics"
            :key="t.id"
            :to="locale === 'en' ? `/en/discover/topic/${t.slug}` : `/discover/topic/${t.slug}`"
            class="gallery-item"
          >
            <div class="gallery-visual">
              <img v-if="t.cover_image" :src="t.cover_image" class="gallery-img" alt="cover" loading="lazy" width="1100" height="360" />
              <div v-else class="gallery-img-placeholder" :style="{ background: t.bg_color || '#f3f4f6' }"></div>
              <div class="gallery-overlay"></div>
            </div>
            
            <div class="gallery-content">
              <div class="gallery-meta">
                <span class="gallery-index">0{{ index + 1 }}</span>
              </div>
              <h3 class="gallery-item-title">{{ t.title }}</h3>
              <p class="gallery-item-desc" v-if="t.description">{{ t.description }}</p>
            </div>
          </router-link>
        </div>
      </div>

      <AdSlot position="mid-banner" />

      <!-- 响应式模块：资讯 Feed 流 -->
      <div class="ultra-wide-feed" v-if="feedItems.length > 0 || discoverArticles.length > 0">
        <div class="feed-header">
          <h2 class="feed-title">DISCOVER</h2>
          <span class="feed-subtitle">{{ locale === 'en' ? 'Personalized Content Recommendations' : '精选内容推荐' }}</span>
          <router-link :to="locale === 'en' ? '/en/discover' : '/discover'" class="feed-more">
            {{ locale === 'en' ? 'View All' : '查看更多' }} &rarr;
          </router-link>
        </div>
        <div class="feed-masonry">
          <!-- Discover Articles (internal) -->
          <router-link
            v-for="article in discoverArticles"
            :key="'article-' + article.id"
            :to="locale === 'en' ? `/en/discover/${article.slug}` : `/discover/${article.slug}`"
            target="_blank"
            class="feed-item-wrapper"
          >
            <div class="feed-image-card" :style="{ height: '220px', background: article.bg_color }">
              <img v-if="article.cover_image" :src="article.cover_image" class="feed-cover-img" alt="cover" loading="lazy" width="400" height="220" />
              <span v-else class="feed-emoji">{{ article.icon }}</span>
            </div>
            <div class="feed-info-external">
              <h3 class="feed-text-external">{{ article.title }}</h3>
              <div class="feed-meta-external">
                <div class="feed-author-external">
                  <div class="author-avatar-external" :style="{ background: article.avatar_color }"></div>
                  <span>{{ article.author }}</span>
                </div>
              </div>
            </div>
          </router-link>
          <!-- Legacy Feed Items (external links) -->
          <component
            :is="feed.link ? 'a' : 'div'"
            v-for="feed in feedItems"
            :key="feed.id"
            :href="feed.link || undefined"
            :target="feed.link ? '_blank' : undefined"
            class="feed-item-wrapper"
          >
            <div class="feed-image-card" :style="{ height: feed.image_height + 'px', background: feed.bg_color }">
              <img v-if="feed.cover_image" :src="feed.cover_image" class="feed-cover-img" alt="cover" loading="lazy" width="400" height="220" />
              <span v-else class="feed-emoji">{{ feed.icon }}</span>
            </div>
            <div class="feed-info-external">
              <h3 class="feed-text-external">{{ feed.title }}</h3>
              <div class="feed-meta-external">
                <div class="feed-author-external">
                  <div class="author-avatar-external" :style="{ background: feed.avatar_color }"></div>
                  <span>{{ feed.author }}</span>
                </div>
                <div class="feed-likes-external">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                  <span>{{ feed.likes }}</span>
                </div>
              </div>
            </div>
          </component>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchMe, type AuthUser } from '../lib/auth'
import { fetchQuota } from '../lib/quota'
import SiteHeader from '../components/common/SiteHeader.vue'
import AdSlot from '../components/common/AdSlot.vue'
import { startFishTank } from '../game/FishDrawingAPI'

const route = useRoute()

const user = ref<AuthUser | null>(null)

interface NavItem {
  id: string
  icon: string
  title: string
  description: string
  path: string
  require_auth: number
  featured: number
  category: string
  image_url: string
  bg_color: string
  grid_span: string
  sort_order: number
}

interface FeedItem {
  id: string
  title: string
  author: string
  icon: string
  bg_color: string
  avatar_color: string
  link: string
  likes: number
  image_height: number
  cover_image?: string
}

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
  icon: string
  bg_color: string
  title: string
  description: string
  article_count: number
  cover_image?: string
}

const navItems = ref<NavItem[]>([])
const feedItems = ref<FeedItem[]>([])
const discoverArticles = ref<DiscoverArticle[]>([])
const topics = ref<TopicItem[]>([])
const locale = computed(() => route.path === '/en' ? 'en' : 'zh')

// --- Fish Widget Logic ---
const bowlRef = ref<HTMLElement | null>(null)
const fishCanvas = ref<HTMLCanvasElement | null>(null)
let stopFishTank: (() => void) | null = null
// -------------------------

// --- Logo Interactive Physics ---
const brandNameRef = ref<HTMLElement | null>(null)

function handleLogoMouseMove(e: MouseEvent) {
  if (!brandNameRef.value) return
  
  const container = brandNameRef.value
  const rect = container.getBoundingClientRect()
  
  // Calculate mouse position relative to the container (0 to 1)
  const relativeX = (e.clientX - rect.left) / rect.width
  
  const letters = container.querySelectorAll('.letter')
  const dot = container.querySelector('.brand-dot') as HTMLElement

  letters.forEach((letterNode, index) => {
    const el = letterNode as HTMLElement
    // Calculate how close the mouse is to this specific letter
    // Assuming letters are evenly distributed
    const letterCenter = (index + 0.5) / letters.length
    const dist = Math.abs(relativeX - letterCenter)
    
    // Impact radius (0.3 means letters within 30% width of the mouse react)
    const radius = 0.3
    
    if (dist < radius) {
      // Calculate intensity (1 when directly over, 0 at edge of radius)
      const intensity = 1 - (dist / radius)
      
      // Calculate physics: Upward translation and Color shift based on mouse proximity
      const yOffset = -8 * intensity
      
      // Interpolate color from Base to Active (Brand Blue to Pastel Purple)
      const baseColor = { r: 17, g: 24, b: 39 } // #111827
      const activeColor = { r: 177, g: 151, b: 252 } // #B197FC
      
      const r = Math.round(baseColor.r + (activeColor.r - baseColor.r) * intensity)
      const g = Math.round(baseColor.g + (activeColor.g - baseColor.g) * intensity)
      const b = Math.round(baseColor.b + (activeColor.b - baseColor.b) * intensity)
      
      el.style.transform = `translateY(${yOffset}px)`
      el.style.background = `linear-gradient(135deg, rgb(${r}, ${g}, ${b}) 0%, var(--c-blue-primary) 100%)`
      el.style.webkitBackgroundClip = 'text'
      
    } else {
      // Reset if outside radius
      el.style.transform = 'translateY(0px)'
      el.style.background = 'linear-gradient(135deg, #111827 0%, #4b5563 100%)'
      el.style.webkitBackgroundClip = 'text'
    }
  })

  // Dot reacts to the far right side
  if (dot) {
    const distToRight = Math.abs(relativeX - 1)
    if (distToRight < 0.2) {
      const intensity = 1 - (distToRight / 0.2)
      dot.style.transform = `scale(${1 + 0.5 * intensity})`
      dot.style.backgroundColor = '#B197FC'
    } else {
      dot.style.transform = 'scale(1)'
      dot.style.backgroundColor = 'var(--c-blue-primary)'
    }
  }
}

function handleLogoMouseLeave() {
  if (!brandNameRef.value) return
  const container = brandNameRef.value
  const letters = container.querySelectorAll('.letter')
  const dot = container.querySelector('.brand-dot') as HTMLElement
  
  letters.forEach(letterNode => {
    const el = letterNode as HTMLElement
    el.style.transform = 'translateY(0px)'
    el.style.background = 'linear-gradient(135deg, #111827 0%, #4b5563 100%)'
    el.style.webkitBackgroundClip = 'text'
  })
  
  if (dot) {
    dot.style.transform = 'scale(1)'
    dot.style.backgroundColor = 'var(--c-blue-primary)'
  }
}
// -------------------------

function handleLocaleChange(lang: string) {
  // Navigation handled by SiteHeader, just reload discover articles on locale change
}

function getGridClass(item: NavItem): string {
  const span = item.grid_span || '1x1'
  if (span === '2x2') return 'bento-span-2x2'
  if (span === '2x1') return 'bento-span-2x1'
  if (span === '1x2') return 'bento-span-1x2'
  return ''
}

watch(locale, () => {
  loadDiscoverArticles()
  loadTopics()
})

onMounted(async () => {
  user.value = await fetchMe()
  if (user.value) fetchQuota()
  loadHomeData()
  
  // Start 2D Canvas Fish Tank
  if (fishCanvas.value && bowlRef.value) {
    const canvas = fishCanvas.value
    const rect = bowlRef.value.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    
    // Pick a random species
    const speciesList: Array<'moyu' | 'juanwang' | 'sheniu' | 'xianyu' | 'xijing'> = ['moyu', 'juanwang', 'sheniu', 'xianyu', 'xijing']
    const randomSpecies = speciesList[Math.floor(Math.random() * speciesList.length)]
    
    const res = startFishTank(canvas, [
      {
        species: randomSpecies,
        bodyLength: 15,
        speedMultiplier: 0.2,
        bubbles: false,
      },
    ])
    stopFishTank = res.stop
  }
})

onUnmounted(() => {
  if (stopFishTank) stopFishTank()
})

async function loadHomeData() {
  try {
    const [modulesRes, feedsRes] = await Promise.all([
      fetch('/api/home/modules'),
      fetch('/api/home/feeds'),
    ])
    if (modulesRes.ok) navItems.value = await modulesRes.json()
    if (feedsRes.ok) feedItems.value = await feedsRes.json()
  } catch { /* silent */ }
  const ssgCss = document.getElementById('ssg-critical-css')
  if (ssgCss) ssgCss.remove()
  loadDiscoverArticles()
  loadTopics()
}

async function loadTopics() {
  try {
    const res = await fetch(`/api/discover/topics?locale=${locale.value}`)
    if (res.ok) topics.value = await res.json()
  } catch { /* silent */ }
}

async function loadDiscoverArticles() {
  try {
    const res = await fetch(`/api/discover/articles?locale=${locale.value}&limit=50`)
    if (res.ok) {
      const data = await res.json()
      discoverArticles.value = data.items || data
    }
  } catch { /* silent */ }
}
</script>

<style scoped>
/* HC Design System 基础变量 */
.home-container {
  --c-grid: rgba(67, 97, 238, 0.04); /* 网格线进一步变淡，更加无感高级 */
  --c-blue-primary: #4361EE; /* 品牌蓝 */
  --c-text-main: #111827;
  --c-text-sub: #6b7280;
  --c-border: rgba(0,0,0,0.06); /* 边框变淡 */
  --font-serif: var(--font-sans); /* 统一移除衬线体 */
  --font-mono: "JetBrains Mono", "Courier New", monospace;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;

  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: #fafafa; /* 极其微弱的暖白灰，比纯白更有质感 */
  color: var(--c-text-main);
  font-family: var(--font-sans);
  display: flex;
  overflow-x: clip;
}

/* 蓝底网格背景 */
.bg-grid {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    linear-gradient(to right, var(--c-grid) 1px, transparent 1px),
    linear-gradient(to bottom, var(--c-grid) 1px, transparent 1px);
  background-size: 50px 50px;
  z-index: 0;
  pointer-events: none;
}

/* ================= 左侧侧边栏 ================= */
.left-panel {
  width: 360px;
  height: 100vh;
  /* 移除生硬的实线边框，改用弥散阴影和背景色区分层级 */
  border-right: none;
  box-shadow: 1px 0 24px rgba(0,0,0,0.02);
  display: flex;
  flex-direction: column;
  padding: 60px 40px;
  z-index: 10;
  background: #ffffff;
  overflow-y: auto;
  flex-shrink: 0;
  position: relative;
}

.left-panel-footer {
  margin-top: auto;
  padding-top: 48px;
  /* 弱化分割线 */
  border-top: 1px solid rgba(0,0,0,0.04);
}

.footer-links {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.footer-links a {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--c-text-main);
  text-decoration: none;
  letter-spacing: 1px;
  transition: color 0.2s;
}

.footer-links a:hover {
  color: var(--c-blue-primary);
}

.footer-copyright {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--c-text-sub);
  line-height: 1.4;
}

.brand-group {
  margin-bottom: 48px;
  position: relative;
}

.brand-group .label {
  margin-bottom: 12px;
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--c-text-sub);
}

.brand-name {
  font-family: var(--font-sans);
  font-size: 56px;
  font-weight: 900;
  line-height: 1;
  margin: 0;
  letter-spacing: -2.5px;
  position: relative;
  display: inline-flex;
  align-items: baseline;
  cursor: pointer;
}

.brand-name .letter {
  display: inline-block;
  color: transparent;
  background: linear-gradient(135deg, #111827 0%, #4b5563 100%);
  -webkit-background-clip: text;
  background-clip: text;
  opacity: 0;
  transform: translateY(20px);
  animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transition: transform 0.1s ease, background 0.1s ease;
}

.brand-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background-color: var(--c-blue-primary);
  border-radius: 50%;
  margin-left: 2px;
  opacity: 0;
  animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.5s forwards;
  transition: transform 0.1s ease, background-color 0.1s ease;
}

@keyframes slideUpFade {
  0% {
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0);
  }
  80% {
    transform: scale(1.2);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.sidebar-modules {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

/* ================= Interactive Fish Widget ================= */
.fish-widget-container {
  padding-top: 24px;
  border-top: 1px solid var(--c-grid);
}

.fish-bowl {
  position: relative;
  width: 100%;
  height: 140px;
  background: transparent;
  overflow: hidden;
  margin-top: 8px;
}

.fish-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}

.fish-food {
  position: absolute;
  width: 6px;
  height: 6px;
  background: #D97706;
  border-radius: 50%;
  transition: top 1s cubic-bezier(0.5, 0, 1, 1);
  z-index: 5;
}

/* ========================================================= */

.module-box {
  padding-top: 24px;
  border-top: 1px solid var(--c-grid);
}

.module-box .label {
  margin-bottom: 16px;
  color: var(--c-blue-primary);
}

.stats-number {
  font-family: var(--font-sans);
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -3px;
}

/* 每日一句 */
.quote-text {
  font-family: var(--font-serif);
  font-size: 18px;
  font-style: italic;
  line-height: 1.5;
  margin: 0 0 12px 0;
  color: var(--c-text-main);
}
.quote-author {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-sub);
}

/* ================= 右侧内容区 ================= */
.main-content {
  flex: 1;
  min-height: 100vh;
  min-height: 100dvh;
  margin-top: 50px; /* 为顶部导航栏留出空间 */
  padding: 40px;
  position: relative;
  z-index: 1;
  overflow-y: auto;
  padding-bottom: 100px; /* 增加底部留白，确保能滚到底 */
}

/* Bento/Masonry Grid 布局 */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-rows: 240px;
  gap: 24px;
  width: 100%;
}

.bento-card {
  position: relative;
  /* 去除边框，纯靠极浅的弥散阴影撑起体积，类似 iOS/VisionOS 卡片 */
  border: none;
  border-radius: 10px; /* 圆角加大到 24px，更现代 */
  background: #fff;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.02), 0 2px 8px rgba(0,0,0,0.02);
  transition: box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.bento-card:hover {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0,0,0,0.03);
}

/* 差异化拼图尺寸 — 由后台 grid_span 字段控制 */
.bento-span-2x2 { grid-column: span 2; grid-row: span 2; }
.bento-span-2x1 { grid-column: span 2; grid-row: span 1; }
.bento-span-1x2 { grid-column: span 1; grid-row: span 2; }

/* 响应式调整跨度 */
@media (max-width: 1200px) {
  .bento-span-2x2, .bento-span-2x1 { grid-column: span 2; }
}
@media (max-width: 900px) {
  .bento-span-2x2, .bento-span-2x1, .bento-span-1x2 {
    grid-column: span 1;
    grid-row: span 1;
  }
}

/* 背景图层 */
.card-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 0;
  pointer-events: none;
}
/* 方案 1: Editorial 杂志风主图 */
.editorial-bg-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  top: 0; left: 0;
  /* 恢复写死的 cubic-bezier 避免变量失效 */
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), filter 0.6s ease;
}

/* 悬浮交互：图片放大并微微变暗 */
.bento-card.is-editorial:hover .editorial-bg-image {
  transform: scale(1.08); /* 仅放大内部图片 */
  filter: brightness(0.9);
}

/* 深色渐变遮罩，保证文字可读性 */
.editorial-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%);
  opacity: 0.8;
}

.bg-pattern {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  opacity: 0.8;
  position: absolute;
  top: 0; left: 0;
}

/* 内容层 */
.card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  background: transparent; 
}

/* ================== 核心交互：Bento & Topic 卡片重构 ================== */

/* 1. Bento Card 基础与背景 */
.card-info-panel {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 24px;
  z-index: 2;
}

.card-body {
  position: relative; /* 作为文字滑出的绝对定位锚点 */
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* 2. Bento Card 文字排版 */
.card-title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: var(--c-text-main);
  /* 标题默认乖乖待在底部，不作任何偏移 */
  transform: translateY(0);
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.is-featured .card-title {
  font-size: 24px;
}

.card-desc {
  /* 描述文字绝对定位到标题的正下方 */
  position: absolute;
  top: 100%; 
  left: 0;
  right: 0;
  margin-top: 8px; /* 与标题的间距 */
  font-size: 14px;
  color: var(--c-text-sub);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 初始状态隐藏并微微靠下 */
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.card-footer {
  /* Footer 也藏到下面，和描述拉开距离 */
  position: absolute;
  top: calc(100% + 48px);
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

/* 3. Bento Card Hover 丝滑滑出逻辑 */
/* 计算需要向上腾出的空间：大概是描述(约42px) + 间距(8px) = 50px */
.bento-card:hover .card-title {
  transform: translateY(-50px);
}
.bento-card:hover .card-desc {
  opacity: 1;
  transform: translateY(-50px);
  pointer-events: auto;
  transition-delay: 0.05s; /* 错落滑出 */
}
.bento-card:hover .card-footer {
  opacity: 1;
  transform: translateY(-50px);
  pointer-events: auto;
  transition-delay: 0.1s; /* 最后滑出 */
}

/* 4. 针对 Editorial 杂志风卡片的样式覆写 */
.bento-card.is-editorial .card-title {
  color: #ffffff;
  font-size: 20px;
  letter-spacing: -0.5px;
  text-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.bento-card.is-editorial .card-desc {
  color: rgba(255, 255, 255, 0.85);
}

/* 如果是没有图片的普通纯色卡片，恢复常规布局 */
.bento-card:not(.is-editorial) .card-content {
  background: linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 100%);
  backdrop-filter: blur(4px);
}

/* 顶部图标/Badge区 */
.card-header {
  position: absolute;
  top: 24px;
  left: 24px;
  right: 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  z-index: 2;
}

.card-header .icon {
  font-size: 32px;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));
  background: rgba(255, 255, 255, 0.8);
  padding: 8px;
  border-radius: 10px;
  backdrop-filter: blur(8px);
}

.meta-tag {
  background: var(--c-blue-primary);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  box-shadow: 0 2px 4px rgba(59, 91, 219, 0.2);
}

.arrow {
  font-family: var(--font-mono);
  font-size: 18px;
  color: var(--c-blue-primary);
}

.badge {
  background: var(--c-blue-primary);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  letter-spacing: 1px;
  font-weight: 600;
}

/* ================= TOPICS 专题推荐 (Magnetic Gallery Style) ================= */
.topics-section {
  margin-top: 80px;
  padding-top: 48px;
  border-top: 1px solid var(--c-border);
}

.gallery-header {
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
}

.gallery-title {
  font-family: var(--font-sans);
  font-size: 32px;
  font-weight: 900;
  margin: 0 0 4px 0;
  letter-spacing: -1px;
  color: var(--c-text-main);
}

.gallery-subtitle {
  font-family: var(--font-mono);
  color: var(--c-blue-primary);
  text-transform: uppercase;
  letter-spacing: 4px;
  font-size: 12px;
  font-weight: 600;
}

.gallery-grid {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.gallery-item {
  display: block;
  position: relative;
  height: 360px;
  border-radius: 10px;
  overflow: hidden;
  text-decoration: none;
  color: #fff;
  /* 基础阴影 */
  box-shadow: 0 8px 32px rgba(0,0,0,0.04);
  /* 平滑过渡 */
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.gallery-item:hover {
  transform: translateY(-8px);
  box-shadow: 0 24px 48px rgba(0,0,0,0.12);
}

.gallery-visual {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1;
}

.gallery-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
.gallery-img-placeholder {
  width: 100%;
  height: 100%;
}

.gallery-item:hover .gallery-img {
  transform: scale(1.05);
}

.gallery-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  /* 左侧和底部加深渐变，确保文字清晰 */
  background: linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 60%, transparent 100%),
              linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%);
  transition: opacity 0.5s ease;
}
.gallery-item:hover .gallery-overlay {
  opacity: 0.9;
}

.gallery-content {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 60%;
  padding: 40px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.gallery-meta {
  margin-bottom: 16px;
}

.gallery-index {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--c-blue-primary);
  background: rgba(255,255,255,0.9);
  padding: 4px 12px;
  border-radius: 10px;
  backdrop-filter: blur(4px);
}

.gallery-item-title {
  font-family: var(--font-sans);
  font-size: 36px;
  font-weight: 800;
  margin: 0 0 12px 0;
  line-height: 1.2;
  letter-spacing: -1px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.gallery-item-desc {
  font-size: 16px;
  color: rgba(255,255,255,0.85);
  line-height: 1.6;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 响应式调整 */
@media (max-width: 900px) {
  .gallery-item {
    height: 280px;
  }
  .gallery-content {
    width: 100%;
    padding: 24px;
  }
  .gallery-item-title {
    font-size: 28px;
  }
}

/* ================= DISCOVER Feed 流 ================= */
.ultra-wide-feed {
  display: block; /* 移除宽屏限制，全尺寸可用 */
  margin-top: 64px;
}

.feed-header {
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.feed-more {
  position: absolute;
  right: 0;
  bottom: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--c-blue-primary);
  text-decoration: none;
  letter-spacing: 1px;
  transition: opacity 0.2s;
}
.feed-more:hover {
  opacity: 0.7;
}

.feed-title {
  font-family: var(--font-sans);
  font-size: 56px; /* 进一步拉大标题，强化杂志排版感 */
  font-weight: 900;
  margin: 0 0 4px 0;
  letter-spacing: -2px;
  text-transform: uppercase;
  color: var(--c-text-main);
}

.feed-subtitle {
  font-family: var(--font-mono);
  color: var(--c-blue-primary); /* 副标题使用品牌色提亮 */
  text-transform: uppercase;
  letter-spacing: 4px;
  font-size: 12px;
  font-weight: 600;
}

/* 瀑布流响应式布局 */
.feed-masonry {
  columns: 1;
  column-gap: 20px;
}
@media (min-width: 640px) { .feed-masonry { columns: 2; } }
@media (min-width: 1024px) { .feed-masonry { columns: 3; } }
@media (min-width: 1440px) { .feed-masonry { columns: 4; } }
@media (min-width: 1800px) { .feed-masonry { columns: 5; } }

.feed-item-wrapper {
  display: block;
  text-decoration: none;
  color: inherit;
  break-inside: avoid;
  margin-bottom: 24px; /* 增加底部间距以容纳外部文字 */
  cursor: pointer;
  position: relative;
}

/* 独立的图片卡片（仅卡片部分有圆角和底色） */
.feed-image-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 12px; /* 图片和标题之间的间距 */
  position: relative;
  /* 移除阴影和 Hover 缩放动画，添加截图中的浅色外边框 */
  border: 1px solid rgba(0,0,0,0.04);
  box-shadow: none;
  transition: none;
}

.feed-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 外部信息区（不再有白底和内边距） */
.feed-info-external {
  padding: 0 4px; /* 微微缩进一点点对齐图片圆角视觉 */
}

.feed-text-external {
  font-family: var(--font-sans);
  font-size: 14px; /* 贴近小红书日常字号 */
  font-weight: 500;
  line-height: 1.5;
  margin: 0 0 8px 0;
  color: var(--c-text-main);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.feed-meta-external {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--c-text-sub);
  font-family: var(--font-sans);
}

.feed-author-external {
  display: flex;
  align-items: center;
  gap: 6px;
}

.author-avatar-external {
  width: 18px; /* 头像再小一点 */
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.05);
}

.feed-likes-external {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--c-text-sub);
}
.feed-likes-external svg {
  transition: transform 0.2s ease;
}
.feed-item-wrapper:hover .feed-likes-external svg {
  transform: scale(1.1);
  stroke: #ff4d4f; /* 悬浮时心形变红 */
}

/* ================= 响应式 ================= */
@media (max-width: 1200px) {
  .left-panel {
    width: 280px;
    padding: 40px 24px;
  }
  .main-content {
    padding: 24px;
  }
}

@media (max-width: 900px) {
  .left-panel {
    width: 240px;
    padding: 32px 20px;
  }
  .main-content {
    padding: 20px;
  }
  .bento-grid {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
  /* 在中等屏幕取消跨度，全部回退为 1x1 */
  .bento-span-2x2, .bento-span-2x1, .bento-span-1x2 {
    grid-column: span 1;
    grid-row: span 1;
  }
}

@media (max-width: 768px) {
  .home-container {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: visible;
  }
  
  .left-panel {
    width: 100%;
    height: auto;
    padding: 84px 20px 24px;
    border-right: none;
    border-bottom: 1px solid var(--c-grid);
    overflow: visible;
    box-shadow: none;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(18px);
  }

  .sidebar-modules {
    display: none; /* 小屏幕隐藏次要模块以节省空间 */
  }

  .brand-group {
    margin-bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .brand-name {
    font-size: 40px;
  }
  
  .brand-group .label {
    margin-bottom: 4px;
  }

  .main-content {
    margin-top: 0;
    padding: 16px;
    height: auto;
    overflow: visible;
    min-height: 0;
    padding-bottom: 48px;
  }

  .bento-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: 200px; /* 小屏幕稍微减小卡片高度 */
    gap: 16px;
  }

  .topics-section {
    margin-top: 48px;
    padding-top: 32px;
  }

  .gallery-header,
  .feed-header {
    margin-bottom: 24px;
  }

  .gallery-title {
    font-size: 24px;
  }

  .gallery-subtitle,
  .feed-subtitle {
    letter-spacing: 2px;
    font-size: 11px;
    line-height: 1.5;
  }

  .feed-title {
    font-size: 40px;
    letter-spacing: -1px;
  }

  .feed-more {
    position: static;
    margin-top: 12px;
    align-self: flex-start;
  }

  .bento-span-2x2, .bento-span-2x1, .bento-span-1x2 {
    grid-column: span 1;
    grid-row: span 1;
  }
}

@media (max-width: 480px) {
  .left-panel {
    padding: 76px 16px 20px;
  }

  .brand-name {
    font-size: 34px;
  }

  .left-panel-footer {
    padding-top: 20px;
  }

  .footer-links {
    gap: 12px;
    flex-wrap: wrap;
  }

  .card-title {
    font-size: 18px;
  }
  .is-featured .card-title {
    font-size: 22px;
  }
  .bento-grid {
    grid-auto-rows: 180px;
  }
  .card-content {
    padding: 16px;
  }

  .gallery-item {
    height: 220px;
  }

  .gallery-content {
    padding: 20px;
  }

  .gallery-item-title {
    font-size: 22px;
  }

  .feed-title {
    font-size: 34px;
  }
}
</style>
