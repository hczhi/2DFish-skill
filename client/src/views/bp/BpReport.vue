<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../lib/api'
import '../../components/bp/report.css'
import Module from '../../components/bp/Module.vue'
import FactCardView, { type FactCard } from '../../components/bp/FactCardView.vue'
import ConsistencyView, { type Consistency } from '../../components/bp/ConsistencyView.vue'
import RevenueView, { type Revenue } from '../../components/bp/RevenueView.vue'
import CreditView, { type Credit } from '../../components/bp/CreditView.vue'
import IndustryView, { type Industry } from '../../components/bp/IndustryView.vue'
import CompetitorsView, { type Competitors } from '../../components/bp/CompetitorsView.vue'
import BenchmarksView from '../../components/bp/BenchmarksView.vue'
import InvestorsView, { type Investors } from '../../components/bp/InvestorsView.vue'
import DiagnosisView, { type Diagnosis } from '../../components/bp/DiagnosisView.vue'
import AdviceView, { type Advice } from '../../components/bp/AdviceView.vue'
import PlanView, { type Plan } from '../../components/bp/PlanView.vue'
import { BP_CTX, type Material } from '../../components/bp/ctx'
import TeamView, { type Team } from '../../components/bp/TeamView.vue'
import CredibilityView, { type Credibility } from '../../components/bp/CredibilityView.vue'
import FinancingView, { type Financing } from '../../components/bp/FinancingView.vue'
import { isEmbedMode } from '../../lib/embed'
import { hasAppKey } from '../../lib/appKey'
import Summary from '../../components/bp/Summary.vue'
import { chapterHealth, type ChapterHealth } from '../../components/bp/health'

// 一份 BP 体检报告（创业者版，机构研报版式，见 components/bp/report.css）。
// 三层阅读：一页纸摘要（Summary）→ 每章结论卡（health.ts，代码从数据推出、不调模型）→ 明细。
// 「精简」模式（默认）：明细收起、长列表只显示前 3 条、数据核验说明收进章节右上角的「数据说明」；「完整」模式全部展开，打印一律完整。
// running 时每 3 秒轮询一次；已经跑完的章节先显示，不等整份。
// 报告章节顺序 ≠ 后台执行顺序：01-04（评分 / 建议）最后才跑，因为它们要用 05-09 的素材。

interface Result {
  factCard?: FactCard; consistency?: Consistency; revenue?: Revenue; credit?: Credit; industry?: Industry
  competitors?: Competitors; investors?: Investors; team?: Team; credibility?: Credibility; financing?: Financing; diagnosis?: Diagnosis; advice?: Advice; plan?: Plan
}
interface Report {
  id: string; filename: string; chars: number
  status: 'running' | 'done' | 'failed' | 'interrupted'
  step: string | null; error: string | null
  result: Result
  notes: string[]
  created_at: string
  steps: { key: string; label: string }[]
  missing: string[]
  materials: Material[]
  attachments?: { name: string; kind: string; chars: number; notes: string[] }[]
}

const route = useRoute()
const router = useRouter()
const report = ref<Report | null>(null)
const loadError = ref('')
const actionError = ref('')
const acting = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const stepIndex = computed(() => report.value?.steps.findIndex((s) => s.key === report.value?.step) ?? -1)

