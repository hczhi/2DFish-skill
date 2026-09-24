<script setup lang="ts">
/**
 * 补料问卷页（/consult/projects/:id/intake）。
 *
 * 独立成页而不是留在工作台右侧抽屉里，是因为这份问卷决定整个项目的天花板：
 * 快车道四步的结论**全部**来自客户资料那一段，缺料不会报错 —— 十二步照样跑完，
 * 只是那些结论是 AI 照常识补的，读起来和真按资料推的一模一样。抽屉会被
 * `select()` 在窄屏关掉、也能被用户点 ×，关掉之后主区没有任何痕迹说明
 * 「有一份七八题的问卷没填」。
 *
 * 两条硬规矩：
 * - **自动出题只认 `?auto=1`，而且发请求之前先把它 replace 掉。** 留着的话刷新一次
 *   就再出一轮，扣一次额度、把这一轮连已填的答案一起替换掉，而两次都显示成功。
 * - **失败必须有出口。** 出题会 502（模型没按格式回）/ 429（额度用完），做成没出口的
 *   硬闸门就等于额度用完那天用户进不了自己的项目。正常状态下不给绕过入口（他选的是
 *   「新建一律先过一轮」），只有失败态给。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiPut } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface IntakeQuestion {
  id: string
  section: string
  question: string
  why: string
  placeholder: string
  /** 老轮次（080 那会儿存的）没有这两个字段，缺省当手填题渲染 —— 判成选择题会是一道没有选项的死题 */
  type?: 'choice' | 'text'
  options?: string[]
}

const route = useRoute()
const router = useRouter()
const projectId = String(route.params.id)

const brandName = ref('')
const briefChars = ref(0)
const rounds = ref(0)
const gaps = ref<string[]>([])
const questions = ref<IntakeQuestion[]>([])
const truncated = ref(false)
const roundId = ref('')
const answers = ref<Record<string, string>>({})

const loading = ref(true)
const generating = ref(false)
const applying = ref(false)
const err = ref('')
const saveErr = ref('')
const workbench = `/consult/projects/${projectId}`

/**
 * 「先绕过这一轮」的标记。工作台在第一轮没提交时会把人送回这一页（新建一律先过一轮），
 * 所以出口必须留一个记号，否则点了跳过又被弹回来，两页之间来回跳。
 * sessionStorage 而不是库：这是「这次先进去看看」，不是「这个项目不用填了」——
 * 落库的话那份问卷从此没人再提。key 和 ConsultProject.vue 里那份必须一致。
 */
const INTAKE_SKIP_KEY = `consult-intake-skip:${projectId}`
function skipToWorkbench() {
  sessionStorage.setItem(INTAKE_SKIP_KEY, '1')
  router.push(workbench)
}

const filled = computed(() => questions.value.filter(q => (answers.value[q.id] || '').trim()).length)
/** 全部必填（作者拍板）：一题没填就不让提交。 */
const unfilled = computed(() => questions.value.length - filled.value)

/**
 * 选择题的两个兜底项由**前端固定补**，不让模型给（prompt 里明说了不要给）。
 * 靠模型给的话它会漏，而漏掉之后现象是：客户面对三个都不对的选项，只能挑一个最像的 ——
 * 那一行进资料之后和他亲口说的一模一样。
 *
 * 「说不准」原样写进客户资料，这是刻意的：AI 读到「答：说不准」会知道这项没有数据，
 * 而留空的那题会被它照行业常识补一个，读起来完全正常。
 */
const UNSURE = '说不准 / 客户也不确定'
/** 这题当前处在「其他，自己填」状态。从服务端恢复答案时要按值反推（见 syncOther）。 */
const otherOn = ref<Record<string, boolean>>({})
const optsOf = (q: IntakeQuestion) => (q.type === 'choice' ? q.options || [] : [])
const isChoice = (q: IntakeQuestion) => optsOf(q).length >= 2

