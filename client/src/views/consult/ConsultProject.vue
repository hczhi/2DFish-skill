<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import { renderMarkdown } from '../../lib/markdown'

interface StageItem {
  key: string
  label: string
  group: string
  lane: 'fast' | 'slow' | 'plan'
  question: string
  /** 这一步该怎么想（方法论操法）。和进 prompt 的是同一份 —— 出来的正文没照它推，对着这里才看得出来 */
  method: string[]
  /** 本步应产出的东西。服务端给（stages.ts），前端不写第二份 —— 对不上的清单比没有清单更糟 */
  deliverables: string[]
  status: 'pending' | 'exploring' | 'decided'
  round: number
  unlocked: boolean
  missing: string[]
  hasEntry: boolean
  stale: boolean
}
interface Entry {
  stage_key: string
  conclusion: string
  /** 正文 markdown（本步那几张表都在这儿）。老定稿是空串 */
  body: string
  rationale: string
  evidence: string
  confidence: string
  /** 本步的 AI 赋能机会，**JSON 数组字符串**（服务端那一列原样回来）。老定稿是 '[]' */
  ai_opportunities: string
  source_level: string
  stale: number
  version: number
  updated_at: string
}

const route = useRoute()
const router = useRouter()
const projectId = String(route.params.id)

const project = ref<any>(null)
const stages = ref<StageItem[]>([])
const entries = ref<Entry[]>([])
const loading = ref(false)
const err = ref('')

interface Draft {
  conclusion: string
  body: string
  rationale: string
  evidence: string
  confidence: 'high' | 'mid' | 'low'
  /** 本步的 AI 赋能机会，1-2 条。不在正文里 —— 报告最后那一章按这一栏取数 */
  aiOpportunities: string[]
  gaps: string[]
}

interface Direction {
  title: string
  tagline: string
  identity: string
  reasons: string[]
  strengths: Array<{ item: string; support: string }>
  solutions: Array<{ action: string; deliverable: string; owner: string; goal90: string }>
  risks: Array<{ risk: string; hedge: string }>
  /** 写作建议已经拼进 markdown 了，这里留着是为了选中时不丢（定稿正文就是那段 markdown） */
  writingTip: string
  aiOpportunities: string[]
  /** 三件套的 markdown，服务端在代码里拼的 —— 选中之后它整段进定稿正文 */
  markdown: string
}

interface Msg {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'directions' | 'draft'
  content: string
  payload: string
  created_at: string
}

const selectedKey = ref<string>('')
const messages = ref<Msg[]>([])
const loadingMessages = ref(false)
const chatText = ref('')
const chatting = ref(false)
const chatDropped = ref(0)
const chatTruncated = ref(false)
const MAX_CHAT = 3000
const directions = ref<Direction[] | null>(null)
const directionsStageKey = ref('')
const directionsVerdict = ref('')
const loadingDirections = ref(false)
const draft = ref<Draft | null>(null)
const draftStageKey = ref('')
const drafting = ref(false)
const draftTruncated = ref(false)
const draftPreview = ref(true)
const savingEntry = ref(false)
const staledNote = ref<string[]>([])
const briefDraft = ref('')
const savingBrief = ref(false)
const briefSaved = ref(false)
/** 客户资料默认收起（知识库那一栏里）。展开一次就一直展开 —— 补料的时候要连着改好几轮 */
const briefOpen = ref(false)
const MAX_BRIEF = 20000

interface IntakeQuestion {
  id: string
  section: string
  question: string
  why: string
  placeholder: string
}
const intake = ref<{ gaps: string[]; questions: IntakeQuestion[]; truncated: boolean } | null>(null)
const intakeAnswers = ref<Record<string, string>>({})
/** 这一轮问卷在库里的 id。暂存答案和「补进资料」都要带上它（服务端靠它挡住重复提交） */
const intakeRoundId = ref('')
/** 已经补过几轮。0 之外都要显示 —— 用户是照这个判断「我上次是不是已经问过客户了」 */
const intakeRounds = ref(0)
/** 只是收起来，不是丢掉（问卷落库了）。丢掉要走「重出一份」并确认 */
const intakeHidden = ref(false)
const loadingIntake = ref(false)
const applyingIntake = ref(false)
const intakeNote = ref('')
const intakeErr = ref('')
const intakeFilled = computed(
  () => Object.values(intakeAnswers.value).filter(v => v.trim()).length
)

interface Source {
  id: string
  stage_key: string
  title: string
  url: string
  domain: string
  published: string
  snippet: string
  query: string
}
interface Hit {
  title: string
  url: string
  content: string
  published: string
}
const sources = ref<Source[]>([])
/** 服务端算的（有没有配 Tavily key）。前端不猜 —— 猜错的那一边是「搜出来是空的」 */
const searchEnabled = ref(true)
const searchQuery = ref('')
const searching = ref(false)
const hits = ref<Hit[] | null>(null)
const picked = ref<Record<string, boolean>>({})
const adopting = ref(false)
const adoptNote = ref('')
const searchErr = ref('')
const pickedCount = computed(() => Object.values(picked.value).filter(Boolean).length)

const selected = computed(() => stages.value.find(s => s.key === selectedKey.value) || null)
const entryOf = (key: string) => entries.value.find(e => e.stage_key === key) || null
const decidedCount = computed(() => stages.value.filter(s => s.hasEntry).length)

// 分组顺序按接口返回的阶段顺序推，不写死一份清单：写死的话服务端新增一个分组
// （第二层 / 第三层）之后那几步在左栏里**完全不存在**，而进度数、解锁、接口全是对的 ——
// 界面上看不出少了东西，只会以为方案就到核心沟通创意为止。
const groups = computed(() => {
  const out: { name: string; items: StageItem[] }[] = []
  for (const s of stages.value) {
    const last = out[out.length - 1]
    if (last && last.name === s.group) last.items.push(s)
    else out.push({ name: s.group, items: [s] })
  }
  return out
})

onMounted(() => {
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
    const res = await apiGet(`/api/consult/projects/${projectId}`)
    project.value = res.project
    stages.value = res.stages
    entries.value = res.entries
    sources.value = res.sources || []
    searchEnabled.value = res.searchEnabled !== false
    briefDraft.value = res.project.brief
    // 没提交的那一轮问卷连着已填的答案一起恢复。不恢复的话用户逐条问客户问了半天，
    // 中途切一下页面回来是一份空白问卷，而界面上什么都不报。
    intakeRounds.value = res.intakeRounds || 0
    if (res.intake) {
      intake.value = { gaps: res.intake.gaps, questions: res.intake.questions, truncated: res.intake.truncated }
      intakeRoundId.value = res.intake.id
      intakeAnswers.value = { ...res.intake.answers }
    }
    if (!selectedKey.value) {
      // 默认停在第一个还没定稿的阶段 —— 这就是「下一步该干什么」
      selectedKey.value = (stages.value.find(s => !s.hasEntry) || stages.value[0])?.key || ''
      await loadMessages(selectedKey.value)
    }
    // 刚建完项目（?intake=1）直接出一份补料问卷：资料缺什么决定后面十二步的天花板，
    // 而缺料的失败形态是 AI 照常识补出一份读起来完全正常的结论。
    // 先把 query 去掉再发请求：留着的话刷新一次就又出一轮（扣一次额度，
    // 并且把这一轮连已填的答案一起替换掉），而两次都显示成功。
    if (route.query.intake && !intake.value) {
      await router.replace({ path: route.path })
      await runIntake()
    }
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// 切阶段必须把草稿清掉。留着的话下一步「定稿」写进的是新选中的那个阶段 ——
// 「看自己」的结论存进「看行业」，两边都不报错，报告里那一节读起来还挺顺。
function select(key: string) {
  if (key === selectedKey.value) return
  if (draft.value && !confirm('当前草稿还没定稿，切换阶段会丢掉它。继续？')) return
  draft.value = null
  draftStageKey.value = ''
  draftTruncated.value = false
  staledNote.value = []
  directions.value = null
  directionsStageKey.value = ''
  directionsVerdict.value = ''
  chatText.value = ''
  chatDropped.value = 0
  selectedKey.value = key
  void loadMessages(key)
}

/**
 * 取这个阶段的对话。**每个阶段一段** —— 混在一起的话讨论品牌定位时
 * 读到的是看行业那段的上下文，AI 答得依然通顺，一句错都不报。
 */
async function loadMessages(key: string) {
  messages.value = []
  if (!key) return
  loadingMessages.value = true
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}/stages/${key}/messages`)
    // 连点两个阶段时后到的响应可能是前一个阶段的：对不上就丢掉，
    // 否则贴出来的是另一个阶段的对话，而标题写着当前这个阶段。
    if (key !== selectedKey.value) return
    messages.value = res.messages
    restoreDirections(key)
  } catch (e: any) {
    err.value = e?.message || '加载对话失败'
  } finally {
    loadingMessages.value = false
  }
}

/**
 * 刷新页面之后把方向卡摆回来（它存在对话里的 payload 里）。
 * 已经定稿的阶段不恢复：那时候该看到的是定稿结论，方向卡在下面的对话记录里还在。
 */
function restoreDirections(key: string) {
  if (entryOf(key) || draft.value) return
  const last = [...messages.value].reverse().find(m => m.kind === 'directions')
  if (!last) return
  try {
    const p = JSON.parse(last.payload || '{}')
    if (!Array.isArray(p.directions) || !p.directions.length) return
    // 三件套之前存的那批方向（没有 reasons/markdown）不摆回卡片：摆出来是几张缺栏的卡，
    // 点了就以为三件套齐了。对话记录里那条文字版还在，看得到当初出过什么。
    if (!p.directions[0]?.markdown) return
    directions.value = p.directions
    directionsStageKey.value = key
    directionsVerdict.value = p.verdict || ''
  } catch {
    // payload 坏了就当没有：对话记录里那条文字版还在，不至于什么都看不到
  }
}

async function sendChat() {
  const text = chatText.value.trim()
  if (!text || !selected.value) return
  const key = selected.value.key
  chatting.value = true
  err.value = ''
  chatTruncated.value = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/chat`, { text })
    if (key !== selectedKey.value) return
    messages.value = [...messages.value, res.user, res.reply]
    chatText.value = ''
    chatDropped.value = res.dropped || 0
    chatTruncated.value = !!res.truncated
    stages.value = res.stages
  } catch (e: any) {
    // 报错时不清输入框，也不往对话里补那句话（服务端失败时两条都没落库）：
    // 补一条只有他没有回复的气泡，读起来像 AI 不理他
    err.value = e?.message || '发送失败'
  } finally {
    chatting.value = false
  }
}