// 章节按「结论 → 你的公司 → 外部视角 → 融资与行动」四部分排，编号按显示顺序现算（不写死在组件里）。
// key = 依赖哪个 result 键（没有时显示「还没跑到 / 没跑到」）；rerun = 重跑从哪一步起；how = 「怎么读这一章」。
type ChapterDef = { title: string; id: string; key: keyof Result; part: string; rerun?: string; how: string }
const PARTS = ['结论', '你的公司', '外部视角', '融资与行动']
const DEFS: ChapterDef[] = [
  { title: '体检结论', id: 'diagnosis', key: 'diagnosis', part: '结论', rerun: 'diagnosis', how: '总分是五维事实分的均值（100 分制），梯队 ≥85 / ≥75 / ≥60 / <60。「可回收分」= 事实分高于举证分的部分：不需要新业绩，改材料就能拿回。' },
  { title: '五维评分与扣分归因', id: 'dims', key: 'diagnosis', part: '结论', rerun: 'diagnosis', how: '每一维拆成事实分（真实水平）和举证分（BP 能证明多少）。扣分前的标签是病因：只有「叙事」「证据」类，改材料就能修。' },
  { title: '企业基本面', id: 'sec01', key: 'factCard', part: '你的公司', how: '先看可信度和一致性：投资人翻到第三页就会发现的矛盾，先在这里出现。每条事实都标了是 BP 原文、计算还是推断。' },
  { title: '宏观分析', id: 'sec02', key: 'industry', part: '外部视角', rerun: 'industry', how: '数字旁的「N 源印证」表示几个不同来源都有这个数；「单一来源」「出处里没有」的数字使用前再核一下。' },
  { title: '竞品分析', id: 'sec03', key: 'competitors', part: '外部视角', rerun: 'competitors', how: '竞品名字和融资记录都在所引资料里核过。十字图看你落在哪一格、该往哪一格挪。' },
  { title: '对标企业', id: 'sec04', key: 'competitors', part: '外部视角', rerun: 'competitors', how: '挑商业模式最像、走得比你远的公司，看它们的融资和经营走到哪一步。' },
  { title: '融资方案 · 融多少、值多少、换什么', id: 'financing', key: 'financing', part: '融资与行动', rerun: 'financing', how: '所有数字由系统按公式算；估值区间、出让比例与下一轮门槛是平台参考口径，不是查到的行业标准。' },
  { title: '目标融资对象', id: 'investors', key: 'investors', part: '融资与行动', rerun: 'investors', how: '只列查得到本赛道出资记录的机构。「待核实」的对口人走引荐路径，不要按名字冷联系。' },
  { title: 'BP 优化 · 问题清单与改写建议', id: 'bpfix', key: 'advice', part: '融资与行动', rerun: 'advice', how: '按严重程度排。「BP 原文」都在你的 BP 里核过，「建议写法」可以直接替换。' },
  { title: '追问预演 · 投资人会挑战什么', id: 'qa', key: 'advice', part: '融资与行动', rerun: 'advice', how: '这些问题读你 BP 时一定会浮上来。建议逐条准备好答案和证据再去见投资人。' },
  { title: '企业 90 天行动清单', id: 'plan', key: 'plan', part: '融资与行动', rerun: 'plan', how: '先定做什么、不做什么（取舍），再定第几周做（排期）。' },
]
const CHAPTERS = DEFS.map((d, i) => ({ ...d, no: String(i + 1).padStart(2, '0'), first: i === 0 || DEFS[i - 1].part !== d.part, partNo: PARTS.indexOf(d.part) }))
const chapterNo = Object.fromEntries(CHAPTERS.map((c) => [c.id, c.no]))
const PART_NUM = ['一', '二', '三', '四']

const health = computed<Record<string, ChapterHealth | null>>(() => {
  const r = report.value?.result
  return Object.fromEntries(CHAPTERS.map((c) => [c.id, r ? chapterHealth(c.id, r) : null]))
})
const sysOpen = ref<Record<string, boolean>>({})
const has = (c: { key: string }) => !!(report.value?.result as any)?.[c.key]

