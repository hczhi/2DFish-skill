<template>
  <div class="page-wrapper">
    <SiteHeader />

    <div class="home-layout">
      <div class="bg-elements">
        <div class="bg-overlay"></div>
        <div class="grid-bg"></div>
      </div>

      <header class="home-header">
        <div class="header-content">
          <div class="header-kicker">
            <span class="kicker-line"></span>
            <span class="kicker-text">HTML DECK WORKBENCH</span>
          </div>
          <h1 class="header-title">HTML 展示稿<span class="brand-dot"></span></h1>
          <p class="header-sub">
            一份提纲 → 逐页挑版式 → 逐页出 HTML → 逐页配图 → 拼成整份放映。
            每一步都存在这份稿子里，关了页面回来接着做。
          </p>
        </div>

        <div class="header-actions">
          <router-link class="btn-ghost" to="/ppt/layouts">版式案例库（44 个）</router-link>
          <!-- 没有入口的话生成过的图只存在于各页 html 里，他不知道自己有一堆花过钱的图可以重用 -->
          <router-link class="btn-ghost" to="/ppt/assets">配图素材库</router-link>
          <button class="btn-create" @click="router.push('/ppt/decks/new')">
            <span class="btn-text">新建演示稿</span>
          </button>
        </div>
      </header>

      <main class="home-main">
        <div v-if="err" class="alert">{{ err }}</div>

        <div v-if="loading" class="empty-state">
          <div class="ios-loading-bar"><div class="ios-loading-fill"></div></div>
          <p class="loading-text">加载中...</p>
        </div>

        <div v-else-if="!decks.length" class="empty-state">
          <p>还没有演示稿，点右上角新建一份 —— 贴一份提纲就能开始。</p>
        </div>

        <div v-else class="decks-grid">
          <div
            v-for="(d, i) in decks"
            :key="d.id"
            class="deck-card"
            @click="router.push(`/ppt/decks/${d.id}`)"
          >
            <div class="card-bg-number">{{ String(i + 1).padStart(2, '0') }}</div>
            <div class="card-content">
              <h3 class="card-title">{{ d.title }}</h3>

              <!-- 这几个数是他判断「这份稿子干到哪了」的唯一依据：只显示名字和时间的话，
                   一份规划完但一页没生成的稿子和一份做完的长得一模一样。 -->
              <div class="card-badges">
                <span v-if="!d.planned_total" class="badge idle">还没规划</span>
                <span v-else-if="d.built_count < d.planned_total" class="badge warning">
                  已生成 {{ d.built_count }} / {{ d.planned_total }} 页
                </span>
                <span v-else class="badge ok">{{ d.planned_total }} 页都生成了</span>
                <span v-if="d.imaged_count" class="badge img">{{ d.imaged_count }} 页图配齐</span>
              </div>

              <div class="card-meta">
                <span class="meta-item">提纲 {{ d.outline_chars }} 字</span>
                <span class="meta-item" v-if="d.style_id">画风 {{ d.style_id }}</span>
                <span class="meta-item" v-if="d.brand_cn">{{ d.brand_cn }}</span>
                <span class="meta-item">更新 {{ fmt(d.updated_at) }}</span>
              </div>
            </div>

            <div class="card-footer">
              <div class="progress-track">
                <div
                  class="progress-fill"
                  :style="{ width: (d.planned_total ? d.built_count / d.planned_total * 100 : 0) + '%' }"
                ></div>
              </div>
              <button class="btn-icon" @click.stop="remove(d)">删除</button>
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
import { useRouter } from 'vue-router'
import { apiGet, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface DeckRow {
  id: string
  title: string
  outline_chars: number
  planned_total: number
  built_count: number
  imaged_count: number
  brand_cn: string
  style_id: string
  created_at: string
  updated_at: string
}

const router = useRouter()
const decks = ref<DeckRow[]>([])
const loading = ref(false)
const err = ref('')

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, 'HTML 展示稿需要登录')
    return
  }
  load()
})