function isPicked(q: IntakeQuestion, opt: string) {
  return !otherOn.value[q.id] && (answers.value[q.id] || '') === opt
}
function pick(q: IntakeQuestion, opt: string) {
  otherOn.value[q.id] = false
  answers.value[q.id] = opt
  saveAnswerDraft()
}
function pickOther(q: IntakeQuestion) {
  otherOn.value[q.id] = true
  // 当前值是某个选项时要清掉：留着的话输入框里预填着一段他没打的字，
  // 直接提交等于把「点错的那个选项」当成客户的原话补进资料。
  const cur = answers.value[q.id] || ''
  if (cur === UNSURE || optsOf(q).includes(cur)) answers.value[q.id] = ''
}
/** 按已存的答案反推每题是不是「其他」：刷新回来时不推的话，手填的那段答案会显示成一个都没选中。 */
function syncOther() {
  const map: Record<string, boolean> = {}
  questions.value.forEach(q => {
    const a = (answers.value[q.id] || '').trim()
    if (isChoice(q) && a && a !== UNSURE && !optsOf(q).includes(a)) map[q.id] = true
  })
  otherOn.value = map
}

onMounted(async () => {
  if (!getToken()) {
    // loading 必须落下来：留着「加载中…」的话，用户把登录框关掉之后
    // 看到的是一个永远在转的页面，而真实原因是他没登录。
    loading.value = false
    openLoginModal(window.location.pathname, '品牌咨询工作台需要登录')
    return
  }
  // 先把 ?auto=1 拿到手再 replace 掉：读完之后 route.query 就没有它了
  const auto = !!route.query.auto
  if (auto) await router.replace({ path: route.path })
  await load()
  if (auto && !questions.value.length) await generate()
})

async function load() {
  loading.value = true
  err.value = ''
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}`)
    brandName.value = res.project.brand_name
    briefChars.value = (res.project.brief || '').length
    rounds.value = res.intakeRounds || 0
    if (res.intake) {
      gaps.value = res.intake.gaps || []
      questions.value = res.intake.questions || []
      truncated.value = !!res.intake.truncated
      roundId.value = res.intake.id
      answers.value = { ...(res.intake.answers || {}) }
      syncOther()
    }
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function generate() {
  if (questions.value.length && filled.value) {
    if (!confirm(`重出一份问卷会丢掉这一轮已经填的 ${filled.value} 条答案（还没补进客户资料）。继续？`)) return
  }
  generating.value = true
  err.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/intake`, {})
    gaps.value = res.gaps || []
    questions.value = res.questions || []
    truncated.value = !!res.truncated
    roundId.value = res.round?.id || ''
    rounds.value = res.rounds ?? rounds.value
    answers.value = {}
    otherOn.value = {}
  } catch (e: any) {
    err.value = e?.message || '生成问卷失败'
  } finally {
    generating.value = false
  }
}

/**
 * 逐题暂存（失焦时调）。一份七八题的问卷是拿去逐条问客户的，不存的话切个页面就全空了。
 * 存不上必须出声：静默 200 的话用户一路以为存住了，关掉页面回来一个字都没有。
 */
async function saveAnswerDraft() {
  if (!roundId.value) return
  try {
    await apiPut(`/api/consult/projects/${projectId}/intake/answers`, {
      roundId: roundId.value,
      answers: answers.value,
    })
    saveErr.value = ''
  } catch (e: any) {
    saveErr.value = `答案暂存失败（${e?.message || '未知原因'}）—— 别关页面，先把这一轮提交掉。`
  }
}

async function submit() {
  if (unfilled.value > 0) return
  applying.value = true
  err.value = ''
  try {
    const payload = questions.value.map(q => ({
      id: q.id,
      question: q.question,
      answer: (answers.value[q.id] || '').trim(),
      section: q.section,
    }))
    await apiPost(`/api/consult/projects/${projectId}/intake/apply`, {
      answers: payload,
      roundId: roundId.value,
    })
    // replace 而不是 push：返回键回到这一页时那一轮已经提交掉了，
    // 页面只会显示「已补过 N 轮」，读起来像答案没存上。
    await router.replace(workbench)
  } catch (e: any) {
    err.value = e?.message || '补进资料失败'
  } finally {
    applying.value = false
  }
}

