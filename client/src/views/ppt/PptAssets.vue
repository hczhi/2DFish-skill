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
            <span class="kicker-text">IMAGE LIBRARY</span>
          </div>
          <h1 class="header-title">配图素材库<span class="brand-dot"></span></h1>
          <p class="header-sub">
            每张图都是一次真实的生图调用。这里按人存着你生成过的全部配图和它们的提示词，
            以后可以直接重用，不用再花一次额度。
          </p>
        </div>

        <div class="header-actions">
          <router-link class="btn-ghost" to="/ppt/decks">← 回演示稿列表</router-link>
        </div>
      </header>

      <main class="home-main">
        <div v-if="err" class="alert">{{ err }}</div>
        <div v-if="note" class="alert note">{{ note }}</div>

        <div v-if="loading" class="empty-state">
          <div class="ios-loading-bar"><div class="ios-loading-fill"></div></div>
          <p class="loading-text">加载中...</p>
        </div>

        <div v-else-if="!assets.length" class="empty-state">
          <p>还没有素材。在某一页点「生成这一页的图」，成功的每一张都会自动进这里。</p>
        </div>

        <template v-else>
          <!-- 只回前 pageSize 张，所以「就这些」和「这一页装不下」必须分得开 -->
          <p class="count-line">
            共 {{ total }} 张<span v-if="total > assets.length">，下面显示最近 {{ assets.length }} 张</span>
          </p>

          <div class="assets-grid">
            <div v-for="a in assets" :key="a.id" class="asset-card">
              <a class="thumb" :href="a.url" target="_blank" rel="noopener">
                <img :src="a.url" :alt="a.prompt" loading="lazy" @error="broken[a.id] = true" />
                <!-- 破图和「这一格本来是空的」长得一样，所以要写出成因 -->
                <div v-if="broken[a.id]" class="thumb-broken">
                  这张打不开了（图不在了 / 只在生成它那台机器的磁盘上）
                </div>
              </a>

              <div class="card-body">
                <p class="prompt">{{ a.prompt || '（没有提示词）' }}</p>
                <div class="card-badges">
                  <span v-if="a.style_id" class="badge style">{{ a.style_id }}</span>
                  <span v-if="a.mode" class="badge mode">{{ a.mode }}</span>
                  <span v-if="a.ratio" class="badge ratio">{{ a.ratio }}</span>
                  <span v-if="a.storage === 'local'" class="badge warn">存在本机磁盘（换机器会 404）</span>
                </div>
                <div class="card-meta">
                  <span class="meta-item" v-if="a.model">{{ a.model }}</span>
                  <span class="meta-item" v-if="a.page">出自第 {{ a.page }} 页</span>
                  <span class="meta-item">{{ fmt(a.created_at) }}</span>
                </div>
              </div>

              <div class="card-footer">
                <button class="btn-icon" @click="copy(a)">复制地址</button>
                <button class="btn-icon danger" @click="remove(a)">删除</button>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface Asset {
  id: string
  url: string
  prompt: string
  mode: string
  style_id: string
  ratio: string
  model: string
  storage: string
  deck_id: string
  page: number
  created_at: string
}

const assets = ref<Asset[]>([])
const total = ref(0)
const loading = ref(false)
const err = ref('')
const note = ref('')
const broken = ref<Record<string, boolean>>({})

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '素材库需要登录')
    return
  }
  load()
})