async function load() {
  loading.value = true
  err.value = ''
  try {
    const data = await apiGet<{ decks: DeckRow[] }>('/api/ppt/decks')
    decks.value = data.decks || []
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 删一份稿子。确认框里要写出**它值多少次调用**（每页一次 + 每张图一次）——
 * 只说「确认删除？」的话，删掉的是十几次已经花掉的额度，而删完只剩一行「已删除」。
 */
async function remove(d: DeckRow) {
  const cost = d.built_count ? `已经生成的 ${d.built_count} 页（每页都是一次真实 AI 调用）和它们的图会一起删掉，不能恢复。` : '不能恢复。'
  if (!confirm(`删除「${d.title}」？${cost}`)) return
  try {
    await apiDelete(`/api/ppt/decks/${d.id}`)
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
/* 样式口径和 /consult 那几页一致（深色玻璃卡 + 品牌黄）：两个模块各写一套的话
   同一个平台上点进去像两个产品。 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --color-soft: rgba(255, 255, 255, 0.6);
  --bg-color: #12182B;

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
  padding: 60px 4vw 80px;
}

.bg-elements {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover;
  background-position: center;
}
.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 24, 43, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
  z-index: 1;
}

.home-header {
  position: relative;
  z-index: 1;
  margin-bottom: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
}
.header-content { flex: 1; }
.header-kicker { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.kicker-line { width: 48px; height: 2px; background: var(--brand-yellow); }
.kicker-text {
  font-family: var(--font-mono);
  font-size: 14px; font-weight: 700; letter-spacing: 0.2em;
  color: var(--brand-yellow);
}
.header-title {
  font-size: 56px; font-weight: 800; letter-spacing: -0.04em;
  color: var(--text-primary); margin: 0 0 24px;
  display: inline-flex; align-items: baseline;
}
.brand-dot {
  display: inline-block; width: 8px; height: 8px;
  background-color: var(--brand-yellow); border-radius: 50%; margin-left: 6px;
}
.header-sub { font-size: 17px; line-height: 1.8; color: var(--text-secondary); max-width: 640px; margin: 0; }

.header-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.btn-ghost {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
  color: var(--text-secondary);
  padding: 12px 20px; border-radius: 999px;
  font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-ghost:hover { color: #fff; border-color: rgba(255, 255, 255, 0.32); }
.btn-create {
  background: var(--brand-yellow); color: #111;
  padding: 14px 32px; font-size: 15px; font-weight: 800;
  border: none; border-radius: 999px; cursor: pointer;
  box-shadow: 0 0 16px rgba(255, 184, 0, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.4);
  transition: box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.4s;
}
.btn-create:hover { box-shadow: 0 0 24px rgba(255, 184, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.6); }
.btn-create:active { transform: scale(0.98); }

.home-main { position: relative; z-index: 1; flex: 1; }

.alert {
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3);
  color: #FCA5A5; padding: 12px 16px; border-radius: 12px;
  margin-bottom: 24px; font-size: 14px; backdrop-filter: blur(10px);
}

.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px; color: var(--text-secondary); font-size: 15px;
}
.ios-loading-bar {
  width: 200px; height: 4px; background: rgba(255, 255, 255, 0.08);
  border-radius: 4px; overflow: hidden; position: relative; margin-bottom: 16px;
}
.ios-loading-fill {
  position: absolute; top: 0; left: 0; bottom: 0; width: 50%;
  background: var(--brand-yellow); border-radius: 4px;
  animation: ios-progress 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  transform-origin: left center;
}
@keyframes ios-progress {
  0% { transform: translateX(-100%) scaleX(0.2); }
  50% { transform: translateX(50%) scaleX(1); }
  100% { transform: translateX(200%) scaleX(0.2); }
}
.loading-text { font-family: var(--font-mono); font-size: 12px; letter-spacing: 2px; color: var(--text-secondary); }

.decks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }

.deck-card {
  position: relative; display: flex; flex-direction: column;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px; padding: 16px; overflow: hidden; cursor: pointer;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.deck-card:hover {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-4px);
}
.deck-card:active { transform: translateY(0) scale(0.98); }

.card-bg-number {
  position: absolute; top: 12px; right: 24px;
  font-family: var(--font-mono); font-size: 80px; font-weight: 800;
  color: rgba(255, 255, 255, 0.03); line-height: 1; pointer-events: none; letter-spacing: -4px;
}
.card-content { position: relative; z-index: 1; flex: 1; margin-bottom: 28px; }
.card-title { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 14px; }
.card-badges { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.badge { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; }
.badge.idle { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.75); }
.badge.warning { background: #FEF3C7; color: #92400E; }
.badge.ok { background: #DCFCE7; color: #166534; }
.badge.img { background: #EDE9FE; color: #5B21B6; }
.card-meta { display: flex; flex-wrap: wrap; gap: 12px; }
.meta-item { font-family: var(--font-mono); font-size: 11px; color: var(--color-soft); }

.card-footer { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }
.progress-track { width: 140px; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--brand-yellow); border-radius: 2px; transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.btn-icon {
  background: rgba(255, 255, 255, 0.08); border: none; padding: 6px 12px;
  border-radius: 8px; font-size: 12px; font-weight: 600;
  color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
}
.btn-icon:hover { background: #FEE2E2; color: #991B1B; }

@media (max-width: 900px) {
  .home-layout { padding: 50px 20px 40px; }
  .home-header { flex-direction: column; align-items: flex-start; gap: 24px; }
  .header-title { font-size: 40px; }
  .decks-grid { grid-template-columns: 1fr; }
}
</style>