const sections = computed(() => {
  const out: { name: string; items: Array<IntakeQuestion & { no: number }> }[] = []
  questions.value.forEach((q, i) => {
    const name = q.section || '其他'
    const last = out.find(s => s.name === name)
    const item = { ...q, no: i + 1 }
    if (last) last.items.push(item)
    else out.push({ name, items: [item] })
  })
  return out
})
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />

    <div class="intake-layout">
      <!-- 装饰背景（和工作台/新建页同一张图 + 同一层遮罩 + 同一张网格） -->
      <div class="bg-elements">
        <div class="bg-overlay"></div>
        <div class="grid-bg"></div>
      </div>

      <header class="hero">
        <div class="hero-main">
          <div class="hero-content">
            <div class="hero-kicker">
              <span class="kicker-line"></span>
              <span class="kicker-text">INTAKE · 补料问卷</span>
            </div>
            <h1>{{ brandName || '…' }}</h1>
            <p class="hero-sub">
              四看（看自己 / 行业 / 竞品 / 用户）的结论<strong>全部</strong>出自客户资料那一段。
              资料缺了不会报错 —— 十二步照样跑完，只是那些结论是 AI 照常识补的。
              所以先把这几题问清楚，再进工作台。
            </p>
            <div class="hero-meta">
              <span>资料 {{ briefChars }} 字</span>
              <span v-if="rounds">已补过 {{ rounds }} 轮</span>
              <span v-if="questions.length">{{ filled }} / {{ questions.length }} 题已填</span>
            </div>
          </div>
          <button class="btn-back-icon" @click="router.push('/consult/projects')" title="返回工作台">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
        </div>
      </header>

      <main class="consult-page">
        <div class="consult-container">
        <div v-if="saveErr" class="alert">{{ saveErr }}</div>

        <!-- 出题失败：这里是唯一给绕过入口的地方（额度用完 / 模型没按格式回） -->
        <div v-if="err" class="alert">
          {{ err }}
          <div class="alert-actions">
            <button class="btn-primary" :disabled="generating" @click="generate">
              {{ generating ? '生成中…' : '再出一次（会再花 1 次 AI 额度）' }}
            </button>
            <button class="btn-ghost" @click="skipToWorkbench">
              跳过，直接进工作台
            </button>
          </div>
          <div class="alert-why">
            跳过之后四看照样出得来，但那些结论会是 AI 按行业常识补的 ——
            正文里带的表格和置信度标记和真按资料推的长得一模一样，所以自己要记住这一步没填。
          </div>
        </div>

        <div v-if="loading" class="empty">加载中…</div>

        <!-- 出题中：去卡片化，大字号排版 -->
        <div v-else-if="generating" class="waiting-editorial">
          <div class="we-anim">
            <span class="we-dot"></span><span class="we-dot"></span><span class="we-dot"></span>
          </div>
          <div class="we-kicker">ANALYZING THE BRIEF</div>
          <h2 class="we-title">AI 正在阅读资料<br/>生成问卷</h2>
          <div class="we-meta">
           
            <p class="we-warn">请勿刷新页面</p>
          </div>
        </div>

        <!-- 问卷 -->
        <template v-else-if="questions.length">
          <div v-if="truncated" class="alert warn">
            这份问卷是被截断的（模型输出到上限了），后面可能还漏了几题。填完这一轮再出一份，
            AI 会接着问下一层。
          </div>

          <div v-if="gaps.length" class="gaps">
            <div class="gaps-title">AI 读完这份资料，认为最要紧的缺口：</div>
            <ul><li v-for="(g, i) in gaps" :key="i">{{ g }}</li></ul>
          </div>

          <div class="tip">
            有选项的题直接点；数字、金额、名单这类没有选项，写客户说的原话
            （那种题的选项只能是 AI 编的）。<strong>填不完可以直接离开</strong> ——
            点一下 / 失焦就存一次，回来接着填。
          </div>

          <div v-for="sec in sections" :key="sec.name" class="section">
            <div class="sec-head">
              <span class="sec-kicker">{{ sec.name }}</span>
              <span class="muted">这几题答不清，这一步的结论就是编的</span>
            </div>
            <div v-for="q in sec.items" :key="q.id" class="qa">
              <div class="qa-q">
                <span class="qa-no">{{ String(q.no).padStart(2, '0') }}</span>
                <div class="qa-body">
                  <div class="qa-text">
                    {{ q.question }}
                    <em v-if="!(answers[q.id] || '').trim()" class="req">必填</em>
                  </div>
                  <div class="qa-why">{{ q.why }}</div>
                </div>
              </div>
              <!-- 选择题：模型给的是「类型划分」类选项（经营模式、客户是企业还是个人…）。
                   数字/金额/名单类的题服务端一律标成 text —— 给那种题配选项的话，
                   客户挑的是模型编出来的一个区间，而它进资料之后和他亲口说的一模一样。 -->
              <div v-if="isChoice(q)" class="opts">
                <button
                  v-for="opt in optsOf(q)" :key="opt" type="button"
                  class="opt" :class="{ on: isPicked(q, opt) }"
                  @click="pick(q, opt)"
                >{{ opt }}</button>
                <button
                  type="button" class="opt soft" :class="{ on: isPicked(q, UNSURE) }"
                  @click="pick(q, UNSURE)"
                >说不准</button>
                <button
                  type="button" class="opt soft" :class="{ on: otherOn[q.id] }"
                  @click="pickOther(q)"
                >其他（自己填）</button>
                <textarea
                  v-if="otherOn[q.id]"
                  v-model="answers[q.id]"
                  rows="2"
                  :placeholder="q.placeholder || '客户答什么就写什么'"
                  @change="saveAnswerDraft"
                ></textarea>
                <div v-if="isPicked(q, UNSURE)" class="opt-note">
                  「说不准」会原样写进资料 —— AI 会知道这项没有数据，而空着的那题它会照常识补一个。
                </div>
              </div>
              <textarea
                v-else
                v-model="answers[q.id]"
                rows="3"
                :placeholder="q.placeholder || '客户答什么就写什么'"
                @change="saveAnswerDraft"
              ></textarea>
            </div>
          </div>

          <div class="submit-bar">
            <button class="btn-primary" :disabled="applying || unfilled > 0" @click="submit">
              {{ applying ? '补充中…' : '提交并进入工作台' }}
            </button>
            <span v-if="unfilled > 0" class="muted">
              还有 {{ unfilled }} 题没填 —— 全部填完才能提交
            </span>
            <span v-else class="muted">
              这 {{ questions.length }} 条答案会追加进客户资料，后面每一步分析都读得到
            </span>
            <button class="btn-ghost leave" @click="router.push('/consult/projects')">
              先离开（已填的都存着）
            </button>
          </div>
        </template>

        <!-- 没有待填的问卷：刷新过（auto 已经被 replace 掉）或者上一轮已经提交了 -->
        <div v-else class="empty">
          <p v-if="rounds">这个项目已经补过 {{ rounds }} 轮，当前没有待填的问卷。</p>
          <p v-else>当前没有待填的问卷。</p>
          <div class="alert-actions">
            <button class="btn-primary" :disabled="generating" @click="generate">
              {{ rounds ? '出下一轮问卷' : '出一份问卷' }}（花 1 次 AI 额度）
            </button>
            <button class="btn-ghost" @click="skipToWorkbench">进工作台</button>
          </div>
        </div>
        </div>
      </main>
    </div>

    <SiteFooter />
  </div>
