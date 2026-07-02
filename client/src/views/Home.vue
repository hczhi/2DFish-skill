<template>
  <div class="home-container">
    <div class="bg-grid"></div>

    <!-- 顶部导航栏 -->
    <header class="top-bar">
      <div class="top-links" v-if="user">
        <span class="label">USER:</span>
        <span class="value">{{ user.username }}</span>
        <QuotaIndicator />
        <router-link to="/admin" class="nav-btn" v-if="isAdmin(user)">ADMIN</router-link>
        <router-link to="/settings/logs" class="nav-btn">LOGS</router-link>
        <router-link to="/settings" class="nav-btn">SETTINGS</router-link>
      </div>
      <div class="date-time">{{ currentTime }}</div>
      <button class="exit-btn" @click="handleLogout" v-if="user">EXIT</button>
      <router-link to="/login" class="exit-btn" v-else>LOGIN</router-link>
    </header>

    <!-- 左侧大字号标题 -->
    <aside class="left-panel">
      <div class="brand-group">
        <div class="label">CURRENT PLATFORM</div>
        <h1 class="brand-name">QiaoNan.</h1>
      </div>
      
      <div class="sidebar-modules">
        <div class="stats-group module-box">
          <div class="label">TOTAL APPS</div>
          <div class="stats-number">{{ navItems.length || '—' }}</div>
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
    </aside>

    <!-- 右侧内容列表 -->
    <main class="main-content">
      
      <div class="bento-grid">
        <router-link
          v-for="item in navItems"
          :key="item.id"
          :to="item.path"
          class="bento-card"
          :class="[getGridClass(item), item.featured ? 'is-featured' : '']"
        >
          <div class="card-bg">
            <img v-if="item.image_url" :src="item.image_url" class="bg-image" alt="bg" />
            <div v-else class="bg-pattern" :style="{ background: item.bg_color || '#f8faff' }"></div>
          </div>

          <div class="card-content">
            <div class="card-header">
              <span class="icon">{{ item.icon }}</span>
              <span class="badge" v-if="item.require_auth && !user">AUTH</span>
            </div>
            <div class="card-body">
              <h2 class="card-title">{{ item.title }}</h2>
              <p class="card-desc">{{ item.description }}</p>
            </div>
            <div class="card-footer" v-if="item.featured">
              <span class="meta-tag">{{ item.category || 'Tool' }}</span>
              <span class="arrow">→</span>
            </div>
          </div>
        </router-link>
      </div>

      <!-- 超宽屏专属模块：资讯 Feed 流 -->
      <div class="ultra-wide-feed" v-if="feedItems.length > 0">
        <div class="feed-header">
          <h2 class="feed-title">DISCOVER</h2>
          <span class="feed-subtitle">Personalized Content Recommendations</span>
        </div>
        <div class="feed-masonry">
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
import { ref, onMounted, onUnmounted } from 'vue'
import { fetchMe, logout, isAdmin, type AuthUser } from '../lib/auth'
import { fetchQuota } from '../lib/quota'
import QuotaIndicator from '../components/common/QuotaIndicator.vue'

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

const navItems = ref<NavItem[]>([])
const feedItems = ref<FeedItem[]>([])

function getGridClass(item: NavItem): string {
  const span = item.grid_span || '1x1'
  if (span === '2x2') return 'bento-span-2x2'
  if (span === '2x1') return 'bento-span-2x1'
  if (span === '1x2') return 'bento-span-1x2'
  return ''
}

// 时间显示逻辑
const currentTime = ref('')
let timer: number

const updateTime = () => {
  const now = new Date()
  currentTime.value = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).replace(/\//g, '-')
}

