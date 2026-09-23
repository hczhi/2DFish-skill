<script setup lang="ts">

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
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
  method: string[]
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
  body: string
  rationale: string
  evidence: string
  confidence: string
  /** JSON 数组字符串（服务端那一列原样回来，见 projectStore.parseEntryAiOpportunities） */
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
  writingTip: string
  markdown: string
}

interface Msg {
  id: string
  role: 'user' | 'assistant'
  /**
   * 'entry' = 定稿那一刻留在对话里的记录（服务端 chatService.entryToText 生成）；
   * 'decisions' = 慢车道动笔前那一屏岔路口；'decided' = 他在那几处岔路口上拍的板
   * （**它是这一步正文的地基**，所以恢复它比恢复岔路口清单更要紧）；
   * 'search' = 这一次分析之前自动联网的结论（查到几条 / 为什么没查到）。
   *
   * 加一种 kind 必须同时在下面那条 `v-if` 链上加一条分支：认不出的 kind 会落到最后那个
   * `v-else`，被画成一张写着「已生成候选方向」的卡片，点开右栏是空的 —— 读起来像那一版丢了。
   */
  kind: 'text' | 'directions' | 'draft' | 'entry' | 'discard' | 'decisions' | 'decided' | 'search'
  content: string
  payload: string
  created_at: string
}

/** 一处要顾问拍板的取舍（服务端 decisionService.DecisionPoint）。 */
interface DecisionPoint {
  id: string
  question: string
  methodRef: string
  basis: string
  options: Array<{ label: string; detail: string; cost: string }>
  recommend: string
}
interface DecisionSheet {
  points: DecisionPoint[]
  noFork: string
  missing: string[]
  /** 服务端丢掉的那几处（缺依据 / 凑不出带代价的选项）。**必须显示** ——
   *  少一处的卡片和「这一步只有两处要定」在屏幕上一模一样，而那一处最后是 AI 自己定的。 */
  dropped: string[]
  truncated: boolean
}
/** 他在那几处岔路口上定的答案（服务端 decisionService.DecidedSheet）。 */
interface DecidedSheet {
  picks: Array<{
    id: string
    question: string
    methodRef: string
    label: string
    detail: string
    /** 选它放弃的东西。**必须显示** —— 那是这一步唯一不可逆的信息，
     *  而正文只会讲选中那条路的好处。 */
    cost: string
    note: string
    /** 谁定的（服务端 decisionService.DecisionBy）。**空 = 他自己点的**（老记录没有这一列）。 */
    by?: string
  }>
  noFork: string
  sheetMessageId: string
}

const selectedKey = ref<string>('')
const messages = ref<Msg[]>([])
const loadingMessages = ref(false)
const chatText = ref('')
const chatting = ref(false)
const chatDropped = ref(0)
const chatTruncated = ref(false)
const MAX_CHAT = 3000

const chatOpen = ref(false)
const openMsgs = ref<Record<string, boolean>>({})
const directions = ref<Direction[] | null>(null)
const directionsStageKey = ref('')
const directionsVerdict = ref('')
const loadingDirections = ref(false)
const decisions = ref<DecisionSheet | null>(null)
const decisionsStageKey = ref('')
const loadingDecisions = ref(false)
/**
 * 这几个选择对的是哪一条 `kind='decisions'` 消息。**必须跟着一起发** ——
 * 清单里的 id 是按顺序生成的（d1..dN），重出一版之后同一个 `d2` 已经是另一个问题，
 * 服务端靠这个 id 才拒得掉「问题 A 配答案 B」那条读起来完全正常的记录。
 */
const decisionsMsgId = ref('')
/** 每处岔路口选中的选项名（id → label）+ 他自己补的一句（id → note）。 */
const picks = ref<Record<string, string>>({})
const pickNotes = ref<Record<string, string>>({})
const applying = ref(false)
/** 已经拍过板的那份（右栏那块只读回顾 + 「按这几条出正文」的入口）。 */
const decided = ref<DecidedSheet | null>(null)
const decidedStageKey = ref('')
const draft = ref<Draft | null>(null)
const draftStageKey = ref('')
const drafting = ref(false)
const draftTruncated = ref(false)
const draftDiscussion = ref<{ used: number; dropped: number } | null>(null)
/**
 * 正在被分析的**那一步**的 key。
 *
 * `drafting` / `loadingDirections` 是全局布尔，拿它当「转圈圈」的条件的话：在「看行业」
 * 分析的中途切到「看自己」，「看自己」的对话里也挂着一句「正在分析这一步」——
 * 而那一步压根没在跑，额度花在别的步上，出来的草稿也会出现在别的步里。用户会一直等，
 * 等到的是另一步的结果，两边都不报错。所以气泡只在 `runningStage === 当前步` 时出现，
 * 别的步在跑时改成明说「哪一步在跑」（顺便解释按钮为什么是灰的）。
 */
const runningStage = ref('')
const draftPreview = ref(true)
const savingEntry = ref(false)
const staledNote = ref<string[]>([])
/**
 * 「AI 替你定了这几处、其中几处是掷硬币」那句提示。**不能用 err**：紧接着跑的
 * `makeDraft` 一进门就把 err 清了，那句降级提示在屏幕上只存在几百毫秒，
 * 而他看到的是一份正常出好的正文。
 */
const autoPickNote = ref('')
const briefDraft = ref('')
const savingBrief = ref(false)
const briefSaved = ref(false)
/**
 * 右栏三个页签。`run` 是「一键生成整份报告」那条链的进度页（十几分钟、十几步），
 * 它**不能只做成对话流上的一条提示**：那一批跑的时候他会切来切去看已经出来的那几步，
 * 而挂在某一步下面的进度一切走就消失了 —— 剩下的表现是「点了按钮之后什么都没发生」，
 * 而它正在花二十多次额度。
 */
const workspaceTab = ref<'task' | 'kb' | 'run'>('task')
const workspaceOpen = ref(false) // Drawer state
// 左栏缺省收起：正文（尤其定稿后那份满是表格的报告）比阶段清单值钱，展开的入口
// 一直挂在左上角（`btn-global-sidebar-toggle`）。
const sidebarOpen = ref(false) // Sidebar state

watch(messages, () => {
  nextTick(() => {
    if (chatScrollRef.value) chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  })
}, { deep: true })
const chatScrollRef = ref<HTMLElement | null>(null)
const chatInputRef = ref<HTMLTextAreaElement | null>(null)

function adjustTextareaHeight() {
  const el = chatInputRef.value
  if (!el) return
  // 重置高度以计算正确的 scrollHeight
  el.style.height = 'auto'
  // 限制最大高度，比如不超过 120px (大约 5-6 行)
  const newHeight = Math.min(el.scrollHeight, 120)
  el.style.height = newHeight + 'px'
  // 如果内容过多导致高度达到最大值，则允许滚动
  el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
}

watch(chatText, (newVal) => {
  if (newVal === '') {
    nextTick(() => {
      if (chatInputRef.value) {
        chatInputRef.value.style.height = 'auto'
        chatInputRef.value.style.overflowY = 'hidden'
      }
    })
  }
})


// 补料问卷只在 ConsultIntake.vue 里填。这里留下的三个值只用来**说出**「有一份没提交」：
// 那一轮没提交就意味着客户资料还缺一块，而后面每一步的结论都从那段资料出。
interface IntakeQuestion {
  id: string
  section: string
  question: string
  why: string
  placeholder: string
}
const intake = ref<{ gaps: string[]; questions: IntakeQuestion[]; truncated: boolean } | null>(null)
const intakeAnswers = ref<Record<string, string>>({})
const intakeRounds = ref(0)
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
  /** 1 = 四看一键分析自动搜来的，没人核对过（migration 110）。0 = 他逐条勾选采纳的。 */
  auto: number
}
interface Hit {
  title: string
  url: string
  content: string
  published: string
}
const sources = ref<Source[]>([])
const searchEnabled = ref(true)
const searchQuery = ref('')
const searching = ref(false)
const hits = ref<Hit[] | null>(null)
const picked = ref<Record<string, boolean>>({})
const adopting = ref(false)
const adoptNote = ref('')
const searchErr = ref('')
const pickedCount = computed(() => Object.values(picked.value).filter(Boolean).length)

/**
 * 用户在问卷页点过「跳过，直接进工作台」（额度用完 / 出题失败时才给的出口）。
 * 存在 sessionStorage 而不是库里：这是「这次先绕过去」，不是「这个项目不用填了」——
 * 落库的话那份问卷从此没人再提，而它决定后面每一步结论的质量。
 * key 和 ConsultIntake.vue 里那份必须一致（不一致的后果只是每次进工作台要再点一次跳过，
 * 不会静默把人挡在外面）。
 */
const INTAKE_SKIP_KEY = `consult-intake-skip:${projectId}`
const intakeSkipped = () => sessionStorage.getItem(INTAKE_SKIP_KEY) === '1'

/**
 * **这一步**正在分析。期间这一步的对话和右栏按钮全部停掉 —— 不是为了防并发（各是一次
 * 独立调用，技术上都跑得通），是因为这段时间里的每个操作都会静默地不生效：
 * - 这时候发的话进不了正在写的那一版（`discussionBlock` 在请求发出那一刻就取完了），
 *   而回来的草稿读起来完全正常，用户以为自己刚才那句被听进去了；
 * - 这时候点「完成定稿」定的是**旧**那一版，紧接着新的一版盖进右栏，界面上看起来
 *   像刚才那次定稿没保存成功。
 */
const stageBusy = computed(() => !!runningStage.value && runningStage.value === selectedKey.value)
/** 有任何一步在跑。出草稿/出方向的按钮按这个禁用，不按各自那个全局布尔：
    A 步在跑 directions 时 `drafting` 是 false，于是在 B 步还能点出第二个并发的分析，
    先结束的那个会把 `runningStage` 清掉 —— 另一步的转圈圈就此消失而它还在花额度。 */
const anyRunning = computed(
  () =>
    !!runningStage.value ||
    drafting.value ||
    loadingDirections.value ||
    loadingDecisions.value ||
    applying.value ||
    // 并行那一批也算：漏了它的话四看跑着的时候每一步的生成按钮都还是亮的，
    // 点下去被 409 挡住（额度没花，但读起来像功能坏了），而真正在跑的那四次看不出来。
    batchActive.value ||
    // 整份报告那条链同理，而且更要紧：链条中间那几步在他点的时候还没开跑（`consult_runs`
    // 里没有它们），所以那道 409 拦不住 —— 他能在链条前面插一次手动分析，两版正文互相盖，
    // 而界面上只是「这一步的内容怎么换了」。
    fullRunning.value
)

/**
 * `methodRef`（例「操法 3」）指的那条操法的原文。
 *
 * **光摆一个序号等于没摆**：「操法 3」在卡片上什么都没说，要知道它是什么得滚回顶上那个
 * 折叠块去数第三条 —— 没人会数，于是这个序号唯一的作用（顾问核出「这个岔路口是模型自己
 * 造的」，操法里压根没有这一条）就落空了，而编出来的 `methodRef` 和真的长得一模一样。
 * 对不上号（模型给的是一句话而不是序号、或者序号超出范围）就返回空串，卡片上只留原样的
 * 那个标签 —— 悄悄换成第 1 条的话，那才是真的在替模型圆谎。
 */
function methodText(ref: string): string {
  const n = Number((ref.match(/\d+/) || [])[0])
  const list = selected.value?.method || []
  if (!(n >= 1 && n <= list.length)) return ''
  return list[n - 1].replace(/\*\*/g, '')
}

/**
 * 标签上的那句话。**要说出界面上真实存在的那个东西的名字**：模型给的是「操法 2」，
 * 而「操法」这个词在整个界面上一次都没出现过（顶上那个折叠块里那份清单叫「💡 该怎么想」）——
 * 于是标签指向一个用户找不到的地方，他只能跳过它，那这个岔路口是照方法论推的还是模型
 * 顺口编的就再没人核了（编出来的那种和真的长得一模一样）。所以这里把序号翻成
 * 「出自「该怎么想」第 N 条」。
 *
 * 号对不上时**原样显示模型给的那串字**（不翻译、不改成第 1 条）：那正是「这条是编的」
 * 的信号，翻得漂亮一点就是替它圆谎。
 */
function methodLabel(ref: string): string {
  if (!methodText(ref)) return ref
  const n = Number((ref.match(/\d+/) || [])[0])
  return `出自「该怎么想」第 ${n} 条`
}

/**
 * 这一处是谁定的（见服务端 `DecisionBy`）。**`by` 缺失一律当他自己点的** ——
 * 老记录里压根没有这一列，默认成 AI 的话，他过去亲手拍的板会显示成「AI 替你定的」。
 */
function aiPicked(p: { by?: string }): boolean {
  return p.by === 'ai-recommend' || p.by === 'ai-fallback'
}
function pickByLabel(p: { by?: string }): string {
  // 两种 AI 分开：fallback 那几处等于掷了个硬币，是他回头第一个要看的
  if (p.by === 'ai-fallback') return '⚠ AI 掷硬币定的'
  if (p.by === 'ai-recommend') return '⚠ AI 替你定的'
  return '✓ 你定的'
}

/** 这一步的岔路口清单 / 拍板结果在不在屏幕上（右栏那一块和对话末尾那个 CTA 共用）。 */
const hasSheet = computed(() => !!decisions.value && decisionsStageKey.value === selectedKey.value)
const hasDecided = computed(() => !!decided.value && decidedStageKey.value === selectedKey.value)

/** 还有几处没定。定完才让提交 —— 留空的那几处 AI 会在写正文时自己定，而正文读起来一样完整。 */
const pendingPicks = computed(() =>
  (decisions.value?.points || []).filter(p => !picks.value[p.id]).length
)

const selected = computed(() => stages.value.find(s => s.key === selectedKey.value) || null)
const entryOf = (key: string) => entries.value.find(e => e.stage_key === key) || null

/**
 * 这一步的定稿（有就是只读态）。
 *
 * **定稿之后这一步锁死**：不能改定稿、不能再聊、不能再出草稿/方向，中间那块换成这一份
 * 报告本身。服务端同一道闸在 `draftService.requireOpenStage`，两边都要有 —— 只挡前端的话
 * 老页面（没刷新的那个标签页）照样能发，而它花了额度、AI 认真回了一段，那段话既进不了
 * 任何 prompt 也改不动结论；只挡服务端的话按钮还在，点下去是一句报错。
 */
const stageEntry = computed(() => (selected.value ? entryOf(selected.value.key) : null))
const stageLocked = computed(() => !!stageEntry.value)
/**
 * 定稿之后接着做哪一步：往后数第一条还没定稿的。
 *
 * 这个入口是必需的，不是锦上添花：这一栏换成只读报告之后，界面上一个能点的东西都没有，
 * 而「下一步」在左边那条窄栏里 —— 不给出口的话他会以为流程到这儿就结束了。
 */
const nextStage = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  if (i < 0) return null
  return stages.value.slice(i + 1).find(s => !s.hasEntry) || null
})
/**
 * 紧挨着的下一步（**不管它定稿了没有**）。右下角那颗按钮用它。
 *
 * 和 `nextStage`（往后数第一条还没定稿的）是两件事，不能共用：十四步都定稿之后
 * `nextStage` 指的是队尾那一条，于是在「看用户」这一步点「下一步」会跳到
 * 「数字化营销战略」—— 界面上它和真的翻页一模一样，而他是在**顺着读**这份报告，
 * 一下被扔到最后一章，回头只能靠左栏一个个找刚才读到哪了。
 */
const nextInOrder = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  if (i < 0) return null
  return stages.value[i + 1] || null
})
/** 紧挨着的上一步（左下角那颗按钮用它）。第一步时为 null，那颗按钮整个不出现。 */
const prevInOrder = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  if (i <= 0) return null
  return stages.value[i - 1] || null
})
/** 定稿里那几条 AI 赋能机会。读坏了当没有 —— 不能因为这一列而让整份报告打不开。 */
const entryAiOpps = computed<string[]>(() => {
  try {
    const v = JSON.parse(stageEntry.value?.ai_opportunities || '[]')
    return Array.isArray(v) ? v.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
})
const labelOf = (key: string) => stages.value.find(s => s.key === key)?.label || key
const decidedCount = computed(() => stages.value.filter(s => s.hasEntry).length)

// ── 导出方案 ──────────────────────────────────────────────
const exporting = ref(false)
/** 十四步全定稿才让点：半份方案在屏幕上和完整的一模一样，而它是要发给客户的东西。 */
const canExport = computed(() => stages.value.length > 0 && decidedCount.value === stages.value.length)
async function exportReport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const res = await apiGet<{ filename: string; markdown: string; stale: string[]; noBody: string[]; chapters: number }>(
      `/api/consult/projects/${projectId}/report`
    )
    // 下载这一步失败必须出声（浏览器拦了弹窗 / 磁盘满）：静默失败的话按钮点下去
    // 什么都不发生，读起来像功能坏了，而那份方案其实已经拼好了。
    const url = URL.createObjectURL(new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = res.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    // 过期 / 缺正文的章节也在文档开头写着，但这里再说一遍：他可能不看就转出去了
    if (res.stale.length || res.noBody.length) {
      err.value =
        `已导出 ${res.chapters} 章，但文档里有需要注意的地方：` +
        [
          res.stale.length ? `${res.stale.join('、')} 这几章是上游改动之前定的（可能和后面矛盾）` : '',
          res.noBody.length ? `${res.noBody.join('、')} 只有结论、没有正文` : '',
        ].filter(Boolean).join('；') +
        '。文档开头也标了同样的话。'
    }
  } catch (e: any) {
    err.value = `导出失败：${e.message}`
  } finally {
    exporting.value = false
  }
}

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