</template>

<style scoped>
/* 和 ConsultProject.vue（详情页）/ ConsultCreate.vue（新建页）同一套：深色底 + 背景图 +
   遮罩 + 32px 网格 + 玻璃卡片 + 品牌黄。这一页原来是浅色 kimi3 那一版 —— 同一个流程里
   两页两种视觉，用户会以为自己点错了地方。
   这一页独有的一条规矩没变：**悬停/选中只改颜色、阴影、边框，绝不 translateY** ——
   正在填的那一题跳一下，光标位置就跑了。所以 .opt / .qa 不跟着 .btn-primary 抬。
   变量在这里重抄一份是因为平台压根没有共享样式表（assets/qiaonx-design.css 是空的）。 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;

  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;

  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --color-soft: rgba(255, 255, 255, 0.6);
  --color-border: rgba(255, 255, 255, 0.1);
  --color-border-strong: rgba(255, 255, 255, 0.22);
  --color-fill: rgba(255, 255, 255, 0.05);
  --bg-color: #12182B;

  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-color);
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.intake-layout {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  padding-top: 30px; /* 避免被固定的 刊头遮挡 */
}

.bg-elements {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: url('http://file.qiaonan.vip/uploads/2026/09/01/90892237-f079-493e-b2e4-13c15d0106e5.jpg');
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

.hero { position: relative; z-index: 1; padding: 40px 4vw 40px; }
.hero-main {
  max-width: 1000px; margin: 0 auto;
  display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
}
.hero-content { flex: 1; min-width: 0; }
.hero-kicker { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.kicker-line { width: 48px; height: 2px; background: var(--brand-yellow); }
.kicker-text {
  font-family: var(--font-mono); font-size: 14px; font-weight: 700;
  letter-spacing: 0.2em; color: var(--brand-yellow);
}
/* 每个标题都要显式写 font-family：App.vue 有一条全局 h1..h6 用衬线体，
   不写的话中文标题落到 Georgia 的中文回退上 —— 整页突然换了一种字 */
.hero h1 {
  margin: 0; font-size: 36px; font-weight: 800; letter-spacing: -0.04em;
  line-height: 1.1; color: var(--text-primary); font-family: var(--font-sans);
}
.hero-sub {
  margin: 20px 0 0; max-width: 720px;
  font-size: 14px; line-height: 1.9; color: var(--text-secondary);
}
.hero-sub strong { color: var(--brand-yellow); font-weight: 700; }
.hero-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.hero-meta span {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: .5px;
  padding: 5px 12px; border-radius: 999px;
  background: var(--color-fill); border: 1px solid var(--color-border);
  color: var(--text-secondary);
}

.btn-back-icon {
  flex: none;
  width: 48px; height: 48px; border-radius: 12px;
  border: 1px solid var(--color-border); background: var(--color-fill);
  color: var(--text-primary);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.btn-back-icon:hover { background: var(--brand-yellow); color: #000; transform: translateY(-2px); }
.btn-back-icon:active { transform: translateY(0) scale(0.98); }

.consult-page { position: relative; z-index: 1; flex: 1; padding: 0 4vw 80px; }
.consult-container { width: 100%; max-width: 1000px; margin: 0 auto; }

.alert {
  margin-bottom: 24px; padding: 14px 16px; border-radius: 12px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3);
  color: #FCA5A5; font-size: 13px; line-height: 1.8;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.alert.warn {
  background: rgba(255, 184, 0, 0.08); border-color: rgba(255, 184, 0, 0.3); color: #FCD34D;
}
.alert-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
.alert-why { margin-top: 10px; font-size: 12px; line-height: 1.8; color: rgba(252, 165, 165, .75); }

.empty {
  padding: 44px; text-align: center; color: var(--color-soft); font-size: 13px; line-height: 1.9;
  background: var(--color-fill);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px dashed var(--color-border-strong); border-radius: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.empty p { margin: 0 0 8px; color: var(--text-secondary); }
.empty .alert-actions { justify-content: center; }

/* 去卡片化的排版 Loading */
.waiting-editorial {
  padding: 80px 20px 120px;
  display: flex; flex-direction: column; align-items: center; text-align: center;
}
.we-anim { display: flex; gap: 6px; margin-bottom: 24px; }
.we-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand-yellow); opacity: 0.2;
  animation: pulse-dot 1.4s infinite ease-in-out both;
}
.we-dot:nth-child(1) { animation-delay: -0.32s; }
.we-dot:nth-child(2) { animation-delay: -0.16s; }
@keyframes pulse-dot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.2; }
  40% { transform: scale(1.2); opacity: 0.9; }
}
.we-kicker {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 6px;
  color: var(--brand-yellow); text-transform: uppercase; font-weight: 700;
  margin-bottom: 20px; margin-right: -6px; /* 补偿 letter-spacing 导致的视觉偏移 */
}
.we-title {
  font-size: 32px; font-weight: 800; line-height: 1.4; letter-spacing: -0.02em;
  color: var(--text-primary); margin: 0 0 32px 0; font-family: var(--font-sans);
}
.we-meta { position: relative; }
.we-meta::before {
  content: ""; position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
  width: 24px; height: 2px; background: var(--color-border-strong);
}
.we-meta p { margin: 0 0 6px; font-size: 13px; line-height: 1.8; color: var(--color-soft); }
.we-meta .we-warn { color: #FCD34D; font-weight: 600; }

.gaps {
  background: var(--color-fill);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--color-border); border-radius: 24px;
  padding: 28px; margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.gaps-title {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 4px;
  color: var(--brand-yellow); text-transform: uppercase; font-weight: 700;
  margin-bottom: 20px;
}
.gaps ul { margin: 0; padding: 0; list-style: none; }
.gaps li {
  position: relative; padding-left: 28px; font-size: 14px; line-height: 1.9;
  color: var(--text-secondary); margin-bottom: 12px; font-weight: 500;
}
.gaps li:last-child { margin-bottom: 0; }
.gaps li::before { content: "—"; position: absolute; left: 0; color: var(--brand-yellow); }

.tip {
  font-size: 13px; line-height: 1.8; color: var(--text-secondary);
  padding: 0 0 0 16px; margin: 0 0 40px;
  border-left: 2px solid var(--brand-yellow);
}
.tip strong { color: var(--text-primary); }

.section {
  background: var(--color-fill);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--color-border); border-radius: 24px;
  padding: 28px 28px 8px; margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.sec-head {
  position: relative; display: flex; align-items: center; gap: 16px;
  margin-bottom: 32px; flex-wrap: wrap; padding-left: 20px;
}
.sec-head::before {
  content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 4px; height: 22px; background: var(--brand-yellow); border-radius: 2px;
}
.sec-kicker { font-size: 18px; letter-spacing: .02em; color: var(--text-primary); font-weight: 800; }
.sec-head .muted {
  font-size: 13px; color: var(--color-soft);
  padding-left: 16px; border-left: 1px solid var(--color-border);
}
.muted { font-size: 12px; color: var(--color-soft); }

.qa {
  position: relative; padding: 0 0 32px; margin-bottom: 32px;
  border-bottom: 1px solid var(--color-border); z-index: 1;
}
.qa:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 20px; }
.qa-q { position: relative; display: block; margin-bottom: 20px; }
.qa-no {
  position: absolute; top: -34px; right: 0;
  font-family: var(--font-mono); font-size: 88px; font-weight: 800;
  line-height: 1; letter-spacing: -4px; color: transparent;
  -webkit-text-stroke: 1.5px rgba(255, 255, 255, 0.07);
  z-index: -1; pointer-events: none; user-select: none;
}
.qa-body { padding-top: 4px; }
.qa-text { font-size: 16px; font-weight: 700; line-height: 1.7; color: var(--text-primary); margin-bottom: 8px; }
.qa-text .req {
  font-style: normal; font-family: var(--font-mono); font-size: 10px;
  margin-left: 8px; padding: 2px 7px; border-radius: 999px;
  background: rgba(252, 165, 165, 0.12); border: 1px solid rgba(252, 165, 165, 0.35);
  color: #FCA5A5; font-weight: 700; vertical-align: middle;
}
.qa-why { font-size: 13px; line-height: 1.8; color: var(--color-soft); }
.qa textarea, .opts textarea {
  position: relative; z-index: 1;
  width: 100%; box-sizing: border-box; padding: 14px 16px;
  border: 1px solid var(--color-border); border-radius: 12px;
  font-size: 14px; font-family: var(--font-sans); color: var(--text-primary);
  background: rgba(0, 0, 0, 0.2); resize: vertical; line-height: 1.8;
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.qa textarea::placeholder, .opts textarea::placeholder { color: rgba(255, 255, 255, 0.3); }
.qa textarea:focus, .opts textarea:focus {
  outline: none; border-color: var(--brand-yellow);
  box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.1);
  background: rgba(0, 0, 0, 0.4);
}