async function loadDirections() {
  if (!selected.value) return
  loadingDirections.value = true
  err.value = ''
  staledNote.value = []
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${selected.value.key}/directions`, {})
    directions.value = res.directions
    directionsStageKey.value = selected.value.key
    directionsVerdict.value = res.verdict || ''
    draftTruncated.value = !!res.truncated
    stages.value = res.stages
    if (res.message) messages.value = [...messages.value, res.message]
  } catch (e: any) {
    err.value = e?.message || '出方向失败'
  } finally {
    loadingDirections.value = false
  }
}

/**
 * 选中一个方向 = 把它摊进草稿编辑器。**三件套整段进正文**（服务端拼好的 markdown）——
 * 以前是把它压成「取舍理由」+「依据」两个纯文本格，结构在定稿里就没了，
 * 下游看到的只剩一句漂亮的定位表述，没人记得当初的落地动作和放弃了什么。
 *
 * 「放弃了哪几个方向」写进依据那一格：不写的话三个月后回来看，
 * 这条定稿读起来就像唯一的选项。
 */
function pickDirection(d: Direction) {
  const others = (directions.value || []).filter(x => x !== d).map(x => x.title)
  draft.value = {
    conclusion: `${d.tagline}｜${d.identity}`,
    body: d.markdown,
    rationale: directionsVerdict.value,
    evidence: others.length ? `选它就等于放弃：${others.join('、')}` : '',
    confidence: 'mid',
    aiOpportunities: d.aiOpportunities || [],
    gaps: [],
  }
  draftStageKey.value = directionsStageKey.value
  draftPreview.value = true
}

async function makeDraft() {
  if (!selected.value) return
  drafting.value = true
  err.value = ''
  staledNote.value = []
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${selected.value.key}/draft`, {})
    draft.value = res.draft
    draftStageKey.value = selected.value.key
    draftTruncated.value = !!res.truncated
    stages.value = res.stages
    if (res.message) messages.value = [...messages.value, res.message]
  } catch (e: any) {
    err.value = e?.message || '出草稿失败'
  } finally {
    drafting.value = false
  }
}

// 已定稿的拿出来改：改完再存是 version +1，同时下游会被重新标 stale
function editEntry() {
  const e = selected.value && entryOf(selected.value.key)
  if (!e) return
  draft.value = {
    conclusion: e.conclusion,
    body: e.body || '',
    rationale: e.rationale,
    evidence: e.evidence,
    confidence: (e.confidence as Draft['confidence']) || 'mid',
    aiOpportunities: entryAiOpps(e),
    gaps: [],
  }
  draftStageKey.value = selected.value!.key
  draftTruncated.value = false
}

/** 定稿那一列（JSON 数组字符串）→ 数组。存坏了当空的，不让整条定稿打不开。 */
function entryAiOpps(e: Entry): string[] {
  try {
    const v = JSON.parse(e.ai_opportunities || '[]')
    return Array.isArray(v) ? v.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * 草稿里那一栏用「一行一条」编辑。**超过 2 条不在这里截掉** ——
 * 静默丢一条的话界面上是「已定稿」，而报告最后那一章里永远没有那条；
 * 服务端会拒并说清要他自己挑，这样他至少知道发生了什么。
 */
const MAX_AI_OPPS = 2
const aiOppsText = computed({
  get: () => (draft.value?.aiOpportunities || []).join('\n'),
  set: (v: string) => {
    if (draft.value) draft.value.aiOpportunities = v.split('\n').map(s => s.trim()).filter(Boolean)
  },
})

async function saveDraft() {
  if (!draft.value || !draftStageKey.value) return
  savingEntry.value = true
  err.value = ''
  try {
    const res = await apiPut(`/api/consult/projects/${projectId}/stages/${draftStageKey.value}/entry`, {
      conclusion: draft.value.conclusion,
      body: draft.value.body,
      rationale: draft.value.rationale,
      evidence: draft.value.evidence,
      confidence: draft.value.confidence,
      aiOpportunities: draft.value.aiOpportunities,
    })
    entries.value = res.entries
    stages.value = res.stages
    staledNote.value = res.staled || []
    draft.value = null
    draftStageKey.value = ''
    draftTruncated.value = false
  } catch (e: any) {
    err.value = e?.message || '定稿失败'
  } finally {
    savingEntry.value = false
  }
}

async function saveBrief() {
  savingBrief.value = true
  briefSaved.value = false
  err.value = ''
  try {
    await apiPut(`/api/consult/projects/${projectId}/brief`, { brief: briefDraft.value })
    briefSaved.value = true
    await load()
  } catch (e: any) {
    err.value = e?.message || '保存失败'
  } finally {
    savingBrief.value = false
  }
}

/**
 * 搜一次。**结果不落库** —— 逐条勾选之后才采纳。
 * 搜索失败单独放一个 searchErr（不并进顶部那条 err）：顶部那条会被下一次出草稿覆盖掉，
 * 而「这次没搜到东西」得留在面板里，否则用户以为采纳过了。
 */
async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q || !selected.value) return
  searching.value = true
  searchErr.value = ''
  adoptNote.value = ''
  hits.value = null
  picked.value = {}
  try {
    const res = await apiPost(
      `/api/consult/projects/${projectId}/stages/${selected.value.key}/search`,
      { query: q }
    )
    hits.value = (res.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || '',
      published: r.published || '',
    }))
  } catch (e: any) {
    searchErr.value = e?.message || '联网检索失败'
  } finally {
    searching.value = false
  }
}

/** 采纳勾选的那几条。added / skipped 都要显示：挡掉的重复条数不说的话，列表没变长读起来像没生效。 */
async function adoptPicked() {
  if (!selected.value || !hits.value) return
  const items = hits.value
    .filter(h => picked.value[h.url])
    .map(h => ({ title: h.title, url: h.url, snippet: h.content, published: h.published }))
  if (!items.length) return
  adopting.value = true
  searchErr.value = ''
  try {
    const res = await apiPost(
      `/api/consult/projects/${projectId}/stages/${selected.value.key}/sources`,
      { query: searchQuery.value.trim(), items }
    )
    sources.value = res.sources || []
    adoptNote.value =
      `已采纳 ${res.added} 条` +
      (res.skipped ? `，${res.skipped} 条是已经采纳过的同一个链接（没有重复计入）` : '') +
      '。这些资料会整段进后面每一次出草稿 / 出方向 / 对话的 prompt。'
    picked.value = {}
  } catch (e: any) {
    searchErr.value = e?.message || '采纳失败'
  } finally {
    adopting.value = false
  }
}

async function removeSource(id: string) {
  searchErr.value = ''
  try {
    const res = await apiDelete(`/api/consult/projects/${projectId}/sources/${id}`)
    sources.value = res.sources || []
    adoptNote.value = ''
  } catch (e: any) {
    searchErr.value = e?.message || '删除失败'
  }
}

/**
 * 让 AI 读一遍客户资料，出一份要问客户的问卷。落库（migration 080），刷新还在。
 *
 * 手上已经有一轮没提交的时候要先确认：服务端出新一轮会把旧那轮删掉 ——
 * 用户填了八题跑去问客户，回来手滑点一下这个按钮，那八题就没了，而两次都显示成功。
 */