async function load() {
  loading.value = true
  err.value = ''
  try {
    const data = await apiGet<{ assets: Asset[]; total: number }>('/api/ppt/assets')
    assets.value = data.assets || []
    total.value = data.total || 0
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 删一条素材。确认框里要写清楚**删的只是这条记录**：稿子里那几页还会照旧显示这张图。
 * 不写的话他以为这是「把这张图从稿子里去掉」，删完去翻那份 deck，图还在，
 * 而这边刚回了一句「已删除」。
 */
async function remove(a: Asset) {
  if (!confirm(`把这张图从素材库里删掉？\n\n${a.prompt || '（没有提示词）'}\n\n只是不再出现在这里 —— 已经用了它的那几页稿子不受影响，图本身也还在。以后想再用就得重新生成（一次真实花费）。`)) return
  try {
    await apiDelete(`/api/ppt/assets/${a.id}`)
    note.value = '已从素材库删掉（用了它的那几页稿子不受影响）'
    await load()
  } catch (e: any) {
    err.value = e?.message || '删除失败'
  }
}

/** 复制失败必须出声：静默的话他去粘贴，粘出来的是上一次剪贴板里的东西。 */
async function copy(a: Asset) {
  try {
    await navigator.clipboard.writeText(a.url)
    note.value = '图片地址已复制'
  } catch (e: any) {
    err.value = `复制不了（${e?.message || '浏览器不给权限'}），地址是：${a.url}`
  }
}

function fmt(ts: string) {
  if (!ts) return ''
  return ts.slice(0, 16).replace('T', ' ')
}
</script>

<style scoped>
/* 样式口径同 /ppt/decks 与 /consult（深色玻璃卡 + 品牌黄）。 */
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

.home-layout { flex: 1; position: relative; display: flex; flex-direction: column; padding: 60px 4vw 80px; }

.bg-elements {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover; background-position: center;
}
.bg-overlay {
  position: absolute; inset: 0;
  background: rgba(18, 24, 43, 0.65);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px; z-index: 1;
}

.home-header {
  position: relative; z-index: 1; margin-bottom: 40px;
  display: flex; justify-content: space-between; align-items: center; gap: 32px;
}
.header-content { flex: 1; }
.header-kicker { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.kicker-line { width: 48px; height: 2px; background: var(--brand-yellow); }
.kicker-text {
  font-family: var(--font-mono);
  font-size: 14px; font-weight: 700; letter-spacing: 0.2em; color: var(--brand-yellow);
}
.header-title {
  font-size: 56px; font-weight: 800; letter-spacing: -0.04em;
  margin: 0 0 24px; display: inline-flex; align-items: baseline;
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

.home-main { position: relative; z-index: 1; flex: 1; }

.alert {
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3);
  color: #FCA5A5; padding: 12px 16px; border-radius: 12px;
  margin-bottom: 24px; font-size: 14px; backdrop-filter: blur(10px);
}
.alert.note {
  background: rgba(255, 184, 0, 0.08); border-color: rgba(255, 184, 0, 0.3); color: #FFD980;
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

.count-line { font-family: var(--font-mono); font-size: 12px; color: var(--color-soft); margin: 0 0 16px; }

.assets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }

.asset-card {
  display: flex; flex-direction: column;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px; overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.asset-card:hover { border-color: rgba(255, 255, 255, 0.2); transform: translateY(-3px); }

.thumb {
  position: relative; display: block; aspect-ratio: 16 / 10;
  background: rgba(0, 0, 0, 0.35); overflow: hidden;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-broken {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 12px; text-align: center;
  background: rgba(18, 24, 43, 0.9); color: #FCA5A5; font-size: 12px; line-height: 1.6;
}

.card-body { padding: 14px 14px 8px; flex: 1; }
.prompt {
  font-size: 13px; line-height: 1.6; color: var(--text-secondary);
  margin: 0 0 10px; word-break: break-word;
}
.card-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
.badge.style { background: #EDE9FE; color: #5B21B6; }
.badge.mode { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.75); }
.badge.ratio { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.75); }
.badge.warn { background: #FEF3C7; color: #92400E; }
.card-meta { display: flex; flex-wrap: wrap; gap: 10px; }
.meta-item { font-family: var(--font-mono); font-size: 11px; color: var(--color-soft); }

.card-footer { display: flex; gap: 8px; padding: 8px 14px 14px; }
.btn-icon {
  background: rgba(255, 255, 255, 0.08); border: none; padding: 6px 12px;
  border-radius: 8px; font-size: 12px; font-weight: 600;
  color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
}
.btn-icon:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.btn-icon.danger:hover { background: #FEE2E2; color: #991B1B; }

@media (max-width: 900px) {
  .home-layout { padding: 50px 20px 40px; }
  .home-header { flex-direction: column; align-items: flex-start; gap: 24px; }
  .header-title { font-size: 40px; }
  .assets-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
</style>
