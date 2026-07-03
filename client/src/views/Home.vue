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
          <!-- <a href="#">PRIVACY</a>
          <a href="#">TERMS</a> -->
        </div>
        <div class="footer-copyright">
          &copy; {{ new Date().getFullYear() }} mmPla Team. All rights reserved.
        </div>
      </div>
    </aside>

    <!-- 右侧内容列表 -->
    <main class="main-content">
      
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

      <!-- 响应式模块：资讯 Feed 流 -->
      <div class="ultra-wide-feed" v-if="feedItems.length > 0 || discoverArticles.length > 0">
        <div class="feed-header">
          <h2 class="feed-title">DISCOVER</h2>
          <span class="feed-subtitle">Personalized Content Recommendations</span>
        </div>
        <div class="feed-masonry">
          <!-- Discover Articles (internal) -->
          <router-link
            v-for="article in discoverArticles"
            :key="'article-' + article.id"
            :to="locale === 'en' ? `/en/discover/${article.slug}` : `/discover/${article.slug}`"
            target="_blank"
            class="feed-card"
          >
            <div class="feed-image" :style="{ height: '220px', background: article.bg_color }">
              <span class="feed-emoji">{{ article.icon }}</span>
            </div>
            <div class="feed-info">
              <h3 class="feed-text">{{ article.title }}</h3>
              <div class="feed-meta">
                <div class="feed-author">
                  <div class="author-avatar" :style="{ background: article.avatar_color }"></div>
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
            class="feed-card"
          >
            <div class="feed-image" :style="{ height: feed.image_height + 'px', background: feed.bg_color }">
              <span class="feed-emoji">{{ feed.icon }}</span>
            </div>
            <div class="feed-info">
              <h3 class="feed-text">{{ feed.title }}</h3>
              <div class="feed-meta">
                <div class="feed-author">
                  <div class="author-avatar" :style="{ background: feed.avatar_color }"></div>
                  <span>{{ feed.author }}</span>
                </div>
                <div class="feed-likes">
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
import SiteFooter from '../components/common/SiteFooter.vue'
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
}

const navItems = ref<NavItem[]>([])
const feedItems = ref<FeedItem[]>([])
const discoverArticles = ref<DiscoverArticle[]>([])
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
  loadDiscoverArticles()
}

async function loadDiscoverArticles() {
  try {
    const res = await fetch(`/api/discover/articles?locale=${locale.value}`)
    if (res.ok) discoverArticles.value = await res.json()
  } catch { /* silent */ }
}
</script>

<style scoped>
/* HC Design System 基础变量 */
.home-container {
  --c-grid: rgba(67, 97, 238, 0.08); /* 浅蓝色网格线 */
  --c-blue-primary: #4361EE; /* 品牌蓝 */
  --c-text-main: #111827;
  --c-text-sub: #6b7280;
  --c-border: #e5e7eb;
  --font-serif: var(--font-sans); /* 统一移除衬线体 */
  --font-mono: "JetBrains Mono", "Courier New", monospace;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;

  position: relative;
  height: 100vh;
  background-color: #f9fafb; /* 浅灰底色 */
  color: var(--c-text-main);
  font-family: var(--font-sans);
  overflow: hidden;
  display: flex;
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
  border-right: 1px solid var(--c-grid);
  display: flex;
  flex-direction: column;
  padding: 60px 40px;
  z-index: 10;
  background: #fff;
  overflow-y: auto;
  flex-shrink: 0;
  position: relative;
}

.left-panel-footer {
  margin-top: auto; /* Pushes the footer to the bottom */
  padding-top: 48px;
  border-top: 1px dashed var(--c-grid);
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
  height: 100vh;
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
  border: 1px solid var(--c-border);
  border-radius: 20px;
  background: #fff;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.bento-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08);
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
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), filter 0.6s ease;
}

/* 深色渐变遮罩，保证文字可读性 */
.editorial-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%);
  opacity: 0.8;
  transition: opacity 0.4s ease;
}