async function runIntake() {
  if (intake.value && intakeFilled.value) {
    if (!confirm(`重出一份问卷会丢掉这一轮已经填的 ${intakeFilled.value} 条答案（还没补进客户资料）。继续？`)) return
  }
  loadingIntake.value = true
  intakeErr.value = ''
  intakeNote.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/intake`, {})
    intake.value = { gaps: res.gaps, questions: res.questions, truncated: res.truncated }
    intakeRoundId.value = res.round?.id || ''
    intakeRounds.value = res.rounds ?? intakeRounds.value
    intakeAnswers.value = {}
    intakeHidden.value = false
    briefOpen.value = false
  } catch (e: any) {
    intakeErr.value = e?.message || '生成问卷失败'
  } finally {
    loadingIntake.value = false
  }
}

/**
 * 逐题失焦时暂存。失败要说出来 —— 一路显示正常而其实没存，用户关掉页面才发现空的。
 */
async function saveAnswerDraft() {
  if (!intakeRoundId.value) return
  try {
    await apiPut(`/api/consult/projects/${projectId}/intake/answers`, {
      roundId: intakeRoundId.value,
      answers: intakeAnswers.value,
    })
    intakeErr.value = ''
  } catch (e: any) {
    intakeErr.value = `答案暂存失败（${e?.message || '未知原因'}）—— 先把填好的补进客户资料，别关页面。`
  }
}

/**
 * 把填了的那几题补进客户资料。空题不传 —— 服务端也会丢，但前端先算一遍，
 * 是为了让按钮上的数字和真正写进去的条数一致（数字对不上的话，
 * 「已补进 8 条」而资料里只有 3 条，谁都不会去核）。
 */
async function applyIntake() {
  if (!intake.value) return
  const answers = intake.value.questions
    .filter(q => (intakeAnswers.value[q.id] || '').trim())
    .map(q => ({ id: q.id, question: q.question, answer: intakeAnswers.value[q.id].trim(), section: q.section }))
  if (!answers.length) return
  applyingIntake.value = true
  intakeErr.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/intake/apply`, {
      answers,
      roundId: intakeRoundId.value,
    })
    briefDraft.value = res.brief
    if (project.value) project.value.brief = res.brief
    intakeRounds.value = res.rounds ?? intakeRounds.value + 1
    intakeNote.value = `已把 ${res.applied} 条答案补进客户资料（现在 ${res.briefChars} 字）—— 后面每一步的分析都会读到它们。下一轮问卷不会再问这几题。`
    intake.value = null
    intakeRoundId.value = ''
    intakeAnswers.value = {}
  } catch (e: any) {
    intakeErr.value = e?.message || '补进资料失败'
  } finally {
    applyingIntake.value = false
  }
}

const confidenceLabel: Record<string, string> = { high: '🟢 高', mid: '🟡 中', low: '🔴 低' }

/**
 * 这一步定稿之后会挂第几级证据。和服务端 sourceLevelFor 同一个口径 ——
 * 服务端是权威（前端这份只是提前告诉用户「现在定稿会是 L3」），
 * 两边不一致的时候界面上看不出来，所以改一边必须改另一边。
 */
const levelNow = computed(() => {
  if (sources.value.length) return 'L1 联网检索'
  if ((project.value?.brief || '').trim()) return 'L2 客户资料'
  return 'L3 模型内置知识（只给区间）'
})

/** 章节号（镂空大字）。全流程里的第几步 —— 用户是照这个号说「第 5 步」的 */
const selectedNo = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  return i < 0 ? '00' : String(i + 1).padStart(2, '0')
})

/** 左栏那个小角标。plan 也要有自己的字 —— 标成「快」的话用户以为它和四看一样是梳理资料 */
const laneTag = (lane: string) => (lane === 'fast' ? '快' : lane === 'plan' ? '案' : '慢')
/** 走「出草稿」那条路的车道（fast 和 plan）。慢车道是「出候选方向 → 聊 → 定稿」 */
const isDraftLane = computed(() => !!selected.value && selected.value.lane !== 'slow')

const MAX_BODY = 20000
const md = (s: string) => renderMarkdown(s)
</script>

