<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiDelete } from '../../lib/api'
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
}

const route = useRoute()
const router = useRouter()
const projects = ref<ProjectRow[]>([])
const loading = ref(false)
const creating = ref(false)
const showCreate = ref(false)
const err = ref('')

const form = ref({ brandName: '', brief: '' })
const MAX_BRIEF = 20000

onMounted(() => {
  // 封面上的「新建一个品牌项目」带 ?new=1 过来，直接把表单展开
  if (route.query.new) showCreate.value = true
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

async function create() {
  if (!form.value.brandName.trim()) { err.value = '请填写品牌 / 客户名称'; return }
  creating.value = true
  err.value = ''
  try {
    const res = await apiPost('/api/consult/projects', {
      brandName: form.value.brandName.trim(),
      brief: form.value.brief,
    })
    // 带 ?intake=1 进工作台：进去先让 AI 读一遍这段资料，列出还得问客户什么。
    // 不自动出的话这一步全靠用户自己想起右栏那个按钮，而资料缺了不会报错 ——
    // 后面十二步照样出结论，只是那些结论是 AI 按常识补的。
    router.push(`/consult/projects/${res.project.id}?intake=1`)
  } catch (e: any) {
    err.value = e?.message || '创建失败'
  } finally {
    creating.value = false
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
          <button class="btn-primary list-new" @click="showCreate = !showCreate">
            {{ showCreate ? '收起' : '+ 新建项目' }}
          </button>
        </div>

        <div v-if="showCreate" class="create-card">
          <label class="field">
            <span class="label">品牌 / 客户名称</span>
            <input v-model="form.brandName" type="text" placeholder="例：捷停车" maxlength="60" />
          </label>
          <label class="field">
            <span class="label">
              客户原始资料（纯文字，可后续补充）
              <em :class="{ over: form.brief.length > MAX_BRIEF }">
                {{ form.brief.length }} / {{ MAX_BRIEF }}
              </em>
            </span>
            <textarea
              v-model="form.brief"
              rows="10"
              placeholder="把你手上关于这个客户的东西直接贴进来：做什么的、业务线、规模数据、现有定位表述、竞品名单、目标人群、当前的痛点……缺的部分后面 AI 会问你。"
            ></textarea>
            <span class="hint">
              这段资料会进「四看」每一次分析的 prompt。超过 {{ MAX_BRIEF }} 字会被拒绝而不是自动截断
              —— 悄悄砍掉后半段的话，AI 是照着半份资料出结论的，而结论看起来完全正常。
            </span>
          </label>
          <div class="create-actions">
            <button class="btn-primary" :disabled="creating" @click="create">
              {{ creating ? '创建中…' : '创建并让 AI 看看还缺什么' }}
            </button>
            <button class="btn-ghost" @click="showCreate = false">取消</button>
            <!-- 说清楚会花一次 AI 额度：不说的话用户以为「创建」是纯本地操作 -->
            <span class="muted">进去先出一份补料问卷（消耗 1 次 AI 额度），填好的答案会补进这段资料</span>
          </div>
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
            @click="router.push(`/consult/projects/${p.id}`)"
          >
            <div class="pc-no">{{ String(i + 1).padStart(2, '0') }}</div>
            <div class="pc-main">
              <div class="pc-title">{{ p.brand_name }}</div>
              <div class="pc-meta">
                <span>进度 {{ p.decided_count }} / {{ p.total_stages }}</span>
                <span>资料 {{ p.brief_chars }} 字</span>
                <span>更新 {{ fmt(p.updated_at) }}</span>
              </div>
            </div>
            <div class="pc-right">
              <!-- 待重跑的条数必须留在列表上：进项目才看到的话，一份互相矛盾的方案已经在手上了 -->
              <span v-if="p.stale_count" class="badge-stale">⚠ {{ p.stale_count }} 条待重跑</span>
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
.consult-container { max-width: 1040px; margin: 0 auto; width: 100%; }

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

/* 玻璃卡片。4px 品牌色顶边留给「主卡」（这一页就是新建表单）—— 和工作台里那几张一致 */
.create-card {
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-top: 4px solid var(--brand);
  border-radius: 14px; padding: 24px; margin-bottom: 28px; box-shadow: var(--shadow);
}
.field { display: block; margin-bottom: 16px; }
.label { display: flex; justify-content: space-between; font-size: 12px; color: var(--color-muted); margin-bottom: 6px; }
.label em { font-style: normal; color: var(--color-soft); font-family: var(--font-mono); }
.label em.over { color: #B42318; }
.field input, .field textarea {
  width: 100%; box-sizing: border-box; padding: 10px 12px;
  border: 1px solid var(--color-border-strong); border-radius: 10px;
  font-size: 13px; font-family: var(--font-sans); color: var(--color-text);
  background: #fff; resize: vertical; line-height: 1.75;
}
.field input:focus, .field textarea:focus { outline: none; border-color: var(--brand); }
.hint { display: block; margin-top: 6px; font-size: 11px; line-height: 1.7; color: var(--color-soft); }
.create-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.empty {
  padding: 52px; text-align: center; color: var(--color-soft); font-size: 13px; line-height: 1.8;
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px dashed var(--color-border-strong); border-radius: 14px;
}

.project-list { display: flex; flex-direction: column; gap: 10px; }
.project-card {
  display: flex; align-items: center; gap: 18px;
  padding: 16px 20px; cursor: pointer;
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-radius: 14px;
  box-shadow: var(--shadow); transition: box-shadow .3s, border-color .3s;
  transform: none;
}
.project-card:hover { box-shadow: var(--shadow-lg); border-color: rgba(11, 74, 111, .3); }
/* 镂空序号：kimi3 那个 .sec-no 的做法，列表里当行号用 */
.pc-no {
  flex: 0 0 auto; font-family: var(--font-mono); font-size: 30px; font-weight: 800;
  line-height: 1; letter-spacing: -1px; color: transparent; -webkit-text-stroke: 1.2px var(--brand);
}
.pc-main { flex: 1; min-width: 0; }
.pc-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; letter-spacing: .3px; }
.pc-meta {
  display: flex; flex-wrap: wrap; gap: 14px;
  font-size: 11px; color: var(--color-soft); font-family: var(--font-mono);
}
.pc-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.badge-stale {
  font-size: 11px; padding: 4px 10px; border-radius: 999px;
  background: #FFFAEB; border: 1px solid #FEDF89; color: #B54708; font-weight: 600;
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
  .project-card { flex-wrap: wrap; }
  .pc-right { width: 100%; justify-content: flex-start; }
}
</style>