/* 选择题。选中态靠底色+边框，不靠 translate —— 同这一页其它交互的规矩。 */
.opts { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 10px; }
.opt {
  padding: 11px 18px; border: 1px solid var(--color-border-strong); border-radius: 999px;
  background: rgba(255, 255, 255, 0.06); color: var(--text-secondary);
  font-size: 14px; font-family: var(--font-sans); font-weight: 500; cursor: pointer;
  transition: border-color .2s, background .2s, color .2s;
}
.opt:hover { border-color: var(--brand-yellow); color: var(--brand-yellow); }
.opt.on {
  background: var(--brand-yellow); border-color: var(--brand-yellow);
  color: #111; font-weight: 700;
}
.opt.soft { color: var(--color-soft); border-style: dashed; }
.opt.soft.on {
  background: rgba(255, 255, 255, 0.9); border-color: rgba(255, 255, 255, 0.9);
  border-style: solid; color: #12182B; font-weight: 700;
}
.opts textarea { flex-basis: 100%; }
.opt-note { flex-basis: 100%; font-size: 12px; line-height: 1.8; color: var(--color-soft); }

.submit-bar {
  position: sticky; bottom: 32px; z-index: 10;
  display: flex; align-items: center; gap: 20px; justify-content: center;
  width: max-content; max-width: 100%; margin: 32px auto 0;
  padding: 12px 12px 12px 28px;
  background: rgba(18, 24, 43, 0.8);
  backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%);
  border: 1px solid var(--color-border); border-radius: 999px;
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.45);
}
.submit-bar .muted { font-size: 13px; margin: 0 8px; font-weight: 500; color: var(--text-secondary); }
.submit-bar .leave { margin: 0; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 12px;
  background: var(--brand-yellow); color: #111;
  padding: 12px 24px; font-size: 14px; font-weight: 700;
  border: none; border-radius: 999px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--font-sans);
}
.btn-primary:hover {
  background: var(--brand-yellow-hover);
  transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255, 184, 0, 0.3);
}
.btn-primary:active { transform: translateY(0) scale(0.98); }
.btn-primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

.btn-ghost {
  padding: 12px 20px; border: 1px solid var(--color-border-strong); border-radius: 999px;
  background: transparent; color: var(--text-secondary); font-size: 14px; cursor: pointer;
  font-family: var(--font-sans); transition: border-color .2s, color .2s, background .2s;
}
.btn-ghost:hover {
  border-color: var(--brand-yellow); color: var(--brand-yellow);
  background: rgba(255, 184, 0, 0.08);
}

@media (max-width: 820px) {
  .hero { padding: 32px 20px 28px; }
  .hero-main { flex-direction: column; align-items: flex-start; gap: 20px; }
  .hero h1 { font-size: 28px; }
  .consult-page { padding: 0 20px 48px; }
  .section, .gaps { padding: 20px 20px 4px; border-radius: 20px; }
  .gaps { padding-bottom: 20px; }
  .qa-no { display: none; }
  .submit-bar {
    flex-direction: column; align-items: stretch; gap: 12px;
    width: auto; border-radius: 20px; padding: 16px;
  }
  .submit-bar .leave { margin-left: 0; }
}
</style>