// 离开这一页要把捞结果的定时器停掉（`startRunPoll`）：留着的话它会一直打接口，
// 而且会往一个已经卸载的组件里写状态。
onUnmounted(() => {
  stopRunPoll()
  stopBatchPoll()
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
    intakeRounds.value = res.intakeRounds || 0
    intake.value = res.intake
      ? { gaps: res.intake.gaps, questions: res.intake.questions, truncated: res.intake.truncated }
      : null
    intakeAnswers.value = { ...(res.intake?.answers || {}) }
    // 第一轮问卷没提交过就先回问卷页。**必须在挑阶段之前 return** —— 落在后面的话
    // 他已经进了工作台，对着一份缺料的资料点下「生成」，出来的一版读起来完全正常。
    // 只挡第一轮（`intakeRounds === 0`）：后面几轮也挡的话，客户还没回话的那几天
    // 他连自己的项目都打不开。跳过入口见 `intakeSkipped`。
    if (res.intake && !intakeRounds.value && !intakeSkipped()) {
      await router.replace(`/consult/projects/${projectId}/intake`)
      return
    }
    if (!selectedKey.value) {
      selectedKey.value = (stages.value.find(s => !s.hasEntry) || stages.value[0])?.key || ''
      await loadMessages(selectedKey.value)
    }
    // 整份报告那一批要在 `resumeRuns` **之前**接回来（111）：刷新/关掉页面再回来时，
    // `runs` 里只有当前那一步，只接它的话面板上是「单步正在跑」，他会去点别的步骤
    // （撞上链条中间），也看不到「后面还排着 9 步」。上次跑到一半停了的那句成因同理。
    fullBatch.value = (res.batch as BatchView) || null
    if (fullBatch.value?.status === 'running') {
      startBatchPoll()
      // 回到这一页时也把进度顶上来（他上次可能是关了页面走的）：不顶的话界面上只有某一步
      // 在转圈，看起来是单步在跑，而其实后面还排着十几步。
      openWorkspace('run')
    }
    resumeRuns(res.runs || [])
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 左右下角那两颗翻页按钮（上一步 / 下一步）：切过去之后把中间这一栏滚回顶上。
 *
 * 必须显式滚：`messages` 那个 watch 每次换阶段都把滚动条推到**底**（聊天该那样），
 * 而下一步是从头开始的 —— 落在底部时他看到的是输入条和一句「还没开始分析」，
 * 阶段标题、要回答的问题、那份「该怎么想」全在视口上面，读起来就是「点了下一步却什么
 * 都没换」（上一步的报告本来也是滚到底才看见这颗按钮的）。
 * 排在 watch 的回调之后：那次 `nextTick` 是 `select` 里赋值 messages 时排的，比这里早。
 */
async function goStage(key: string) {
  await select(key)
  await nextTick()
  if (chatScrollRef.value) chatScrollRef.value.scrollTop = 0
}

async function select(key: string) {
  if (key === selectedKey.value) return
  // 切换阶段不再拦一句确认：那一版**不会丢** —— 它整份存在对话里 `kind='draft'` 那条
  // 消息的 payload 里，切回来 `restoreArtifact` 会照原样恢复。真正丢掉的只有他在右栏
  // 编辑器里手改过、还没定稿的那些字（草稿不落库），而为这件事拦住每一次翻看别的阶段
  // 太贵了 —— 这一步要跑几分钟，中途切去看上游结论是常事。
  draft.value = null
  draftStageKey.value = ''
  draftTruncated.value = false
  draftDiscussion.value = null
  staledNote.value = []
  // 这句话说的是「这一步」的取舍，跟着阶段走 —— 留着的话它挂在别的阶段头上
  autoPickNote.value = ''
  directions.value = null
  directionsStageKey.value = ''
  directionsVerdict.value = ''
  decisions.value = null
  decisionsStageKey.value = ''
  // 选中的选项按 `d1..dN` 存，而每一步都有自己的 d1 —— 不清的话切到下一步，
  // 那几处岔路口一进来就是「已经选好的」，而他一个都没看过（服务端会按 label 拒掉，
  // 但界面上那几个高亮读起来完全像他自己点的）。
  picks.value = {}
  pickNotes.value = {}
  decisionsMsgId.value = ''
  decided.value = null
  decidedStageKey.value = ''
  chatText.value = ''
  chatDropped.value = 0
  chatOpen.value = false
  selectedKey.value = key
  // 那条链跑着的时候**不切回「当前工作区」**：他在进度页上点某一步的名字就是去看已经出来
  // 的那一份，切页签的话进度就此消失（而它还在跑、还在花额度），他只会以为跑完了。
  if (!fullRunning.value) workspaceTab.value = 'task'

  if (window.innerWidth < 1024) {
    workspaceOpen.value = false
  }

  await loadMessages(key)
}

// ── 分析结果的兜底：不只等那次 POST 的返回 ──────────────────
//
// 那个返回**可能永远收不到**：页面热更新过、网络断一下、服务重启、手机息屏、代理掐掉
// 长连接。而服务端那一版已经落在对话记录里了（`appendMessage` 在 `res.json` 之前），
// 于是界面上剩一个永远转的圈圈加一排灰按钮，用户只能靠刷新页面才发现「其实已经出来了」
// —— 在那之前他会以为额度白花了，再点一次生成（又花一次）。所以分析期间每 8 秒去库里
// 看一眼这一步有没有新的产出，有就直接收下并把转圈圈停掉。
const POLL_MS = 8000
/** 等多久就认定这次真的没戏。到点必须**出声**并把界面解开：
    一直转下去的话「还在跑」和「早就断了」在屏幕上是同一个样子。

    这个数必须**比服务端那个超时长**（draftService.AI_TIMEOUT_MS = 330 秒；四看那一步
    实测要 260-300 秒）。短了的话服务端还在写、界面已经说「等太久了」，用户走了，
    而那一版稍后照样落进对话记录 —— 下次进来看到一版没人要的草稿，一句错都不报。 */
const POLL_MAX_TICKS = 45
/** 上面那个窗口有多长。文案里写死分钟数的话，改了 TICKS 就变成一句谎话。 */
const POLL_WINDOW_LABEL = `${Math.round((POLL_MS * POLL_MAX_TICKS) / 60000)} 分钟`
let runPoll: number | undefined

function stopRunPoll() {
  if (runPoll !== undefined) {
    clearInterval(runPoll)
    runPoll = undefined
  }
}

/**
 * 贴一条消息，**已经在列表里的那条不再贴一遍**。
 *
 * 去重是必须的：等待期的轮询会先把已经落库的 🌐 联网结论捞出来贴上（见 `startRunPoll`），
 * 而十几秒后那次 POST 的返回里还带着**同一条**（`searchMessage`）—— 直接 push 的话
 * 对话里两张一模一样的黄卡片，读起来像联网跑了两遍（也就是「多花了一次额度」）。
 */
function pushMessage(m?: Msg | null) {
  if (!m || messages.value.some(x => x.id === m.id)) return
  messages.value = [...messages.value, m]
}

/**
 * 这次分析开跑之前已经有哪几条资料。等待区里那句「这次新搜到 N 条」按它做差集算出来 ——
 * `consult_sources` 那几列里没有时间戳，照 `auto=1` 数的话把**以前几次**搜的也算进这一次
 * （四看跑完通常已经躺着十几条），于是他等的那一版明明一条都没搜到，屏幕上照旧写着
 * 「这次新搜到 16 条」。
 *
 * **`null` = 这次没有快照可比**（刷新之后接回来的那次，`resume`），此时一条都不显示。
 * 空 Set 当默认值是不行的：那样差集等于「库里全部」，于是 🌐 那条气泡说「这次联网一条
 * 都没拿到」，紧下面却列着 39 条「这次新搜到、已经喂进去了」 —— 两句话都在屏幕上，
 * 而真话是上面那句（实际跑出来的就是这个样子）。
 */
const preRunSourceIds = ref<Set<string> | null>(null)

/**
 * 只把右栏那份资料清单刷新一遍：自动联网是在写正文**之前**落库的，
 * 不刷的话那十几条要等整次分析结束才出现，而等待的这一分钟里屏幕上一个字都没变。
 * 失败就算了 —— 这是一条锦上添花的刷新，在这里报错会盖掉真正在跑的那次的状态。
 */
async function refreshSources() {
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}`)
    sources.value = res.sources || []
  } catch {}
}

/** 把「正在跑」的三个状态位一起清掉。漏一个的话按钮或转圈圈会单独卡住。 */
function clearRunState() {
  runningStage.value = ''
  drafting.value = false
  loadingDirections.value = false
  loadingDecisions.value = false
  stopRunPoll()
}

/**
 * @param resume 这一次不是本标签页发起的（刷新/重进之后从 `consult_runs` 接回来的，见
 *   `resumeRuns`）。这种情况下**不能按 message id 判新旧**：`messages` 里装的是当前选中步
 *   的记录，而在跑的可能是另一步 —— `seen` 对不上号，第一轮就把那一步**早就存在**的旧草稿
 *   当成刚出炉的收下并宣布「已经出好了」，而真正那一版还在写（几分钟后才落库，没人再去捞）。
 *   所以改成按「比这次开跑的时刻更晚」认，`since` 传 `consult_runs.started_at`。
 */
function startRunPoll(key: string, resume?: { since: string }) {
  stopRunPoll()
  const seen = new Set(messages.value.map(m => m.id))
  // 这次开跑时的资料快照（见 preRunSourceIds）。接回来的那次没有快照可言（那几条早就在
  // 库里了），置 null 而不是空 Set —— 空 Set 的差集是「库里全部」，等待区会把以前搜的
  // 几十条全说成「这次新搜到的」。
  preRunSourceIds.value = resume ? null : new Set(sources.value.map(s => s.id))
  let ticks = 0
  runPoll = window.setInterval(async () => {
    // 那次 POST 已经正常返回（或换了别的步在跑）就不用捞了
    if (runningStage.value !== key) return stopRunPoll()
    ticks++
    try {
      const res = await apiGet(`/api/consult/projects/${projectId}/stages/${key}/messages`)
      // 🌐 那条联网结论在写正文**之前**就落库了（`autoSearchBeforeAnalysis`），
      // 所以等待期里先把它贴出来 —— 不贴的话它要和正文一起在一分钟后同时冒出来，
      // 而这一分钟里屏幕上只有一句纹丝不动的「正在分析」，和卡死了一模一样。
      // **不算跑完**：它不进下面那个 `fresh`，转圈圈照旧转着。
      if (key === selectedKey.value) {
        const notes = (res.messages as Msg[]).filter(
          m => m.kind === 'search' && !messages.value.some(x => x.id === m.id)
        )
        if (notes.length) {
          notes.forEach(pushMessage)
          // 搜回来的那几条同时进右栏和等待区（那次 POST 的返回里没有资料清单）
          void refreshSources()
        }
      }
      const fresh = (res.messages as Msg[]).filter(
        m =>
          (resume ? m.created_at > resume.since : !seen.has(m.id)) &&
          (m.kind === 'draft' || m.kind === 'directions' || m.kind === 'decisions')
      )
      if (fresh.length) {
        if (runningStage.value !== key) return stopRunPoll()
        // 库里那行是在 `res.json` 前一刻写的，所以正常的一次分析也会被这里撞上。
        // 先让那次返回有 3 秒机会自己回来 —— 不等的话每次分析结束都要多弹一句
        // 「这一版是捞回来的」，而它其实一切正常，看多了就没人当真了。
        // 接回来的那次不用等：这一页压根没有那个 POST 在飞（它死在上一次页面生命周期里）。
        if (!resume) await new Promise(r => setTimeout(r, 3000))
        if (runningStage.value !== key) return stopRunPoll()
        stopRunPoll()
        // 轮次 / 解锁状态也要一起收下（那次返回里的 stages 同样没收到）
        try {
          const p = await apiGet(`/api/consult/projects/${projectId}`)
          stages.value = p.stages
          entries.value = p.entries
        } catch {}
        if (key === selectedKey.value) {
          messages.value = res.messages
          restoreArtifact(key)
          openWorkspace('task')
          err.value = resume
            ? '✅ 这是你刷新/离开之前那次分析的结果 —— 它在服务端一直跑着，现在写完了。额度只花了一次。'
            : '⚠ 这一版是直接从服务端捞回来的 —— 那次请求的返回没收到（页面热更新过 / 网络断了一下 / 服务重启都会这样）。' +
              '内容是完整的，额度也只花了一次，不用重新生成。'
        } else {
          err.value = `「${labelOf(key)}」已经出好了（额度已经花掉），切回那一步就能看到。`
        }
        // 状态位**最后**才清：清早了那条 `watch(runningStage)` 会在这一版挂上去之前
        // 就去补跑当前步（本地 round 还是 0），于是同一步又花一次额度。
        clearRunState()
        return
      }
    } catch {
      // 捞不到就下一轮再试：这里报错会把真正在跑的那次盖成「失败」
    }
    if (ticks >= POLL_MAX_TICKS) {
      clearRunState()
      err.value =
        `「${labelOf(key)}」等了 ${POLL_WINDOW_LABEL}还没有结果，先把界面解开。额度可能已经花掉了 —— ` +
        '先切走再切回来（或刷新一次）看看那一版是不是已经出来了，确认没有再重新生成。'
    }
  }, POLL_MS)
}

/** `consult_runs`（109）回来的一行。 */
interface RunRow {
  id: string
  stage_key: string
  kind: 'draft' | 'decisions' | 'directions'
  status: 'running' | 'done' | 'failed' | 'interrupted'
  error: string | null
  started_at: string
}
const RUN_LABEL: Record<RunRow['kind'], string> = {
  draft: '写正文',
  decisions: '出待定方向',
  directions: '出候选方向',
}

/**
 * 上次没等完的那些分析接回来（`consult_runs`，109，随项目详情一起回来）。
 *
 * 这一页的「正在跑」原来**只活在浏览器内存里**（`runningStage`）：一次分析要几十秒到几
 * 分钟，而服务端那份产出是在 `res.json` 之前就落进对话记录的。于是刷新一次 / 息屏 /
 * 切走那个标签页之后，界面退回「这一步还没有草稿」加一个生成按钮 —— 额度已经扣了、
 * 正文正在写（或已经写完躺在库里），而唯一看得见的动作是再点一次（再扣一次）。
 *
 * 失败/被重启掐掉的那些要把**存下来的上游原文**说出来，并且只说一次（`acked_at`）：
 * 不说的话它和「这一步从没跑过」在屏幕上是同一个样子，而额度是真花了（硬规则 1）；
 * 每次进项目都弹一遍的话弹到第三次就没人看了，于是真中断那次也被划过去。
 */
function resumeRuns(runs: RunRow[]) {
  const notes: string[] = []
  // 失败那些先说：running 那条是「接着等就行」，这条是「额度花了但没东西」。
  const dead = runs.filter(r => r.status === 'failed' || r.status === 'interrupted')
  if (dead.length) {
    const d = dead[dead.length - 1]
    notes.push(
      `⚠ 「${labelOf(d.stage_key)}」上次${RUN_LABEL[d.kind] || '分析'}没跑完：` +
        `${d.error || '没有记下成因'}` +
        (dead.length > 1 ? `（另外还有 ${dead.length - 1} 次也是这样）` : '')
    )
    for (const r of dead) {
      apiPost(`/api/consult/projects/${projectId}/runs/${r.id}/ack`, {}).catch(() => {})
    }
  }
  const running = runs.filter(r => r.status === 'running')
  // 两条以上 = 一键并行那一批还在跑。**不能挂到 `runningStage` 上**（它只装得下一步，
  // 于是另外三步的进度在界面上整个消失，而它们还在花额度），改成接回那个并行面板。
  if (running.length > 1) {
    batchRuns.value = runs
    startBatchPoll()
    notes.push(
      `⏳ 「四看」还有 ${running.length} 步在服务端并行跑着 —— 这一页会接着等，` +
        '每一步跑完自己定稿。别重复点「一键跑完四看」（那会再花 4 次额度）。'
    )
  } else if (running.length === 1 && fullRunning.value) {
    // 整份报告那条链正在跑：那一步的转圈圈照样挂上（这一步的输入框要停掉），但**不报**
    // 「别再点一次」那句话 —— 进度和「后面还有几步」在下面那块面板上，在这儿再说一遍
    // 会把他的注意力引到单步上（他会以为只剩这一步了）。
    attachRun(running[0])
  } else if (running.length === 1) {
    attachRun(running[0])
    notes.push(
      `⏳ 「${labelOf(running[0].stage_key)}」上次那次${RUN_LABEL[running[0].kind] || '分析'}还在服务端跑着` +
        `（${new Date(running[0].started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开始），` +
        '这一页会接着等，出来了自己贴上来 —— 不用再点一次（那会再花一次额度）。'
    )
  }
  if (notes.length) err.value = notes.join('　')
}

// ── 四看一键并行（四步同时跑，跑完各自自动定稿）────────────
//
// 这一批**挂不到 `runningStage` 上** —— 那个变量只装得下一步，塞第二步进去的话第一步的
// 转圈圈直接消失，而它还在花额度。所以并行这一批单独一套状态 + 单独一条轮询，进度一律
// 按服务端的 `consult_runs` 显示（只记在本地的话刷新就没了，而那四次调用照旧在跑）。
const batchRuns = ref<RunRow[]>([])
/**
 * 这块进度面板现在跑的是哪一种批量。**必须分**：两种的代价完全不同（四看是四步同时跑、
 * 谁也没读到另外三份；单步全自动是 AI 替他把那几处取舍定了），而底下那句解释是他事后
 * 唯一看得到的说明 —— 写死四看那句的话，单步全自动跑完之后面板上写着「四步是同时跑的」，
 * 而真正该提醒的「地基是 AI 定的」一个字都没有。
 */
const batchKind = ref<'four-views' | 'stage-auto'>('four-views')
const batchSkipped = ref<Array<{ stageKey: string; label: string; reason: string }>>([])
const batchStarting = ref(false)
/**
 * 这次自动联网的结果。**四种状态（没配 key / 搜到了 / 搜了没结果 / 搜失败）都要显示出来** ——
 * 四种在屏幕上完全一样（四看照样跑完四份通顺的正文），差别只在那几节数字是查来的还是编的，
 * 而唯一的痕迹是定稿之后才出现一次的证据级别（L1? / L2）。
 */
const batchSearch = ref<{ status: 'off' | 'ok' | 'empty' | 'failed'; added: number; note: string } | null>(null)
let batchPoll: number | undefined
const batchActive = computed(() => batchRuns.value.some(r => r.status === 'running'))
const batchDoneCount = computed(() => batchRuns.value.filter(r => r.status !== 'running').length)
const isFourView = computed(() => selected.value?.group === '四看')

function stopBatchPoll() {
  if (batchPoll !== undefined) {
    clearInterval(batchPoll)
    batchPoll = undefined
  }
}

async function runFourViews() {
  // 这一下是 4 次额度 + 4 份自动定稿（定稿不可逆），所以必须先问一句 ——
  // 而且要把「谁都没读到另外三份」写在这里：出来之后四份各自都通顺，没人看得出这件事。
  if (
    !confirm(
      '四看那四步会同时开跑，一共花 5 次 AI 额度（1 次出联网检索词 + 4 步分析）。\n\n' +
        '开跑前先自动联网查一遍资料（十几秒到一分钟，按钮会一直转），搜到的资料算「未人工核对」，' +
        '喂给这四步之后你可以逐条删。\n' +
        '跑完每一步各自自动定稿（定稿之后那一步只读，不能再改）。\n' +
        '因为是同时跑的，四份里谁都没读到另外三份的结论 —— 出来之后对照一遍，哪一步口径不对就单独重跑那一步。\n\n继续？'
    )
  )
    return
  batchStarting.value = true
  batchSearch.value = null
  batchKind.value = 'four-views'
  err.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/four-views/run`, {})
    batchRuns.value = res.runs || []
    // 联网那一段的结论（含「压根没联网」的成因）—— 不显示的话它和「查到 12 条」在屏幕上一样
    batchSearch.value = res.search || null
    // 搜到的资料现在就要进右栏列表（服务端顺带回的）：不更新的话他看到的是「已采纳 0 条」，
    // 而那四步的 prompt 里其实带着这几条 —— 读起来就是「自动联网没生效」。
    // 这里不走 `load()`：它末尾会 `resumeRuns`，把刚开跑的这一批当成「接回来的那次」再报一遍。
    if (res.sources) sources.value = res.sources
    // 跳过了哪几步必须显示（服务端回的 skipped）：只说一句「已开始分析」的话他等的是四份、
    // 出来两份，而那两步（已经定稿 / 已经在跑）在屏幕上看不出任何差别。
    batchSkipped.value = res.skipped || []
    if (res.stages) stages.value = res.stages
    startBatchPoll()
  } catch (e: any) {
    err.value = e?.message || '一键分析没起来'
  } finally {
    batchStarting.value = false
  }
}

/**
 * 「这一步全自动跑完」：出方向 → AI 按建议拍板 → 出正文 → 自动定稿，中间不停。
 *
 * 进度复用四看那块面板（`batchRuns` + `startBatchPoll`）：形状完全一样（一批 run，
 * 转到不转了就 `load()` 收结果）。另写一套轮询的话，跑完之后界面上还是
 * 「这一步还没有草稿 + 生成按钮」，而正文已经在库里了 —— 他会再点一次（再花几次额度）。
 *
 * 确认框里那三句不能省：这一下 **2-3 次额度、AI 替他定取舍、定完稿那一步只读**，
 * 三样都不可逆，而按钮和旁边那颗「开始分析」长得一样。
 */
async function autoRunStage() {
  const key = selected.value?.key
  if (!key) return
  const slow = !isDraftLane.value
  if (
    !confirm(
      `「${labelOf(key)}」这一步会一路跑到定稿，中间不停，共花 ${slow ? 3 : 2} 次 AI 额度` +
        `（1 次出联网检索词${slow ? ' + 1 次出那几处取舍' : ''} + 1 次写正文）。\n\n` +
        (slow
          ? '那几处要拍板的取舍**由 AI 按它自己的建议定**（你不看就没人看）—— 定了哪几处、放弃了什么会写进对话和正文开头的「方法论速览」。\n'
          : '') +
        '跑完自动定稿，而定稿之后这一步只读、不能再改（下游每一步都拿它当依据）。\n\n继续？'
    )
  )
    return
  batchStarting.value = true
  batchSearch.value = null
  batchSkipped.value = []
  batchKind.value = 'stage-auto'
  err.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/auto`, {})
    batchRuns.value = res.run ? [res.run] : []
    // 同 runFourViews：联网那一段的结论（含「压根没联网」的成因）必须显示出来
    batchSearch.value = res.search || null
    if (res.sources) sources.value = res.sources
    if (res.stages) stages.value = res.stages
    startBatchPoll()
  } catch (e: any) {
    err.value = e?.message || '这一步的全自动分析没起来'
  } finally {
    batchStarting.value = false
  }
}

// ── 一键生成整份报告（111）─────────────────────────────────
//
// 这一批是**串行**的：任何时候只有一步在 `consult_runs` 里，所以它挂不到上面那块
// `batchRuns` 面板上（那块面板按「一批 run 全部离开 running」判结束，串行这一批第一步
// 跑完就会被判成「整批跑完」，而后面十几步还在跑、还在花额度）。进度一律读服务端那张
// `consult_batches`（只记在本地的话刷新就没了，而驱动器照旧在跑）。
interface BatchView {
  id: string
  status: 'running' | 'done' | 'failed' | 'interrupted'
  cursor: number
  total: number
  stageKeys: string[]
  labels: string[]
  current: string | null
  error: string | null
  searchNote: string | null
  startedAt: string
  finishedAt: string | null
}
const fullBatch = ref<BatchView | null>(null)
const fullStarting = ref(false)
const fullRunning = computed(() => fullBatch.value?.status === 'running')
/** 还没定稿的那几步 —— 和服务端 `pendingStagesFor` 同一个判据（「没定稿」不是「没跑过」）。 */
const pendingStages = computed(() => stages.value.filter(s => !s.hasEntry))

/**
 * 进度页上那份十四步清单。**「这次自动跑出来的」和「之前就定稿的」必须分开**：
 * 一律画成 ✅ 的话，跑完他看到的是十四份「已完成」，而其中只有几份是没人看过的 AI 自动稿 ——
 * 该回头核的正是那几份，而它们和他上周一句一句核过的那些在屏幕上一模一样。
 */
type FullStepState = 'auto-done' | 'before' | 'running' | 'stopped' | 'queued' | 'idle'
const fullSteps = computed(() => {
  const b = fullBatch.value
  return stages.value.map(s => {
    const pos = b ? b.stageKeys.indexOf(s.key) : -1
    let state: FullStepState
    if (pos < 0) state = s.hasEntry ? 'before' : 'idle'
    else if (pos < (b?.cursor ?? 0)) state = 'auto-done'
    else if (pos === (b?.cursor ?? 0)) state = b?.status === 'running' ? 'running' : 'stopped'
    else state = 'queued'
    // 判据只认服务端的 `cursor`，**不再拿本地 `hasEntry` 复核**：那个数只在这一步真定稿
    // （或者「跑到它时已经有人定稿了」被跳过）之后才往前走，所以它比前端这份阶段清单准。
    // 复核过一版，症状是刚跑完的那几步显示「⚠ 停在这一步，没有定稿」，刷新一次全变 ✅ ——
    // 链跑着的十几分钟里 `stages` 压根没更新过（现在 `refreshBatch` 跟着更新了）。
    return { key: s.key, label: s.label, group: s.group, lane: s.lane, state, no: pos + 1 }
  })
})
/**
 * 这一批之外、之前就定稿的有几步。**进度页顶上必须说这个数**：清单是十四行，而进度是
 * 「1/9」，于是前五行灰勾读起来像是「这一批已经跑完五步、却只有第六步打了绿勾」——
 * 他会以为前面几步失败了（真实情况是它们压根不在这一批里）。
 */
const fullBeforeCount = computed(() => fullSteps.value.filter(s => s.state === 'before').length)
/**
 * 这一批已经跑了多久。**要显示**：每一步几十秒到几分钟，没有这个数的话「正在跑第 3 步」
 * 停在屏幕上五分钟和卡死一模一样，他会刷新页面/重点一次（而那是二十多次额度）。
 * 跟着轮询（6 秒）更新，不另开一条秒级定时器 —— 显示到分钟够了。
 */
const nowTick = ref(Date.now())
const fullElapsed = computed(() => {
  const b = fullBatch.value
  if (!b) return ''
  const end = b.finishedAt ? new Date(b.finishedAt).getTime() : nowTick.value
  const sec = Math.max(0, Math.round((end - new Date(b.startedAt).getTime()) / 1000))
  return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
})

/**
 * 「一键生成整份报告」：把还没定稿的那几步按顺序串着跑完。
 *
 * 确认框里那几句一句都不能省，全是不可逆的：**二十多次额度**（默认配额 10 次/天，
 * 这一下能把当天的全用完）、**慢车道那几处取舍由 AI 按它自己的建议定**、**每一步跑完
 * 自动定稿**（定稿之后那一步只读）。按钮上写「一键生成」四个字的话，这三样在点之前
 * 一个都看不见。
 */
async function runFullReport() {
  const pending = pendingStages.value
  if (!pending.length) return
  // 次数在这儿现算（和服务端 `estimateAiCalls` 同一个算法）：写死一个「约 23 次」的话，
  // 他从断点接着跑那次也看到 23，而那次可能只剩两步。
  const estimate = 1 + pending.reduce((n, s) => n + (s.lane === 'slow' ? 2 : 1), 0)
  const resume = pending.length < stages.value.length
  if (
    !confirm(
      `这一下会把还没定稿的 ${pending.length} 步一路跑完（${pending[0].label} → ${pending[pending.length - 1].label}），` +
        `串着跑，预计花 ${estimate} 次 AI 额度、十几分钟。\n\n` +
        (resume ? `已经定稿的 ${stages.value.length - pending.length} 步不会重跑。\n` : '') +
        '慢车道那几步要拍板的取舍**由 AI 按它自己的建议定**（你不看就没人看），定了哪几处会写进每一步的定稿记录。\n' +
        '每一步跑完自动定稿，定稿之后那一步只读、不能再改。\n' +
        '中间任何一步挂了就停在那里（后面几步不会跑），面板上会说清停在哪、为什么。\n\n继续？'
    )
  )
    return
  fullStarting.value = true
  err.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/full-report`, {})
    fullBatch.value = res.batch || null
    nowTick.value = Date.now()
    // 点完直接把右栏那一页顶上来：不打开的话他点完看到的是原来那屏对话（这一批的第一步
    // 要几十秒才有动静），读起来就是「点了没反应」，而它已经在花额度了。
    openWorkspace('run')
    // 联网那一段的结论跟着 batch 走（`searchNote`）：不显示的话「查了 12 条」和
    // 「压根没联网、数字按常识给的区间」在这十几份正文里读起来一模一样。
    if (res.sources) sources.value = res.sources
    if (res.stages) stages.value = res.stages
    startBatchPoll()
  } catch (e: any) {
    err.value = e?.message || '整份报告没起来'
  } finally {
    fullStarting.value = false
  }
}

/** 那条失败/中断提示他已经看到了，别每次进项目再弹一遍（同 `runs/:rid/ack`）。 */
async function dismissFullBatch() {
  const b = fullBatch.value
  fullBatch.value = null
  // 收起之后那个页签也没了，停在 `run` 上的话右栏是一块空白（读起来像抽屉坏了）
  if (workspaceTab.value === 'run') workspaceTab.value = 'task'
  if (!b || b.status === 'running') return
  await apiPost(`/api/consult/projects/${projectId}/batches/${b.id}/ack`, {}).catch(() => {})
}

function startBatchPoll() {
  stopBatchPoll()
  batchPoll = window.setInterval(() => void refreshBatch(), 6000)
}

/**
 * 刷一次这一批的进度。
 *
 * 跑成了的那条**不在** `GET …/runs` 里（那个接口只回「还在跑的 + 还没跟他说过的失败」），
 * 所以本地这一批里「从列表上消失了」就等于跑完了。反过来失败那条要**保留本地那份原文**：
 * 下一次 `load()` 会把它 ack 掉（说过一次就不再回），那之后它同样从列表上消失 ——
 * 一律当成跑完的话，那一步在面板上变成 ✅，而它一个字都没写出来。
 */