/* 悬浮交互：图片放大并微微变暗，遮罩加深 */
.bento-card.is-editorial:hover .editorial-bg-image {
  transform: scale(1.08);
  filter: brightness(0.9);
}
.bento-card.is-editorial:hover .editorial-overlay {
  opacity: 1;
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

/* ================== 信息面板 (Info Panel) ================== */

.card-info-panel {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* 针对 Editorial 杂志风卡片，应用极其特殊的排版 */
.bento-card.is-editorial .card-info-panel {
  padding-bottom: 24px;
}

.bento-card.is-editorial .card-title {
  color: #ffffff;
  font-size: 28px; /* 夸张的杂志大标题 */
  letter-spacing: -0.5px;
  text-shadow: 0 4px 12px rgba(0,0,0,0.4);
  margin-bottom: 0;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.bento-card.is-editorial .card-desc {
  color: rgba(255, 255, 255, 0.85);
  /* 隐藏描述：利用 max-height 和 opacity 实现滑出 */
  max-height: 0;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  margin-top: 0;
}

.bento-card.is-editorial .card-footer {
  max-height: 0;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  margin-top: 0;
  padding-bottom: 0;
  overflow: hidden;
}

/* Hover 时，杂志风卡片的信息滑出 */
.bento-card.is-editorial:hover .card-title {
  transform: translateY(-8px);
}
.bento-card.is-editorial:hover .card-desc {
  max-height: 100px;
  opacity: 1;
  transform: translateY(0);
  margin-top: 8px;
}
.bento-card.is-editorial:hover .card-footer {
  max-height: 50px;
  opacity: 1;
  transform: translateY(0);
  margin-top: 20px;
}

/* ======================================================= */

/* 如果是没有图片的普通纯色卡片，恢复常规布局 */
.bento-card:not(.is-editorial) .card-content {
  background: linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 100%);
  backdrop-filter: blur(4px);
}
.bento-card:not(.is-editorial):hover .card-content {
  background: linear-gradient(to bottom, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.5) 100%);
}
.bento-card:not(.is-editorial) .card-info-panel {
  padding-bottom: 24px;
}

/* 重新分配内边距到 info-panel 内部 */
.card-header {
  position: absolute;
  top: 24px;
  left: 24px;
  right: 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  z-index: 2; /* 悬浮在图片上方 */
}

.card-header .icon {
  font-size: 32px;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));
  background: rgba(255, 255, 255, 0.8);
  padding: 8px;
  border-radius: 16px;
  backdrop-filter: blur(8px);
}

.card-body {
  padding: 24px 24px 0 24px;
}

.card-title {
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: var(--c-text-main);
}
.is-featured .card-title {
  font-size: 28px;
}

.card-desc {
  font-size: 14px;
  color: var(--c-text-sub);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  margin-top: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px 24px 24px;
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
  opacity: 0;
  transform: translateX(-10px);
  transition: all 0.3s;
}
.bento-card:hover .arrow {
  opacity: 1;
  transform: translateX(0);
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

/* ================= DISCOVER Feed 流 ================= */
.ultra-wide-feed {
  display: block; /* 移除宽屏限制，全尺寸可用 */
  margin-top: 64px;
  padding-top: 48px;
  border-top: 2px solid var(--c-text-main);
}

.feed-header {
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
}

.feed-title {
  font-family: var(--font-sans);
  font-size: 48px;
  font-weight: 800;
  margin: 0 0 8px 0;
  letter-spacing: -1.5px;
  text-transform: uppercase;
}

.feed-subtitle {
  font-family: var(--font-mono);
  color: var(--c-text-sub);
  text-transform: uppercase;
  letter-spacing: 3px;
  font-size: 12px;
}

/* 瀑布流响应式布局 */
.feed-masonry {
  columns: 1;
  column-gap: 24px;
}
@media (min-width: 768px) { .feed-masonry { columns: 2; } }
@media (min-width: 1024px) { .feed-masonry { columns: 3; } }
@media (min-width: 1440px) { .feed-masonry { columns: 4; } }

.feed-card {
  display: block; /* 解决 a 标签 inline 导致的排版错乱 */
  text-decoration: none;
  color: inherit;
  break-inside: avoid;
  margin-bottom: 24px;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 20px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  position: relative;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.feed-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08);
}

.feed-image {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  border-bottom: 1px solid var(--c-border);
}

.feed-info {
  padding: 24px;
  background: #fff;
}

.feed-text {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 20px 0;
  color: var(--c-text-main);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.3s;
}

.feed-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--c-text-sub);
  font-family: var(--font-sans);
  border-top: 1px solid var(--c-border);
  padding-top: 16px;
}

.feed-author {
  display: flex;
  align-items: center;
  gap: 10px;
}

.author-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.feed-likes {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--c-text-main);
}
.feed-likes svg {
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.feed-card:hover .feed-likes svg {
  transform: scale(1.2);
  stroke: var(--c-blue-primary);
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
    overflow: visible;
  }
  
  .left-panel {
    width: 100%;
    height: auto;
    padding: 24px;
    border-right: none;
    border-bottom: 1px solid var(--c-grid);
    overflow: visible;
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
  }

  .bento-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: 200px; /* 小屏幕稍微减小卡片高度 */
    gap: 16px;
  }

  .bento-span-2x2, .bento-span-2x1, .bento-span-1x2 {
    grid-column: span 1;
    grid-row: span 1;
  }
}

@media (max-width: 480px) {
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
}
</style>
