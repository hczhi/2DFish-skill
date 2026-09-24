<template>
  <div class="page-wrapper">
    <SiteHeader />

    <div class="home-layout">
      <!-- 装饰背景 -->
      <div class="bg-elements">
      <div class="bg-overlay"></div>
      <div class="grid-bg"></div>
    </div>

      <header class="home-header">
        <div class="header-content">
          <div class="header-kicker">
            <span class="kicker-line"></span>
            <span class="kicker-text">BRAND CONSULTING WORKBENCH</span>
          </div>
          <h1 class="header-title" ref="brandNameRef" @mousemove="handleLogoMouseMove" @mouseleave="handleLogoMouseLeave">
            <span class="letter" style="animation-delay: 1.0s">品</span>
            <span class="letter" style="animation-delay: 1.05s">牌</span>
            <span class="letter" style="animation-delay: 1.1s">咨</span>
            <span class="letter" style="animation-delay: 1.15s">询</span>
            <span class="letter" style="animation-delay: 1.2s">工</span>
            <span class="letter" style="animation-delay: 1.25s">作</span>
            <span class="letter" style="animation-delay: 1.3s">台</span>
            <span class="brand-dot"></span>
          </h1>
          <div class="header-desc-wrapper">
            <div class="vertical-accent"></div>
            <p class="header-sub">
              「四看·四问·四大成」品牌占位方法论 , 写出高质量咨询方案。
            </p>
          </div>
        </div>
        
        <div class="header-actions">
          <button class="btn-create" @click="router.push('/consult/projects/new')">
            <span class="btn-text">新建咨询项目</span>
          </button>
        </div>
      </header>

      <main class="home-main">
        <div v-if="err" class="alert">{{ err }}</div>

        <div v-if="loading" class="empty-state">
          <div class="ios-loading-bar">
            <div class="ios-loading-fill"></div>
          </div>
          <p class="loading-text">加载中...</p>
        </div>
        
        <div v-else-if="!projects.length" class="empty-state">
          <p>还没有项目，点击右上角新建一个品牌项目开始。</p>
        </div>

        <div v-else class="projects-grid">
          <div
            v-for="(p, i) in projects"
            :key="p.id"
            class="project-card"
            @click="openProject(p)"
          >
            <div class="card-bg-number">{{ String(i + 1).padStart(2, '0') }}</div>
            <div class="card-content">
              <h3 class="card-title">{{ p.brand_name }}</h3>
              
              <div class="card-badges" v-if="p.intake_pending || p.stale_count">
                <span v-if="p.intake_pending" class="badge warning">问卷未提交</span>
                <span v-if="p.stale_count" class="badge danger">{{ p.stale_count }} 条待重跑</span>
              </div>
              
              <div class="card-meta">
                <span class="meta-item">进度 {{ p.decided_count }}/{{ p.total_stages }}</span>
                <span class="meta-item">资料 {{ p.brief_chars }} 字</span>
                <span class="meta-item" v-if="p.intake_rounds">已补 {{ p.intake_rounds }} 轮</span>
                <span class="meta-item">更新 {{ fmt(p.updated_at) }}</span>
              </div>
            </div>
            
            <div class="card-footer">
              <div class="progress-track">
                <div class="progress-fill" :style="{ width: (p.decided_count / p.total_stages * 100) + '%' }"></div>
              </div>
              <button class="btn-icon" @click.stop="remove(p)">删除</button>
            </div>
          </div>
        </div>
      </main>
    </div>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface ProjectRow {
  id: string
  brand_name: string
  status: string
  created_at: string
  updated_at: string
  brief_chars: number
  decided_count: number
  stale_count: number
  total_stages: number
  intake_pending: number
  intake_rounds: number
}

function openProject(p: ProjectRow) {
  if (p.intake_pending) router.push(`/consult/projects/${p.id}/intake`)
  else router.push(`/consult/projects/${p.id}`)
}

const route = useRoute()
const router = useRouter()
const projects = ref<ProjectRow[]>([])
const loading = ref(false)
const err = ref('')

const brandNameRef = ref<HTMLElement | null>(null)