async function refreshBatch() {
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}/runs`)
    const live = (res.runs || []) as RunRow[]
    batchRuns.value = batchRuns.value.map(r => {
      const hit = live.find(l => l.id === r.id)
      if (hit) return hit
      return r.status === 'running' ? { ...r, status: 'done' as const } : r
    })
    // 整份报告那一批的进度一律用服务端这一份覆盖（`cursor` 每跑完一步就落库）。
    // 本地自己数「跑完几步」的话，中间某一步失败之后本地还在往前数，界面上是
    // 「正在跑第 8 步」而驱动器早就停了 —— 剩下几步永远不会跑。
    // **跑完/失败之后不清空**（等他点 ×）：清掉的话停在半路那句成因一闪就没了。
    if (res.batch || fullRunning.value) fullBatch.value = (res.batch as BatchView) || null
    nowTick.value = Date.now()
    // 阶段清单（`hasEntry`）必须跟着这一份一起更新，而且要用**同一个响应**里的那一份：
    // 整份报告那条链一跑十几分钟，这段时间里只更新 `cursor` 的话，刚跑完的那几步在进度页上
    // 是「⚠ 停在这一步，没有定稿」（`fullSteps` 拿 `hasEntry` 反推「跳过的那种」），
    // 而它们已经定稿了 —— 刷一下页面就全变成 ✅，读起来像界面在骗人。
    // 这里**不调 `load()`**：那会连 `briefDraft` 一起覆盖，他正在改的客户资料会被冲掉。
    if (res.stages) stages.value = res.stages
    if (!batchActive.value && !fullRunning.value) {
      stopBatchPoll()
      // 定稿、阶段状态、这一步的对话一起收下：不收的话四步都跑完了而界面上还是
      // 「这一步还没有草稿 + 生成按钮」，他会再点一次（再花一次额度）。
      await load()
      if (selectedKey.value) await loadMessages(selectedKey.value)
    }
  } catch {
    // 捞不到就下一轮再试：在这里报错会把正在跑的那一批显示成失败
  }
}

/**
 * 把界面挂到服务端那一次 run 上（转圈圈 + 接着捞产出）。
 *
 * 三个状态位按 `kind` 分开设：一律当成写正文的话，接回来的「出待定方向」在气泡里显示成
 * 「正在写这一步的正文」，他会等一份永远不会出现的正文（出来的是几处要他拍板的取舍）。
 */
function attachRun(run: RunRow) {
  runningStage.value = run.stage_key
  drafting.value = run.kind === 'draft'
  loadingDirections.value = run.kind === 'directions'
  loadingDecisions.value = run.kind === 'decisions'
  startRunPoll(run.stage_key, { since: run.started_at })
}

/**
 * 这次 POST 报错（或回了 409）之后回头问一句：服务端那一步是不是**还在跑**？
 *
 * 在跑就接着等 —— 挂掉的往往只是「等返回」那一段（网络断一下、代理掐掉长连接、页面热
 * 更新、息屏），而那次 AI 调用照旧在跑、额度照旧扣了、产出照旧会落进对话记录。不问这一句
 * 的话界面上只剩一句报错加一颗生成按钮，他会再点一次（再扣一次），而先前那一版稍后
 * 自己贴出来 —— 于是同一步两版，界面上一个错都不报。409 那条同理（另一个标签页在跑）。
 */
async function recoverRunning(stageKey: string) {
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}/runs`)
    const running = ((res.runs || []) as RunRow[]).find(
      r => r.status === 'running' && r.stage_key === stageKey
    )
    if (!running) return
    attachRun(running)
    err.value =
      `${err.value} —— 不过这一步在服务端还在跑，这一页会接着等它，出来了自己贴上来。` +
      '别再点一次，那会再扣一次 AI 额度。'
  } catch {
    // 连这一句都问不到就算了：这时候那条报错横幅是他唯一的线索，别把它盖掉
  }
}

/** 这条产出是不是轮询已经收下了（按 message id 认）。 */
function adopted(message?: { id?: string } | null): boolean {
  return !!message?.id && messages.value.some(m => m.id === message.id)
}

async function loadMessages(key: string) {
  messages.value = []
  openMsgs.value = {}
  if (!key) return
  loadingMessages.value = true
  try {
    const res = await apiGet(`/api/consult/projects/${projectId}/stages/${key}/messages`)
    if (key !== selectedKey.value) return
    messages.value = res.messages
    restoreArtifact(key)
  } catch (e: any) {
    err.value = e?.message || '加载对话失败'
  } finally {
    loadingMessages.value = false
  }
}

/**
 * 从对话记录里把这一步最后一份产出恢复到右栏。
 *
 * **草稿也要恢复，不能只恢复方向。** 出了草稿 → 切去别处看一眼 → 切回来是常态。
 * 不恢复的话对话里挂着一张「已生成草稿」的卡片、点开右栏是空的，那一步看起来就是
 * 卡死了 —— 而唯一的出路（再点一次「生成」）要再花一次额度。
 *
 * **「已丢弃」也算一份产出**（`kind='discard'` 排在同一条时间线上找最后一条）：只找
 * draft/directions 的话，用户点过「丢弃草稿」，切走再切回来那一版又原样回来了 ——
 * 卡片、正文、置信度全在，看不出它已经被丢过一次。
 */
function restoreArtifact(key: string) {
  if (entryOf(key) || draft.value) return
  const last = [...messages.value]
    .reverse()
    .find(
      m =>
        m.kind === 'directions' ||
        m.kind === 'draft' ||
        m.kind === 'discard' ||
        m.kind === 'decisions' ||
        m.kind === 'decided'
    )
  if (!last || last.kind === 'discard') return
  try {
    const p = JSON.parse(last.payload || '{}')
    // 拍过板的那份最要紧：它是这一步正文的地基，服务端出正文时就读它。不恢复的话
    // 右栏是空的、对话里挂着一条「已确认」，他唯一看得见的入口是「重新分析这一步」——
    // 点下去重出一版，那几处取舍要重问一遍，而已经定的那批就此作废（额度也再花一次）。
    if (last.kind === 'decided') {
      if (!Array.isArray(p.picks)) return
      if (!p.picks.length && !p.noFork) return
      decided.value = { picks: p.picks, noFork: p.noFork || '', sheetMessageId: p.sheetMessageId || '' }
      decidedStageKey.value = key
      return
    }
    // 岔路口那一屏同理要恢复：对话里挂着「已生成待定方向」而右栏是空的话，那一步看起来
    // 卡死了，而他唯一的出路是再点一次（再花一次额度），那几处取舍还得重问一遍。
    if (last.kind === 'decisions') {
      if (!Array.isArray(p.points)) return
      if (!p.points.length && !p.noFork) return
      decisions.value = {
        points: p.points,
        noFork: p.noFork || '',
        missing: Array.isArray(p.missing) ? p.missing : [],
        dropped: Array.isArray(p.dropped) ? p.dropped : [],
        truncated: !!p.truncated,
      }
      decisionsStageKey.value = key
      // 提交时要对着这一条 id 拍板（服务端拒掉配到旧清单上的选择）
      decisionsMsgId.value = last.id
      return
    }
    if (last.kind === 'draft') {
      if (!p.conclusion && !p.body) return
      draft.value = {
        conclusion: p.conclusion || '',
        body: p.body || '',
        rationale: p.rationale || '',
        evidence: p.evidence || '',
        gaps: Array.isArray(p.gaps) ? p.gaps : [],
      }
      draftStageKey.value = key
      draftPreview.value = true
      return
    }
    if (!Array.isArray(p.directions) || !p.directions.length) return
    if (!p.directions[0]?.markdown) return
    directions.value = p.directions
    directionsStageKey.value = key
    directionsVerdict.value = p.verdict || ''
  } catch {}
}

async function sendChat() {
  const text = chatText.value.trim()
  if (!text || !selected.value) return
  // 这一步正在分析时不发（回车这条路也走这里）：见 stageBusy 的注释 ——
  // 发出去也不会进正在写的那一版，而回来的草稿看不出少听了一句。
  if (stageBusy.value) return
  // 已定稿的步骤只读（见 stageEntry）。回车这条路必须也挡：输入条虽然换掉了，
  // 但键盘事件在旧 DOM 上仍可能触发，而服务端回的是一句 409，读起来像故障。
  if (stageLocked.value) return
  const key = selected.value.key
  
  // 乐观更新（Optimistic UI）：立即将用户的输入上屏，不等待后端响应
  const tempId = 'temp_user_' + Date.now()
  messages.value.push({
    id: tempId,
    role: 'user',
    kind: 'text',
    content: text,
    payload: '',
    created_at: new Date().toISOString()
  })
  chatText.value = ''
  
  nextTick(() => {
    if (chatScrollRef.value) chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  })
  
  chatting.value = true
  err.value = ''
  chatTruncated.value = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/chat`, { text })
    if (key !== selectedKey.value) return
    
    // 收到响应后，移除刚才乐观更新的那条临时消息，用后端的真实数据（res.user 和 res.reply）替换
    messages.value = messages.value.filter(m => m.id !== tempId)
    messages.value = [...messages.value, res.user, res.reply]
    
    chatDropped.value = res.dropped || 0
    chatTruncated.value = !!res.truncated
    stages.value = res.stages
    
    nextTick(() => {
      if (chatScrollRef.value) chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
    })
  } catch (e: any) {
    err.value = e?.message || '发送失败'
    messages.value = messages.value.filter(m => m.id !== tempId)
  } finally {
    chatting.value = false
  }
}

/**
 * 出候选方向（慢车道的老路）。**界面上已经没有入口了**，这个函数留着只是为了不动
 * `/directions` 那条接口和它的方向卡（老项目里已经出过的那几张照样要恢复得出来）——
 * 别顺手给它接回一个按钮：它不读顾问拍板的那几条，出来的四份方案地基是 AI 自己定的，
 * 而四份各自都通顺，挑的时候看不出它替你定过什么（那正是「先定方向」要防的事）。
 *
 * `key` 在发请求**之前**就取好，返回时如果用户已经切走
 * 就只留服务端那份 stages，不往界面上挂 —— 原来这里取的是返回时的
 * `selected.value.key`，切走之后这几个方向会挂在**新**阶段的名下，
 * 选一个方向再定稿就存到别的阶段去了，而两步都没有任何报错。
 * 这一步要跑几分钟，中途切去看别的阶段是常事，所以必须挡住。
 */
async function loadDirections(key?: string) {
  const stageKey = key || selected.value?.key
  if (!stageKey) return
  loadingDirections.value = true
  runningStage.value = stageKey
  err.value = ''
  staledNote.value = []
  startRunPoll(stageKey)
  let failed = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${stageKey}/directions`, {})
    // 轮询已经把这一批收下了（那次返回来得晚）：再走一遍就是同一批方向卡贴两张
    if (adopted(res.message)) return
    // stages 照样收下：服务端那一轮（`round`）已经计上了，本地不更新的话界面上这一步
    // 看起来还是「一次都没跑过」
    stages.value = res.stages
    if (stageKey !== selectedKey.value) {
      err.value = `「${labelOf(stageKey)}」的候选方向已经出好了（额度已经花掉），但你已经切到别的阶段 —— 切回去就能看到。`
      return
    }
    directions.value = res.directions
    directionsStageKey.value = stageKey
    directionsVerdict.value = res.verdict || ''
    draftTruncated.value = !!res.truncated
    draftDiscussion.value = res.discussion || null
    draft.value = null
    draftStageKey.value = ''
    // 同 makeDraft：联网那条记录也要当场贴上去
    // 这两条都走 pushMessage：轮询可能已经把 🌐 那条贴上去了（见 startRunPoll）
    pushMessage(res.searchMessage)
    pushMessage(res.message)

    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出方向失败'
    failed = true
  } finally {
    clearRunState()
  }
  if (failed) await recoverRunning(stageKey)
}

/**
 * 慢车道动笔之前先问方向（岔路口）。**不产出正文、不定稿**，只把「这一步有哪几处得你拍板」
 * 摆出来。`key` 的取法和 `loadDirections` 同一条理由（切走之后不能挂到新阶段名下）。
 */
async function loadDecisions(key?: string) {
  const stageKey = key || selected.value?.key
  if (!stageKey) return
  loadingDecisions.value = true
  runningStage.value = stageKey
  err.value = ''
  staledNote.value = []
  startRunPoll(stageKey)
  closeWorkspaceForRun()
  let failed = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${stageKey}/decisions`, {})
    // 轮询先捞到了就不再收一遍（否则对话里两张一样的卡片）
    if (adopted(res.message)) return
    stages.value = res.stages
    if (stageKey !== selectedKey.value) {
      err.value = `「${labelOf(stageKey)}」的待定方向已经出好了（额度已经花掉），但你已经切到别的阶段 —— 切回去就能看到。`
      return
    }
    decisions.value = {
      points: res.points || [],
      noFork: res.noFork || '',
      missing: res.missing || [],
      dropped: res.dropped || [],
      truncated: !!res.truncated,
    }
    decisionsStageKey.value = stageKey
    // 新的一版清单和旧的选择配不上（`d2` 已经是另一个问题），所以选择跟着清空 ——
    // 留着的话那几个高亮读起来像他已经在这一版上选过了。
    picks.value = {}
    pickNotes.value = {}
    decisionsMsgId.value = res.message?.id || ''
    decided.value = null
    decidedStageKey.value = ''
    draftDiscussion.value = res.discussion || null
    // 同 makeDraft：联网那条记录也要当场贴上去
    // 这两条都走 pushMessage：轮询可能已经把 🌐 那条贴上去了（见 startRunPoll）
    pushMessage(res.searchMessage)
    pushMessage(res.message)
    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出待定方向失败'
    failed = true
  } finally {
    clearRunState()
  }
  if (failed) await recoverRunning(stageKey)
}

/**
 * 提交这几处拍板，紧接着按它出这一步的正文。
 *
 * 两件事必须连在一起：这一屏只是取舍清单，停在这里的话他手上什么产出都没有，而界面上
 * 那几个高亮读起来很像「已经在推进了」。所以提交成功就直接接着出正文（出正文那一次才
 * 花 AI 额度，提交本身不花）。
 *
 * 提交失败**不接着出正文**：没有那条 `decided` 记录，服务端会拒掉出正文那一步（400），
 * 而两次报错叠在一起读起来像出正文本身坏了。
 */
async function applyPicks() {
  const key = decisionsStageKey.value || selected.value?.key
  if (!key || !decisions.value || applying.value) return
  if (!decisionsMsgId.value) {
    err.value =
      '这一版待定方向的记录 id 没拿到（页面可能是热更新过的）—— 切走再切回来一次，' +
      '或者点一次「重新分析这一步」，不然这几个选择会被配到别的清单上。'
    return
  }
  applying.value = true
  err.value = ''
  let ok = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/decisions/apply`, {
      sheetMessageId: decisionsMsgId.value,
      picks: decisions.value.points.map(p => ({
        id: p.id,
        label: picks.value[p.id] || '',
        note: (pickNotes.value[p.id] || '').trim(),
      })),
    })
    stages.value = res.stages
    if (res.message && key === selectedKey.value) messages.value = [...messages.value, res.message]
    if (key !== selectedKey.value) {
      err.value = `「${labelOf(key)}」那几处取舍已经记下了，但你已经切到别的阶段 —— 切回去点「按定好的方向出正文」。`
      return
    }
    decided.value = { picks: res.picks || [], noFork: res.noFork || '', sheetMessageId: res.sheetMessageId || '' }
    decidedStageKey.value = key
    decisions.value = null
    decisionsStageKey.value = ''
    ok = true
  } catch (e: any) {
    err.value = e?.message || '提交这几处取舍失败'
  } finally {
    applying.value = false
  }
  if (ok) await makeDraft(key)
}

/**
 * 「让 AI 按它的建议定这几处」= 不花额度的自动拍板，紧接着出正文（那一次花 1 次）。
 *
 * 存在的理由是全自动出整份报告：慢车道 8 步动笔之前都要这一条记录，而没人在屏幕前点卡片。
 * 这里先把它做成一个按钮，是为了让他能**先手动核一遍 AI 会怎么定** —— 直接上全自动的话，
 * 他第一次看到这几处是在十四步跑完之后。
 *
 * `fallbacks`（AI 连建议都没给准、代码拿了第一个选项）必须单独说出来：
 * 混进那句「已按建议定完」的话，掷硬币定的那几处和有理由的选择长得一模一样。
 */
async function autoPicks() {
  const key = decisionsStageKey.value || selected.value?.key
  if (!key || !decisions.value || applying.value) return
  applying.value = true
  err.value = ''
  autoPickNote.value = ''
  let ok = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/decisions/auto`, {})
    stages.value = res.stages
    if (key !== selectedKey.value) {
      err.value = `「${labelOf(key)}」那几处取舍 AI 已经替你定了，但你已经切到别的阶段 —— 切回去点「按定好的方向出正文」。`
      return
    }
    pushMessage(res.message)
    decided.value = { picks: res.picks || [], noFork: res.noFork || '', sheetMessageId: res.sheetMessageId || '' }
    decidedStageKey.value = key
    decisions.value = null
    decisionsStageKey.value = ''
    ok = true
    // 这不是报错，是降级要出声（硬规则 1）：fallback 那几处 AI 的建议指不到唯一一个选项，
    // 用的是第一个 —— 它和有理由的选择在正文里长得一模一样。
    const total = (res.picks || []).length
    autoPickNote.value = res.fallbacks
      ? `AI 替你定了这一步的 ${total} 处取舍，其中 ${res.fallbacks} 处它连建议都没给准、用的是第一个选项 —— ` +
        `正文出来后先核这几处（对话里那条拍板记录上标着 ⚠）。不同意就重跑这一步和它的下游。`
      : total
        ? `AI 按它自己的建议替你定了这一步的 ${total} 处取舍，你还没核过 —— 正文开头的「方法论速览」会写明这几处不是你定的。`
        : ''
  } catch (e: any) {
    err.value = e?.message || '让 AI 替你定这几处失败'
  } finally {
    applying.value = false
  }
  if (ok) await makeDraft(key)
}

/**
 * 采纳一个候选方向 = **直接定稿**，没有第二道确认。
 *
 * 原来「采纳」只是把它摊进右栏的草稿编辑器，还要再点一次「完成定稿」才落库。那一步
 * 什么都没多问（不是确认框，只是多一次点击），而它带来一种真的丢失：右栏那一版
 * **不落库**，切走或刷新之后靠 `restoreArtifact` 从对话记录恢复，而方向卡那条记录里
 * 没有「他选了哪一个」—— 恢复出来的是四张卡片重新让他挑一遍，看起来就像他那次采纳
 * 压根没发生。所以确认不是藏起来，是写在按钮上：定稿之后这一步只读。
 */
async function pickDirection(d: Direction) {
  const others = (directions.value || []).filter(x => x !== d).map(x => x.title)
  draft.value = {
    conclusion: `${d.tagline}｜${d.identity}`,
    body: d.markdown,
    rationale: directionsVerdict.value,
    evidence: others.length ? `选它就等于放弃：${others.join('、')}` : '',
    gaps: [],
  }
  
    // 在对话流中插入一条“用户选择了该方向”的消息
    messages.value.push({
      id: 'msg_pick_' + Date.now(),
      role: 'user',
      kind: 'text',
      content: `我选择了方向：**${d.title}**\n\n<blockquote>${d.tagline}｜${d.identity}</blockquote>`,
      payload: '',
      created_at: new Date().toISOString()
    })
  
  nextTick(() => {
    if (chatScrollRef.value) chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  })

  draftStageKey.value = directionsStageKey.value
  draftPreview.value = true
  openWorkspace('task')
  // 定稿失败时 draft 留在右栏（saveDraft 只在成功那条路上清掉它），他能在那儿看到
  // 「完成定稿」再试一次 —— 所以这里不吞错，err 那条横幅就是他唯一的线索。
  await saveDraft()
}

/** 出草稿（快车道 / 内容方案）。`key` 的取法和 `loadDirections` 同一条理由。 */
async function makeDraft(key?: string) {
  const stageKey = key || selected.value?.key
  if (!stageKey) return
  // 右栏已经有一版就先问一句：新的一版是整个盖进去的，他在编辑器里改的那些没有任何
  // 地方留着（草稿不落库），而两次都显示成功。
  if (draft.value && draftStageKey.value === stageKey) {
    if (!confirm('重出一版会覆盖右栏现在这一版（包括你改过的部分），并再花 1 次 AI 额度。继续？')) return
  }
  drafting.value = true
  runningStage.value = stageKey
  err.value = ''
  staledNote.value = []
  startRunPoll(stageKey)
  closeWorkspaceForRun()
  let failed = false
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${stageKey}/draft`, {})
    // 同 loadDirections：轮询先捞到了就不再收一遍（否则对话里两张一样的卡片）
    if (adopted(res.message)) return
    stages.value = res.stages
    if (stageKey !== selectedKey.value) {
      err.value = `「${labelOf(stageKey)}」的草稿已经出好了（额度已经花掉），但你已经切到别的阶段 —— 切回去就能看到。`
      return
    }
    draft.value = res.draft
    draftStageKey.value = stageKey
    draftTruncated.value = !!res.truncated
    draftDiscussion.value = res.discussion || null
    // 联网那条记录排在产出之前贴上去：不贴的话那句话要等下一次刷新才出现，而「这次没联网」
    // 和「查到 8 条」在正文里读起来一模一样（见 Msg.kind 的 'search'）。
    // 这两条都走 pushMessage：轮询可能已经把 🌐 那条贴上去了（见 startRunPoll）
    pushMessage(res.searchMessage)
    pushMessage(res.message)
    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出草稿失败'
    failed = true
  } finally {
    clearRunState()
  }
  // `clearRunState()` 之后才问（见 recoverRunning）：在 catch 里问的话刚挂上去的转圈圈
  // 会被紧接着的 finally 清掉，于是那次还在跑的分析又变成孤儿。
  if (failed) await recoverRunning(stageKey)
}

/**
 * 这一步还没有任何产出，该显示那个「生成」按钮。
 *
 * **进入阶段不再自动跑一次**（原来的 `autoRun`）：那一下是在用户还没说一句话的时候
 * 就花掉一次额度，出来的一版只按客户资料写 —— 而他进这一步往往正是想先交代两句
 * （「这家的重点是加盟商，不是终端」）。自动跑掉的那一版读起来完全正常，所以他不会
 * 重出（要再花一次额度），那句交代就永远没进过任何 prompt。
 * 现在改成他点，对话先聊、聊完再点，`discussionBlock` 就真的带上那几条。
 */
const noArtifact = computed(
  () =>
    !(draft.value && draftStageKey.value === selectedKey.value) &&
    !(directions.value && directionsStageKey.value === selectedKey.value)
)
const showRunCta = computed(
  () => !!selected.value && selected.value.unlocked && !stageLocked.value && noArtifact.value && !runningStage.value
)

// 「修改定稿」那个按钮和它的 editEntry 已经删掉：定稿现在是一次性的（服务端
// `requireOpenStage` 也不收第二版）。留着按钮的话点下去是把定稿抄进草稿编辑器、
// 改半天再点「完成定稿」才收到一句 409 —— 改动没地方留，而中间每一步都像成功。

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
      // Provide defaults to prevent backend breakage if it still requires them
      confidence: 'mid',
      aiOpportunities: []
    })
    entries.value = res.entries
    stages.value = res.stages
    staledNote.value = res.staled || []
    // 定稿那条记录进对话。只在还停在这一步时追加：切走了就挂到别的步的对话上了
    // （下次进那一步会从库里正确读到，这里挂错的话是当场就看得见的一条假记录）
    if (res.message && draftStageKey.value === selectedKey.value) {
      messages.value = [...messages.value, res.message]
    }
    draft.value = null
    draftStageKey.value = ''
    directions.value = null
    directionsStageKey.value = ''
    draftTruncated.value = false
    draftDiscussion.value = null
    
    // 定稿完成后自动关闭右侧工作区抽屉
    workspaceOpen.value = false
  } catch (e: any) {
    err.value = e?.message || '定稿失败'
  } finally {
    savingEntry.value = false
  }
}

/**
 * 丢弃这一版草稿 / 这几个候选方向。
 *
 * 本地清掉之外**必须往对话里记一条**：草稿存在对话那张卡片的 payload 里，不记的话切走
 * 再切回来 `restoreArtifact` 会把它恢复出来（见那个函数的注释）。所以这次请求失败要
 * 出声 —— 用户看到的是「丢弃成功」，而下次进这一步那一版还在。
 */