// 目录：当前章节高亮。
const active = ref('summary')
const tocOpen = ref(false)
let io: IntersectionObserver | null = null
function observe() {
  io?.disconnect()
  io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) active.value = e.target.id
  }, { rootMargin: '-30% 0px -60% 0px' })
  for (const id of ['summary', ...CHAPTERS.map((c) => c.id)]) { const el = document.getElementById(id); if (el) io.observe(el) }
}
function go(id: string) {
  tocOpen.value = false
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const LIGHT_TEXT: Record<string, string> = { good: '良好', watch: '需关注', risk: '风险', info: '参考', na: '' }

const fact = (section: string, field: string) => {
  const it = report.value?.result.factCard?.sections.find((s) => s.key === section)?.items.find((i) => i.field === field)
  return it && it.label !== 'missing' ? it.value : ''
}
const companyName = computed(() => fact('company', '公司名称'))
const brandLine = computed(() => [fact('company', '所属行业'), fact('financing', '本轮轮次'), fact('company', '所在地')].filter(Boolean).join(' · '))
const createdDate = computed(() => report.value ? new Date(report.value.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '')

// 每章用的是后台那份分析方法还是内置默认：后台那份被停用/解绑时会静默退回默认，不写出来的话看不出改的生效没。
const promptSources = computed(() => {
  const r = report.value?.result
  if (!r) return []
  const pairs: [string, { promptSource: 'skill' | 'default' } | undefined][] = [
    ['01-02 五维评分', r.diagnosis],
    ['评分标尺 · ' + (r.diagnosis?.stageLabel || ''), r.diagnosis?.stagePromptSource ? { promptSource: r.diagnosis.stagePromptSource } : undefined],
    ['03-04 BP 优化与追问', r.advice], ['5.9 企业信用档案', r.credit],
    ['5.11 一致性审计', r.consistency], ['5.12 收入质量', r.revenue], ['06 宏观分析', r.industry],
    ['5.7 可信度核验', r.credibility], ['5.10 团队评估', r.team],
    ['07-08 竞品与对标', r.competitors], ['09 融资方案', r.financing], ['10 目标融资对象', r.investors], ['11 行动清单', r.plan],
  ]
  return pairs.filter(([, v]) => v).map(([label, v]) => ({ label, source: v!.promptSource }))
})

const pending = () => report.value?.status === 'running'
  ? '这一部分还在排队，跑到时会自动出现。'
  : '这一部分没跑到：报告在前面某一步停了（成因见页面顶部）。'

async function load() {
  try {
    const res = await api(`/api/bp/reports/${route.params.id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const firstLoad = !report.value
    report.value = data
    loadError.value = ''
    if (firstLoad) nextTick(observe)
    document.title = `BP 体检报告 · ${companyName.value || data.filename}`
    if (data.status === 'running') timer = setTimeout(load, 3000)
  } catch (e: any) {
    // 轮询中途断网不能悄悄停：停了的话界面永远停在「分析中」，而后台其实早跑完了。
    loadError.value = `报告没加载出来：${e?.message || e}（10 秒后自动重试）`
    timer = setTimeout(load, 10000)
  }
}

const printIt = () => window.print()
// 演示模式：全屏要在这次点击里请求（浏览器只认用户手势），再跳到演示页；SPA 跳转不会退出全屏。
function present() {
  document.documentElement.requestFullscreen?.().catch(() => {})
  router.push(`/consult/bp/reports/${route.params.id}/deck`)
}

// 缺章（失败 / 中断 / 老报告没有新章节）时可以接着跑：已有的章节不重跑，从第一个缺的开始。
const canResume = computed(() => !!report.value && report.value.status !== 'running' && report.value.missing.length > 0)
const resumeFrom = computed(() => report.value?.steps.find((s) => s.key === report.value?.missing[0])?.label || '')

async function post(url: string, body?: unknown) {
  acting.value = true
  actionError.value = ''
  try {
    const res = await api(url, {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    if (timer) clearTimeout(timer)
    await load()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e: any) {
    actionError.value = `没跑起来：${e?.message || e}`
  } finally {
    acting.value = false
  }
}

const resume = () => post(`/api/bp/reports/${route.params.id}/resume`)

// 重跑某一章 = 这一章和它后面所有步骤一起重跑（后面每一步都拿前面的结果当输入）。确认框里把会被重跑的步骤列出来。
function rerun(from: string) {
  const steps = report.value?.steps || []
  const affected = steps.slice(steps.findIndex((s) => s.key === from)).map((s) => s.label)
  if (!confirm(`会清掉并重跑这 ${affected.length} 步（后面的章节都拿前面的结果当输入，只重跑一章会对不上）：\n\n${affected.join('\n')}\n\n每一步都是一次真实的 AI 调用。继续？`)) return
  post(`/api/bp/reports/${route.params.id}/rerun`, { from })
}

async function remove() {
  if (!confirm('删除这份报告？删了找不回来。')) return
  acting.value = true
  actionError.value = ''
  try {
    const res = await api(`/api/bp/reports/${route.params.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    router.replace('/consult/bp')
  } catch (e: any) {
    actionError.value = `没删掉：${e?.message || e}`
  } finally {
    acting.value = false
  }
}

// 补充资料面板 / 来源列表的「排除」按钮用：改完资料要重新拉一次报告（materials 跟着报告一起回来）。
provide(BP_CTX, {
  reportId: String(route.params.id),
  materials: computed(() => report.value?.materials || []),
  editable: computed(() => !!report.value && report.value.status !== 'running'),
  refresh: async () => { if (timer) clearTimeout(timer); await load() },
  rerun: (step: string) => rerun(step),
})

// 第三方（key / 嵌入）不看「本次分析方法 · 后台版本 / 内置默认」—— 那是给管理员核对后台提示词用的。
const thirdParty = isEmbedMode() || hasAppKey('consult')

const canRerun = (key: keyof Result) => !!report.value?.result[key] && report.value?.status !== 'running'

onMounted(async () => { await load(); await nextTick(); observe() })
onUnmounted(() => { if (timer) clearTimeout(timer); io?.disconnect() })
</script>

<template>
  <div class="bpr rp">
    <header class="rp-bar no-print">
      <router-link to="/consult/bp" class="rp-back">← 全部报告</router-link>
      <span class="rp-co">{{ companyName || report?.filename || 'BP 体检报告' }}</span>
      <div v-if="report" class="rp-acts">
        <button v-if="report.result.diagnosis" class="btn primary" @click="present">演示模式</button>
        <button v-if="report.status === 'done'" class="btn" @click="printIt">导出 PDF</button>
        <button v-if="report.status !== 'running'" class="btn ghost danger" :disabled="acting" @click="remove">删除</button>
      </div>
    </header>

    <div class="rp-body">
      <aside :class="['rp-side', 'no-print', { open: tocOpen }]">
        <button class="rp-side-x" @click="tocOpen = false">×</button>
        <a :class="['rp-s0', { on: active === 'summary' }]" href="#summary" @click.prevent="go('summary')">报告摘要</a>
        <template v-for="c in CHAPTERS" :key="c.id">
          <div v-if="c.first" class="rp-spart">{{ PART_NUM[c.partNo] }} · {{ c.part }}</div>
          <a :class="['rp-si', { on: active === c.id, off: !has(c) }]" :href="`#${c.id}`" @click.prevent="go(c.id)">
            <span class="rp-sn">{{ c.no }}</span>
            <span class="rp-st">{{ c.title.split(' · ')[0] }}</span>
            <i v-if="health[c.id]" :class="['ld', health[c.id]!.light]" :title="LIGHT_TEXT[health[c.id]!.light]" />
          </a>
        </template>
      </aside>
      <button class="rp-toc-btn no-print" @click="tocOpen = true">目录</button>

      <main class="rp-main">
        <div v-if="loadError" class="err">{{ loadError }}</div>
        <div v-if="actionError" class="err">{{ actionError }}</div>
        <div v-if="!report && !loadError" class="pending">加载中…</div>

        <template v-if="report">
          <header class="rp-cover">
            <div class="rp-cover-k">BP 体检报告 · DIAGNOSIS &amp; PRESCRIPTION</div>
            <h1>{{ companyName || report.filename }}</h1>
            <div v-if="brandLine" class="rp-cover-b">{{ brandLine }}</div>
            <dl class="rp-cover-m">
              <div><dt>生成日期</dt><dd>{{ createdDate }}</dd></div>
              <div><dt>读者</dt><dd>创业者 / 创始团队</dd></div>
              <div><dt>材料</dt><dd>BP<template v-if="report.attachments?.length"> + {{ report.attachments.length }} 份补充</template> · {{ report.chars }} 字</dd></div>
              <div><dt>方法</dt><dd>五维双轨评分 · 原文与公开来源逐条核验</dd></div>
            </dl>
          </header>

          <div v-if="report.status === 'running'" class="progress no-print">
            <div class="spinner" />
            <div style="flex:1">
              <div class="progress-h">正在分析 —— 可以关掉页面，跑完后在列表里打开</div>
              <ol class="steps">
                <li v-for="(s, i) in report.steps" :key="s.key" :class="{ done: report.result[s.key as keyof Result] && i !== stepIndex, now: i === stepIndex }">
                  <i>{{ report.result[s.key as keyof Result] && i !== stepIndex ? '✓' : '' }}</i>{{ s.label }}
                </li>
              </ol>
            </div>
          </div>
          <div v-else-if="report.status === 'failed' || report.status === 'interrupted'" class="err">
            {{ report.status === 'failed' ? '分析失败：' : '' }}{{ report.error }}
          </div>
          <div v-if="canResume" class="resume no-print">
            <span>{{ report.status === 'done' ? '这份报告是旧版生成的，缺' : '还缺' }} {{ report.missing.length }} 步。已经跑完的部分不会重跑。</span>
            <button class="btn primary" :disabled="acting" @click="resume">从「{{ resumeFrom }}」接着跑</button>
          </div>
          <div v-if="report.notes.length" class="warn x-sys">⚠️ <template v-for="(n, i) in report.notes" :key="i">{{ n }}<br v-if="i < report.notes.length - 1" /></template></div>

          <Summary :r="report.result" :chapters="CHAPTERS" :health="health" @go="go" />

          <template v-for="(c, ci) in CHAPTERS" :key="c.id">
            <div v-if="c.first" class="rp-part"><span>PART {{ PART_NUM[c.partNo] }}</span><b>{{ c.part }}</b></div>
            <section :id="c.id" class="chap rc">
              <header class="rc-head">
                <span class="rc-no">{{ c.no }}</span>
                <div class="rc-tt"><div class="rc-kicker">{{ PART_NUM[c.partNo] }} · {{ c.part }}</div><h2>{{ c.title }}</h2></div>
                <div class="rc-acts no-print">
                  <details class="rc-how"><summary>怎么读</summary><div>{{ c.how }}</div></details>
                  <button v-if="health[c.id]?.sys.length" class="rc-sysbtn" @click="sysOpen[c.id] = !sysOpen[c.id]">数据说明 {{ health[c.id]!.sys.length }}</button>
                  <button v-if="c.rerun && canRerun(c.key as keyof Result)" class="rerun" :disabled="acting" @click="rerun(c.rerun)">重跑</button>
                </div>
              </header>

              <div v-if="health[c.id]?.sys.length" :class="['rc-sys', { open: sysOpen[c.id] }]">
                <div class="rc-sys-h">数据说明 · 系统核验时处理掉 / 标出来的内容（不影响阅读结论，核实时看）</div>
                <ul><li v-for="x in health[c.id]!.sys" :key="x">{{ x }}</li></ul>
              </div>

              <p v-if="!has(c)" class="pending">{{ pending() }}</p>
              <DiagnosisView v-else-if="c.id === 'diagnosis'" :data="report.result.diagnosis!" part="summary" />
              <DiagnosisView v-else-if="c.id === 'dims'" :data="report.result.diagnosis!" part="dims" />
              <AdviceView v-else-if="c.id === 'bpfix'" :data="report.result.advice!" part="fixes" />
              <AdviceView v-else-if="c.id === 'qa'" :data="report.result.advice!" part="qa" />
              <template v-else-if="c.id === 'sec01'">
                <Module v-if="report.attachments?.length" :no="`${c.no}.0`" title="本次读入的材料" desc="BP 之外一起提供的补充材料，和 BP 一起进了事实卡、一致性审计与收入质量；引文出自附件时标「附件K」。" class="x-detail">
                  <div class="table-wrap">
                    <table class="t">
                      <thead><tr><th>材料</th><th>类型</th><th>字数</th><th>说明</th></tr></thead>
                      <tbody>
                        <tr><td class="cname">BP · {{ report.filename }}</td><td data-l="类型">主材料</td><td data-l="字数">—</td><td data-l="说明">页码记作 P01、P02…</td></tr>
                        <tr v-for="(a, i) in report.attachments" :key="i">
                          <td class="cname">附件{{ i + 1 }} · {{ a.name }}</td>
                          <td data-l="类型"><span :class="['lbl', a.kind === '图片识别' ? 'inferred' : 'computed']">{{ a.kind }}</span></td>
                          <td data-l="字数">{{ a.chars }}</td>
                          <td data-l="说明">{{ a.kind === '图片识别' ? '模型从图片逐字转写，不是文件里的文字层；引用它的事实请对照原图。' : '' }}{{ a.notes.join('；') }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Module>
                <Module :no="`${c.no}.1`" title="BP 可信度核验" desc="把 BP 关键声明清单化，逐条对照后文核验过的发现。先看这份 BP 能信几成，再读后文。">
                  <template #act><button v-if="canRerun('credibility')" class="rerun no-print" :disabled="acting" @click="rerun('credibility')">重跑</button></template>
                  <CredibilityView v-if="report.result.credibility" :data="report.result.credibility" />
                  <p v-else class="pending">{{ pending() }}</p>
                </Module>
                <Module :no="`${c.no}.2`" title="BP 内部一致性交叉表" tone="risk" desc="同一指标在 BP 不同页、不同口径下的取值比对。材料自己打自己，不需要额外证据就成立。">
                  <template #act><button v-if="canRerun('consistency')" class="rerun no-print" :disabled="acting" @click="rerun('consistency')">重跑</button></template>
                  <ConsistencyView v-if="report.result.consistency" :data="report.result.consistency" />
                  <p v-else class="pending">{{ pending() }}</p>
                </Module>
                <Module :no="`${c.no}.3`" title="收入质量体检" desc="不看收入多少，看是不是好收入：集中度、经常性收入、现金跑道、烧钱效率，以及这个行业投资人最看的几项。">
                  <template #act><button v-if="canRerun('revenue')" class="rerun no-print" :disabled="acting" @click="rerun('revenue')">重跑</button></template>
                  <RevenueView v-if="report.result.revenue" :data="report.result.revenue" />
                  <p v-else class="pending">{{ pending() }}</p>
                </Module>
                <Module :no="`${c.no}.4`" title="团队竞争力评估" desc="结构化评估 + 外部交叉验证；无法自动核实的标「待外部核实」并给核实路径。">
                  <template #act><button v-if="canRerun('team')" class="rerun no-print" :disabled="acting" @click="rerun('team')">重跑</button></template>
                  <TeamView v-if="report.result.team" :data="report.result.team" />
                  <p v-else class="pending">{{ pending() }}</p>
                </Module>
                <FactCardView :card="report.result.factCard!" :cn="c.no" :start="5" />
                <Module :no="`${c.no}.11`" title="企业信用档案（公开渠道核查）" desc="工商、股权、知识产权与风险信息。只用公开网页检索：查不到 ≠ 没有。">
                  <template #act><button v-if="canRerun('credit')" class="rerun no-print" :disabled="acting" @click="rerun('credit')">重跑</button></template>
                  <CreditView v-if="report.result.credit" :data="report.result.credit" />
                  <p v-else class="pending">{{ pending() }}</p>
                </Module>
              </template>
              <IndustryView v-else-if="c.id === 'sec02'" :data="report.result.industry!" />
              <CompetitorsView v-else-if="c.id === 'sec03'" :data="report.result.competitors!" />
              <BenchmarksView v-else-if="c.id === 'sec04'" :data="report.result.competitors!" />
              <FinancingView v-else-if="c.id === 'financing'" :data="report.result.financing!" :cn="c.no" />
              <InvestorsView v-else-if="c.id === 'investors'" :data="report.result.investors!" />
              <PlanView v-else-if="c.id === 'plan'" :data="report.result.plan!" :cn="c.no" />

              <footer v-if="CHAPTERS[ci + 1]" class="rc-next no-print">
                <a :href="`#${CHAPTERS[ci + 1].id}`" @click.prevent="go(CHAPTERS[ci + 1].id)">下一章 · {{ CHAPTERS[ci + 1].no }} {{ CHAPTERS[ci + 1].title.split(' · ')[0] }} →</a>
              </footer>
            </section>
          </template>

          <footer class="page-foot">
            <div v-if="promptSources.length && !thirdParty" class="ps x-sys">
              <span>本次分析方法：</span>
              <span v-for="p in promptSources" :key="p.label">{{ p.label }} · {{ p.source === 'skill' ? '后台版本' : '内置默认（后台没绑定或已停用）' }}</span>
            </div>
            本报告基于 BP 原文与公开网页检索生成，结论供决策参考，不构成投资建议；标「出处里没有」「待核实」「原文对不上」的内容使用前请自行核实。
          </footer>
        </template>
      </main>
    </div>
  </div>
</template>