function handleLogoMouseMove(e: MouseEvent) {
  if (!brandNameRef.value) return
  
  const container = brandNameRef.value
  const rect = container.getBoundingClientRect()
  const relativeX = (e.clientX - rect.left) / rect.width
  const letters = container.querySelectorAll('.letter')
  const dot = container.querySelector('.brand-dot') as HTMLElement

  letters.forEach((letterNode, index) => {
    const el = letterNode as HTMLElement
    const letterCenter = (index + 0.5) / letters.length
    const dist = Math.abs(relativeX - letterCenter)
    const radius = 0.3
    
    if (dist < radius) {
      const intensity = 1 - (dist / radius)
      const yOffset = -8 * intensity
      const baseColor = { r: 255, g: 255, b: 255 }
      const activeColor = { r: 255, g: 184, b: 0 }
      
      const r = Math.round(baseColor.r + (activeColor.r - baseColor.r) * intensity)
      const g = Math.round(baseColor.g + (activeColor.g - baseColor.g) * intensity)
      const b = Math.round(baseColor.b + (activeColor.b - baseColor.b) * intensity)
      
      el.style.transform = `translateY(${yOffset}px)`
      el.style.color = `rgb(${r}, ${g}, ${b})`
    } else {
      el.style.transform = 'translateY(0px)'
      el.style.color = 'var(--text-primary)'
    }
  })

  if (dot) {
    const distToRight = Math.abs(relativeX - 1)
    if (distToRight < 0.2) {
      const intensity = 1 - (distToRight / 0.2)
      dot.style.transform = `scale(${1 + 0.5 * intensity})`
      dot.style.backgroundColor = '#FFFFFF'
    } else {
      dot.style.transform = 'scale(1)'
      dot.style.backgroundColor = 'var(--brand-yellow)'
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
    el.style.color = 'var(--text-primary)'
  })
  
  if (dot) {
    dot.style.transform = 'scale(1)'
    dot.style.backgroundColor = 'var(--brand-yellow)'
  }
}

onMounted(() => {
  if (route.query.new) {
    router.replace('/consult/projects/new')
    return
  }
  if (!getToken()) {
    openLoginModal(window.location.pathname, '品牌咨询工作台需要登录')
    return
  }
  load()
})

async function load() {
  loading.value = true
  err.value = ''
  try {
    projects.value = await apiGet('/api/consult/projects')
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function remove(p: ProjectRow) {
  if (!confirm(`删除「${p.brand_name}」？项目下已定稿的 ${p.decided_count} 条结论会一起删掉，不能恢复。`)) return
  try {
    await apiDelete(`/api/consult/projects/${p.id}`)
    await load()
  } catch (e: any) {
    err.value = e?.message || '删除失败'
  }
}

function fmt(ts: string) {
  if (!ts) return ''
  return ts.slice(0, 16).replace('T', ' ')
}
</script>

<style scoped>
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  
  /* 调整文字颜色以适应深色背景 */
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --bg-color: #12182B; /* 从 #0A0F1E 调亮 */;
  
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-color);
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.home-layout {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 60px 4vw 80px; /* 增加 top padding 避免被固定的 刊头遮挡 */
}

.bg-elements {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  /* 添加首页同款背景图 */
  background-image: url('http://file.qiaonan.vip/uploads/2026/09/01/90892237-f079-493e-b2e4-13c15d0106e5.jpg');
  background-size: cover;
  background-position: center;
}

/* 添加一个深色遮罩，保证上方卡片和文字的对比度 */
.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 24, 43, 0.65); /* 从 0.85 降低到 0.65 */
  backdrop-filter: blur(12px); /* 稍微增加模糊度让画面更柔和 */
  -webkit-backdrop-filter: blur(12px);
}

.grid-bg {
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
  z-index: 1; /* 确保网格在背景和遮罩之上 */
}

.home-header {
  position: relative;
  z-index: 1;
  margin-bottom: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-content {
  flex: 1;
}

.header-kicker {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.kicker-line {
  width: 48px;
  height: 2px;
  background: var(--brand-yellow);
}

.kicker-text {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--brand-yellow);
}

.header-title {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  margin: 0 0 24px;
  display: inline-flex;
  align-items: baseline;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.header-title:active {
  transform: scale(0.98);
}

.header-title .letter {
  display: inline-block;
  opacity: 0;
  transform: translateY(20px);
  animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transition: transform 0.1s ease, color 0.1s ease;
}

.brand-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background-color: var(--brand-yellow);
  border-radius: 50%;
  margin-left: 4px;
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

.header-desc-wrapper {
  display: flex;
}

.vertical-accent {
  width: 3px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 2px;
}

.header-sub {
  font-size: 18px;
  line-height: 1.8;
  color: var(--text-secondary);
  max-width: 600px;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px;
}

.meta-tags {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.tag {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-secondary);
  font-weight: 600;
}

.btn-create {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--brand-yellow);
  color: #111;
  padding: 14px 32px;
  font-size: 15px;
  font-weight: 800;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  /* 基础阴影：去除 Y 轴偏移，只做均匀光晕，彻底消除视觉浮起(位移)感 */
  box-shadow: 0 0 16px rgba(255, 184, 0, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.4);
  /* 仅过渡需要的属性，避免任何影响盒模型的过渡 */
  transition: box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.4s;
  overflow: hidden;
  /* 强制硬件加速并锁定位置 */
  transform: translateZ(0);
}

/* 方案3: 极简波浪流体 (Liquid Glow) - 内部光晕流动 */
.btn-create::before {
  content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.35) 0%, transparent 60%);
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
  z-index: 1;
}