<template>
  <!-- 全屏沉浸式：整页占满视口，三栏各自滚动。
       故意不挂 SiteHeader —— 这是个工作台，不是内容页；顶栏里有回项目列表的入口。 -->
  <div class="desk">
    <header class="hero">
      <div class="hero-main">
        <div class="hero-kicker">BRAND POSITIONING WORKBENCH</div>
        <h1>{{ project?.brand_name || '…' }}</h1>
        <div class="hero-rule"></div>
        <div class="hero-meta">
          <span>{{ decidedCount }} / {{ stages.length }} 步已定稿</span>
          <span v-if="selected">{{ selectedNo }} · {{ selected.group }} · {{ selected.label }}</span>
          <span>知识库 {{ entries.length }} 条</span>
        </div>
      </div>
      <button class="hero-back" @click="router.push('/consult/projects')">← 全部项目</button>
      <!-- 进度条：三栏各自滚动之后，「还剩几步」在页面上没有别的地方看得到 -->
      <div class="prog"><i :style="{ width: (stages.length ? decidedCount / stages.length * 100 : 0) + '%' }"></i></div>
    </header>

    <div v-if="err" class="alert">{{ err }}</div>

    <div class="layout">
      <!-- 左：阶段栏 -->
      <nav class="side">
        <div v-for="g in groups" :key="g.name" class="rail-group">
          <h4>{{ g.name }}</h4>
          <button
            v-for="s in g.items"
            :key="s.key"
            class="rail-item"
            :class="{ active: s.key === selectedKey, locked: !s.unlocked, done: s.hasEntry }"
            @click="select(s.key)"
          >
            <span class="dot">
              <template v-if="s.hasEntry">✓</template>
              <template v-else-if="!s.unlocked">🔒</template>
              <template v-else>·</template>
            </span>
            <span class="rail-label">{{ s.label }}</span>
            <span class="lane" :class="s.lane">{{ laneTag(s.lane) }}</span>
            <span v-if="s.stale" class="stale-dot" title="上游结论已变，建议重跑">⚠</span>
          </button>
        </div>
      </nav>

      <!-- 中：当前阶段 -->
      <main class="stage-pane">
          <!-- 补料问卷（项目级，不属于某一步）。摆在最上面：它是四看的前提 ——
               资料缺了，后面每一步的结论都是 AI 照常识补的，而那些结论读起来完全正常。 -->
          <div v-if="intakeErr" class="alert inline">{{ intakeErr }}</div>
          <div v-if="intakeNote" class="src-note">{{ intakeNote }}</div>
          <!-- 收起来的时候留一条能点回去的横条：问卷在库里，但界面上不留痕迹的话
               用户以为它没了，会再点一次 🩺 重出一份（旧那轮连答案一起被替换掉）。 -->
          <div v-if="intake && intakeHidden" class="intake-bar" @click="intakeHidden = false">
            📋 有一份补料问卷还没提交（{{ intakeFilled }} / {{ intake.questions.length }} 已填）—— 点开继续
          </div>
          <div v-if="intake && !intakeHidden" class="intake-box">
            <div class="brief-head">
              <span class="brief-title">📋 补料问卷 · AI 读完资料后要问客户的</span>
              <button class="btn-ghost small" @click="intakeHidden = true">收起</button>
            </div>
            <div class="intake-warn">
              填的答案<strong>随时暂存</strong>（刷新、切页都还在），但只有点下面那个按钮才会进「客户原始资料」——
              后面每一步分析读的是资料，不是这份问卷。
              答不出来的题留空，空题不会写进资料：写成「答：（空）」会被 AI 当成「客户确认没有这个东西」。
            </div>
            <div v-if="intake.truncated" class="inline-warn">
              ⚠ 模型这次返回被截断了，最后一题可能不完整。
            </div>
            <ul v-if="intake.gaps.length" class="gap-list">
              <li v-for="(g, i) in intake.gaps" :key="i">{{ g }}</li>
            </ul>
            <div v-for="(q, i) in intake.questions" :key="q.id" class="qa">
              <div class="qa-q">
                <span class="qa-no">{{ String(i + 1).padStart(2, '0') }}</span>
                <div>
                  <div class="qa-text">{{ q.question }}</div>
                  <div class="qa-why">
                    <span v-if="q.section" class="qa-sec">{{ q.section }}</span>
                    <!-- 「为什么问这题」必须显示：不说的话一半的题会被跳过，
                         而跳过之后 AI 按常识补出来的结论一样漂亮 -->
                    {{ q.why }}
                  </div>
                </div>
              </div>
              <textarea
                v-model="intakeAnswers[q.id]"
                rows="2"
                :placeholder="q.placeholder || '客户答什么就写什么，答不出来就留空'"
                @change="saveAnswerDraft"
              ></textarea>
            </div>
            <div class="draft-actions">
              <button class="btn-primary" :disabled="applyingIntake || !intakeFilled" @click="applyIntake">
                {{ applyingIntake ? '补充中…' : `把填好的 ${intakeFilled} 条补进客户资料` }}
              </button>
              <span class="muted">追加到资料末尾，不会覆盖你已经写的部分</span>
            </div>
          </div>

          <template v-if="selected">
            <div class="sec-head">
              <div class="sec-no">{{ selectedNo }}</div>
              <div class="sec-t">
                <div class="chap">{{ selected.lane === 'fast' ? 'FAST LANE · 快车道 —— AI 直接出结论，你 review'
                  : selected.lane === 'plan' ? 'PLAN LANE · 执行层 —— 承接上面的占位结论，翻译成能上手做的方案'
                  : 'SLOW LANE · 慢车道 —— AI 给方向，你选 / 继续聊' }}</div>
                <h2>{{ selected.label }}</h2>
                <p class="stage-question">{{ selected.question }}</p>
              </div>
            </div>

            <!-- 分析操法：和进 prompt 的是同一份。正文没照方法论推（比如价值主张没做三问检验、
                 竞品每家写的维度不一样）在屏幕上看不出来，对着这份顺序才数得出来。 -->
            <details v-if="selected.method?.length" class="method">
              <summary>
                <span class="brief-title">这一步该怎么想 · {{ selected.method.length }} 条操法</span>
                <span class="muted">AI 拿到的就是这一份 —— 正文读起来对不上它的顺序就是没照方法论推</span>
              </summary>
              <ol class="method-list">
                <li v-for="(m, i) in selected.method" :key="i">{{ m }}</li>
              </ol>
            </details>

            <!-- 本步应产出的东西：AI 漏了第几项，只有对着这份清单才数得出来 -->
            <div v-if="selected.deliverables?.length" class="deliv">
              <div class="deliv-head">
                <span class="brief-title">这一步应该产出 {{ selected.deliverables.length }} 项</span>
                <span class="muted">出完草稿对着这里数一遍 —— 少一项的正文读起来一样完整</span>
              </div>
              <ol class="deliv-list">
                <li v-for="(d, i) in selected.deliverables" :key="i">{{ d }}</li>
              </ol>
            </div>

            <div v-if="!selected.unlocked" class="notice">
              这一步还没解锁 —— 需要先定稿：<strong>{{ selected.missing.join('、') }}</strong>。
              <br />
              这一步的判断要引用上面那些结论，跳过做出来的东西读起来一样正常，但依据是空的。
            </div>

            <!-- 草稿编辑器：出完草稿 / 点「编辑」之后 -->
            <div v-else-if="draft && draftStageKey === selected.key" class="draft-box">
              <div class="draft-head">
                <span class="tag draft-tag">草稿 · 还没进知识库</span>
                <span class="muted">改完点「定稿」才会存下来（刷新后这个编辑框会空掉，但这一版留在下面的对话里）</span>
              </div>

              <div v-if="draftTruncated" class="inline-warn">
                ⚠ 模型这次的返回被截断了，下面的结论可能断在半句话上 —— 定稿前自己读一遍。
              </div>
              <div v-if="draft.gaps.length" class="inline-gaps">
                <b>AI 说资料里缺这些</b>（补进下面的「客户原始资料」再重新出草稿，置信度才上得去）
                <ul><li v-for="(g, i) in draft.gaps" :key="i">{{ g }}</li></ul>
              </div>

              <label class="dfield">
                <span class="dlabel">一句话总结<em>{{ draft.conclusion.length }} / 4000</em></span>
                <textarea v-model="draft.conclusion" rows="3"></textarea>
              </label>

              <div class="dfield">
                <span class="dlabel">
                  正文（markdown，本步那几张表都在这里）
                  <em>
                    {{ draft.body.length }} / {{ MAX_BODY }}
                    <button class="link-btn" @click="draftPreview = !draftPreview">
                      {{ draftPreview ? '改文字' : '看渲染' }}
                    </button>
                  </em>
                </span>
                <div v-if="draftPreview" class="md md-preview" v-html="md(draft.body)"></div>
                <textarea v-else v-model="draft.body" rows="24"></textarea>
              </div>

              <label class="dfield">
                <span class="dlabel">取舍理由</span>
                <textarea v-model="draft.rationale" rows="3"></textarea>
              </label>
              <label class="dfield">
                <span class="dlabel">依据（资料里的哪几句 / 哪些数字）</span>
                <textarea v-model="draft.evidence" rows="3"></textarea>
              </label>
              <!-- AI 赋能机会：单独存一栏（不在正文里），报告最后那一章按它汇总 -->
              <label class="dfield">
                <span class="dlabel">
                  AI 赋能机会（一行一条，最多 {{ MAX_AI_OPPS }} 条）
                  <em>{{ draft.aiOpportunities.length }} / {{ MAX_AI_OPPS }}</em>
                </span>
                <textarea
                  v-model="aiOppsText"
                  rows="3"
                  placeholder="用 AI 做什么、替代掉现在的哪个动作 —— 一句话，不展开"
                ></textarea>
                <span class="muted dhint">
                  每一步各标 1–2 条，最后汇成方案里独立的一章「AI 转型机会清单」。
                  这一步空着的话那一章就少一个模块，而它读起来照样是完整的清单。
                </span>
              </label>

              <label class="dfield inline">
                <span class="dlabel">置信度</span>
                <select v-model="draft.confidence">
                  <option value="high">🟢 高 · 资料直接支撑</option>
                  <option value="mid">🟡 中 · 部分靠常识补</option>
                  <option value="low">🔴 低 · 资料不足</option>
                </select>
              </label>

              <div class="draft-actions">
                <button class="btn-primary" :disabled="savingEntry || !draft.conclusion.trim()" @click="saveDraft">
                  {{ savingEntry ? '保存中…' : '定稿并存入知识库' }}
                </button>
                <button v-if="isDraftLane" class="btn-ghost" :disabled="drafting" @click="makeDraft">
                  {{ drafting ? 'AI 重写中…' : '让 AI 重出一版' }}
                </button>
                <button
                  v-if="directions && directionsStageKey === selected.key"
                  class="btn-ghost"
                  @click="draft = null; draftStageKey = ''"
                >← 回到方向列表</button>
                <button v-else class="btn-ghost" @click="draft = null; draftStageKey = ''">丢弃草稿</button>
              </div>
            </div>

            <!-- 慢车道：候选方向（互斥，选一个就等于放弃另外几个） -->
            <div v-else-if="directions && directionsStageKey === selected.key" class="dirs">
              <div class="dirs-head">
                <span class="tag draft-tag">{{ directions.length }} 个候选方向 · 都还没定稿</span>
                <span class="muted">方向之间是互斥的：选一个就等于放弃另外几个。都不满意就让它重出。</span>
              </div>
              <div v-if="draftTruncated" class="inline-warn">
                ⚠ 模型这次的返回被截断了，最后一个方向可能不完整 —— 挑之前自己读一遍。
              </div>
              <div v-for="(d, i) in directions" :key="i" class="dir-card">
                <div class="dir-top">
                  <span class="dir-idx">{{ i + 1 }}</span>
                  <h3>{{ d.title }}</h3>
                </div>
                <!-- 卡片渲染的就是点选之后进定稿正文的那一段（服务端拼的 markdown）：
                     卡片和正文各渲染一份的话，某一栏在卡片上看得见、定稿里没有，谁都不会去核 -->
                <div class="md dir-md" v-html="md(d.markdown)"></div>
                <div class="draft-actions">
                  <button class="btn-primary" @click="pickDirection(d)">就用这个方向 →</button>
                </div>
              </div>

              <!-- 方向研判放在所有卡片之后：它讲的是「几个方向之间怎么选」，
                   摆在卡片上方会被当成第 1 个方向的说明 -->
              <div v-if="directionsVerdict" class="verdict">
                <div class="brief-title">🧭 方向研判</div>
                <div class="md" v-html="md(directionsVerdict)"></div>
              </div>

              <div class="draft-actions">
                <button class="btn-ghost" :disabled="loadingDirections" @click="loadDirections">
                  {{ loadingDirections ? 'AI 思考中…' : '都不满意，重出一批' }}
                </button>
                <span class="muted">已出过 {{ selected.round }} 轮</span>
              </div>
            </div>

            <div v-else-if="entryOf(selected.key)" class="entry-box">
              <div class="entry-head">
                <span class="tag">已定稿 · v{{ entryOf(selected.key)!.version }}</span>
                <span class="conf" :class="'conf-' + entryOf(selected.key)!.confidence">
                  {{ confidenceLabel[entryOf(selected.key)!.confidence] || entryOf(selected.key)!.confidence }}
                </span>
                <span class="tag">{{ entryOf(selected.key)!.source_level }}</span>
                <span v-if="entryOf(selected.key)!.stale" class="tag warn">⚠ 上游已变，建议重跑</span>
              </div>
              <p class="entry-conclusion">{{ entryOf(selected.key)!.conclusion }}</p>
              <div v-if="entryOf(selected.key)!.body" class="md" v-html="md(entryOf(selected.key)!.body)"></div>
              <div v-else class="inline-warn">
                这条定稿没有正文（是加正文之前存的那一版）—— 让 AI 重出一版才有企业现状卡 / 优先级矩阵这些表。
              </div>
              <p v-if="entryOf(selected.key)!.rationale" class="entry-sub"><b>理由</b>{{ entryOf(selected.key)!.rationale }}</p>
              <p v-if="entryOf(selected.key)!.evidence" class="entry-sub"><b>依据</b>{{ entryOf(selected.key)!.evidence }}</p>
              <!-- 没标就说出来，不要只是不显示：空白和「这一步确实没有 AI 机会」长得一样，
                   而报告最后那一章会因此少一个模块 -->
              <div v-if="entryAiOpps(entryOf(selected.key)!).length" class="entry-ai">
                <b>🤖 AI 赋能机会</b>
                <ul><li v-for="(a, i) in entryAiOpps(entryOf(selected.key)!)" :key="i">{{ a }}</li></ul>
              </div>
              <div v-else class="entry-ai muted">
                🤖 这条定稿没标 AI 赋能机会 —— 报告里的「AI 转型机会清单」会少这一个模块。
                点「改这条结论」自己补一条，或者让 AI 重出一版。
              </div>
              <div class="draft-actions">
                <button class="btn-ghost" @click="editEntry">✎ 改这条结论</button>
                <button v-if="isDraftLane" class="btn-ghost" :disabled="drafting" @click="makeDraft">
                  {{ drafting ? 'AI 分析中…' : selected.lane === 'plan' ? '让 AI 按现在的结论重出一版' : '让 AI 按现在的资料重出一版' }}
                </button>
                <button v-else class="btn-ghost" :disabled="loadingDirections" @click="loadDirections">
                  {{ loadingDirections ? 'AI 思考中…' : '换个方向重做这一步' }}
                </button>
              </div>
            </div>

            <div v-else class="notice todo">
              这一步还没开始。<br />
              <span class="muted">
                {{ selected.lane === 'fast'
                  ? '快车道：AI 读你贴的资料直接出一份结论草稿，你改完就定稿。它只会用资料里已有的事实，缺的部分会单独列出来让你补。'
                  : selected.lane === 'plan'
                    ? '执行层：AI 按上面已定稿的占位结论出一份能上手做的方案草稿 —— 具体平台、具体链路、具体节奏，每条都指回它承接的那条结论。它不会回去让你重选定位。'
                    : '慢车道：AI 先给 2–4 个互斥的候选方向（选择理由 / 你现在就有的优势 / 核心解决方案 / 代价），你选一个再改成自己的话，然后定稿。' }}
              </span>
              <div class="draft-actions">
                <button v-if="isDraftLane" class="btn-primary" :disabled="drafting" @click="makeDraft">
                  {{ drafting ? 'AI 分析中…' : selected.lane === 'plan' ? '让 AI 按已定稿结论出方案草稿' : '让 AI 读资料出结论草稿' }}
                </button>
                <button v-else class="btn-primary" :disabled="loadingDirections" @click="loadDirections">
                  {{ loadingDirections ? 'AI 思考中…' : '让 AI 给几个候选方向' }}
                </button>
                <span v-if="selected.round" class="muted">已出过 {{ selected.round }} 轮</span>
              </div>
            </div>
          </template>

          <div v-if="staledNote.length" class="notice warn-staled">
            已定稿。<strong>{{ staledNote.join('、') }}</strong> 里的结论是按旧口径写的，已标成「待重跑」
            —— 四问是相互咬合的，不重跑的话最后的报告里这几节会互相矛盾，而中途不会有任何报错。
          </div>

          <!-- 阶段内对话：在这一步里接着问、让它换个角度、挑某个方向往深挖 -->
          <div v-if="selected && selected.unlocked" class="chat-box">
            <div class="chat-head">
              <span class="brief-title">这一步的对话</span>
              <span class="muted">
                只属于「{{ selected.label }}」这一步，AI 只带着这一段和已定稿结论回答
              </span>
            </div>

            <div v-if="loadingMessages" class="chat-empty">加载中…</div>
            <div v-else-if="!messages.length" class="chat-empty">
              还没聊过。可以直接问，比如「第 2 个方向再往深挖一层」「这个结论的依据够吗」
              「按 XX 竞品的做法重新看一遍」。
            </div>

            <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
              <div class="msg-who">
                {{ m.role === 'user' ? '我' : 'AI' }}
                <span v-if="m.kind === 'directions'" class="msg-kind">候选方向</span>
                <span v-else-if="m.kind === 'draft'" class="msg-kind">结论草稿</span>
              </div>
              <!-- AI 那侧走 markdown：草稿正文里是表格，pre-wrap 出来是一屏竖线，
                   用户就不会去核对里面的数字了。自己说的那句保持原样。 -->
              <div v-if="m.role === 'assistant'" class="msg-body md" v-html="md(m.content)"></div>
              <div v-else class="msg-body">{{ m.content }}</div>
            </div>

            <div v-if="chatDropped" class="inline-warn">
              ⚠ 这一步聊得比较长了，最早的 {{ chatDropped }} 条没能进这次的上下文 ——
              前面已经排除掉的方向它可能会重新提，读到似曾相识的建议时留个心。
            </div>
            <div v-if="chatTruncated" class="inline-warn">
              ⚠ 上面这条回复被截断了（额度用完），最后一句可能没写完。
            </div>

            <div class="chat-input">
              <textarea
                v-model="chatText"
                rows="3"
                :maxlength="MAX_CHAT"
                placeholder="接着问 —— 聊定了再去上面出草稿 / 选方向 / 定稿"
                @keydown.ctrl.enter="sendChat"
                @keydown.meta.enter="sendChat"
              ></textarea>
              <div class="chat-actions">
                <button class="btn-primary" :disabled="chatting || !chatText.trim()" @click="sendChat">
                  {{ chatting ? 'AI 思考中…' : '发送' }}
                </button>
                <span class="muted">⌘/Ctrl + Enter · {{ chatText.length }} / {{ MAX_CHAT }}</span>
              </div>
            </div>
          </div>

          <!-- 联网查资料（L1）。方法论 §8：L1 联网 > L2 客户资料 > L3 内置知识（只给区间）> L4 缺失。
               搜出来的东西**要用户逐条勾选**才进 prompt：全自动塞进去的话，同名公司、几年前的旧闻
               会被写成这家企业的现状卡，而那一节读起来完全正常。 -->
          <div class="src-box">
            <div class="brief-head">
              <span class="brief-title">🌐 联网查资料（L1）</span>
              <span class="muted">已采纳 {{ sources.length }} 条 · 现在定稿会标成 <strong>{{ levelNow }}</strong></span>
            </div>

            <!-- 没配 key 时说清楚是「这个部署没接搜索」，不是「网上查不到」：
                 藏起面板的话用户只会觉得这个 AI 在瞎猜，而它确实只能瞎猜。 -->
            <div v-if="!searchEnabled" class="inline-warn">
              ⚠ 联网检索没开（管理员还没配搜索 key）。AI 不会替你上网 ——
              它只用下面的客户资料（L2），其余按 L3 给区间。需要外部事实请自己贴进客户资料。
            </div>

            <template v-else>
              <div class="src-input">
                <input
                  v-model="searchQuery"
                  :placeholder="`查什么？例如「${project?.brand_name || '品牌名'} 市场规模 2025」`"
                  @keydown.enter="runSearch"
                />
                <button class="btn-primary" :disabled="searching || !searchQuery.trim()" @click="runSearch">
                  {{ searching ? '搜索中…' : '搜索' }}
                </button>
              </div>

              <div v-if="searchErr" class="inline-warn">⚠ {{ searchErr }}</div>
              <div v-if="adoptNote" class="src-note">{{ adoptNote }}</div>

              <div v-if="hits && !hits.length" class="src-empty">
                这个词没搜到东西。换个说法再试 —— 不采纳任何东西的话，这一步的结论只能是 L2/L3。
              </div>

              <div v-if="hits && hits.length" class="hits">
                <label v-for="h in hits" :key="h.url" class="hit">
                  <input type="checkbox" v-model="picked[h.url]" />
                  <div class="hit-body">
                    <div class="hit-title">{{ h.title || '(无标题)' }}</div>
                    <div class="hit-meta">
                      <span>{{ h.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] }}</span>
                      <!-- 日期没有就明说「未标日期」：省掉的话三年前的旧数字读起来和今年的一样 -->
                      <span>{{ h.published || '未标日期' }}</span>
                      <a :href="h.url" target="_blank" rel="noopener" @click.stop>打开原文 ↗</a>
                    </div>
                    <div class="hit-snip">{{ h.content }}</div>
                  </div>
                </label>
                <div class="src-actions">
                  <button class="btn-primary" :disabled="adopting || !pickedCount" @click="adoptPicked">
                    {{ adopting ? '采纳中…' : `采纳选中的 ${pickedCount} 条` }}
                  </button>
                  <span class="muted">采纳之后每一次调用都会带上它们，并要求 AI 标注「（联网·域名·年份）」</span>
                </div>
              </div>
            </template>

            <div v-if="sources.length" class="adopted">
              <div v-for="sc in sources" :key="sc.id" class="adopted-item">
                <span class="lv">L1</span>
                <div class="adopted-body">
                  <a :href="sc.url" target="_blank" rel="noopener">{{ sc.title || sc.url }}</a>
                  <div class="hit-meta">
                    <span>{{ sc.domain }}</span>
                    <span>{{ sc.published || '未标日期' }}</span>
                    <span v-if="sc.query">搜的是「{{ sc.query }}」</span>
                  </div>
                </div>
                <button class="src-del" title="不再作为依据" @click="removeSource(sc.id)">✕</button>
              </div>
            </div>
          </div>
      </main>

      <!-- 右：企业知识库 -->
      <aside class="kb">
        <h4>企业知识库 · {{ entries.length }} 条</h4>
        <div v-if="!entries.length" class="kb-empty">
          还没有定稿结论。<br />
          每完成一步，这一步的结论会存到这里，成为后面所有分析的依据。
        </div>
        <button
          v-for="e in entries"
          :key="e.stage_key"
          class="kb-item"
          :class="{ stale: e.stale }"
          @click="select(e.stage_key)"
        >
          <div class="kb-item-head">
            <span>{{ stages.find(s => s.key === e.stage_key)?.label || e.stage_key }}</span>
            <span class="conf" :class="'conf-' + e.confidence">{{ confidenceLabel[e.confidence] || e.confidence }}</span>
          </div>
          <div class="kb-item-text">{{ e.conclusion }}</div>
          <div v-if="e.stale" class="kb-item-warn">⚠ 上游已变</div>
        </button>

        <!-- 客户原始资料（L2 事实源）。挪到知识库这一栏、默认收起 ——
             它以前钉在中间栏底部，每一步都要滚过一整块 2 万字的输入框才看得到下面的东西。
             字数常显：这是「AI 手上到底有多少料」唯一看得见的数字，收起来也要留着。 -->
        <div class="brief-side" :class="{ open: briefOpen }">
          <button class="brief-toggle" @click="briefOpen = !briefOpen">
            <span>客户原始资料</span>
            <span class="brief-count">{{ briefDraft.length }} 字 {{ briefOpen ? '▲' : '▼' }}</span>
          </button>
          <!-- 手上有一轮没提交的时候，这个按钮是「回去接着填」而不是重出一份：
               重出会把那一轮连答案一起替换掉，而用户点它的本意通常只是「问卷跑哪去了」。 -->
          <button
            v-if="intake && intakeHidden"
            class="intake-btn"
            @click="intakeHidden = false"
          >
            📋 回去填问卷（{{ intakeFilled }} / {{ intake.questions.length }}）
          </button>
          <button v-else class="intake-btn" :disabled="loadingIntake" @click="runIntake">
            {{ loadingIntake ? 'AI 读资料中…' : intake ? '🩺 重出一份问卷' : '🩺 让 AI 看看还缺什么' }}
          </button>
          <!-- 已补过几轮：用户靠它判断「这些是不是我上次已经问过客户的」 -->
          <div v-if="intakeRounds" class="intake-rounds">已补过 {{ intakeRounds }} 轮问卷</div>
          <template v-if="briefOpen">
            <textarea
              v-model="briefDraft"
              rows="12"
              :maxlength="MAX_BRIEF"
              placeholder="把客户资料贴进来，缺的部分后面 AI 会问你。"
            ></textarea>
            <div class="brief-actions">
              <button class="btn-primary" :disabled="savingBrief" @click="saveBrief">
                {{ savingBrief ? '保存中…' : '保存资料' }}
              </button>
              <span v-if="briefSaved" class="saved">已保存</span>
              <span class="muted">{{ briefDraft.length }} / {{ MAX_BRIEF }}</span>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/**
 * kimi3 设计系统（references/kimi3-design-system.css）落到这个工作台上。
 * 品牌色用 consult 自己那支深蓝 #0B4A6F（和 ConsultCover 一致），不是 kimi3 示例里的橙。
 *
 * 一条硬规矩：**悬停只改阴影和边框，绝不 translateY**。这一页上的卡片里全是表格，
 * 鼠标划过时整块往上跳，正在对照的那一行就跑掉了。
 */