async function discardDraft(kind: 'draft' | 'directions' = 'draft') {
  const key = (kind === 'draft' ? draftStageKey.value : directionsStageKey.value) || selectedKey.value
  if (!key) return
  const what = kind === 'draft' ? '这一版草稿' : '这几个候选方向'
  if (!confirm(`丢弃${what}？它没有进知识库，丢了之后要再花一次 AI 额度才能重新出一版。`)) return
  if (kind === 'draft') {
    draft.value = null
    draftStageKey.value = ''
    draftTruncated.value = false
    draftDiscussion.value = null
  } else {
    directions.value = null
    directionsStageKey.value = ''
    directionsVerdict.value = ''
  }
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/stages/${key}/draft/discard`, { kind })
    if (res.message && key === selectedKey.value) messages.value = [...messages.value, res.message]
  } catch (e: any) {
    err.value = `丢弃没记进对话（${e?.message || '未知原因'}）—— 切回这一步时那一版会重新出现，到时候再丢一次。`
  }
}

/**
 * 哪几张产出卡片已经作废：后面跟了一条「已丢弃」，而中间没有新的产出或定稿。
 * 不标的话对话里留着一张「已生成草稿 · 查看 →」，点开右栏是空的 —— 读起来像界面坏了。
 */
const discardedMsgs = computed(() => {
  const out: Record<string, boolean> = {}
  let pending: string[] = []
  for (const m of messages.value) {
    if (m.kind === 'draft' || m.kind === 'directions') pending.push(m.id)
    else if (m.kind === 'discard') { pending.forEach(id => { out[id] = true }); pending = [] }
    else if (m.kind === 'entry') pending = []
  }
  return out
})

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

/**
 * 「这条自动抓的我点开看过了」→ 升级成 L1。
 *
 * 必须有这个动作：自动抓的那几条否则只有两条出路（删掉 / 永远挂着「未人工核对」，
 * 于是每一步的结论都停在 L1? 且模型一直给区间）。核过一条按一条。
 */
async function verifySource(id: string) {
  searchErr.value = ''
  try {
    const res = await apiPost(`/api/consult/projects/${projectId}/sources/${id}/verify`, {})
    sources.value = res.sources || []
    adoptNote.value = '这条已经记成「你核对过的」（L1）。后面出的结论会按 L1 引用它，不再标「未人工核对」。'
  } catch (e: any) {
    searchErr.value = e?.message || '确认失败'
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


// 和服务端 `sourceLevelFor` 一份逻辑两处写。这里必须跟着分岔：自动搜来的那几条撑不到 L1
// （没人核对过），说成 L1 的话他会拿这一版去做决策，而它可能全靠一页软文。
const pickedSources = computed(() => sources.value.filter(s => !s.auto))
const autoSources = computed(() => sources.value.filter(s => s.auto))

const levelNow = computed(() => {
  if (sources.value.some(s => !s.auto)) return 'L1 联网检索'
  if (sources.value.length) return 'L1? 自动联网（未人工核对）'
  if ((project.value?.brief || '').trim()) return 'L2 客户资料'
  return 'L3 模型内置知识（只给区间）'
})

/**
 * 这次分析新搜回来的那几条（等待区里铺开给他先看）。差集见 `preRunSourceIds`。
 * 只在**等待期**用：跑完之后右栏那份清单才是权威的（那边按采纳/自动分组）。
 */
const freshSources = computed(() => {
  const before = preRunSourceIds.value
  if (!before) return []
  return sources.value.filter(s => !before.has(s.id))
})

/**
 * 展开了摘要的那几条资料（id）。
 *
 * 摘要（`snippet`）是搜回来的正文片段，**也正是真进 prompt 的那段字**（`sourcesBlock`）。
 * 界面上不给看的话，「我核过了」只能凭标题按，而标题永远看起来是相关的：实测自动搜
 * 「吉盛伟邦 番禺店 消费者投诉 维权」回来一篇市场监管的**通用**案例汇编，通篇没提这个品牌，
 * 而那一行的标题、域名、日期全都体面。原文站点打不开时（政府站偶发 502）这段字是
 * 唯一还核得动的东西 —— 没有它，那一条只能凭感觉留着或删掉，而留着就是 L1? 进正文。
 */
const expandedSources = ref(new Set<string>())
function toggleSnippet(id: string) {
  const next = new Set(expandedSources.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedSources.value = next
}

/** 操法那几条里带着 `**`（它们原样进 prompt）。等待区是纯文本列表，不剥的话满屏星号。 */
const plain = (s: string) => s.replace(/\*\*/g, '')

const selectedNo = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  return i < 0 ? '00' : String(i + 1).padStart(2, '0')
})

const laneTag = (lane: string) => (lane === 'fast' ? '快' : lane === 'plan' ? '案' : '慢')
const isDraftLane = computed(() => !!selected.value && selected.value.lane !== 'slow')

const md = (s: string) => renderMarkdown(s)

function openWorkspace(tab?: 'task' | 'kb' | 'run') {
  if (tab) workspaceTab.value = tab
  workspaceOpen.value = true
}

/**
 * 一跑起来就把右栏收起来（出结果时 `openWorkspace('task')` 会自己开回来）。
 *
 * 抽屉是盖在对话上的，而这几分钟里它摆的是**已经作废的那一屏**（刚提交的那份取舍清单、
 * 或者上一版草稿），盖住的恰好是唯一有动静的地方：对话末尾那句「正在写这一步的正文」和
 * 输入条上那句「这一步正在分析，先不接受输入」。留着不收的话他对着一屏纹丝不动的旧内容，
 * 只能理解成刚才那次点击没生效 —— 于是回头再点一次，而那是又一次真实的 AI 调用。
 */
function closeWorkspaceForRun() {
  workspaceOpen.value = false
}
</script>

<template>
  <div class="desk editorial-theme">
    <!-- 装饰背景 -->
    <div class="bg-elements">
      <div class="bg-overlay"></div>
      <div class="grid-bg"></div>
    </div>

    <!-- 两条提示叠在一个绝对定位的容器里，不各自 absolute top:0 —— 后者会让下面那条
         压在上面那条身上，两句话只看得见一句（而看不见的那句正是降级提示）。 -->
    <div v-if="err || autoPickNote" class="banner-stack">
      <div v-if="err" class="alert-banner">
        <span>{{ err }}</span>
        <button class="alert-close" @click="err = ''" title="关闭提示">×</button>
      </div>
      <!-- AI 替他拍板那条降级提示自己一条：跟 err 合用的话，紧接着跑的出正文会把它清掉 -->
      <div v-if="autoPickNote" class="alert-banner warn">
        <span>{{ autoPickNote }}</span>
        <button class="alert-close" @click="autoPickNote = ''" title="关闭提示">×</button>
      </div>
    </div>
    
    <!-- Left Navigation: Floating Island -->
    <nav class="sidebar-island" :class="{ hidden: !sidebarOpen }">
      <div class="sidebar-header">
        <div class="header-left">
          <button class="btn-back" @click="router.push('/consult/projects')">←</button>
          <div class="brand-title">{{ project?.brand_name || 'Brand Workbench' }}</div>
        </div>
        <button class="btn-toggle-sidebar" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? '收起侧边栏' : '展开侧边栏'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <line x1="9" x2="9" y1="3" y2="21"/>
          </svg>
        </button>
      </div>
      
      <!-- 有一份问卷没提交就一直挂在这儿。进了工作台还不说的话，跳过那一下就是静默的：
           后面十二步照样跑完，只是那些结论是照缺料的资料出的，读起来完全正常。 -->
      <button
        v-if="intake && intake.questions.length"
        class="intake-pending"
        @click="router.push(`/consult/projects/${projectId}/intake`)"
      >
        <span class="ip-title">📋 补料问卷没提交</span>
        <span class="ip-sub">
          {{ intake.questions.length }} 题，已填 {{ intakeFilled }} —— 现在的结论是照缺料的资料出的
        </span>
        <span class="ip-cta">去填 →</span>
      </button>

      <div class="rail-scroll">
        <div class="rail-group" v-for="g in groups" :key="g.name">
          <div class="rail-title">{{ g.name }}</div>
          <button
            v-for="s in g.items"
            :key="s.key"
            class="rail-item"
            :class="{ active: s.key === selectedKey, locked: !s.unlocked, done: s.hasEntry }"
            @click="select(s.key)"
            :title="!sidebarOpen ? s.label : ''"
          >
            <span class="dot">
              <template v-if="s.hasEntry">✓</template>
              <template v-else-if="!s.unlocked">🔒</template>
              <template v-else>·</template>
            </span>
            <span class="rail-label">{{ s.label }}</span>
            <span v-if="s.stale" class="stale-dot" title="上游结论已变，建议重跑">⚠</span>
          </button>
        </div>
      </div>

      <!-- 导出方案：全定稿才亮。没定完时不隐藏而是灰着说还差几步 ——
           藏起来的话用户不知道有这个功能，也不知道差的是哪几步。 -->
      <div class="rail-footer" v-if="stages.length">
        <!-- 一键生成整份报告（111）。放在「导出方案」上面：这两颗是一对（先生成整份、
             再导出整份），而这一颗是项目级的 —— 挂在某一步的对话里的话，他要先挑对步骤
             才找得到它。跑着的时候按钮换成进度文案并禁用：不禁的话连点两次被 409 挡住
             （额度没花，但读起来像功能坏了）。 -->
        <button
          v-if="pendingStages.length"
          class="btn-full-report"
          :disabled="fullStarting || fullRunning || anyRunning"
          @click="runFullReport()"
        >
          <template v-if="fullStarting">⏳ 正在联网查资料…</template>
          <template v-else-if="fullRunning">⏳ 正在跑（{{ fullBatch?.cursor }}/{{ fullBatch?.total }}）</template>
          <template v-else>⚡ 一键生成整份报告（剩 {{ pendingStages.length }} 步）</template>
        </button>
        <div v-if="pendingStages.length" class="export-sub">
          串着跑完剩下 {{ pendingStages.length }} 步，约 {{ 1 + pendingStages.reduce((n, s) => n + (s.lane === 'slow' ? 2 : 1), 0) }} 次 AI 额度 ·
          取舍由 AI 定 · 每步跑完自动定稿
        </div>
        <button class="btn-export" :disabled="!canExport || exporting" @click="exportReport">
          {{ exporting ? '正在合并…' : '⬇ 导出方案' }}
        </button>
        <div class="export-sub">
          <template v-if="canExport">十四步合并成一份 md，正文原样搬，不重新生成</template>
          <template v-else>还差 {{ stages.length - decidedCount }} 步定稿（现在导出的会是半份方案）</template>
        </div>
      </div>
    </nav>

    <!-- Main Chat Stream -->
    <main class="chat-stream">
      <!-- Global toggle for sidebar when hidden -->
      <div v-if="!sidebarOpen" class="global-actions-bar">
        <button class="btn-global-sidebar-toggle" @click="sidebarOpen = true" title="展开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <button class="btn-back-to-work" @click="router.push('/consult/projects')" title="返回工作台">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
      </div>

      <div class="chat-scroll-area" ref="chatScrollRef">
        <!-- 整份报告那条链的一行状态条（111）。详情在右栏那一页（`workspaceTab==='run'`），
             这里只留一行，但**停在半路那句成因要留在这条上** —— 藏到右栏里的话他不点就看不到，
             而那时候剩下几步是真的没跑，和「他压根没点过这颗按钮」一模一样（硬规则 1）。 -->
        <div v-if="fullBatch" class="full-strip" :class="fullBatch.status">
          <strong>
            {{ fullRunning ? '⏳ 正在生成整份报告' : fullBatch.status === 'done' ? '✅ 整份报告跑完了' : '⚠ 整份报告停在半路' }}
          </strong>
          <span class="full-strip-num">{{ fullBatch.cursor }}/{{ fullBatch.total }} 步</span>
          <!-- 正在跑哪一步要点名：只显示「8/14」的话他不知道现在该等哪一步 -->
          <span v-if="fullRunning" class="full-strip-cur">正在跑「{{ fullBatch.labels[fullBatch.cursor] || '…' }}」· 已跑 {{ fullElapsed }}</span>
          <span v-else-if="fullBatch.error" class="full-strip-err">{{ fullBatch.error }}</span>
          <button class="link-btn" @click="openWorkspace('run')">查看进度 →</button>
          <button v-if="!fullRunning" class="alert-close" title="知道了，收起这条" @click="dismissFullBatch()">×</button>
        </div>

        <!-- Editorial Stage Hero -->
        <div v-if="selected" class="stage-intro-card">
          <div class="intro-header">
            <div class="intro-title-group">
              <span class="step-badge">STEP {{ selectedNo }}</span>
              <h2 class="stage-title">{{ selected.label }}</h2>
              <p class="stage-question">{{ selected.question }}</p>
            </div>
          </div>
          
          <details class="intro-methodology" v-if="selected.method?.length || selected.deliverables?.length">
            <summary class="methodology-trigger">
              <span class="trigger-icon">
                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </span>
              <span class="trigger-text">查看阶段目标与思考框架</span>
            </summary>
            <div class="methodology-content">
              <div v-if="selected.method?.length" class="sys-section">
                <strong>💡 该怎么想</strong>
                <ol>
                  <li v-for="(m, i) in selected.method" :key="i">{{ m }}</li>
                </ol>
              </div>
              <div v-if="selected.deliverables?.length" class="sys-section">
                <strong>📦 产出清单</strong>
                <ul>
                  <li v-for="(d, i) in selected.deliverables" :key="i">{{ d }}</li>
                </ul>
              </div>
            </div>
          </details>
        </div>

        <!-- 定稿之后中间这一栏不再是聊天，而是这一步的咨询报告本身（只读）。
             理由：定稿是一次性的，这一步之后既不能改也不能再聊（见 stageEntry），
             那么留着一条输入框和一串讨论记录只会让人以为还能在这里推进它。 -->
        <div v-if="stageLocked && stageEntry && selected" class="report">
          <div class="report-head">
            <span class="report-tag">✅ 已定稿 · 只读</span>
            <span class="report-meta">
              第 {{ stageEntry.version }} 版 · 置信度 {{ stageEntry.confidence }} ·
              证据级别 {{ stageEntry.source_level }} ·
              {{ (stageEntry.updated_at || '').slice(0, 10) }}
            </span>
          </div>
          <!-- stale 要说清「报告是按旧上游写的」，而不只是一个 ⚠：定稿锁定之后这一步
               没有重跑入口，不说的话他只看到一个警告图标，不知道该拿它怎么办。 -->
          <div v-if="stageEntry.stale" class="report-warn">
            ⚠ 上游结论后来改过，这一份是按<strong>改之前</strong>的上游写的。这一步已锁定、没有重跑入口 ——
            引用它时自己核一眼有没有和上游冲突。
          </div>

          <h3 class="report-h">一句话结论</h3>
          <p class="report-conclusion">{{ stageEntry.conclusion }}</p>

          <h3 class="report-h">完整报告</h3>
          <div v-if="stageEntry.body" class="md report-body" v-html="md(stageEntry.body)"></div>
          <!-- 正文为空要出声：一份只有一句结论的定稿和「正文没加载出来」在屏幕上一样 -->
          <div v-else class="report-empty">
            这一版没有正文，只定了上面那一句结论（当时定稿时正文是空的）。
          </div>

          <template v-if="entryAiOpps.length">
            <h3 class="report-h">本步的 AI 赋能机会</h3>
            <ul class="report-ai"><li v-for="(o, i) in entryAiOpps" :key="i">{{ o }}</li></ul>
          </template>
        </div>

        <!-- Chat messages。定稿之后收进一个折叠块 —— 直接不渲染的话，那一步的讨论
             记录看起来是被删掉了（它还在库里，只是这一栏换成了报告）。 -->
        <component :is="stageLocked ? 'details' : 'div'" class="msg-log">
          <summary v-if="stageLocked" class="msg-log-summary">
            查看定稿前的讨论记录（{{ messages.length }} 条，只读）
          </summary>
        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
          <!-- 丢弃那条不挂 AI 头像：挂上去就成了「AI 说它把草稿丢了」，而那是用户自己点的 -->
          <div class="msg-avatar" v-if="m.role === 'assistant' && m.kind !== 'discard'">AI</div>
          <div class="msg-content">
            <div v-if="m.kind === 'text'" class="msg-bubble" :class="{ md: m.role === 'assistant', 'user-pick': m.role === 'user' && m.content.startsWith('我选择了方向') }" v-html="m.role === 'assistant' ? md(m.content) : m.content"></div>
            <!-- 定稿：直接把定的内容摊在对话里（正文不抄一份，见 entryToText 的注释） -->
            <div v-else-if="m.kind === 'entry'" class="msg-bubble md entry-msg">
              <div v-html="md(m.content)"></div>
              <button class="link-btn" @click="openWorkspace()">在右侧查看完整正文 →</button>
            </div>
            <!-- 拍板：摊在对话里（正文的地基就是这几条）。**不做成那张「查看 →」的产出卡片**
                 —— 认不出的 kind 会落到下面那个 v-else，被画成「已生成候选方向」，点开右栏
                 根本不是方向卡。 -->
            <div v-else-if="m.kind === 'decided'" class="msg-bubble md decided-msg" v-html="md(m.content)"></div>
            <!-- 丢弃：单独一条细提示，不做成 AI 气泡（那是这一步的状态，不是 AI 说的话） -->
            <div v-else-if="m.kind === 'discard'" class="discard-note">{{ m.content }}</div>
            <!-- 这一次分析之前自动联网的结论。**一定要显示出来**：没配 key / 搜失败 /
                 搜到了在正文里一模一样（都是一份通顺的分析），差别只在那几节数字是查来的
                 还是按常识给的区间。也不做成 AI 气泡 —— 那是这次调用的过程记录。 -->
            <div v-else-if="m.kind === 'search'" class="search-note" v-html="md(m.content)"></div>
            <div
              v-else
              class="msg-artifact"
              :class="{ discarded: discardedMsgs[m.id] }"
              @click="discardedMsgs[m.id] ? null : openWorkspace()"
            >
              <div class="artifact-icon">{{ discardedMsgs[m.id] ? '🗑' : '📄' }}</div>
              <div class="artifact-meta">
                <!-- 每种 kind 都要有自己的名字：认不出的那种会被画成「已生成候选方向」，
                     而点开右栏根本不是方向卡 —— 读起来像那一版丢了 -->
                <strong>{{ m.kind === 'draft' ? '已生成草稿' : m.kind === 'decisions' ? '已列出待定方向（还没定）' : '已生成候选方向' }}</strong>
                <!-- 作废的卡片要明说点不开：留着「查看 →」的话点了什么都不发生 -->
                <span>{{ discardedMsgs[m.id] ? '这一版已丢弃，右侧工作区里没有它了' : '点击在右侧工作区查看详情' }}</span>
              </div>
              <div v-if="!discardedMsgs[m.id]" class="artifact-action">查看 →</div>
              <div v-else class="artifact-action muted">已丢弃</div>
            </div>
          </div>
        </div>
        </component>

        <!-- 一键并行那一批的进度。**和选中的是哪一步无关**（四步同时在跑），所以它挂在
             对话流末尾、不跟着 `selected` 走：只在选中那一步显示的话，其余三步的进度和
             失败原文在界面上整个消失，而它们各自都真花了一次额度。 -->
        <div v-if="batchRuns.length" class="batch-panel">
          <div class="batch-head">
            <strong>{{ batchKind === 'stage-auto' ? '⚡ 这一步全自动跑完' : '⚡ 四看一键并行' }}</strong>
            <span>{{ batchDoneCount }}/{{ batchRuns.length }} 步跑完</span>
            <button v-if="!batchActive" class="alert-close" title="收起这块" @click="batchRuns = []; batchSkipped = []; batchSearch = null">×</button>
          </div>
          <!-- 联网那一段的结论。**四种状态都要在这儿出声**（没配 key / 搜到了 / 搜了没结果 /
               搜失败）：四种在屏幕上一模一样 —— 四看照样跑完四份通顺的正文，差别只在那几节
               数字是查来的还是编的。搜到了也要说「未人工核对」，不然他会当成核实过的事实。 -->
          <div v-if="batchSearch" class="batch-row" :class="{ warn: batchSearch.status !== 'ok' }">
            <span class="batch-ico">{{ batchSearch.status === 'ok' ? '🌐' : '⚠' }}</span>
            <span class="batch-net">自动联网</span>
            <span class="batch-note">{{ batchSearch.note }}</span>
          </div>
          <div v-for="r in batchRuns" :key="r.id" class="batch-row">
            <span class="batch-ico">{{ r.status === 'running' ? '⏳' : r.status === 'done' ? (entryOf(r.stage_key) ? '✅' : '📄') : '⚠' }}</span>
            <button class="link-btn" @click="select(r.stage_key)">{{ labelOf(r.stage_key) }}</button>
            <span class="batch-note">
              <template v-if="r.status === 'running'">正在写…（十几秒到几分钟，这一页会自己更新）</template>
              <!-- 「跑完了但没定稿」必须和「已定稿」分开说：截断/超长那两种情况服务端
                   故意不自动定稿（草稿留在那一步的对话里），一律写「已定稿」的话他永远
                   不会回去看那一版，而那一步其实还空着。 -->
              <template v-else-if="r.status === 'done'">
                {{ entryOf(r.stage_key) ? '已自动定稿' : '草稿出来了，但没有自动定稿 —— 点进去看一眼再定' }}
              </template>
              <template v-else>{{ r.error || '没跑成，没记下成因' }}</template>
            </span>
          </div>
          <div v-for="s in batchSkipped" :key="s.stageKey" class="batch-row muted">
            <span class="batch-ico">–</span>
            <button class="link-btn" @click="select(s.stageKey)">{{ s.label }}</button>
            <span class="batch-note">这次没跑：{{ s.reason }}</span>
          </div>
          <!-- 这句解释按批量的种类分（见 batchKind）：两种的代价完全不同，而这是他事后
               唯一看得到的说明。 -->
          <p v-if="batchKind === 'stage-auto'" class="batch-foot">
            这一步是<strong>全自动</strong>跑的：那几处要拍板的取舍是 <strong>AI 按它自己的建议定的</strong>，
            你还没核过（定稿那条记录里每一处都标着 ⚠）。往下每一步都拿这一版当依据，
            所以先核一眼结论和那几张表，不对就重跑这一步。
          </p>
          <p v-else class="batch-foot">
            四步是<strong>同时</strong>跑的，所以每一份都没读到另外三份的结论（每一步的定稿记录里都写了这句）。
            全部出来之后对照一遍，哪一步口径不对就单独重跑那一步。
          </p>
        </div>

        <!-- 还没有产出时，这一步唯一的推进入口就是这个按钮（原来是进阶段自动跑，
             见 showRunCta 的注释）。放在对话末尾而不是顶上：先聊几句再点是这次改动的
             全部目的，按钮跟着对话往下走，聊到哪儿它就在哪儿。 -->
        <div v-if="showRunCta && !chatting" class="run-cta">
          <div class="run-cta-body">
            <div class="run-cta-title">
              {{ hasDecided ? '方向已经定了，还没出正文' : isDraftLane ? '这一步还没有草稿' : '这一步还没开始分析' }}
            </div>
            <p class="run-cta-sub">
              <!-- 每种状态都要说清那个按钮会干什么。慢车道「开始分析」**不写正文**，
                   不说的话他点完看到一屏选项，会以为分析失败了（或者以为这就是产出）。 -->
              <template v-if="hasDecided">
                右栏那 {{ decided!.picks.length }} 处取舍已经由你定了，正文会照它写
                （正文出来还要你定稿）。
              </template>
              <template v-else-if="!isDraftLane">
                这一步<strong>先问后写</strong>：「开始分析」出来的是几处要你拍板的取舍
                （竞品挑哪几家、定位取哪个角色这类），<strong>还不是正文</strong>；定完之后
                才照你定的方向写一份完整的。
              </template>
              <template v-else>
                点击下方按钮让 AI 开始分析并生成本步的草稿内容。
              </template>
            </p>
            <!-- 「这一版会按第几级证据写」必须在点下去**之前**说，而且要在主区说。
                 出来之后 L1 和 L3 的正文在屏幕上一模一样（一样的表格、一样的结论、
                 一样的自信），而那个级别只在定稿之后的气泡里出现一次 —— 那时候这一步
                 已经锁定了。
                 原来这里并排一颗「🌐 联网查资料 →」（跳右栏抽屉自己搜），已经去掉：
                 分析现在**一律先自动联网**，那颗按钮留着读起来像「不点它就不联网」。
                 手动搜那条路还在右栏「全局知识库」里，它的作用变成「补一条机器没搜到的、
                 而且是我核过的（L1）」。**多花的那 1 次额度要写在这里** —— 不说的话他按
                 10 次/天算着用，实际一半就没了，而报错是一句突然冒出来的 429。 -->
            <p class="run-cta-lv">
              点下去会先自动联网查资料（多花 1 次额度），这一版会标成 <strong>{{ levelNow }}</strong
              ><template v-if="sources.length">（现有 {{ sources.length }} 条联网资料）</template>
            </p>
          </div>
          <!-- 一个入口。原来慢车道还并排一个「AI 直接出候选方向」（`/directions`：AI 把那几处
               取舍替他定了，再拿四份写好的方案给他挑），已经去掉 —— 摆着它就是给一条绕过
               拍板的路，而那四份各自都通顺，挑的时候看不出它替你定过什么。接口还在，老项目
               里已经出过的方向卡照样恢复得出来。 -->
          <button v-if="hasDecided" class="btn-run-cta" :disabled="anyRunning" @click="makeDraft()">
            按定好的方向出这一步的正文 →
          </button>
          <button
            v-else
            class="btn-run-cta"
            :disabled="anyRunning"
            @click="isDraftLane ? makeDraft() : loadDecisions()"
          >
            {{ isDraftLane ? '生成这一步的草稿 →' : hasSheet ? '重新分析这一步（重出一版取舍）' : '开始分析 →' }}
          </button>
          <!-- 四看的一键入口只挂在四看那四步上（`isFourView`）：挂到四问/四大成上的话，
               点下去跑的是另外四步，而那几步在界面上毫无动静（它们是慢车道，要先拍板）。
               按钮上必须写明「4 次额度 + 自动定稿」：这一下不可逆，而它和旁边那颗
               单步生成按钮长得一样。 -->
          <button
            v-if="isFourView"
            class="btn-batch-cta"
            :disabled="anyRunning || batchStarting"
            @click="runFourViews()"
          >
            <!-- 点下去之后这个 POST 要等十几秒到一分钟（先自动联网），所以按钮文案必须换成
                 「正在联网查资料」：不换的话那段时间里它和「卡住了」一模一样，他会刷新页面
                 （而联网那一次额度已经花了）。 -->
            {{ batchStarting ? '⏳ 正在联网查资料…（十几秒，别关页面）' : '⚡ 一键跑完四看（先联网查资料 · 4 步同时跑 · 共 5 次额度 · 跑完自动定稿）' }}
          </button>
          <!-- 「这一步全自动跑完」。四看那四步上不挂（它们有自己的一键入口，`isFourView`），
               `hasDecided` 时也不挂 —— 那时候取舍已经是他定的了，再给一颗写着「AI 替你定」
               的按钮会让他以为刚拍的板不算。按钮上必须写明额度和「AI 替你定取舍」：
               这一下不可逆，而它和上面那颗单步按钮长得一样。 -->
          <button
            v-if="!isFourView && !hasDecided"
            class="btn-batch-cta"
            :disabled="anyRunning || batchStarting"
            @click="autoRunStage()"
          >
            {{
              batchStarting
                ? '⏳ 正在联网查资料…（十几秒，别关页面）'
                : isDraftLane
                  ? '⚡ 这一步全自动跑完（联网 + 写正文 · 2 次额度 · 跑完自动定稿）'
                  : '⚡ 这一步全自动跑完（取舍交给 AI 定 · 3 次额度 · 跑完自动定稿）'
            }}
          </button>
          <!-- 「一键生成整份报告」也挂在这里（左栏底部那颗是同一个 `runFullReport`）：左栏缺省
               是收起的，所以那颗按钮他很可能压根没见过 —— 而这块 CTA 是他每一步都会看到的地方。
               样式必须和旁边那两颗分开（`full`：实线 + 更重的字）：三颗都长一样的话，本来想点
               「一键跑完四看」（5 次额度）的那一下会点成二十多次额度的这一颗。
               按钮上写明剩几步、几次额度、取舍由 AI 定、每步自动定稿 —— 全是不可逆的。 -->
          <button
            v-if="pendingStages.length"
            class="btn-batch-cta full"
            :disabled="anyRunning || batchStarting || fullStarting"
            @click="runFullReport()"
          >
            <template v-if="fullStarting">⏳ 正在联网查资料…（十几秒，别关页面）</template>
            <template v-else-if="fullRunning">⏳ 整份报告正在跑（{{ fullBatch?.cursor }}/{{ fullBatch?.total }}）—— 进度看右栏</template>
            <template v-else>
              ⚡ 一键生成整份报告（剩 {{ pendingStages.length }} 步串着跑 ·
              约 {{ 1 + pendingStages.reduce((n, s) => n + (s.lane === 'slow' ? 2 : 1), 0) }} 次额度 ·
              取舍由 AI 定 · 每步跑完自动定稿）
            </template>
          </button>
        </div>

        <!-- 正在跑 / 正在对话都显示思考气泡 -->
        <div v-if="(runningStage && runningStage === selectedKey) || chatting" class="msg assistant">
          <div class="msg-avatar">AI</div>
          <div class="msg-content">
            <div class="msg-bubble loading-bubble">
              <div class="loading-progress-bar">
                <div class="loading-progress-inner"></div>
              </div>
              <div class="loading-title">
                <!-- 慢车道现在也走 /draft（照拍好的方向写正文），所以这句不能再按车道分 ——
                     按车道写的话「正在出候选方向」会挂在一次真正在写正文的调用上。 -->
                {{ chatting ? '思考中' : loadingDecisions ? '正在分析' : loadingDirections ? '正在出候选方向' : (isDraftLane ? '正在写这一步的草稿' : '正在写这一步的正文') }}
              </div>
              <div v-if="!chatting" class="loading-sub">
                <!-- 这个数写少了的后果不是不好看：他等到写着的那个时间就认定卡住了，
                     去刷新（正在跑的那一版变成孤儿）或者再点一次生成（同一步花两次额度）。
                     原来写「30–60 秒」而实测是 260–300 秒（思维链两万多 token）；
                     现在服务端关掉了思维链（GatewayOptions.noThinking），实测回到
                     十几秒到一分钟。**关不掉的接入点会退回四分钟量级**（服务端日志里会
                     喊一句），所以这里给的是区间的上限，不是那个好看的下限。 -->
                <strong>通常十几秒到 1 分钟</strong>（这一步要写六节带表格的正文）。别刷新，也不用再点一次生成
              </div>

              <!-- 等这一分钟的时候屏幕上得有**这一步真要用的东西**，不是一句小贴士：
                   这三块（刚搜回来的资料 / 这一步按哪几条操法想 / 出来之后要核哪几项）
                   他反正都得看一遍，铺在这里等于把空转的时间变成预习。
                   全部来自已经在内存里的数据（`stages` 那两列 + 轮询刷回来的 `sources`），
                   没有新接口、也不猜进度 —— 写成假的百分比的话，那个条走到 90% 停住
                   和真卡住一模一样。 -->
              <div v-if="!chatting" class="wait-brief">
                <div v-if="freshSources.length" class="wait-sec">
                  <div class="wait-h">🌐 这次新搜到 {{ freshSources.length }} 条，已经喂进去了</div>
                  <ul class="wait-list">
                    <li v-for="sc in freshSources.slice(0, 6)" :key="sc.id">
                      <a :href="sc.url" target="_blank" rel="noopener">{{ sc.title || sc.url }}</a>
                      <span class="wait-dim">{{ sc.domain }}<template v-if="sc.published"> · {{ sc.published }}</template></span>
                    </li>
                  </ul>
                  <div v-if="freshSources.length > 6" class="wait-dim">
                    还有 {{ freshSources.length - 6 }} 条，在右栏「资料」里
                  </div>
                </div>
                <div v-if="selected?.method?.length" class="wait-sec">
                  <div class="wait-h">💡 它这一步按这几条想</div>
                  <ul class="wait-list">
                    <li v-for="(m, i) in selected.method" :key="i">{{ plain(m) }}</li>
                  </ul>
                </div>
                <div v-if="selected?.deliverables?.length" class="wait-sec">
                  <div class="wait-h">✅ 出来之后你要核这几项</div>
                  <ul class="wait-list">
                    <li v-for="(d, i) in selected.deliverables" :key="i">{{ plain(d) }}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- 别的步在跑：这一步的按钮是灰的，不说清哪一步在跑的话看起来像界面坏了 -->
        <div v-else-if="runningStage" class="other-running">
          ⏳ 「{{ labelOf(runningStage) }}」正在分析中，结果会出现在那一步里。
          这一步要等它跑完（同时跑两个会互相顶掉），跑完回来再点一次这一步的生成按钮。
        </div>

        <!-- Bottom spacing for capsule -->
        <div class="chat-bottom-spacer"></div>
      </div>

      <!-- 定稿之后这一步只读：输入条整个换掉，不是把它变灰 —— 灰着的输入框读起来是
           「界面坏了 / 网络卡了」，他会刷新、会反复点发送。 -->
      <div v-if="stageLocked" class="locked-capsule-wrapper">
        <div class="locked-capsule done">
          <span>✅ 这一步已定稿 </span>
          <button v-if="nextStage" class="btn-next-stage" @click="select(nextStage!.key)">
            继续「{{ nextStage.label }}」→
          </button>
          <span v-else class="lc-sub">十四步都定稿了</span>
        </div>
      </div>


      <!-- Floating Input Capsule -->
      <div class="input-capsule-wrapper" v-else-if="selected && selected.unlocked && !showRunCta">
        <!-- 为什么停掉输入，要写在他眼皮底下：只把发送键变灰的话，他会以为是网络卡了，
             刷新页面（正在跑的那一版就此变成孤儿）或者反复点发送。 -->
        <!-- <div v-if="stageBusy" class="capsule-note">
          ⏳ 这一步正在分析，先不接受输入 —— 现在发的话<strong>进不了</strong>正在写的这一版
          （它开写的那一刻就把对话取完了）。等它出来再说，那句话会进下一版。
        </div> -->
        <div v-show="!stageBusy" class="input-capsule" :class="{ busy: stageBusy }">
          <textarea
            v-model="chatText"
            rows="1"
            :disabled="stageBusy"
            :placeholder="stageBusy ? '正在分析这一步，等它出来再说…（打的字不会丢）' : '对现在的资料、方向或草稿有什么意见？在这里告诉 AI... (Shift+Enter 换行，Enter 发送)'"
            @keydown.enter.exact.prevent="chatText.trim() && sendChat()"
            @input="adjustTextareaHeight"
            ref="chatInputRef"
          ></textarea>
          <div class="capsule-actions">
            <!-- 一律写成 `makeDraft()`：`@click="makeDraft"` 会把 MouseEvent 当第一个
                 参数传进去，那个位置现在是 stageKey，拼出来的是一条打不通的 URL -->
            <!-- 还没有产出时这两个小按钮收起来：那时候对话末尾那个 CTA 就是入口，
                 两个按钮并排而其中一个写着「重新生成」，读起来像已经生成过一版了。 -->
            <!-- 慢车道这个小按钮分两种：拍过板的重出正文（照那几条写），没拍过板的
                 重新分析一次（出取舍）。写成一个「重新生成」都走 makeDraft 的话，慢车道
                 没拍板那次会收到一句 400，读起来像界面坏了。 -->
            <button
              v-if="!showRunCta && (isDraftLane || hasDecided)"
              class="btn-ghost small"
              :disabled="drafting || stageBusy"
              :title="runningStage && runningStage !== selectedKey ? `「${labelOf(runningStage)}」正在分析中` : ''"
              @click="makeDraft()"
            >
               {{ isDraftLane ? '重新生成草稿' : '按定好的方向重出正文' }}
            </button>
            <button
              v-else-if="!showRunCta"
              class="btn-ghost small"
              :disabled="loadingDecisions || stageBusy"
              :title="runningStage && runningStage !== selectedKey ? `「${labelOf(runningStage)}」正在分析中` : ''"
              @click="loadDecisions()"
            >
               重新分析这一步
            </button>
            <button class="btn-send" :disabled="chatting || stageBusy || !chatText.trim()" @click="sendChat">
              ↑
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="selected && !selected.unlocked" class="locked-capsule-wrapper">
        <div class="locked-capsule">
          🔒 请先完成前置阶段：{{ selected.missing.join('、') }}
        </div>
      </div>

      <!-- 右下角再来一颗「下一步」。和居中那颗（在上面那条已定稿的胶囊里）是两个入口，
           故意重复：居中那颗压在正文最后几行上，而报告有十几屏，滚到底想读的正是那几行。
           这一颗**还会把视口滚回顶上**（见 goStage）：换过去之后落在底部的话，阶段标题
           和「该怎么想」全在视口上面，读起来是「点了下一步却什么都没换」。

           左下角那颗「上一步」是同一件事的反向：他是**顺着读**这份报告的，读到一半想
           回头核上一章的结论时，唯一的出口在左边那条窄栏里（窄屏上还是收起来的）。
           两颗都只在定稿态出现 —— 没定稿时底部中间是那条输入胶囊，翻页按钮并排摆过去
           会压在它身上。

           **必须放在上面那条 v-if / v-else-if 链之外**：夹在链子中间的话
           `v-else-if="selected && selected.unlocked"`（输入条）就找不到它的 v-if 了，
           于是已定稿的阶段上一边是只读报告、一边冒出一条能打字的输入框 ——
           在那里说的话既进不了任何 prompt 也改不动结论，而它看起来完全正常。 -->
      <button
        v-if="stageLocked && prevInOrder"
        class="btn-prev-corner"
        @click="goStage(prevInOrder.key)"
      >
        ← 上一步「{{ prevInOrder.label }}」
      </button>
      <button
        v-if="stageLocked && nextInOrder"
        class="btn-next-corner"
        @click="goStage(nextInOrder.key)"
      >
        下一步「{{ nextInOrder.label }}」→
      </button>
    </main>

    <!-- Right Workspace Drawer -->
    <aside class="drawer-workspace" :class="{ open: workspaceOpen }">
      <div class="drawer-header">
        <div class="drawer-tabs">
          <!-- 这一批跑着的时候这个页签排在最前面，并且带一个进度数字：他会切去看已经出来的
               那几份，页签上不带数字的话「跑到第几步了」要点一下才知道。 -->
          <button
            v-if="fullBatch"
            :class="{active: workspaceTab === 'run', running: fullRunning}"
            @click="workspaceTab = 'run'"
          >
            {{ fullRunning ? `⏳ 生成进度 ${fullBatch.cursor}/${fullBatch.total}` : fullBatch.status === 'done' ? '✅ 生成进度' : '⚠ 生成进度' }}
          </button>
          <button :class="{active: workspaceTab === 'task'}" @click="workspaceTab = 'task'">当前工作区</button>
          <button :class="{active: workspaceTab === 'kb'}" @click="workspaceTab = 'kb'">全局知识库</button>
        </div>
        <button class="btn-close" @click="workspaceOpen = false">×</button>
      </div>

      <div class="drawer-body">
        <!-- 「一键生成整份报告」的进度页（111）。十四步全列出来，而**「这次自动跑的」和
             「之前就定稿的」画得不一样**（`fullSteps` 的 state）：一律 ✅ 的话跑完他看到的是
             十四份「已完成」，而该回头核的只有那几份没人看过的自动稿。 -->
        <div class="workspace-content run-page" v-show="workspaceTab === 'run'" v-if="fullBatch">
          <div class="run-hero" :class="fullBatch.status">
            <div class="run-hero-title">
              {{ fullRunning ? '⏳ 正在生成整份报告' : fullBatch.status === 'done' ? '✅ 整份报告跑完了' : '⚠ 整份报告停在半路' }}
            </div>
            <div class="run-hero-num">已跑完 {{ fullBatch.cursor }}<span>/{{ fullBatch.total }} 步</span></div>
            <div class="full-bar"><i :style="{ width: `${Math.round((fullBatch.cursor / Math.max(1, fullBatch.total)) * 100)}%` }"></i></div>
            <!-- 「这一批只有 N 步」必须写出来：下面那份清单是十四行，不说的话前面几行灰勾
                 会被当成「这一批跑过、但没打绿勾」= 前面几步失败了。 -->
            <div class="run-hero-sub">
              这一批只跑<strong>还没定稿的 {{ fullBatch.total }} 步</strong><template v-if="fullBeforeCount">，
              另外 {{ fullBeforeCount }} 步之前就定稿了，这次不重跑</template>。
            </div>
            <!-- 已跑多久：每一步几十秒到几分钟，没有这个数的话「正在跑第 3 步」停在屏幕上
                 五分钟和卡死一模一样，他会重点一次（那是二十多次额度）。 -->
            <div class="run-hero-sub">
              已跑 {{ fullElapsed }}<template v-if="fullRunning"> · 一步几十秒到几分钟 · 关掉页面也照跑，回来接得上</template>
            </div>
          </div>

          <!-- 停在半路那句原文照搬（服务端已经把「第几步、为什么、后面几步没跑」写全了）：
               合成一句「生成失败」的话他只会一路重点那颗按钮，每次都真跑一遍。 -->
          <p v-if="fullBatch.error" class="run-err">{{ fullBatch.error }}</p>

          <div class="run-steps">
            <div v-for="st in fullSteps" :key="st.key" class="run-step" :class="st.state">
              <!-- 这一批里的第几步。**不在这一批里的那几行不给号**（显示「—」）：都给号的话
                   十四行连号，而顶上写着「1/9」，两个数对不上，他只能理解成前面几步没成功。 -->
              <span class="run-step-no">{{ st.no > 0 ? st.no : '—' }}</span>
              <span class="run-step-ico">
                <template v-if="st.state === 'auto-done'">✅</template>
                <template v-else-if="st.state === 'before'">✓</template>
                <template v-else-if="st.state === 'running'">⏳</template>
                <template v-else-if="st.state === 'stopped'">⚠</template>
                <template v-else-if="st.state === 'queued'">·</template>
                <template v-else>–</template>
              </span>
              <button class="run-step-label link-btn" @click="select(st.key)">{{ st.label }}</button>
              <span class="run-step-note">
                <template v-if="st.state === 'auto-done'">本批第 {{ st.no }} 步 · 已自动定稿 —— 没有人看过，回头核一眼</template>
                <template v-else-if="st.state === 'before'">之前就定稿了，不在这一批里</template>
                <!-- 慢车道那一步要打两次模型（出取舍 + 写正文），说出来他才知道为什么这一步等得久 -->
                <template v-else-if="st.state === 'running'">
                  本批第 {{ st.no }} 步 · {{ st.lane === 'slow' ? '正在定那几处取舍，然后写正文…' : '正在写正文…' }}
                </template>
                <template v-else-if="st.state === 'stopped'">停在这一步，没有定稿（草稿可能留在这一步的对话里）</template>
                <template v-else-if="st.state === 'queued'">排队中</template>
                <template v-else>这次不在清单里</template>
              </span>
            </div>
          </div>

          <!-- 自动联网那一段的结论（含「压根没联网」的成因）：这十几份正文里「查过资料」和
               「按常识给的区间」读起来一模一样。 -->
          <p v-if="fullBatch.searchNote" class="run-foot">{{ fullBatch.searchNote }}</p>
          <p class="run-foot warn">
            这几步是<strong>全自动</strong>跑的：慢车道那几处要拍板的取舍由 <strong>AI 按它自己的建议定</strong>，
            每一步的定稿记录里都标着 ⚠。先按顺序核一遍再导出。
          </p>

          <!-- 「接着跑」就是重新 POST 一次（待跑清单按「哪几步还没定稿」现算，所以天然从
               断点继续）。没有这颗按钮的话他唯一想得到的动作是回去一步一步手点。 -->
          <button
            v-if="!fullRunning && pendingStages.length"
            class="btn-batch-cta"
            :disabled="fullStarting"
            @click="runFullReport()"
          >
            {{ fullStarting ? '⏳ 正在联网查资料…（十几秒，别关页面）' : `▶ 接着跑剩下的 ${pendingStages.length} 步（已定稿的不重跑）` }}
          </button>
          <button v-if="!fullRunning" class="btn-ghost small run-dismiss" @click="dismissFullBatch()">知道了，收起这一页</button>
        </div>

        <div class="workspace-content" v-show="workspaceTab === 'task'">
          <!-- 补料问卷不在这里填，只有 /consult/projects/:id/intake 那一页有（入口在左栏那条
               黄色提示 + 「客户原始资料」下面那一行）。两套问卷 UI 迟早会漂：这份抽屉里的
               当初就少了「全部必填」和逐题暂存，用它填完提交，界面上和填那一页一模一样。 -->
          <template v-if="selected">
            <!-- 草稿编辑器 -->
            <div v-if="draft && draftStageKey === selected.key" class="draft-box">
              <div class="draft-head">
                <span class="draft-tag">✏️ 编辑草稿</span>
              </div>
              <!-- 重出一版的中途：新的一版回来会整个盖掉这里。不说的话他在这个编辑器里
                   接着改，改完发现自己的改动没了，而两边都没报错。定稿也停掉 ——
                   这时候定的是旧那一版，紧接着新的一版盖进来，看起来像那次定稿没保存上。 -->
              <div v-if="stageBusy" class="draft-busy">
                ⏳ 正在重出一版。它回来会<strong>覆盖</strong>这里的内容（包括你改过的部分）——
                想留住现在这一版，先把文字复制出去。
              </div>
              <div v-if="draft.gaps.length" class="inline-gaps">
                <strong>资料缺失提醒：</strong>
                <ul><li v-for="(g, i) in draft.gaps" :key="i">{{ g }}</li></ul>
              </div>
              <label class="dfield">
                <span class="dlabel">结论摘要</span>
                <textarea v-model="draft.conclusion" rows="5"></textarea>
              </label>
              <div class="dfield">
                <div class="dlabel-bar">
                  <span class="dlabel">正文详情</span>
                  <!-- <div class="dlabel-actions">
                    <button class="link-btn" :class="{ active: !draftPreview }" @click="draftPreview = false">✏️ 编辑模式</button>
                    <button class="link-btn" :class="{ active: draftPreview }" @click="draftPreview = true">👁️ 预览模式</button>
                  </div> -->
                </div>
                <div v-if="draftPreview" class="md md-preview" v-html="md(draft.body)"></div>
                <textarea v-else v-model="draft.body" rows="20"></textarea>
              </div>
              
              <div class="draft-actions">
                <button
                  class="btn-primary"
                  :disabled="savingEntry || stageBusy || !draft?.conclusion?.trim()"
                  :title="stageBusy ? '正在重出一版，等它出来再决定定哪一版' : ''"
                  @click="saveDraft"
                >
                  {{ savingEntry ? '保存中…' : '完成定稿' }}
                </button>
                <!-- 只清本地状态是假成功：那一版存在对话卡片的 payload 里，切回来会被恢复 -->
                <button class="btn-ghost" :disabled="stageBusy" @click="discardDraft('draft')">丢弃草稿</button>
              </div>
            </div>

            <!-- 候选方向 -->
            <div v-else-if="directions && directionsStageKey === selected.key" class="dirs">
              <div class="dirs-head">
                <span class="draft-tag">候选方向 (请选择其一)</span>
              </div>
              <div class="dirs-note">
                选中的那一个<strong>直接定稿</strong>：这一步随即锁定、只读，也没有重跑入口。
                想先聊聊再定，就回左边的对话区。
              </div>
              <!-- 同草稿那边：正在重出一批，这几张卡片马上会被换掉。这时候「采纳」的是
                   旧那一批里的一个，新的一批一到就把右栏换成新卡片，他刚采纳的那一版
                   连痕迹都没有（`pickDirection` 只改本地状态）。 -->
              <div v-if="stageBusy" class="draft-busy">
                ⏳ 正在重出一批方向。它回来会<strong>换掉</strong>这几张卡片，所以先别采纳 ——
                想要现在这一批里的某个，等它出来之后从对话记录里翻回来。
              </div>
              <div v-for="(d, i) in directions" :key="i" class="dir-card">
                <div class="dir-top">
                  <span class="dir-idx">{{ i + 1 }}</span>
                  <h3>{{ d.title }}</h3>
                </div>
                <div class="md dir-md" v-html="md(d.markdown)"></div>
                <!-- 点下去就定稿了，没有第二道确认（见 pickDirection）。所以按钮上必须
                     写明不可逆 —— 定稿之后这一步只读、也没有重跑入口。 -->
                <div class="draft-actions">
                  <button class="btn-primary" :disabled="stageBusy || savingEntry" @click="pickDirection(d)">
                    {{ savingEntry ? '定稿中…' : '就用这个方向 · 直接定稿' }}
                  </button>
                </div>
              </div>
              <div v-if="directionsVerdict" class="verdict">
                <div class="brief-title">🧭 研判建议</div>
                <div class="md" v-html="md(directionsVerdict)"></div>
              </div>
              <div class="draft-actions">
                <button class="btn-ghost" :disabled="stageBusy" @click="discardDraft('directions')">这几个都不要</button>
              </div>
            </div>

            <!-- 待定方向（岔路口）：动笔之前先把「得你拍板的取舍」摆出来。
                 这一屏不产出正文、不定稿，所以下面必须写清「还没有任何东西被定下来」——
                 一屏卡片读起来很像已经在推进这一步了。 -->
            <div v-else-if="decisions && decisionsStageKey === selected.key" class="dirs">
              <div class="dirs-head">
                <span class="draft-tag">待定方向 （需要你拍板）</span>
              </div>
              <div v-if="decisions.truncated" class="draft-busy">
                ⚠ 模型这次的返回被截断了 —— 下面这几处可能不全（断在半句上的清单和写完的长得一样）。
              </div>
              <!-- 丢掉的那几处必须说出来：少一处的卡片和「这一步只有两处要定」一模一样，
                   而那一处最后是 AI 自己定的。 -->
              <div v-if="decisions.dropped.length" class="inline-gaps">
                <strong>这几处 AI 没给全，已经丢掉（等于它自己会替你定，留意一下）：</strong>
                <ul><li v-for="(d, i) in decisions.dropped" :key="i">{{ d }}</li></ul>
              </div>
              <div v-if="!decisions.points.length" class="dirs-note">
                AI 认为这一步没有需要你拍板的取舍：{{ decisions.noFork }}
                <br />不同意的话在左边对话里说清楚该在哪儿分岔，再点一次「重新分析这一步」。
              </div>
              <div v-for="(p, i) in decisions.points" :key="p.id" class="dir-card">
                <div class="dir-top">
                  <span class="dir-idx">{{ i + 1 }}</span>
                  <h3>{{ p.question }}</h3>
                </div>
                <!-- 标签要说出界面上那份清单的名字，后面还要接上那一条的原文：光一个
                     「操法 2」既指不到任何看得见的东西、也没说自己是什么，用户只能跳过它 ——
                     而它唯一的作用就是核出「清单里压根没有这一条」的岔路口（那种是模型
                     造的，卡片上和真的一样）。 -->
                <div class="dec-meta">
                  <span v-if="p.methodRef" class="dec-tag">{{ methodLabel(p.methodRef) }}</span>
                  <span v-if="methodText(p.methodRef)" class="dec-method" :title="methodText(p.methodRef)">{{ methodText(p.methodRef) }}</span>
                  <span v-if="p.basis" class="dec-basis">依据：{{ p.basis }}</span>
                </div>
                <button
                  v-for="(o, j) in p.options"
                  :key="j"
                  type="button"
                  class="dec-opt"
                  :class="{ chosen: picks[p.id] === o.label }"
                  :disabled="stageBusy || applying"
                  @click="picks[p.id] = o.label"
                >
                  <div class="dec-opt-label">
                    {{ String.fromCharCode(65 + j) }}. {{ o.label }}
                    <span v-if="picks[p.id] === o.label" class="dec-chosen-tag">✓ 已选</span>
                  </div>
                  <div v-if="o.detail" class="dec-opt-detail">{{ o.detail }}</div>
                  <!-- 代价是这张卡片的重点：没有它三个选项就是「都挺好」，
                       随手点一个等于 AI 替你定了 -->
                  <div class="dec-opt-cost">放弃：{{ o.cost }}</div>
                </button>
                <div v-if="p.recommend" class="dec-recommend">🧭 AI 的建议：{{ p.recommend }}</div>
                <!-- 补充说明：都不合适时的出口是「在对话里说清再重出一版」，不是在这里
                     自己写一个答案 —— 自己写的答案配不上任何「放弃什么」，进正文之后
                     那一段就是 AI 编的。所以这里只收对选项的补充。 -->
                <label class="dec-note">
                  <span>补充说明（可空，最多 300 字，会跟着这条选择进正文）</span>
                  <textarea
                    v-model="pickNotes[p.id]"
                    rows="2"
                    :disabled="stageBusy || applying"
                    placeholder="例：选 B，但别提加盟商；口径按客户上次会议那句"
                  ></textarea>
                </label>
              </div>
              <div v-if="decisions.missing.length" class="inline-gaps">
                <strong>这几件是缺事实、不是取舍，要去问客户：</strong>
                <ul><li v-for="(m, i) in decisions.missing" :key="i">{{ m }}</li></ul>
              </div>
              <!-- 提交 = 把这几条记成这一步正文的地基，紧接着出正文（那一次才花额度）。
                   每一处都必须选：留空的那几处 AI 会在写正文时自己定，而定完的正文
                   读起来一样完整（服务端同一道闸在 applyDecisions）。 -->
              <div class="dirs-note">
                点「就按这几个走」之后：这几条会记进对话，然后<strong>直接接着出这一步的正文</strong>
                （出正文花 1 次 AI 额度，提交本身不花）。正文出来还要你在这儿定稿，<strong>还不是定稿</strong>。
                都不合适的话别硬选一个 —— 在左边对话里说清该在哪儿分岔，再点一次「重出一版待定方向」。
              </div>
              <div class="draft-actions">
                <button
                  class="btn-primary"
                  :disabled="applying || stageBusy || (!!decisions.points.length && pendingPicks > 0)"
                  @click="applyPicks()"
                >
                  {{
                    applying
                      ? '正在记下这几条…'
                      : !decisions.points.length
                        ? '确认这一步没有取舍 · 出正文 →'
                        : pendingPicks
                          ? `还差 ${pendingPicks} 处没定`
                          : '就按这几个走 · 出这一步的正文 →'
                  }}
                </button>
                <!-- 全自动出整份报告走的是同一条服务端逻辑（0 次额度）。放在这儿是为了让他
                     先手动看一眼 AI 会怎么定 —— 不然他第一次看到这几处是在十四步跑完之后。 -->
                <button
                  v-if="decisions.points.length"
                  class="btn-ghost"
                  :disabled="applying || stageBusy"
                  @click="autoPicks()"
                >
                  我不定，让 AI 按它的建议定（不花额度）
                </button>
              </div>
            </div>

            <!-- 拍板之后：这几条就是正文的地基，所以右栏留一份只读回顾 + 出正文的入口。
                 不留的话右栏是空的，他唯一看得见的按钮是「开始分析」——
                 点下去重出一版，那几处取舍要重问一遍，已经定的那批作废，额度也再花一次。 -->
            <div v-else-if="decided && decidedStageKey === selected.key" class="dirs">
              <div class="dirs-head">
                <span class="draft-tag">✅ 方向已定（正文的地基）</span>
              </div>
              <div v-if="!decided.picks.length" class="dirs-note">
                这一步没有需要拍板的取舍：{{ decided.noFork || '（未说明原因）' }}
              </div>
              <div v-for="(p, i) in decided.picks" :key="p.id" class="dir-card">
                <div class="dir-top">
                  <span class="dir-idx">{{ i + 1 }}</span>
                  <h3>{{ p.question }}</h3>
                </div>
                <div class="dec-meta">
                  <span v-if="p.methodRef" class="dec-tag">{{ methodLabel(p.methodRef) }}</span>
                  <span v-if="methodText(p.methodRef)" class="dec-method" :title="methodText(p.methodRef)">{{ methodText(p.methodRef) }}</span>
                </div>
                <div class="dec-opt chosen">
                  <!-- 一处一处标是谁定的。写死「✓ 你定的」的话，AI 替他定的那几处在这张
                       只读回顾里和他亲手点的一模一样，而这张卡是他复核前唯一看得见的地方。 -->
                  <div class="dec-opt-label">
                    {{ p.label }}
                    <span class="dec-chosen-tag" :class="{ ai: aiPicked(p) }">{{ pickByLabel(p) }}</span>
                  </div>
                  <div v-if="p.detail" class="dec-opt-detail">{{ p.detail }}</div>
                  <!-- 放弃了什么必须一直显示：正文只会讲选中那条路的好处，
                       而这半句是这一步唯一不可逆的信息 -->
                  <div class="dec-opt-cost">放弃：{{ p.cost }}</div>
                </div>
                <div v-if="p.note" class="dec-recommend">你的补充：{{ p.note }}</div>
              </div>
              <div class="dirs-note">
                正文会照这几条写，并在开头的「方法论速览」里写明每一处是谁定的、放弃了什么。
                想改的话点「重出一版待定方向」重问一遍（已经定的这批就作废了）。
              </div>
              <div class="draft-actions">
                <button class="btn-primary" :disabled="anyRunning || stageBusy" @click="makeDraft()">
                  按这几条出这一步的正文 →
                </button>
                <button class="btn-ghost" :disabled="anyRunning || stageBusy" @click="loadDecisions()">
                  重出一版待定方向
                </button>
              </div>
            </div>

            <!-- 已定稿内容 -->
            <div v-else-if="entryOf(selected.key)" class="entry-box">
              <div class="entry-head">
                <span class="tag">✅ 已定稿 (v{{ entryOf(selected.key)!.version }})</span>
                <span v-if="entryOf(selected.key)!.stale" class="tag warn">⚠ 建议重跑</span>
              </div>
              <p class="entry-conclusion">{{ entryOf(selected.key)!.conclusion }}</p>
              <div v-if="entryOf(selected.key)!.body" class="md" v-html="md(entryOf(selected.key)!.body)"></div>
              <!-- 只读要说出来，不能只是「没有按钮」：一个没有任何按钮的面板读起来像
                   界面没加载完，他会刷新、会去别处找那个改的入口。 -->
              <div class="entry-locked">
                🔒 这一步已定稿，内容锁定不再修改 —— 下游每一步的结论都建立在它上面。
                中间那一栏就是这一份完整报告。
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-state">
              <div class="empty-icon">✨</div>
              <h3>工作区就绪</h3>
              <p>在左侧聊天区与 AI 沟通，生成的草稿或方向卡片将显示在这里。</p>
            </div>
          </template>
        </div>

        <div class="workspace-content" v-show="workspaceTab === 'kb'">
          <!-- 客户原始资料 -->
          <div class="brief-side open">
            <div class="brief-head">
              <span class="brief-title">📁 客户原始资料</span>
            </div>
            <textarea
              v-model="briefDraft"
              rows="12"
              placeholder="贴入访谈纪要、业务介绍等原始素材..."
              @change="saveBrief"
            ></textarea>
            <div class="brief-actions">
              <button class="btn-ghost small" :disabled="savingBrief" @click="saveBrief">
                {{ savingBrief ? '保存中…' : '保存修改' }}
              </button>
              <span v-if="briefSaved" class="saved">已保存</span>
            </div>
            <!-- 出下一轮问卷的唯一入口。放在资料下面：问卷答完就是追加进这段资料的。
                 已补几轮要写出来 —— 看不到轮数的话，一份从没补过料的项目和补过三轮的
                 在这儿长得一模一样，而两者的结论质量差一大截。 -->
            <div class="intake-link">
              <div class="il-text">
                📋 补料问卷 · {{ intakeRounds ? `已补 ${intakeRounds} 轮` : '还没补过' }}
                <span v-if="intake && intake.questions.length">
                  ｜有一份没提交（{{ intake.questions.length }} 题，已填 {{ intakeFilled }}）
                </span>
              </div>
              <!-- <button class="btn-ghost small" @click="router.push(`/consult/projects/${projectId}/intake`)">
                {{ intake && intake.questions.length ? '去填问卷 →' : '让 AI 再出一轮 →' }}
              </button> -->
            </div>
          </div>

          <!-- 联网查资料（L1）。方法论 §8 的分级：L1 联网 > L2 客户资料 > L3 内置知识（只给区间）> L4 缺失。
               **每一次分析都会自动搜一批**（`autoSourceService`），那几条单独一组标 L1?
               「未人工核对」—— 不分开的话同名公司、几年前的旧闻会被当成他核过的事实写进
               现状卡，而那一节读起来完全正常。
               这个搜索框留着的是**手动补一条**：搜回来要逐条勾选才进 prompt，而勾进去的算 L1
               （他自己看过）—— 机器搜不到的、或者他手上有出处的，只能从这里进来。
               放在「全局知识库」这一栏而不是「当前工作区」：采纳的资料是**整个项目**共享的
               （`sourcesBlock(listSources(project.id))`，不按阶段筛），摆在当前工作区里会读成
               「这几条只给这一步用」，于是他在每一步都重新搜一遍同样的词。 -->
          <div class="src-box">
            <div class="brief-head">
              <span class="brief-title">🌐 联网查资料（L1）</span>
              <!-- 两个数分开报：合成一句「已采纳 12 条」的话，12 条全是机器抓的也读成
                   「我核过 12 条」，而这一步的证据级别其实只到 L1? -->
              <span class="muted">
                你采纳 {{ pickedSources.length }} 条<template v-if="autoSources.length"> · 自动抓 {{ autoSources.length }} 条（未核对）</template>
                · 现在定稿会标成 <strong>{{ levelNow }}</strong>
              </span>
            </div>

            <!-- 没配 key 时说清楚是「这个部署没接搜索」，不是「网上查不到」：
                 整块藏起来的话用户只会觉得这个 AI 在瞎猜，而它确实只能瞎猜。 -->
            <div v-if="!searchEnabled" class="src-warn">
              ⚠ 联网检索没开（管理员还没在「系统配置 &gt; 联网搜索」里填 Tavily key）。AI 不会替你上网 ——
              它只用上面那段客户资料（L2），其余按 L3 给区间。需要外部事实请自己贴进客户资料。
            </div>

            <template v-else>
              <div class="src-input">
                <input
                  v-model="searchQuery"
                  :placeholder="`查什么？例如「${project?.brand_name || '品牌名'} 市场规模 2025」`"
                  @keydown.enter="runSearch"
                />
                <!-- `!selected` 也要禁：`runSearch` 在没选中阶段时是 `return`（这条记录要挂在
                     某一步名下），点下去一点动静都没有，读起来像搜索坏了。 -->
                <button class="btn-primary" :disabled="searching || !searchQuery.trim() || !selected" @click="runSearch">
                  {{ searching ? '搜索中…' : '搜索' }}
                </button>
              </div>

              <div v-if="searchErr" class="src-warn">⚠ {{ searchErr }}</div>
              <div v-if="adoptNote" class="src-note">{{ adoptNote }}</div>

              <div v-if="hits && !hits.length" class="src-empty">
                这个词没搜到东西。换个说法再试 —— 一条都不采纳的话，这一步的结论只能是 L2/L3。
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
                  <span class="muted">采纳之后每一次出草稿 / 出方向 / 对话都会带上它们，并要求 AI 标注「（联网·域名·年份）」</span>
                </div>
              </div>
            </template>

            <div v-if="sources.length" class="adopted">
              <!-- **两组分开列**（`auto`）：自动抓的那几条谁都没看过，可能是同名的另一家、
                   几年前的旧稿或一页软文，而它们在这张列表里和他亲手核过的年报长得一模一样。
                   混在一起的话「这一步凭什么这么说」永远查不回去，而正文只会写得更自信。 -->
              <div v-if="pickedSources.length" class="adopted-group">
                <div class="adopted-head">你采纳的（L1）· {{ pickedSources.length }} 条</div>
                <div v-for="sc in pickedSources" :key="sc.id" class="adopted-item">
                  <span class="lv">L1</span>
                  <div class="adopted-body">
                    <a :href="sc.url" target="_blank" rel="noopener">{{ sc.title || sc.url }}</a>
                    <div class="hit-meta">
                      <span>{{ sc.domain }}</span>
                      <span>{{ sc.published || '未标日期' }}</span>
                      <span v-if="sc.query">搜的是「{{ sc.query }}」</span>
                      <button class="src-snip-btn" @click="toggleSnippet(sc.id)">
                        {{ expandedSources.has(sc.id) ? '收起摘要 ▴' : '看摘要 ▾' }}
                      </button>
                    </div>
                    <!-- 见 expandedSources：这段字就是进 prompt 的那段，空的时候必须明说 -->
                    <div v-if="expandedSources.has(sc.id)" class="src-snip">
                      <template v-if="sc.snippet">{{ sc.snippet }}</template>
                      <span v-else class="src-snip-empty">
                        这条没存摘要（采纳那会儿上游没给正文片段）—— 进 AI 的也就只有标题和域名，核不动就删掉。
                      </span>
                    </div>
                  </div>
                  <button class="src-del" title="不再作为依据" @click="removeSource(sc.id)">✕</button>
                </div>
              </div>

              <div v-if="autoSources.length" class="adopted-group auto">
                <div class="adopted-head">
                  一键四看自动抓的（L1? · 未人工核对）· {{ autoSources.length }} 条
                  <!-- 只说「点开原文」不够：政府站/新闻站的旧链接偶发 502，点不开的那几条
                       他就只能凭标题决定留不留 —— 所以这里先指向「看摘要」。 -->
                  <span class="muted">点「看摘要」核一眼（原文打不开时它是唯一线索），对的按「我核过了」升成 L1，不对的删掉</span>
                </div>
                <div v-for="sc in autoSources" :key="sc.id" class="adopted-item">
                  <span class="lv warn">L1?</span>
                  <div class="adopted-body">
                    <a :href="sc.url" target="_blank" rel="noopener">{{ sc.title || sc.url }}</a>
                    <div class="hit-meta">
                      <span>{{ sc.domain }}</span>
                      <span>{{ sc.published || '未标日期' }}</span>
                      <span v-if="sc.query">自动搜的是「{{ sc.query }}」</span>
                      <button class="src-snip-btn" @click="toggleSnippet(sc.id)">
                        {{ expandedSources.has(sc.id) ? '收起摘要 ▴' : '看摘要 ▾' }}
                      </button>
                    </div>
                    <!-- 自动那几条尤其要能在这里核：原文经常打不开（政府站偶发 502），
                         而标题看起来永远是相关的 —— 见 expandedSources 里那个例子。 -->
                    <div v-if="expandedSources.has(sc.id)" class="src-snip">
                      <template v-if="sc.snippet">{{ sc.snippet }}</template>
                      <span v-else class="src-snip-empty">
                        这条没存摘要（搜的时候上游没给正文片段）—— 进 AI 的也就只有标题和域名，核不动就删掉。
                      </span>
                    </div>
                  </div>
                  <button class="src-ok" title="我点开核对过了，按 L1 用" @click="verifySource(sc.id)">我核过了</button>
                  <button class="src-del" title="不再作为依据" @click="removeSource(sc.id)">✕</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 历史知识库 -->
          <div class="kb-history">
            <h4>历史知识库 ({{ entries.length }} 条)</h4>
            <div v-if="!entries.length" class="kb-empty">尚未沉淀任何结论</div>
            <button
              v-for="e in entries"
              :key="e.stage_key"
              class="kb-item"
              :class="{ stale: e.stale }"
              @click="select(e.stage_key)"
            >
              <div class="kb-item-head">
                <span>{{ stages.find(s => s.key === e.stage_key)?.label || e.stage_key }}</span>
              </div>
              <div class="kb-item-text">{{ e.conclusion }}</div>
            </button>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* 
 * Native App / Editorial Layout
 * Following HC Design System constraints:
 * - Spatial Minimalist (极简网格背景, 无感边框)
 * - Glassmorphism (玻璃拟态)
 * - Premium Diffused Shadows (高级弥散阴影)
 * - No hover translateY or scale (禁止物理位移，仅阴影/边框变化)
 * - Typography (无衬线, tracking-tighter)
 */

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.4);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: content-box;
}

/* 全局滚动条美化 (只在 Webkit 下生效) */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.editorial-theme {
  --font-sans: "Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand: #FFB800;
  --brand-soft: rgba(255, 184, 0, 0.15);
  --brand-ink: #FFB800;
  --navy: #FFFFFF;
  --navy-2: rgba(255, 255, 255, 0.85);
  --color-text: #FFFFFF;
  --color-text-soft: rgba(255, 255, 255, 0.6);
  --color-muted: rgba(255, 255, 255, 0.7);
  --color-soft: rgba(255, 255, 255, 0.5);
  --color-border: rgba(255, 255, 255, 0.1);
  --color-border-strong: rgba(255, 255, 255, 0.15);
  --color-fill: rgba(255, 255, 255, 0.05);
  --bg-color: #12182B;
  
  --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.1);
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.3);

  height: 100vh;
  display: flex;
  overflow: hidden;
  background-color: var(--bg-color);
  color: var(--color-text);
  font-family: var(--font-sans);
  position: relative;
}

.bg-elements {
  position: absolute;
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

.banner-stack {
  position: absolute;
  top: 0; left: 0; right: 0; z-index: 100;
}

.alert-banner {
  padding: 12px 24px;
  background: rgba(254, 242, 242, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #FCA5A5;
  color: #991B1B;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(153, 27, 27, 0.05);
}

.alert-banner span {
  flex: 1;
}

/* 降级提示（不是报错）：黄底，跟红底的报错分得开 —— 同一个红底的话他会以为这次失败了 */
.alert-banner.warn {
  background: rgba(255, 251, 235, 0.96);
  border-bottom-color: #FCD34D;
  color: #92400E;
}
.alert-banner.warn .alert-close { color: #92400E; }

.alert-close {
  background: transparent;
  border: none;
  color: #991B1B;
  font-size: 18px;
  line-height: 1;
  padding: 0 8px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 16px;
}
.alert-close:hover {
  opacity: 1;
}

.intake-pending {
  display: block; width: calc(100% - 24px); margin: 0 12px 8px;
  padding: 10px 12px; text-align: left; cursor: pointer;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px;
  font-family: inherit;
}
.intake-pending:hover { border-color: #F59E0B; }
.intake-pending .ip-title { display: block; font-size: 12px; font-weight: 700; color: #92400E; }
.intake-pending .ip-sub { display: block; margin-top: 4px; font-size: 11px; line-height: 1.6; color: #B45309; }
.intake-pending .ip-cta { display: block; margin-top: 6px; font-size: 11px; font-weight: 700; color: #92400E; }

/* --- Left Navigation: Floating Island --- */
.sidebar-island {
  width: 280px;
  flex: 0 0 auto;
  margin: 16px 0 16px 16px;
  background: rgba(18, 24, 43, 0.6);
  backdrop-filter: blur(40px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: left center;
}
.sidebar-island.hidden {
  width: 0;
  margin-left: 0;
  opacity: 0;
  transform: scaleX(0.95);
  pointer-events: none;
  border-width: 0;
}

.sidebar-header {
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0,0,0,0.05);
  min-height: 72px;
  box-sizing: border-box;
  white-space: nowrap;
}
.header-left {
  display: flex; align-items: center; gap: 12px;
  transition: opacity 0.2s;
}
.btn-toggle-sidebar {
  width: 32px; height: 32px;
  border-radius: 10px;
  border: none; background: transparent;
  color: var(--color-muted);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
.btn-toggle-sidebar:hover { background: rgba(255,255,255,0.1); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }

.btn-back {
  width: 28px; height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: var(--navy);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-back:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); }

.brand-title {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: -0.5px;
  color: var(--navy);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.rail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0 24px;
}

.rail-footer {
  flex: 0 0 auto;
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.btn-export {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--navy);
  border-radius: 12px;
  background: var(--navy);
  color: #fff;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}
.btn-export:hover:not(:disabled) { opacity: 0.85; }
.btn-export:disabled {
  background: transparent;
  border-color: rgba(0,0,0,0.12);
  color: var(--color-soft);
  cursor: not-allowed;
}
.export-sub {
  margin-top: 6px;
  font-size: 11px; line-height: 1.6;
  color: var(--color-soft);
}

.rail-footer {
  flex: 0 0 auto;
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(0,0,0,0.05);
}
.btn-export {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 12px;
  background: rgba(255,255,255,0.1);
  color: #fff;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s, background 0.2s;
}
.btn-export:hover:not(:disabled) { background: rgba(255,255,255,0.2); }
.btn-export:disabled {
  background: transparent;
  color: var(--color-soft);
  border-color: rgba(255,255,255,0.1);
  cursor: not-allowed;
}
.export-sub {
  margin-top: 6px;
  font-size: 11px; line-height: 1.6;
  color: var(--color-soft);
}

/* 一键生成整份报告：和「导出方案」明显分开（一个花二十多次额度且不可逆，一个只是合并
   已有正文），所以用警示色 —— 两颗长一样的话他会随手点成这一颗。 */
.btn-full-report {
  width: 100%;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #F59E0B;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.18);
  color: #FFD9A0;
  font-size: 13px; font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, opacity 0.2s;
}
.btn-full-report:hover:not(:disabled) { background: rgba(245, 158, 11, 0.3); }
.btn-full-report:disabled { opacity: 0.55; cursor: not-allowed; }

/* 整份报告那条链：对话流顶上那一行状态条（详情在右栏那一页） */
.full-strip {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  margin: 0 0 12px; padding: 10px 16px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.32); border-radius: 12px;
  font-size: 12.5px; line-height: 1.7;
}
.full-strip.failed, .full-strip.interrupted {
  background: rgba(239, 68, 68, 0.09); border-color: rgba(239, 68, 68, 0.32);
}
.full-strip.done { background: rgba(16, 185, 129, 0.09); border-color: rgba(16, 185, 129, 0.32); }
.full-strip strong { font-size: 13px; font-weight: 800; }
.full-strip-num { color: var(--color-muted); }
.full-strip-cur { color: var(--color-soft); }
/* 失败原文整段要看得见（几行上游报文 + 「后面 N 步没跑」），所以不截不省略 */
.full-strip-err { flex: 1 1 100%; color: #F87171; font-weight: 600; word-break: break-word; }
.full-strip .link-btn { margin-left: auto; font-weight: 700; }
.full-strip .alert-close { flex: 0 0 auto; }

.full-bar {
  margin: 10px 0 4px; height: 6px; border-radius: 4px;
  background: rgba(0,0,0,0.18); overflow: hidden;
}
.full-bar i { display: block; height: 100%; background: #F59E0B; transition: width .4s; }

/* 右栏的「生成进度」页 */
.drawer-tabs button.running { color: #F59E0B; }
.run-hero { padding: 4px 0 14px; }
.run-hero-title { font-size: 15px; font-weight: 800; }
.run-hero-num { margin-top: 8px; font-size: 30px; font-weight: 800; line-height: 1; }
.run-hero-num span { font-size: 14px; font-weight: 600; color: var(--color-soft); }
.run-hero-sub { margin-top: 6px; font-size: 12px; line-height: 1.7; color: var(--color-soft); }
.run-err {
  margin: 0 0 14px; padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px;
  font-size: 12.5px; line-height: 1.8; color: #F87171; word-break: break-word;
}
.run-steps { border-top: 1px solid rgba(255,255,255,0.08); }
.run-step {
  display: flex; align-items: baseline; gap: 8px;
  padding: 9px 2px; border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 12.5px; line-height: 1.6;
}
.run-step-no {
  flex: 0 0 auto; width: 20px; text-align: right;
  font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-soft); opacity: .8;
}
.run-step-ico { flex: 0 0 auto; width: 18px; text-align: center; }
.run-step-label { flex: 0 0 auto; font-weight: 700; }
.run-step-note { flex: 1 1 auto; min-width: 0; color: var(--color-soft); word-break: break-word; }
/* 「这次自动跑的」要比「之前就定稿的」显眼 —— 该回头核的是前者 */
.run-step.auto-done { background: rgba(245, 158, 11, 0.07); }
.run-step.auto-done .run-step-note { color: #F59E0B; }
.run-step.running { background: rgba(245, 158, 11, 0.14); }
.run-step.running .run-step-note { color: #FFD9A0; font-weight: 600; }
.run-step.stopped .run-step-note { color: #F87171; font-weight: 600; }
.run-step.before, .run-step.queued, .run-step.idle { opacity: .6; }
.run-foot { margin: 12px 0 0; font-size: 12px; line-height: 1.8; color: var(--color-muted); }
.run-foot.warn { color: #F59E0B; }
.run-page .btn-batch-cta { width: 100%; margin-top: 14px; }
.run-dismiss { width: 100%; margin-top: 8px; }

.rail-group { margin-bottom: 16px; }
.rail-title {
  margin: 8px 24px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--color-soft);
  text-transform: uppercase;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.rail-item {
  display: flex; align-items: center; gap: 12px;
  width: calc(100% - 16px);
  margin: 4px 8px;
  padding: 10px 12px;
  border: none; border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-size: 13.5px; color: var(--color-muted);
  transition: all 0.2s;
  text-align: left;
  position: relative;
}
.rail-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
.rail-item.active {
  color: #111;
  background: var(--brand);
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(255, 184, 0, 0.2);
}
.rail-item.locked { color: var(--color-soft); opacity: 0.8; }
.rail-item .dot {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: var(--color-soft);
  background: rgba(255,255,255,0.1); border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s;
}
.rail-item.active .dot { background: rgba(0,0,0,0.1); color: #111; box-shadow: none; }
.rail-item.done .dot { background: rgba(16, 185, 129, 0.2); color: #10B981; }
.rail-item.done.active .dot { background: #10B981; color: #fff; box-shadow: none; }

.rail-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity 0.2s; }

.stale-dot { color: #F59E0B; font-size: 12px; }

/* --- Main Chat Stream --- */
.chat-stream {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.global-actions-bar {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-global-sidebar-toggle {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-back-to-work {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-back-to-work:hover {
  background: rgba(255,255,255,0.15);
  color: var(--brand);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.btn-global-sidebar-toggle:hover {
  background: rgba(255,255,255,0.15);
  border-color: var(--brand);
  color: var(--brand);
  box-shadow: var(--shadow);
  transform: scale(1.05);
}

.chat-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 40px 15% 100px; /* Leave space for bottom capsule */
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.chat-bottom-spacer { height: 60px; }

.stage-intro-card {
  width: 100%;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.intro-header {
  /* padding-bottom: 24px; */
}

.intro-title-group {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.step-badge {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--brand);
  background: transparent;
  padding: 0;
  border-radius: 0;
  text-transform: uppercase;
  flex-shrink: 0;
}

.stage-title {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--color-text);
  margin: 0;
  flex-shrink: 0;
  line-height: 1.2;
}

.stage-question {
  font-size: 16px;
  color: var(--color-soft);
  margin: 0;
  line-height: 1.6;
  font-weight: 500;
  margin-left: 0;
  padding-left: 20px;
  border-left: 2px solid var(--brand);
  max-width: 65ch;
}

/* Collapsible Methodology */
.intro-methodology {
  /* padding-top: 16px; */
  padding-bottom: 10px;
}
.intro-methodology[open] .chevron {
  transform: rotate(180deg);
}

.methodology-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-soft);
  transition: color 0.2s;
}
.methodology-trigger::-webkit-details-marker { display: none; } /* Hide default triangle */
.methodology-trigger:hover {
  color: #fff;
}

.trigger-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  transition: background 0.2s;
}
.methodology-trigger:hover .trigger-icon {
  background: rgba(255,255,255,0.2);
}

.chevron {
  color: currentColor;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.methodology-content {
  margin-top: 20px;
  padding: 24px 32px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px) saturate(150%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 24px rgba(0,0,0,0.1);
  font-size: 14px;
  color: var(--color-muted);
  line-height: 1.8;
}

.sys-section { margin-bottom: 24px; }
.sys-section:last-child { margin-bottom: 0; }
.sys-section strong { 
  color: #fff; 
  display: block; 
  margin-bottom: 12px; 
  font-weight: 700; 
  font-size: 14px;
}
.sys-section ol, .sys-section ul { 
  margin: 0; 
  padding-left: 0;
  list-style: none;
}
.sys-section li { 
  margin-bottom: 12px; 
  position: relative;
  padding-left: 24px;
}
.sys-section li:last-child { margin-bottom: 0; }

.sys-section ul li::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 10px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--brand);
}

.sys-section ol { counter-reset: method-counter; }
.sys-section ol li::before {
  content: counter(method-counter) ".";
  counter-increment: method-counter;
  position: absolute;
  left: 0;
  top: 0;
  color: var(--brand);
  font-size: 13px;
  font-weight: 700;
  font-family: var(--font-sans);
}

.msg {
  display: flex;
  gap: 16px;
  margin: 0;
  width: 100%;
  padding: 0 46px; /* 强制与头部标题区和底部输入框两端对齐 */
  box-sizing: border-box;
}
.msg.user { flex-direction: row-reverse; }

.msg-avatar {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: rgba(255,255,255,0.1);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  flex-shrink: 0;
}
.msg.assistant .msg-avatar {
  /* 头像宽度 32px + gap 16px = 48px，向左悬挂，确保气泡内容精确对齐在 96px 垂直线上 */
  margin-left: -48px; 
}

.msg-content {
  max-width: 85%;
  display: flex; flex-direction: column; gap: 8px;
}
.msg.user .msg-content { align-items: flex-end; }

.msg-bubble {
  padding: 16px 20px;
  border-radius: 20px;
  font-size: 15px;
  line-height: 1.8;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: none;
  color: var(--color-text);
}
.msg.user .msg-bubble {
  background: var(--brand);
  color: #111;
  border-radius: 20px 20px 4px 20px;
  white-space: pre-wrap;
  border: none;
}
.msg.user .msg-bubble.user-pick {
  background: rgba(255, 184, 0, 0.1);
  color: var(--brand);
  box-shadow: none;
  border: 1px solid rgba(255, 184, 0, 0.2);
  font-size: 14px;
}
.msg.user .msg-bubble.user-pick strong {
  font-size: 15px;
}
.msg.user .msg-bubble.user-pick blockquote {
  margin: 12px 0 0;
  padding-left: 16px;
  border-left: 2px solid var(--brand);
  color: var(--color-text);
  font-size: 13px;
}
.msg.assistant .msg-bubble { 
  border-radius: 20px 20px 20px 4px; 
}

.msg-artifact {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 20px;
  border-radius: 20px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: none;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.msg-artifact:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px -8px rgba(0,0,0,0.2);
}
.msg-artifact:active {
  transform: scale(0.98);
}
.artifact-icon { font-size: 24px; }
.artifact-meta { display: flex; flex-direction: column; flex: 1; }
.artifact-meta strong { font-size: 14px; color: #fff; }
.artifact-meta span { font-size: 12px; color: var(--color-soft); margin-top: 2px; }
.artifact-action { font-size: 13px; font-weight: 600; color: var(--brand); }
.artifact-action.muted { color: var(--color-soft); font-weight: 500; }

/* 作废的产出卡片。留在时间线上（那一步确实出过一版），但要一眼看出点不开 —— 不置灰的话
   它和还在的那版长得一样，点了什么都不发生，读起来像界面坏了。 */
.msg-artifact.discarded {
  cursor: default;
  background: rgba(255,255,255,0.02);
  border-style: dashed;
  border-color: rgba(255,255,255,0.1);
  box-shadow: none;
  opacity: 0.7;
}
.msg-artifact.discarded:hover { border-color: rgba(255,255,255,0.2); box-shadow: none; transform: none; }
.msg-artifact.discarded .artifact-meta strong { text-decoration: line-through; color: var(--color-muted); }

/* 「已丢弃」是这一步的状态，不是 AI 说的话，所以做成一条细提示而不是气泡 */
.discard-note {
  margin: 8px 0 0; padding: 10px 14px; max-width: 640px;
  background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.1);
  border-radius: 12px;
  font-size: 12px; line-height: 1.8; color: var(--color-muted);
}

/* 联网结论。和「丢弃」那条一样是过程记录，不是 AI 说的话；但它要读得进去
   （里面有搜的词和「未人工核对」那句），所以字号不压到 12px、底色用品牌色一点点 */
.search-note {
  margin: 8px 0 0; padding: 10px 14px; max-width: 640px;
  background: rgba(255, 184, 0, 0.06); border: 1px dashed rgba(255, 184, 0, 0.22);
  border-radius: 12px;
  font-size: 13px; line-height: 1.85; color: var(--color-muted);
}
.search-note :deep(p) { margin: 0; }
.search-note :deep(strong) { color: var(--brand); }

.loading-bubble {
  background: transparent; border: none; box-shadow: none;
  display: flex; flex-direction: column; gap: 16px;
}
.loading-progress-bar {
  width: 100%; max-width: 240px;
  height: 4px;
  background: rgba(30, 41, 59, 0.06);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 8px;
}
.loading-progress-inner {
  height: 100%;
  width: 40%;
  background: var(--brand);
  border-radius: 2px;
  animation: progress-indeterminate 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
@keyframes progress-indeterminate {
  0% { transform: translateX(-100%) scaleX(0.2); }
  50% { transform: translateX(100%) scaleX(0.8); }
  100% { transform: translateX(300%) scaleX(0.2); }
}
.loading-title { 
  font-size: 16px; font-weight: 800; /* 杂志化大字重 */
  letter-spacing: -0.01em; /* 收紧字距 */
  color: #fff;
  animation: text-breathe 1.2s cubic-bezier(0.16, 1, 0.3, 1) infinite alternate;
}
@keyframes text-breathe {
  0% { opacity: 0.5; }
  100% { opacity: 1; }
}
.loading-sub {
  max-width: 520px;
  font-size: 13px; line-height: 1.8; color: var(--color-muted);
  opacity: 0;
  animation: fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards;
}

@keyframes fade-in-up {
    0% { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: translateY(0); }
  }

/* 等待区：这一步真要用的东西（刚搜到的资料 / 操法 / 待核清单）。
   气泡整个是透明的，所以这里给一条左边线把它和正文回答分开。 */
.wait-brief {
  max-width: 560px;
  display: flex; flex-direction: column; gap: 14px;
  padding: 12px 0 2px 14px;
  border-left: 2px solid rgba(255, 255, 255, 0.12);
  opacity: 0;
  animation: fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards;
}
.wait-h { font-size: 12px; font-weight: 700; color: var(--color-muted); margin-bottom: 6px; }
.wait-list { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.8; color: var(--color-soft); }
.wait-list li + li { margin-top: 2px; }
.wait-list a { color: var(--color-soft); text-decoration: none; border-bottom: 1px dotted currentColor; }
.wait-list a:hover { color: var(--brand); }
.wait-dim { font-size: 11.5px; color: var(--color-soft); opacity: 0.7; margin-left: 6px; }

/* 定稿气泡：和普通回答区分开（左边一条绿边），否则它读起来像 AI 又说了一段话 */
.entry-msg { border-left: 3px solid #10B981; }
.entry-msg :deep(p:last-of-type) { margin-bottom: 8px; }

/* 这一步还没产出时的生成入口。刻意做得比输入条上那两个小按钮显眼：
   进阶段不再自动跑之后，看不见它的人会以为这一步只能聊天。 */
.run-cta {
  display: flex; flex-direction: column; align-items: flex-start; gap: 20px;
  padding: 32px 36px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.run-cta-body { width: 100%; }
.run-cta-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -0.02em; margin-bottom: 12px; }
.run-cta-sub { margin: 0; font-size: 14px; line-height: 1.8; color: var(--color-muted); }
.run-cta-lv {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  margin: 12px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--color-soft);
}
.run-cta-lv strong { color: var(--brand); }
.btn-run-cta {
  align-self: flex-start;
  margin-top: 8px;
  flex: 0 0 auto; padding: 14px 28px;
  background: var(--brand); color: #111;
  border: none; border-radius: 999px; /* 改为全圆角 */
  font-size: 14px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-run-cta:hover:not(:disabled) {
  background: var(--brand-ink);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 184, 0, 0.3);
}
.btn-run-cta:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.btn-run-cta:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; transform: none; }
/* 慢车道那个次要入口（AI 直接出方向）。做成描边的：两个实心按钮并排的话，
   「先定方向」那条推荐路径看不出来 */
.btn-run-cta.secondary {
  background: rgba(255, 255, 255, 0.1); color: var(--color-text);
  border: 1px solid rgba(255,255,255,0.2); box-shadow: none;
  font-weight: 600;
}
.btn-run-cta.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}

/* 四看一键并行那一批的进度。刻意不做成 AI 气泡 —— 它说的是**四步**的事，
   长成气泡的话读起来像当前这一步的回复 */
.batch-panel {
  margin: 8px 0 0; padding: 16px 20px;
  background: rgba(255, 184, 0, 0.07);
  border: 1px solid rgba(255, 184, 0, 0.22); border-radius: 16px;
}
.batch-head {
  display: flex; align-items: center; gap: 12px;
  font-size: 13px; color: var(--brand);
}
.batch-head strong { font-size: 14px; font-weight: 800; }
.batch-head span { color: var(--color-muted); }
.batch-head .alert-close { margin-left: auto; }
.batch-row {
  display: flex; align-items: baseline; gap: 8px;
  margin-top: 10px; font-size: 12.5px; line-height: 1.7;
}
.batch-ico { flex: 0 0 auto; width: 18px; text-align: center; }
.batch-row .link-btn { flex: 0 0 auto; font-weight: 600; }
/* 失败原文整段要看得见（可能是几行上游报文），所以不截不省略 */
.batch-note { flex: 1 1 auto; min-width: 0; color: var(--color-soft); word-break: break-word; }
.batch-row.muted { opacity: .6; }
/* 自动联网那一行。`warn` = 这次压根没联网（没配 key / 搜失败 / 0 条）—— 必须和
   「查到 12 条」在视觉上分开，两者的正文质量差一整级证据 */
.batch-net { flex: 0 0 auto; font-weight: 600; color: var(--color-text); }
.batch-row.warn { color: #ffb020; }
.batch-row.warn .batch-net, .batch-row.warn .batch-note { color: #ffb020; }
.batch-foot {
  margin: 14px 0 0; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.08);
  font-size: 12px; line-height: 1.8; color: var(--color-muted);
}
.batch-foot strong { color: var(--brand); }
/* 一键那颗和旁边的单步按钮**必须长得不一样**：这一下花 4 次额度并且自动定稿，
   两颗实心黄按钮并排的话点错了完全看不出来（界面上就是「分析中」） */
.btn-batch-cta {
  align-self: flex-start; margin-top: 4px;
  padding: 12px 22px;
  background: rgba(255, 184, 0, 0.12); color: var(--brand);
  border: 1px dashed rgba(255, 184, 0, 0.45); border-radius: 999px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-batch-cta:hover:not(:disabled) {
  background: rgba(255, 184, 0, 0.2); border-style: solid; transform: translateY(-2px);
}
.btn-batch-cta:disabled { opacity: .45; cursor: not-allowed; transform: none; }
/* 整份报告那一颗：二十多次额度、十几步自动定稿，所以要和旁边那两颗（2-5 次）分得开 ——
   三颗虚线按钮长一样的话，想点「一键跑完四看」的那一下会点成这一颗。 */
.btn-batch-cta.full {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid #F59E0B; color: #FFD9A0;
  font-weight: 800;
}
.btn-batch-cta.full:hover:not(:disabled) { background: rgba(245, 158, 11, 0.32); }

/* 别的步在跑。刻意不做成 AI 气泡：气泡长在这一步的对话里，读起来还是「这一步在跑」 */
.other-running {
  margin: 8px 0 0; padding: 10px 14px; max-width: 640px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 12px;
  font-size: 12px; line-height: 1.8; color: var(--brand);
}

/* --- Floating Input Capsule --- */
.input-capsule-wrapper {
  position: absolute;
  bottom: 32px; left: 0; right: 0;
  padding: 0 96px; /* 与上方的消息流对齐 */
  /* column：分析中那条说明要压在输入条**上面**一行，横排的话它会把输入条挤窄 */
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}
/* 为什么现在不能说话。放在输入条正上方 —— 只把它变灰的话，读起来是「界面坏了」 */
.capsule-note {
  pointer-events: auto;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 20px;
  background: rgba(255, 184, 0, 0.1);
  border: 1px solid rgba(255, 184, 0, 0.2);
  border-radius: 16px;
  font-size: 12px; line-height: 1.7; color: var(--brand);
}
.locked-capsule-wrapper {
  position: absolute; bottom: 32px; left: 0; right: 0;
  display: flex; justify-content: center;
}
/* 右下角那颗「下一步」。尺寸和 `.btn-next-stage` 一模一样、`bottom` 算成和它同一条
   水平中线（胶囊 bottom 32 + 上下 padding 16 + 半个按钮高 17 = 65；这颗是 48 + 17）——
   两颗一样的按钮差几个像素时，看起来是没对齐，而不是「有意摆成两层」。
   窄屏时抬到居中那颗上面一行：并排会压在它身上，叠着的话点下去哪一颗生效说不清。 */
.btn-next-corner {
  position: absolute; right: 50%;
    margin-right: -520px;bottom: 48px; z-index: 2;
  padding: 8px 18px; border: none; border-radius: 999px;
  background: var(--brand); color: #111;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
}
.btn-next-corner:hover { background: var(--brand-ink); box-shadow: 0 4px 20px rgba(255, 184, 0, 0.3); }
/* 左下角那颗「上一步」。位置和 `.btn-next-corner` 严格镜像（同一条水平中线、离中线
   同样 520px），但**故意不用实心深色**：两颗一样的深色按钮并排时，「回头核上一章」
   和「往下走」看起来一样重，而这一步只读、往下走才是他要做的事。 */
.btn-prev-corner {
  position: absolute; left: 50%;
  margin-left: -520px; bottom: 48px; z-index: 2;
  padding: 8px 18px; border: 1px solid rgba(255,255,255,0.1); border-radius: 999px;
  background: rgba(255,255,255,0.05); color: var(--color-soft);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: var(--shadow);
}
.btn-prev-corner:hover { color: var(--navy); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); }
@media (max-width: 900px) {
  .btn-next-corner { right: 16px; bottom: 112px; }
  .btn-prev-corner { left: 16px; bottom: 112px; }
  /* 两颗并排在一行上，阶段名长的时候会撞在一起（撞上之后点下去哪颗生效说不清），
     所以各占不到一半、超出的部分省略号收掉 */
  .btn-next-corner, .btn-prev-corner {
    max-width: 44%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
}
.locked-capsule {
  padding: 16px 32px;
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(12px);
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.1);
  font-size: 14px; font-weight: 600; color: var(--color-soft);
  box-shadow: var(--shadow);
}
/* 已定稿那一条：不是「被锁在门外」，而是「这一步做完了」，所以颜色和字重跟前者分开 */
.locked-capsule.done {
  display: flex; align-items: center; gap: 16px;
  color: var(--navy);
  background: rgba(255,255,255,0.15);
}
.locked-capsule .lc-sub { font-weight: 500; color: var(--color-soft); }
.btn-next-stage {
  padding: 8px 18px; border: none; border-radius: 999px;
  background: var(--brand); color: #111;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
}
.btn-next-stage:hover { background: var(--brand-ink); box-shadow: 0 4px 20px rgba(255, 184, 0, 0.3); }

/* --- 定稿之后中间这一栏：只读的咨询报告 --- */
.report { max-width: 100%; }
.report-head {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px;
  padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1);
}
.report-tag { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
.report-meta { font-size: 12px; color: var(--color-soft); }
.report-warn {
  margin-top: 16px; padding: 12px 16px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 12px;
  font-size: 12.5px; line-height: 1.8; color: var(--brand);
}
.report-h {
  margin: 28px 0 10px;
  font-size: 12px; font-weight: 700; letter-spacing: 1px;
  color: var(--color-soft); text-transform: uppercase;
}
.report-conclusion {
  margin: 0; font-size: 17px; line-height: 1.8; font-weight: 600; color: var(--color-text);
}
.report-empty {
  padding: 12px 16px; background: rgba(255,255,255,0.05);
  border: 1px dashed rgba(255,255,255,0.2); border-radius: 12px;
  font-size: 12.5px; color: var(--color-muted);
}
.report-ai { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.9; color: var(--color-text); }

/* 折叠起来的讨论记录。summary 要看得出能点 —— 看不出的话那段记录等于消失了。 */
.msg-log { display: flex; flex-direction: column; gap: 24px; }
details.msg-log { margin-top: 32px; gap: 0; }
.msg-log-summary {
  cursor: pointer; padding: 10px 0; margin-bottom: 8px;
  font-size: 13px; font-weight: 600; color: var(--color-muted);
  border-top: 1px solid rgba(255,255,255,0.1);
}
.msg-log-summary:hover { color: #fff; }
details.msg-log[open] > .msg { margin-bottom: 24px; }

.entry-locked {
  margin-top: 20px; padding: 12px 16px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  font-size: 12.5px; line-height: 1.8; color: var(--color-muted);
}

.input-capsule {
  pointer-events: auto;
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 28px;
  padding: 12px 12px 12px 24px;
  display: flex; align-items: flex-end; gap: 16px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1);
  transition: border-color 0.3s, box-shadow 0.3s, background 0.3s;
}
.input-capsule:focus-within {
  border-color: rgba(255, 184, 0, 0.4);
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 16px 40px rgba(255, 184, 0, 0.08), 0 4px 12px rgba(255, 184, 0, 0.04);
}
.input-capsule.busy { background: rgba(255, 255, 255, 0.03); border-style: dashed; }
.input-capsule textarea:disabled { cursor: not-allowed; color: var(--color-soft); }
.input-capsule textarea {
  flex: 1;
  background: transparent;
  border: none; outline: none;
  resize: none;
  font-size: 15px;
  font-family: var(--font-sans);
  color: #fff;
  padding: 8px 0;
  line-height: 1.6;
  min-height: 24px;
  max-height: 120px;
  overflow-y: hidden;
  margin-bottom: 4px;
}
.capsule-actions {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 4px;
}
.btn-send {
  width: 40px; height: 40px;
  border-radius: 20px;
  background: var(--brand);
  color: #111;
  border: none;
  font-size: 18px; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.btn-send:hover:not(:disabled) { background: var(--brand-ink); }
.btn-send:disabled { background: var(--color-border-strong); cursor: not-allowed; }

/* --- Right Workspace Drawer --- */
/**
 * 宽度 60%（作者定的）。正文里那几张表是这个抽屉的主要内容 —— 竞品对照、痛点优先级
 * 矩阵动辄五六列，540px 里第一列会被挤成一字一行的竖排文字，而页面不报错、表格也在，
 * 只是没人读得下去（也就没人去核对里面的数字）。
 *
 * 收起用 transform 而不是 `right: -600px`：负 right 的写法和宽度是两个数，
 * 宽度一改就得同步改那个数，改漏了抽屉会有一条边永远露在屏幕右侧。
 */
.drawer-workspace {
  position: absolute;
  top: 16px; bottom: 16px; right: 16px;
  width: 75%;
  min-width: 480px;
  max-width: 1080px; /* kimi3 的 main 就是这个宽度，再宽一行字读起来要来回扫 */
  background: rgba(18, 24, 43, 0.6);
  backdrop-filter: blur(40px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  box-shadow: -12px 0 48px rgba(0,0,0,0.3);
  display: flex; flex-direction: column;
  transform: translateX(calc(100% + 24px));
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 50;
}
.drawer-workspace.open { transform: none; }

/* 窄屏：min-width 会顶出屏幕，改成占满（`select()` 在 <1024 时本来就会把它关掉） */
@media (max-width: 900px) {
  .drawer-workspace { width: auto; min-width: 0; left: 16px; }
}

.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.drawer-tabs { display: flex; gap: 24px; }
.drawer-tabs button {
  padding: 20px 0;
  background: transparent; border: none;
  font-size: 15px; font-weight: 600; color: var(--color-soft);
  border-bottom: 2px solid transparent;
  cursor: pointer; transition: all 0.2s;
}
.drawer-tabs button:hover { color: rgba(255,255,255,0.85); }
.drawer-tabs button.active { color: #fff; border-bottom-color: var(--brand); }

.btn-close {
  width: 32px; height: 32px;
  border-radius: 16px;
  border: none; background: rgba(255,255,255,0.1);
  color: var(--color-muted);
  font-size: 20px; line-height: 1;
  cursor: pointer; transition: background 0.2s;
}
.btn-close:hover { background: rgba(255,255,255,0.2); color: #fff; }

.drawer-body {
  flex: 1; overflow-y: auto;
  padding: 32px;
}

/* Common Workspace Components */
.artifact-box {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  margin-bottom: 24px;
}

.empty-state {
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; color: var(--color-soft);
}
.empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
.empty-state h3 { font-size: 18px; font-weight: 700; color: #fff; margin: 0 0 8px; }
.empty-state p { font-size: 14px; max-width: 280px; line-height: 1.6; }

/* Buttons */
.btn-primary {
  padding: 14px 28px;
  background: var(--brand); color: #111;
  border: none; border-radius: 999px;
  font-size: 14px; font-weight: 700;
  cursor: pointer; 
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-primary:hover:not(:disabled) { 
  background: var(--brand-ink); 
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 184, 0, 0.3);
}
.btn-primary:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; transform: none; }

.btn-ghost {
  padding: 12px 24px;
  background: transparent; color: var(--color-muted);
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-ghost:hover:not(:disabled) { 
  background: rgba(255, 255, 255, 0.05); 
  color: #fff;
  border-color: #fff; 
}
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost.small { padding: 6px 12px; font-size: 13px; }

.dlabel-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.dlabel-actions {
  display: flex;
  gap: 8px;
}
.link-btn { 
  background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--color-muted); cursor: pointer; 
  font-size: 12px; padding: 4px 12px; border-radius: 6px; font-weight: 600; 
  transition: all 0.2s;
}
.link-btn:hover { background: rgba(255,255,255,0.05); color: #fff; border-color: rgba(255,255,255,0.2); }
.link-btn.active { color: #111; background: var(--brand); border-color: transparent; }

/* Draft Editor */
.draft-box { border: none; padding: 0; background: transparent; box-shadow: none; margin-bottom: 24px; }
.draft-head { margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
.draft-tag { padding: 0; background: transparent; color: #fff; font-size: 20px; font-weight: 800; border-radius: 0; letter-spacing: -0.02em; margin-bottom: 8px; display: inline-block; }

/* 采纳 = 直接定稿、不可逆，这句必须在卡片上方说清（见 pickDirection） */
.dirs-note {
  margin-bottom: 24px; padding: 16px 20px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 16px;
  font-size: 13.5px; line-height: 1.8; color: var(--brand);
}

/* 正在重出一版：这块内容马上会被换掉。按钮变灰不解释的话，读起来是「保存不了了」 */
.draft-busy {
  margin-bottom: 24px; padding: 16px 20px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 16px;
  font-size: 13.5px; line-height: 1.8; color: var(--brand);
}

.inline-gaps {
  margin-bottom: 24px;
  padding: 16px 20px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2);
  border-radius: 16px;
  font-size: 13.5px;
  color: var(--brand);
}
.inline-gaps strong {
  display: block;
  margin-bottom: 8px;
  font-weight: 700;
}
.inline-gaps ul {
  margin: 0;
  padding-left: 20px;
  list-style-type: disc;
}
.inline-gaps li {
  margin-bottom: 4px;
  line-height: 1.6;
}
.inline-gaps li:last-child {
  margin-bottom: 0;
}
.dfield { margin-bottom: 32px; display: flex; flex-direction: column; }
.dlabel { 
  font-size: 13px; 
  font-weight: 700; 
  color: #fff; 
  margin-bottom: 12px; 
  display: flex; 
  justify-content: space-between; 
  letter-spacing: 0.5px;
}
.dfield textarea { 
  width: 100%; 
  box-sizing: border-box; 
  padding: 16px; 
  border: 1px solid rgba(255,255,255,0.1); 
  border-radius: 12px; 
  font-family: var(--font-sans); 
  font-size: 15px; 
  line-height: 1.6; 
  background: rgba(255,255,255,0.05); 
  transition: all 0.2s; 
  resize: none; 
  color: #fff;
}
.dfield textarea:focus { 
  outline: none; 
  border-color: var(--brand); 
  background: rgba(255,255,255,0.1);
  box-shadow: 0 0 0 3px rgba(255, 184, 0, 0.15); 
}
.draft-actions { display: flex; gap: 12px; margin-top: 32px; }

.dir-card { 
  padding: 32px 0 48px; 
  background: transparent; border: none; 
  border-bottom: 1px solid rgba(255, 255, 255, 0.1); 
  margin-bottom: 0; 
}
.dir-card:last-child { border-bottom: none; }
.dir-top { position: relative; margin-bottom: 24px; }
.dir-idx {
  position: absolute; left: -48px; top: -4px;
  font-size: 32px; font-weight: 800;
  color: rgba(255, 255, 255, 0.05); line-height: 1;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.dir-top h3 {
  font-size: 20px; font-weight: 800; color: #fff;
  margin: 0; line-height: 1.4; letter-spacing: -0.02em;
}

/* 待定方向（岔路口）。选项做成「卡中卡」而不是列表：每一条要读的是
   「这条路是什么 + 放弃什么」两行，压成一行的话代价那半句会被跳过。 */
.dec-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; margin: 8px 0 24px; }
.dec-tag {
  flex: 0 0 auto; padding: 4px 10px; border-radius: 8px;
  background: rgba(255, 184, 0, 0.1); color: var(--brand);
  font-size: 12px; font-weight: 700;
}
/* 那一条的原文。自己占一行、最多两行（悬停看全文）：这些条目是一两百字的长句，
   整段摊开的话一屏只放得下一张卡片，几处取舍之间就没法比着看了 ——
   而这一屏的全部作用就是比着挑。 */
.dec-method {
  flex: 1 1 100%; min-width: 0;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  font-size: 13px; line-height: 1.7; color: var(--color-text); cursor: help;
}
.dec-basis { font-size: 13px; line-height: 1.7; color: var(--color-muted); }
/* 选项是按钮：`display:block` + `text-align:left` 是必需的（按钮默认居中且是
   inline-flex，三行文字会挤成居中一团，读起来像标题而不是可点的选项）。 */
.dec-opt {
  display: block; width: 100%; text-align: left; cursor: pointer; font: inherit;
  margin-bottom: 12px; padding: 20px 24px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s, background 0.2s, border-color 0.2s;
}
button.dec-opt:active:not(:disabled) { transform: scale(0.98); }
button.dec-opt:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 184, 0, 0.3); }
button.dec-opt:disabled { cursor: default; opacity: 0.7; }
/* 选中态要看得出来：只靠一个小勾的话，八处岔路口里漏选一处很难发现，
   而提交按钮上那句「还差 N 处」是他唯一的线索。 */
.dec-opt.chosen {
  background: rgba(255, 184, 0, 0.1);
  border-color: var(--brand);
  box-shadow: 0 8px 24px rgba(255, 184, 0, 0.12);
}
.dec-chosen-tag { margin-left: 8px; font-size: 12px; font-weight: 700; color: var(--brand); }
/* AI 替他定的那几处换个颜色：和他自己点的同一个色的话，扫一眼扫不出哪几处要复核 */
.dec-chosen-tag.ai { color: #D97706; }
.dec-recommend {
  margin: 16px 0; padding: 16px 20px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 16px;
  font-size: 13.5px; line-height: 1.7; color: var(--brand);
}
.dec-note { display: block; margin: 16px 0 0; }
.dec-note > span { display: block; margin-bottom: 8px; font-size: 13px; color: var(--color-muted); }
.dec-note textarea {
  width: 100%; padding: 16px 20px; font: inherit; font-size: 14px; line-height: 1.7;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: rgba(255, 255, 255, 0.05);
  color: #fff; resize: vertical; transition: all 0.2s;
}
.dec-note textarea:focus { outline: none; background: rgba(255, 255, 255, 0.1); border-color: var(--brand); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); }
/* 拍板那条对话记录。它 `role='user'`（那几处是**他**定的，记成 AI 说的就成了
   「AI 说它定了」），所以必须把用户气泡那身满色底 + `pre-wrap` 覆盖掉 ——
   不覆盖的话渲染出来的 markdown 挤在一块蓝底上，那几行「放弃：…」读不出来，
   而那半句是这一步唯一不可逆的信息。左侧竖线用品牌色而不是定稿那条的绿色：
   两条长得一样的话，「方向定了」会被读成「这一步已经定稿了」。 */
.msg.user .msg-bubble.decided-msg {
  background: rgba(255, 184, 0, 0.1);
  color: var(--color-text);
  white-space: normal;
  font-size: 14px;
  border-left: 3px solid var(--brand);
  border-radius: 20px 20px 4px 20px;
}
.dec-opt-label { font-size: 15px; font-weight: 700; color: #fff; }
.dec-opt-detail { margin-top: 6px; font-size: 13.5px; line-height: 1.7; color: var(--color-text); }
.dec-opt-cost { margin-top: 8px; font-size: 13px; line-height: 1.7; color: var(--brand); opacity: 0.8; }

/* 已定稿内容 */
.entry-box { border: none; padding: 0; background: transparent; box-shadow: none; }
.entry-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.entry-box .tag { padding: 0; background: transparent; color: #fff; font-size: 16px; font-weight: 800; border-radius: 0; letter-spacing: -0.5px; }

/**
 * Markdown Styles —— 表格与排版照 references/kimi3-design-system.css 那份来
 * （深色表头 + 12px 字距 + 12/16 的格内留白）。这个 `.md` 同时用在三处：抽屉里的
 * 草稿预览 / 方向卡 / 定稿正文，以及左栏的 AI 聊天气泡。
 *
 * 几条是「不写就静默出错」的，改的时候别顺手删：
 * - `td` 的 `min-width` 是让 `.md-table` 那层滚动**真的会滚**的东西。没有它，表格
 *   永远收在 100% 宽里，五六列的表在窄气泡里被挤成一字一行的竖排文字 —— 页面不报错、
 *   表格也在，只是没人读得下去，也就没人去核对里面的数字。wrapper 本身在
 *   `lib/markdown.ts:wrapTables` 里加。
 * - `pre` 要自己 `overflow-x`，`img` / 长链接要自己收住宽度：一行长代码或一个超长 URL
 *   会把整块内容顶宽，右边的按钮跑出可视区，看起来像界面坏了。
 * - `li > p` 要清掉段间距：`breaks: true` + 松散列表下 marked 会给每个 li 包一层 p，
 *   16px 的下边距让列表读起来像每条之间空了一行。
 * - h4-h6 必须给样式：方法论正文常写到第四层（「#### 1) 价值主张」），浏览器默认的
 *   1em 粗体和正文里的 **加粗** 长得一样，那一层标题在屏幕上等于消失了。
 */
.md { font-size: 14.5px; line-height: 1.75; color: var(--color-text); }
.md :deep(h1:first-child), .md :deep(h2:first-child), .md :deep(h3:first-child),
.md :deep(h4:first-child), .md :deep(p:first-child), .md :deep(ul:first-child),
.md :deep(ol:first-child), .md :deep(.md-table:first-child) { margin-top: 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4), .md :deep(h5), .md :deep(h6) {
  margin: 32px 0 16px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.4px;
  line-height: 1.4;
}
.md :deep(h1) { font-size: 24px; }
.md :deep(h2) { font-size: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
.md :deep(h3) { font-size: 16.5px; }
.md :deep(h4) { font-size: 14.5px; margin: 24px 0 10px; color: rgba(255,255,255,0.85); }
.md :deep(h5), .md :deep(h6) { font-size: 13.5px; margin: 20px 0 8px; font-weight: 600; color: var(--color-muted); }
.md :deep(p) { margin: 0 0 16px; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 16px; padding-left: 22px; }
.md :deep(li) { margin: 0 0 6px; }
.md :deep(li > p) { margin: 0; }
.md :deep(li > ul), .md :deep(li > ol) { margin: 6px 0 0; }
.md :deep(strong) { font-weight: 600; color: #fff; }
.md :deep(a) {
  color: var(--brand);
  text-decoration: none;
  border-bottom: 1px solid rgba(59, 91, 219, 0.3);
  word-break: break-word;
}
.md :deep(a:hover) { border-bottom-color: var(--brand); }
.md :deep(hr) { margin: 32px 0; border: none; border-top: 1px solid var(--color-border); }
.md :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.md :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  color: var(--brand);
}
.md :deep(pre) {
  margin: 0 0 16px;
  padding: 16px;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  overflow-x: auto;
}
.md :deep(pre code) { padding: 0; border: none; background: transparent; color: #fff; line-height: 1.6; }
.md :deep(blockquote) {
  margin: 16px 0;
  padding: 12px 16px;
  background: rgba(255, 184, 0, 0.1);
  border-left: 3px solid var(--brand);
  border-radius: 0 8px 8px 0;
  color: var(--brand);
  font-size: 14px;
}
.md :deep(blockquote p:last-child) { margin-bottom: 0; }

/* 表格 */
.md :deep(.md-table) {
  margin: 24px 0;
  overflow-x: auto; /* 圆角同时把里面那张表裁齐，所以边框/圆角挂在这一层而不是 table 上 */
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transition: box-shadow 0.3s;
}
.md :deep(.md-table:hover) { box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.md :deep(table) { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.md :deep(th) {
  background: rgba(255,255,255,0.1);
  color: #fff;
  text-align: left;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.5px;
  white-space: nowrap; /* 表头是短标签，断行会变成「竞\n品」 */
}
.md :deep(td) {
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.1);
  color: var(--color-muted);
  vertical-align: top;
  min-width: 96px; /* 列宽的下限：再挤就横向滚动，不把中文压成竖排 */
}
.md :deep(tbody tr:hover td) { background: rgba(255,255,255,0.02); }
.md :deep(td p) { margin: 0; }
.md :deep(td ul), .md :deep(td ol) { margin: 0; padding-left: 18px; }

.md.md-preview {
  padding: 32px 40px;
  background: rgba(255,255,255,0.05);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  min-height: 400px;
}

/* Intake：这一页只留一个去问卷页的入口，问卷本身在 ConsultIntake.vue */
.intake-link {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 16px; padding: 12px 14px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
}
.intake-link .il-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.7; color: var(--color-muted); }

/* KB */
.brief-side textarea { width: 100%; box-sizing: border-box; padding: 16px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; font-size: 14px; line-height: 1.6; background: rgba(255,255,255,0.05); color: #fff; margin-bottom: 16px; transition: all 0.2s; }
.brief-side textarea:focus { outline: none; border-color: var(--brand); background: rgba(255,255,255,0.1); box-shadow: 0 0 0 3px rgba(255, 184, 0, 0.15); }
/* 联网查资料（L1） */
.src-box { margin-top: 32px; }
.src-box .brief-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.src-box .brief-title { font-size: 16px; font-weight: 700; color: #fff; }
.src-box .muted { font-size: 12px; color: var(--color-muted); }
.src-box .muted strong { color: var(--brand); }
.src-warn {
  margin-bottom: 12px; padding: 12px 14px;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 12px;
  font-size: 12.5px; line-height: 1.8; color: var(--brand);
}
.src-note {
  margin-bottom: 12px; padding: 10px 14px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  font-size: 12.5px; line-height: 1.7; color: var(--color-muted);
}
.src-input { display: flex; gap: 8px; margin-bottom: 12px; }
.src-input input {
  flex: 1; min-width: 0; padding: 10px 14px;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  background: rgba(255,255,255,0.05); color: #fff; font-size: 13px;
}
.src-input input:focus {
  outline: none; border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(255, 184, 0, 0.15);
}
.src-empty {
  padding: 12px 14px; background: rgba(255,255,255,0.05);
  border: 1px dashed rgba(255,255,255,0.2); border-radius: 12px;
  font-size: 12.5px; line-height: 1.7; color: var(--color-muted);
}
.hits { display: flex; flex-direction: column; gap: 8px; }
.hit {
  display: flex; gap: 10px; padding: 12px 14px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; background: rgba(255,255,255,0.05);
}
.hit:hover { border-color: var(--brand); }
.hit input { margin-top: 3px; flex-shrink: 0; accent-color: var(--brand); }
.hit-body { min-width: 0; }
.hit-title { font-size: 13.5px; font-weight: 700; color: #fff; line-height: 1.5; }
.hit-meta {
  display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px;
  font-size: 11.5px; color: var(--color-soft);
}
.hit-meta a { color: var(--brand); text-decoration: none; }
.hit-snip { margin-top: 6px; font-size: 12.5px; line-height: 1.7; color: var(--color-muted); }
.src-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.adopted { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.adopted-item {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 12px; background: rgba(255, 184, 0, 0.06);
}
.adopted-item .lv {
  flex-shrink: 0; padding: 2px 8px; border-radius: 999px;
  background: rgba(255, 184, 0, 0.2); color: var(--brand);
  font-size: 11px; font-weight: 800;
}
.adopted-body { flex: 1; min-width: 0; }
.adopted-body a {
  display: block; font-size: 13px; font-weight: 600; color: #fff; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.adopted-body a:hover { color: var(--brand); }
/* 「看摘要」：长在 meta 那一行里，所以做成一个不像按钮的按钮 */
.src-snip-btn {
  padding: 0; cursor: pointer; border: none; background: transparent;
  color: var(--brand); font-size: 11.5px; font-weight: 700;
}
.src-snip-btn:hover { text-decoration: underline; }
/* 摘要正文：可能几百字，给个高度上限让它自己滚，
   不给的话一条展开就把整份资料清单顶出视口。 */
.src-snip {
  margin-top: 8px; padding: 8px 10px; max-height: 220px; overflow-y: auto;
  background: rgba(0, 0, 0, 0.18); border-radius: 8px;
  font-size: 12.5px; line-height: 1.75; color: var(--color-muted);
  white-space: pre-line; word-break: break-word;
}
.src-snip-empty { color: #ffb020; }
.src-del {
  flex-shrink: 0; width: 24px; height: 24px; padding: 0; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
  background: transparent; color: var(--color-soft); font-size: 12px;
}
.src-del:hover { border-color: #e5484d; color: #e5484d; }
/* 自动抓的那一组。**必须在视觉上和上面那组分开** —— 两组混在一起时，一页没人看过的
   软文和他核过的年报长得一模一样，而它们差一整级证据（见模板里的注释） */
.adopted-group { display: flex; flex-direction: column; gap: 8px; }
.adopted-group + .adopted-group { margin-top: 16px; }
.adopted-head {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
  font-size: 12px; font-weight: 700; color: var(--color-muted);
}
.adopted-head .muted { font-weight: 400; font-size: 11.5px; color: var(--color-soft); }
.adopted-group.auto .adopted-head { color: #ffb020; }
.adopted-group.auto .adopted-item {
  border-color: rgba(255, 176, 32, 0.28); border-style: dashed; background: rgba(255, 176, 32, 0.05);
}
.adopted-item .lv.warn { background: rgba(255, 176, 32, 0.2); color: #ffb020; }
.src-ok {
  flex-shrink: 0; padding: 3px 10px; cursor: pointer;
  border: 1px solid rgba(255, 176, 32, 0.4); border-radius: 999px;
  background: transparent; color: #ffb020; font-size: 11.5px; font-weight: 700;
}
.src-ok:hover { background: rgba(255, 176, 32, 0.15); }

.kb-history { margin-top: 40px; }
.kb-history h4 { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #fff; }
.kb-item { display: block; width: 100%; text-align: left; padding: 16px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; background: rgba(255,255,255,0.05); margin-bottom: 12px; cursor: pointer; transition: border-color 0.2s; }
.kb-item:hover { border-color: var(--brand); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.kb-item-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; font-weight: 700; color: #fff; }
.kb-item-text { font-size: 14px; color: var(--color-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