/* 方案3: 表面水流光泽 (Liquid Sweep) */
.btn-create::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 20%, rgba(255, 255, 255, 0.4) 50%, transparent 80%);
  background-size: 200% 200%;
  background-position: -100% 0;
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
  z-index: 1;
  mix-blend-mode: overlay;
}

.btn-create .btn-text {
  position: relative;
  z-index: 2;
}

.btn-create:hover {
  /* Hover 时仅加亮外发光和内发光，完全没有 Y 轴位移 */
  box-shadow: 0 0 24px rgba(255, 184, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.6);
  color: #000;
}

.btn-create:hover::before {
  opacity: 1;
  /* 启动极简的波浪形光晕呼吸 */
  animation: liquid-pulse 4s ease-in-out infinite alternate;
}

.btn-create:hover::after {
  opacity: 1;
  /* 启动表面水流扫过 */
  animation: liquid-sweep 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes liquid-pulse {
  0% { transform: scale(1) translate(0, 0); }
  33% { transform: scale(1.1) translate(5%, -2%); }
  66% { transform: scale(0.95) translate(-3%, 4%); }
  100% { transform: scale(1.05) translate(-2%, -3%); }
}

@keyframes liquid-sweep {
  0% { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

.btn-create:active {
  transform: scale(0.98);
}

.home-main {
  position: relative;
  z-index: 1;
  flex: 1;
}

.alert {
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  color: #991B1B;
  padding: 12px 16px;
  border-radius: 12px;
  margin-bottom: 24px;
  font-size: 14px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: rgba(255, 255, 255, 0.05); /* 调整空状态背景透明度以适应深色背景 */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  color: var(--text-secondary);
  font-size: 15px;
}

.ios-loading-bar {
  width: 200px;
  height: 4px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  margin-bottom: 16px;
}

.ios-loading-fill {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 50%;
  background: var(--brand-yellow);
  border-radius: 4px;
  animation: ios-progress 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  transform-origin: left center;
}

@keyframes ios-progress {
  0% { transform: translateX(-100%) scaleX(0.2); }
  50% { transform: translateX(50%) scaleX(1); }
  100% { transform: translateX(200%) scaleX(0.2); }
}

.loading-text {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--text-secondary);
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 24px;
}

.project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.05); /* 调整卡片背景透明度以适应深色背景 */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1); /* 添加微弱的白色边框提升质感 */
  border-radius: 20px;
  padding: 16px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.project-card:hover {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-4px);
}

.project-card:active {
  transform: translateY(0) scale(0.98);
}

.card-bg-number {
  position: absolute;
  top: 12px;
  right: 24px;
  font-family: var(--font-mono);
  font-size: 80px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.03); /* 调整卡片内大数字的颜色以适应深色背景 */
  line-height: 1;
  pointer-events: none;
  letter-spacing: -4px;
}

.card-content {
  position: relative;
  z-index: 1;
  flex: 1;
  margin-bottom: 32px;
}

.card-title {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0 0 16px;
}

.card-badges {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 6px;
}

.badge.warning { background: #FEF3C7; color: #92400E; }
.badge.danger { background: #FEE2E2; color: #991B1B; }

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.meta-item {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.card-footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.progress-track {
  width: 140px;
  height: 4px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--brand-yellow);
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-icon {
  background: rgba(255, 255, 255, 0.5);
  border: none;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #FEE2E2;
  color: #991B1B;
}

@media (max-width: 900px) {
  .home-layout { padding: 50px 20px 40px; }
  .home-header { flex-direction: column; align-items: flex-start; gap: 24px; }
  .header-title { font-size: 40px; }
  .header-actions { flex-direction: column; align-items: flex-start; }
  .projects-grid { grid-template-columns: 1fr; }
}
</style>