.desk {
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

  /* 满屏不滚：三栏各自滚动。整页一起滚的话左边的阶段栏和右边的知识库会滚出视野，
     而这两栏就是「我在第几步 / 前面定了什么」的唯一入口。 */
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  background: #F5F5F7; color: var(--color-text); font-family: var(--font-sans);
  background-image: linear-gradient(rgba(0,0,0,.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,.03) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* ── 刊头 ───────────────────────────────────────── */
.hero {
  position: relative; flex: 0 0 auto; overflow: hidden;
  padding: 22px 32px 20px; color: #F2F6FC;
  background: linear-gradient(135deg, #080F1D 0%, var(--navy) 38%, var(--navy-2) 68%, #1E3A5C 105%);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
}
.hero::before {
  content: ""; position: absolute; top: -180px; right: -80px; width: 420px; height: 420px;
  background: radial-gradient(circle, rgba(11, 74, 111, .55) 0%, transparent 65%); pointer-events: none;
}
.hero-main { position: relative; z-index: 1; min-width: 0; }
/* 每个标题都要显式写 font-family：App.vue 里有一条全局 `h1..h6 { font-family: var(--font-serif) }`，
   不写的话中文标题落到 Georgia 的中文回退上 —— 字重字号都对，只是整页标题突然变了一种字 */
.hero-kicker {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 4px;
  color: rgba(242, 246, 252, .5); text-transform: uppercase;
}
.hero h1 { margin: 8px 0 0; font-size: 26px; font-weight: 800; font-family: var(--font-sans); letter-spacing: .5px; color: #fff; }
.hero-rule { width: 48px; height: 3px; border-radius: 2px; background: #4C9CC9; margin: 12px 0; }
.hero-meta { display: flex; flex-wrap: wrap; gap: 8px; }
.hero-meta span {
  padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(242, 246, 252, .24);
  background: rgba(242, 246, 252, .08); font-size: 11px; letter-spacing: .5px; color: rgba(242, 246, 252, .9);
}
.hero-back {
  position: relative; z-index: 1; flex: 0 0 auto;
  padding: 7px 14px; border-radius: 8px; cursor: pointer; font-family: var(--font-sans); font-size: 12px;
  border: 1px solid rgba(242, 246, 252, .3); background: rgba(242, 246, 252, .1); color: #F2F6FC;
}
.hero-back:hover { background: rgba(242, 246, 252, .18); }
.prog { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: rgba(255, 255, 255, .12); }
.prog i { display: block; height: 100%; background: #4C9CC9; }

.alert {
  flex: 0 0 auto; padding: 10px 32px;
  background: #FEF3F2; border-bottom: 1px solid #FECDCA; color: #B42318; font-size: 13px; line-height: 1.7;
}
/* 中间栏里的报错（问卷那块）：顶部那条是整页横幅，摆在栏里要收成一张卡 */
.alert.inline {
  padding: 10px 14px; margin-bottom: 14px; border-radius: 10px;
  border: 1px solid #FDA29B; border-bottom: 1px solid #FDA29B;
}

/* ── 版式骨架 ───────────────────────────────────── */
.layout {
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: 252px minmax(0, 1fr) 300px;
}

/* 左栏 */
.side {
  min-height: 0; overflow-y: auto; padding: 20px 0 40px;
  background: rgba(245, 245, 247, .7); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-right: 1px solid var(--color-border);
}
.side h4, .kb h4 {
  margin: 18px 20px 8px; font-family: var(--font-mono); font-size: 9.5px; font-weight: 600;
  letter-spacing: 3px; text-transform: uppercase; color: #98A2B3;
}
.side .rail-group:first-child h4 { margin-top: 4px; }
.rail-item {
  display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
  padding: 7px 20px; border: none; border-left: 2px solid transparent;
  background: transparent; cursor: pointer; font-size: 12.5px; color: var(--color-muted);
  font-family: var(--font-sans); transition: background .15s, color .15s, border-color .15s;
}
.rail-item:hover { color: var(--brand); background: var(--brand-soft); }
.rail-item.active {
  color: var(--brand); border-left-color: var(--brand); background: var(--brand-soft); font-weight: 600;
}
.rail-item.locked { color: #98A2B3; }
.rail-item .dot { width: 14px; text-align: center; font-size: 11px; color: var(--color-soft); }
.rail-item.done .dot { color: #067647; }
.rail-label { flex: 1; }
.lane { font-size: 10px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--color-border-strong); color: var(--color-soft); }
.lane.slow { border-color: #B9D6E5; color: var(--brand); background: #fff; }
.lane.plan { border-color: #D8C7A6; color: #8A6D33; background: #FFFCF4; }
.stale-dot { color: #B54708; font-size: 11px; }

/* 中栏 */
.stage-pane {
  min-width: 0; min-height: 0; overflow-y: auto;
  padding: 34px 44px 80px; display: flex; flex-direction: column; gap: 20px;
}
.muted { color: var(--color-soft); font-size: 12px; }

/* 章节头（镂空章节号） */
.sec-head {
  display: grid; grid-template-columns: 76px 1fr; align-items: end; gap: 16px; position: relative;
  padding-bottom: 14px; border-bottom: 1px solid var(--color-border);
}
.sec-head::after {
  content: ""; position: absolute; left: 0; bottom: -1px; width: 64px; height: 3px;
  background: var(--brand); border-radius: 2px;
}
.sec-no {
  font-size: 54px; line-height: .95; font-weight: 800; letter-spacing: -2px;
  color: transparent; -webkit-text-stroke: 1.5px var(--brand);
}
.sec-t .chap {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 2px; color: var(--brand);
  font-weight: 600; margin-bottom: 6px;
}
.sec-t h2 { margin: 0; font-size: 24px; font-weight: 800; font-family: var(--font-sans); letter-spacing: .5px; line-height: 1.35; }
.stage-question { margin: 6px 0 0; font-size: 13px; line-height: 1.75; color: var(--color-muted); }

/* 卡片体系（玻璃拟态）。悬停只改阴影/边框 —— 位移会把正在对照的表格行带走 */
.deliv, .entry-box, .draft-box, .dir-card, .chat-box, .verdict, .src-box {
  background: var(--color-bg-elevated); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-radius: 14px; padding: 22px 26px;
  box-shadow: var(--shadow); transition: box-shadow .3s, border-color .3s;
}
.deliv:hover, .entry-box:hover, .draft-box:hover, .dir-card:hover, .chat-box:hover, .src-box:hover {
  box-shadow: var(--shadow-lg); border-color: rgba(11, 74, 111, .28); transform: none;
}
/* 定稿 / 草稿 / 方向卡是这一页的主角，顶部 4px 品牌线把它们和辅助卡分开 */
.entry-box, .draft-box, .dir-card { border-top: 4px solid var(--brand); }

.notice {
  background: #FFFAEB; border: 1px solid #FEDF89; color: #B54708;
  border-radius: 14px; padding: 18px 22px; font-size: 13px; line-height: 1.8;
}
.notice.todo {
  background: var(--color-bg-elevated); border: 1px dashed var(--color-border-strong); color: var(--color-text);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
}

.entry-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.tag {
  font-size: 11px; padding: 3px 10px; border-radius: 999px;
  background: #fff; border: 1px solid var(--color-border); color: var(--color-muted);
}
.tag.warn { background: #FFFAEB; border-color: #FEDF89; color: #B54708; }
/* 置信度徽章：🔴 低和 🟢 高在一行灰色小字里长得太像，而这两者的意思是相反的 */
.conf {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700;
  padding: 3px 9px; border-radius: 20px; white-space: nowrap; border: 1px solid transparent;
}
.conf-high { background: #ECFDF3; color: #067647; border-color: #A6F4C5; }
.conf-mid { background: #FFFAEB; color: #B54708; border-color: #FEDF89; }
.conf-low { background: #FEF3F2; color: #B42318; border-color: #FECDCA; }
.entry-conclusion { margin: 0 0 12px; font-size: 15.5px; line-height: 1.85; font-weight: 600; }
.entry-sub { margin: 10px 0 0; font-size: 13px; line-height: 1.8; color: var(--color-muted); }
.entry-sub b { display: inline-block; margin-right: 8px; color: var(--color-text); font-weight: 700; }
.entry-ai {
  margin: 14px 0 0; padding: 10px 12px; border-radius: 10px;
  background: rgba(11, 74, 111, 0.05); border: 1px solid var(--color-border);
  font-size: 13px; line-height: 1.8;
}
.entry-ai b { color: var(--color-text); font-weight: 700; }
.entry-ai ul { margin: 6px 0 0; padding-left: 18px; }

/* 分析操法。默认折起（十来条操法摊开会把草稿按钮推到屏幕外），但标题行常显 ——
   收进设置里的话没人知道有这份东西可对照 */
.method {
  background: var(--color-bg-elevated); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-left: 3px solid rgba(11, 74, 111, .45);
  border-radius: 14px; padding: 14px 22px; box-shadow: var(--shadow);
}
.method summary {
  cursor: pointer; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  list-style: none;
}
.method summary::-webkit-details-marker { display: none; }
.method summary::before { content: "▸"; color: var(--brand); font-size: 11px; }
.method[open] summary::before { content: "▾"; }
.method[open] summary { margin-bottom: 8px; }
.method-list {
  margin: 0; padding-left: 22px; font-size: 12.5px; line-height: 1.95; color: var(--color-muted);
}
.method-list li::marker { color: var(--brand); font-weight: 700; }

/* 本步输出物清单 */
.deliv-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.deliv-list { margin: 0; padding-left: 20px; font-size: 12.5px; line-height: 1.95; color: var(--color-muted); }
.deliv-list li::marker { color: var(--brand); font-weight: 700; }

/* AI 生成的 markdown 正文。v-html 的内容不受 scoped 约束，必须走 :deep() */
.md { font-size: 13.5px; line-height: 1.85; color: var(--color-muted); overflow-x: auto; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { margin: 22px 0 10px; font-size: 15.5px; font-weight: 700; font-family: var(--font-sans); color: var(--color-text); }
.md :deep(h1:first-child), .md :deep(h2:first-child), .md :deep(h3:first-child) { margin-top: 0; }
.md :deep(p) { margin: 0 0 10px; }
.md :deep(strong), .md :deep(b) { color: var(--color-text); }
.md :deep(ul), .md :deep(ol) { margin: 0 0 12px; padding-left: 20px; }
.md :deep(li) { margin-bottom: 4px; }
.md :deep(table) {
  width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 12.5px;
  background: #fff; border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden;
  box-shadow: var(--shadow);
}
/* ── 补料问卷 ─────────────────────────────────── */
.intake-box {
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-top: 4px solid var(--brand);
  border-radius: 14px; padding: 22px; margin-bottom: 20px; box-shadow: var(--shadow);
}
.intake-warn {
  font-size: 12px; line-height: 1.75; color: #B54708;
  background: #FFFAEB; border: 1px solid #FEDF89; border-radius: 10px;
  padding: 9px 12px; margin-bottom: 12px;
}
.gap-list { margin: 0 0 16px; padding-left: 20px; font-size: 12.5px; line-height: 1.85; color: var(--color-muted); }
.qa { padding: 12px 0; border-top: 1px dashed var(--color-border-strong); }
.qa-q { display: flex; gap: 10px; align-items: flex-start; }
.qa-no {
  flex: 0 0 auto; font-family: var(--font-mono); font-size: 18px; font-weight: 800; line-height: 1.2;
  color: transparent; -webkit-text-stroke: 1.1px var(--brand);
}
.qa-text { font-size: 13.5px; font-weight: 700; line-height: 1.6; }
.qa-why { margin-top: 3px; font-size: 11.5px; line-height: 1.7; color: var(--color-soft); }
.qa-sec {
  display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 999px;
  background: var(--brand-soft); color: var(--brand-ink); font-weight: 700; font-size: 10.5px;
}
.qa textarea {
  width: 100%; box-sizing: border-box; margin-top: 8px; padding: 8px 10px;
  border: 1px solid var(--color-border-strong); border-radius: 10px; background: #fff;
  font-size: 13px; line-height: 1.7; font-family: inherit; color: var(--color-text); resize: vertical;
}
.qa textarea:focus { outline: none; border-color: var(--brand); }
.btn-ghost.small { padding: 4px 10px; font-size: 11.5px; }
.intake-btn {
  width: 100%; margin-top: 8px; padding: 9px 11px; cursor: pointer;
  border: 1px dashed var(--brand); border-radius: 10px; background: var(--brand-soft);
  color: var(--brand-ink); font-size: 12px; font-weight: 700; font-family: inherit;
  transition: background .3s;
}
.intake-btn:hover { background: #D8E7F0; }
.intake-btn:disabled { opacity: .6; cursor: default; }
.intake-rounds {
  margin-top: 6px; font-family: var(--font-mono); font-size: 10.5px;
  letter-spacing: .5px; color: var(--color-soft); text-align: right;
}
/* 收起后的那条横条：问卷还在库里，界面上必须留一个看得见的入口 */
.intake-bar {
  margin-bottom: 16px; padding: 10px 14px; cursor: pointer;
  border: 1px dashed var(--brand); border-radius: 10px; background: var(--brand-soft);
  color: var(--brand-ink); font-size: 12.5px; font-weight: 700;
  transition: background .3s;
}
.intake-bar:hover { background: #D8E7F0; }

/* ── 联网资料面板 ─────────────────────────────── */
.src-input { display: flex; gap: 8px; margin-bottom: 10px; }
.src-input input {
  flex: 1; min-width: 0; padding: 9px 12px; font-size: 13px; font-family: inherit;
  border: 1px solid var(--color-border-strong); border-radius: 10px; background: #fff; color: var(--color-text);
}
.src-input input:focus { outline: none; border-color: var(--brand); }
.src-note {
  font-size: 12px; line-height: 1.6; color: var(--brand-ink);
  background: var(--brand-soft); border-radius: 10px; padding: 8px 12px; margin-bottom: 10px;
}
.src-empty { font-size: 12px; color: var(--color-soft); padding: 6px 0; }
.hits { display: flex; flex-direction: column; gap: 8px; }
.hit {
  display: flex; gap: 10px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--color-border); border-radius: 10px; background: rgba(255, 255, 255, .6);
}
.hit:hover { border-color: var(--brand); }
.hit input { margin-top: 3px; flex: 0 0 auto; }
.hit-body { min-width: 0; }
.hit-title { font-size: 13px; font-weight: 700; line-height: 1.5; }
.hit-meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0; font-size: 11px; color: var(--color-soft); font-family: var(--font-mono); }
.hit-meta a { color: var(--brand); text-decoration: none; }
.hit-snip {
  font-size: 12px; line-height: 1.65; color: var(--color-muted);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.src-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.adopted { margin-top: 12px; border-top: 1px dashed var(--color-border-strong); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.adopted-item { display: flex; align-items: flex-start; gap: 10px; }
.lv {
  flex: 0 0 auto; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .5px;
  padding: 3px 7px; border-radius: 6px; background: var(--brand); color: #fff;
}
.adopted-body { min-width: 0; flex: 1; }
.adopted-body a { font-size: 13px; font-weight: 600; color: var(--color-text); text-decoration: none; }
.adopted-body a:hover { color: var(--brand); text-decoration: underline; }
.src-del {
  flex: 0 0 auto; border: 1px solid var(--color-border-strong); background: #fff; color: var(--color-soft);
  width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 11px; line-height: 1;
}
.src-del:hover { border-color: #C0392B; color: #C0392B; }

.md :deep(th), .md :deep(td) { padding: 10px 14px; text-align: left; vertical-align: top; }
.md :deep(th) { background: var(--navy); color: #E8EEF6; font-weight: 600; font-size: 12px; letter-spacing: .5px; white-space: nowrap; }
.md :deep(td) { border-top: 1px solid var(--color-border); }
.md :deep(tbody tr:hover td) { background: #F8FAFC; }
.md :deep(blockquote) {
  margin: 12px 0; padding: 12px 16px; border-left: 3px solid var(--brand);
  background: var(--brand-soft); border-radius: 0 10px 10px 0; color: var(--brand-ink);
}
.md :deep(code) { padding: 1px 5px; border-radius: 4px; background: #F0F2F5; font-family: var(--font-mono); font-size: 12px; }
.md :deep(hr) { border: none; border-top: 1px solid var(--color-border); margin: 16px 0; }
.md-preview {
  padding: 14px 16px; border: 1px solid var(--color-border-strong); border-radius: 10px;
  background: #fff; max-height: 620px; overflow: auto;
}
.link-btn {
  margin-left: 8px; padding: 0; border: none; background: none; cursor: pointer;
  color: var(--brand); font-size: 11px; font-family: var(--font-sans); text-decoration: underline;
}

/* 候选方向卡 */
.dirs { display: flex; flex-direction: column; gap: 16px; }
.dirs-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dir-top { display: flex; align-items: center; gap: 12px; }
.dir-idx {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px; flex: 0 0 auto;
  background: var(--brand); color: #fff; font-family: var(--font-mono); font-size: 11px; font-weight: 700;
}
.dir-top h3 { margin: 0; font-size: 20px; font-weight: 800; font-family: var(--font-sans); }
.dir-md { margin: 12px 0 4px; }
.verdict { border-left: 3px solid var(--brand); }

/* 草稿编辑器 */
.draft-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.draft-tag { background: var(--brand-soft); border-color: #B9D6E5; color: var(--brand); font-weight: 600; }
.inline-warn {
  margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; line-height: 1.7;
  background: #FFFAEB; border: 1px solid #FEDF89; color: #B54708;
}
.inline-gaps {
  margin-bottom: 14px; padding: 12px 14px; border-radius: 10px; font-size: 12.5px; line-height: 1.7;
  background: #F5F5F7; border: 1px dashed var(--color-border-strong); color: var(--color-muted);
}
.inline-gaps b { color: var(--color-text); }
.inline-gaps ul { margin: 6px 0 0; padding-left: 18px; }
.dfield { display: block; margin-bottom: 14px; }
.dfield.inline { display: flex; align-items: center; gap: 10px; }
.dlabel { display: flex; justify-content: space-between; font-size: 12px; color: var(--color-muted); margin-bottom: 6px; }
.dlabel em { font-style: normal; color: var(--color-soft); }
.dhint { display: block; margin-top: 6px; font-size: 12px; line-height: 1.7; }
textarea, select {
  width: 100%; box-sizing: border-box; padding: 11px 13px; border: 1px solid var(--color-border-strong);
  border-radius: 10px; font-size: 13px; line-height: 1.8; font-family: var(--font-sans);
  color: var(--color-text); background: #fff; resize: vertical;
}
.dfield.inline select { width: auto; }
textarea:focus, select:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(11, 74, 111, .1); }
.draft-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }

/* 阶段内对话 */
.chat-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.chat-empty { font-size: 12.5px; line-height: 1.9; color: var(--color-soft); }
.msg { margin-bottom: 14px; }
.msg-who { font-size: 11px; color: var(--color-soft); margin-bottom: 4px; }
.msg-kind { margin-left: 6px; padding: 1px 7px; border-radius: 4px; background: var(--brand-soft); color: var(--brand); }
.msg-body {
  font-size: 13px; line-height: 1.85; white-space: pre-wrap; word-break: break-word;
  padding: 12px 14px; border-radius: 10px; background: #fff;
  border: 1px solid var(--color-border);
}
/* markdown 那侧不能留 pre-wrap：源码里的换行会在渲染后的段落之间再加一遍空行 */
.msg-body.md { white-space: normal; }
.msg.user .msg-body { background: var(--brand-soft); border-color: #B9D6E5; color: var(--brand-ink); }
.chat-input { margin-top: 14px; }
.chat-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }

.brief-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.brief-title { font-size: 13.5px; font-weight: 700; }
.brief-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.saved { font-size: 12px; color: #067647; }

/* 右栏 */
.kb {
  min-height: 0; overflow-y: auto; padding: 20px 18px 40px;
  background: rgba(245, 245, 247, .7); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-left: 1px solid var(--color-border);
}
.kb h4 { margin: 0 2px 12px; }
.kb-empty { font-size: 12px; line-height: 1.9; color: var(--color-soft); }
.kb-item {
  display: block; width: 100%; text-align: left; margin-bottom: 10px;
  padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 12px;
  background: rgba(255, 255, 255, .8); cursor: pointer; font-family: var(--font-sans);
  box-shadow: var(--shadow); transition: box-shadow .3s, border-color .3s;
}
.kb-item:hover { box-shadow: var(--shadow-lg); border-color: rgba(11, 74, 111, .28); }
.kb-item.stale { border-color: #FEDF89; background: #FFFAEB; }
.kb-item-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.kb-item-text { font-size: 12px; line-height: 1.7; color: var(--color-muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.kb-item-warn { margin-top: 6px; font-size: 11px; color: #B54708; }

/* 客户原始资料（收在知识库栏底部） */
.brief-side {
  margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--color-border-strong);
}
.brief-toggle {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 9px 11px; cursor: pointer; text-align: left;
  border: 1px solid var(--color-border-strong); border-radius: 10px; background: rgba(255, 255, 255, .7);
  font-size: 12px; font-weight: 700; font-family: inherit; color: var(--color-text);
  transition: border-color .3s;
}
.brief-toggle:hover { border-color: var(--brand); }
.brief-count { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--color-soft); }
.brief-side.open textarea {
  width: 100%; box-sizing: border-box; margin-top: 8px; padding: 9px 10px;
  border: 1px solid var(--color-border-strong); border-radius: 10px; background: #fff;
  font-size: 12px; line-height: 1.75; font-family: inherit; color: var(--color-text); resize: vertical;
}
.brief-side.open textarea:focus { outline: none; border-color: var(--brand); }

.btn-primary {
  padding: 9px 17px; border: 1px solid var(--brand); border-radius: 10px;
  background: var(--brand); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  font-family: var(--font-sans); transition: background .2s, box-shadow .2s;
}
.btn-primary:hover:not(:disabled) { background: #0d5b87; box-shadow: var(--shadow); }
.btn-primary:disabled { opacity: .45; cursor: default; }
.btn-ghost {
  padding: 8px 14px; border: 1px solid var(--color-border-strong); border-radius: 10px;
  background: #fff; color: var(--color-muted); font-size: 12px; cursor: pointer; font-family: var(--font-sans);
  transition: border-color .2s, color .2s;
}
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }

@media (max-width: 1180px) {
  /* 窄屏退回整页滚动：三栏挤在一屏里每栏都只剩一小条，谁都读不了 */
  .desk { height: auto; min-height: 100vh; overflow: visible; }
  .layout { grid-template-columns: 1fr; }
  .side, .stage-pane, .kb { overflow: visible; }
  .side { border-right: none; border-bottom: 1px solid var(--color-border); padding-bottom: 16px; }
  .kb { border-left: none; border-top: 1px solid var(--color-border); }
  .stage-pane { padding: 24px 20px 48px; }
  .hero { padding: 20px 20px 18px; }
  .hero h1 { font-size: 22px; }
}
</style>
