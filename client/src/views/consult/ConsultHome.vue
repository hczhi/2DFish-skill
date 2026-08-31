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

/**
 * 有一份问卷没提交时，点这一行直接去问卷页而不是工作台。
 * 工作台在第一轮没提交时本来也会把人送回问卷页（`ConsultProject.vue:load`），
 * 这里先跳只是少闪一下；badge 才是关键 —— 不显示的话这一行和资料齐全的项目
 * 长得一模一样，而后面每一步的结论都从那段缺料的资料出。
 */
function openProject(p: ProjectRow) {
  if (p.intake_pending) router.push(`/consult/projects/${p.id}/intake`)
  else router.push(`/consult/projects/${p.id}`)
}

const route = useRoute()
const router = useRouter()
const projects = ref<ProjectRow[]>([])
const loading = ref(false)
const err = ref('')

onMounted(() => {
  // 封面上的「新建一个品牌项目」带 ?new=1 过来，现在直接跳去新建页
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

<template>
  <div class="page-wrapper">
    <SiteHeader />

    <!-- 版式和工作台（ConsultProject.vue）同一套 kimi3：从这一页点进项目不该像换了个产品。
         这一页保留 SiteHeader/SiteFooter —— 它是入口页，不是那个满屏不滚的工作台。 -->
    <header class="hero">
      <div class="hero-main">
        <div class="hero-kicker">BRAND CONSULTING WORKBENCH</div>
        <h1>品牌咨询工作台</h1>
        <div class="hero-rule"></div>
        <p class="hero-sub">
          一个品牌一个项目。四看（看自己 / 行业 / 竞品 / 用户）走快车道，
          四问与四大成一步一步聊出方向，占位定完再往下做内容营销与数字化营销
          —— 每步定稿都进企业知识库，成为后面判断的依据。
        </p>
        <div class="hero-meta">
          <span>{{ projects.length }} 个项目</span>
          <span>14 步 · 四看 / 四问 / 四大成 / 第二层 / 第三层</span>
          <span>结论 + 取舍理由 + 依据 + 置信度</span>
        </div>
      </div>
    </header>

    <div class="consult-page">
      <div class="consult-container">
        <div v-if="err" class="alert">{{ err }}</div>

        <!-- 新建按钮放在列表这一行的右端，不放刊头右上角：SiteHeader 是浮在页面上的，
             刊头右上角正好压在它的 EXIT / 语言切换那一块下面，点不着也看不清。 -->
        <div class="list-head">
          <span class="sec-kicker">PROJECTS</span>
          <span class="muted">点一行进工作台，回来的时候停在下一个没定稿的步骤</span>
          <button class="btn-primary list-new" @click="router.push('/consult/projects/new')">
            + 新建项目
          </button>
        </div>

        <div v-if="loading" class="empty">加载中…</div>
        <div v-else-if="!projects.length" class="empty">
          还没有项目。点上面那个「+ 新建项目」，贴一段客户资料开始。
        </div>

        <div v-else class="project-list">
          <div
            v-for="(p, i) in projects"
            :key="p.id"
            class="project-card"
            @click="openProject(p)"
          >
            <div class="pc-no">{{ String(i + 1).padStart(2, '0') }}</div>
            <div class="pc-main">
              <div class="pc-title">{{ p.brand_name }}</div>
              <div class="pc-badges" v-if="p.intake_pending || p.stale_count">
                <!-- 问卷没提交要留在列表上：那意味着客户资料还缺一块，而这一行的进度数照样在涨 -->
                <span v-if="p.intake_pending" class="badge-intake">📋 问卷没提交</span>
                <!-- 待重跑的条数必须留在列表上：进项目才看到的话，一份互相矛盾的方案已经在手上了 -->
                <span v-if="p.stale_count" class="badge-stale">⚠ {{ p.stale_count }} 条待重跑</span>
              </div>
              <div class="pc-meta">
                <span>进度 {{ p.decided_count }} / {{ p.total_stages }}</span>
                <span>资料 {{ p.brief_chars }} 字</span>
                <span v-if="p.intake_rounds">已补 {{ p.intake_rounds }} 轮</span>
                <span>更新 {{ fmt(p.updated_at) }}</span>
              </div>
            </div>
            <div class="pc-footer">
              <div class="progress">
                <div class="bar" :style="{ width: (p.decided_count / p.total_stages * 100) + '%' }"></div>
              </div>
              <button class="btn-del" @click.stop="remove(p)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <SiteFooter />
  </div>
</template>

<style scoped>
/**
 * kimi3 设计系统（references/kimi3-design-system.css），品牌色用 consult 自己那支深蓝 #0B4A6F。
 * 和 ConsultProject.vue 共用同一套变量名和同一条硬规矩：**悬停只改阴影和边框，绝不 translateY**
 * —— 列表里一行往上跳，正在读的那条进度数字就跑掉了。
 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;

  --brand: #0B4A6F;
  --brand-soft: #E7F0F6;
  --brand-ink: #063553;
  --navy: #0B1424;
  --navy-2: #16233C;

  --color-text: #1D1D1F;
  --color-muted: #434344;
  --color-soft: #86868B;
  --color-bg-elevated: rgba(255, 255, 255, 0.75);
  --color-border: rgba(0, 0, 0, 0.07);
  --color-border-strong: rgba(0, 0, 0, 0.16);
  --color-fill: #F5F5F7;
  --primary-color: var(--brand);
  --shadow: 0 12px 32px -12px rgba(0, 0, 0, .06), 0 2px 8px rgba(0, 0, 0, .02);
  --shadow-lg: 0 20px 48px -16px rgba(0, 0, 0, .1), 0 4px 16px rgba(0, 0, 0, .04);

  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #F5F5F7;
  background-image: linear-gradient(rgba(0,0,0,.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,.03) 1px, transparent 1px);
  background-size: 24px 24px;
  background-attachment: fixed;
  color: var(--color-text);
  font-family: var(--font-sans);
}

/* ── 刊头（和工作台顶栏同一支渐变）───────────────── */
.hero {
  position: relative; overflow: hidden;
  padding: 40px 48px 34px; color: #F2F6FC;
  background: linear-gradient(135deg, #080F1D 0%, var(--navy) 38%, var(--navy-2) 68%, #1E3A5C 105%);
}
.hero::before {
  content: ""; position: absolute; top: -200px; right: -60px; width: 460px; height: 460px;
  background: radial-gradient(circle, rgba(11, 74, 111, .55) 0%, transparent 65%); pointer-events: none;
}
.hero-main { position: relative; z-index: 1; max-width: 720px; }
/* 每个标题都要显式写 font-family：App.vue 里有一条全局 `h1..h6 { font-family: var(--font-serif) }`，
   不写的话中文标题落到 Georgia 的中文回退上 —— 字重字号都对，只是整页标题突然变了一种字 */
.hero-kicker {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 5px;
  color: rgba(242, 246, 252, .5); text-transform: uppercase;
}
.hero h1 {
  margin: 10px 0 0; font-size: 34px; font-weight: 800; letter-spacing: .5px;
  font-family: var(--font-sans); color: #fff;
}
.hero-rule { width: 56px; height: 3px; border-radius: 2px; background: #4C9CC9; margin: 16px 0; }
.hero-sub { margin: 0; font-size: 14px; line-height: 1.9; color: rgba(242, 246, 252, .82); }
.hero-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.hero-meta span {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: .5px;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(242, 246, 252, .08); border: 1px solid rgba(242, 246, 252, .14);
  color: rgba(242, 246, 252, .9);
}

.consult-page { flex: 1; padding: 32px 48px 64px; }
.consult-container { width: 100%; }

.list-head { display: flex; align-items: center; gap: 14px; margin: 4px 0 14px; flex-wrap: wrap; }
.list-new { margin-left: auto; }
.sec-kicker {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 4px;
  color: var(--brand); text-transform: uppercase; font-weight: 700;
}
.muted { font-size: 12px; color: var(--color-soft); }

.btn-primary {
  padding: 9px 18px; border: 1px solid var(--brand); border-radius: 10px;
  background: var(--brand); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  font-family: var(--font-sans);
}
.btn-primary:hover { background: var(--brand-ink); }
.btn-primary:disabled { opacity: .5; cursor: default; }
.btn-ghost {
  padding: 9px 18px; border: 1px solid var(--color-border-strong); border-radius: 10px;
  background: transparent; color: var(--color-muted); font-size: 13px; cursor: pointer;
  font-family: var(--font-sans);
}
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }

.alert {
  margin-bottom: 16px; padding: 11px 14px; border-radius: 10px;
  background: #FEF3F2; border: 1px solid #FDA29B; color: #B42318; font-size: 13px; line-height: 1.7;
}

.empty {
  padding: 52px; text-align: center; color: var(--color-soft); font-size: 13px; line-height: 1.8;
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px dashed var(--color-border-strong); border-radius: 14px;
}

.project-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}
.project-card {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start; gap: 16px;
  padding: 24px; cursor: pointer;
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-radius: 16px;
  box-shadow: var(--shadow); transition: box-shadow .3s, border-color .3s;
  overflow: hidden;
}
.project-card:hover { box-shadow: var(--shadow-lg); border-color: rgba(11, 74, 111, .3); }
/* 水印序号：破形出框，放置在右上角作为背景 */
.pc-no {
  position: absolute; right: 20px; top: -10px;
  font-family: var(--font-mono); font-size: 64px; font-weight: 800;
  line-height: 1; letter-spacing: -2px; color: transparent;
  -webkit-text-stroke: 1px rgba(11, 74, 111, 0.15);
  pointer-events: none; z-index: 0;
}
.pc-main { flex: 1; min-width: 0; width: 100%; position: relative; z-index: 1; }
.pc-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; letter-spacing: .3px; }
.pc-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.pc-meta {
  display: flex; flex-wrap: wrap; gap: 10px;
  font-size: 11px; color: var(--color-soft); font-family: var(--font-mono);
}
.pc-footer {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; margin-top: auto; padding-top: 16px;
  border-top: 1px dashed var(--color-border);
  position: relative; z-index: 1;
}
.badge-stale {
  font-size: 11px; padding: 4px 10px; border-radius: 999px;
  background: #FFFAEB; border: 1px solid #FEDF89; color: #B54708; font-weight: 600;
}
.badge-intake {
  font-size: 11px; padding: 4px 10px; border-radius: 999px;
  background: var(--brand-soft); border: 1px solid rgba(11, 74, 111, .3); color: var(--brand-ink); font-weight: 600;
}
.progress { width: 120px; height: 5px; border-radius: 999px; background: rgba(0, 0, 0, .07); overflow: hidden; }
.progress .bar { height: 100%; background: var(--brand); }
.btn-del {
  padding: 5px 11px; border: 1px solid var(--color-border-strong); border-radius: 8px;
  background: #fff; color: var(--color-soft); font-size: 12px; cursor: pointer;
  font-family: var(--font-sans);
}
.btn-del:hover { color: #B42318; border-color: #FDA29B; }

@media (max-width: 820px) {
  .hero { flex-direction: column; padding: 32px 24px 28px; }
  .hero h1 { font-size: 26px; }
  .consult-page { padding: 24px 20px 48px; }
  .project-list { grid-template-columns: 1fr; }
}
</style>