onMounted(async () => {
  user.value = await fetchMe()
  if (user.value) fetchQuota()
  updateTime()
  timer = window.setInterval(updateTime, 1000)
  loadHomeData()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
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
}

function handleLogout() {
  logout()
}
</script>

<style scoped>
/* 杂志风 Brutalist 基础变量 */
.home-container {
  --c-grid: rgba(0, 160, 255, 0.15); /* 浅蓝色网格线 */
  --c-blue-primary: #0077FF; /* 高亮蓝色 */
  --c-text-main: #111111;
  --c-text-sub: #555555;
  --c-border: #E5E7EB;
  --font-serif: "Noto Serif SC", "Songti SC", "SimSun", serif; /* 衬线字体 */
  --font-mono: "JetBrains Mono", "Courier New", monospace; /* 等宽字体 */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;

  position: relative;
  height: 100vh;
  background-color: #ffffff;
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

/* ================= 顶部导航栏 ================= */
.top-bar {
  position: fixed;
  top: 0; right: 0; left: 320px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 0;
  z-index: 10;
  border-bottom: 1px solid var(--c-grid);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(5px);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 1px;
}

.top-links {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  border-right: 1px solid var(--c-grid);
  height: 100%;
}

.label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #888;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.top-links .label { margin-bottom: 0; }

.value {
  font-weight: bold;
  color: var(--c-text-main);
}

.nav-btn {
  color: var(--c-text-sub);
  text-decoration: none;
  transition: color 0.2s;
  margin-left: 8px;
}
.nav-btn:hover { color: var(--c-blue-primary); }

.date-time {
  padding: 0 24px;
  color: var(--c-text-sub);
  display: flex;
  align-items: center;
  height: 100%;
  border-right: 1px solid var(--c-grid);
}

.exit-btn {
  height: 100%;
  padding: 0 32px;
  background-color: #000;
  color: #fff;
  border: none;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  text-decoration: none;
  transition: background 0.2s;
}
.exit-btn:hover {
  background-color: var(--c-blue-primary);
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
}

.brand-group {
  margin-bottom: 48px;
}

.brand-group .label {
  margin-bottom: 12px;
  display: block;
}

.brand-name {
  font-family: var(--font-serif);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  margin: 0;
  letter-spacing: -2px;
}

.sidebar-modules {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

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
  border: 1px solid var(--c-grid);
  background: #fff;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s;
  display: flex;
  flex-direction: column;
}

.bento-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 68, 255, 0.08);
  border-color: var(--c-blue-primary);
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
.bg-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bg-pattern {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  opacity: 0.8;
}

/* 内容层 */
.card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  background: linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 100%);
  backdrop-filter: blur(2px);
}

.bento-card:hover .card-content {
  background: linear-gradient(to bottom, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.7) 100%);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: auto;
}

.card-header .icon {
  font-size: 32px;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1));
}

.card-body {
  margin-top: 24px;
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
}

.meta-tag {
  background: #000;
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
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
  letter-spacing: 1px;
}

/* ================= 超宽屏 Feed 流 ================= */
.ultra-wide-feed {
  display: none; /* 默认隐藏 */
}

/* 调整阈值为 1600px 方便测试和展示，原 2400px 可能太难触发 */
@media (min-width: 1600px) {
  .ultra-wide-feed {
    display: block;
    margin-top: 64px;
    padding-top: 64px;
    border-top: 2px solid var(--c-text-main);
  }

  .feed-header {
    margin-bottom: 40px;
  }

  .feed-title {
    font-family: var(--font-serif);
    font-size: 48px;
    font-weight: 700;
    margin: 0 0 8px 0;
    letter-spacing: -1px;
  }

  .feed-subtitle {
    font-family: var(--font-mono);
    color: var(--c-text-sub);
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 14px;
  }

  /* 小红书风格瀑布流 */
  .feed-masonry {
    columns: 4 320px; /* 至少 4 列，每列最小宽度 320px */
    column-gap: 24px;
  }

  .feed-card {
    break-inside: avoid;
    margin-bottom: 24px;
    background: #fff;
    border: 1px solid var(--c-grid);
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.3s, box-shadow 0.3s;
    cursor: pointer;
  }

  .feed-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.05);
    border-color: var(--c-blue-primary);
  }

  .feed-image {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48px;
  }

  .feed-info {
    padding: 16px;
  }

  .feed-text {
    font-family: var(--font-sans);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.5;
    margin: 0 0 16px 0;
    color: var(--c-text-main);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .feed-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--c-text-sub);
  }

  .feed-author {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .author-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
  }

  .feed-likes {
    display: flex;
    align-items: center;
    gap: 4px;
  }
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
  .top-bar {
    left: 280px;
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
  .top-bar {
    left: 240px;
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

  .top-bar {
    position: relative;
    left: 0;
    justify-content: space-between;
    border-bottom: 1px solid var(--c-grid);
  }

  .top-links {
    padding: 0 16px;
    border-right: none;
  }

  .date-time {
    display: none; /* 移动端隐藏时间 */
  }

  .exit-btn {
    padding: 0 20px;
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
  .top-links {
    font-size: 10px;
    gap: 8px;
  }
  .top-links .label {
    display: none;
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
}
</style>
