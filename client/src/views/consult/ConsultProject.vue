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
   * （**它是这一步正文的地基**，所以恢复它比恢复岔路口清单更要紧）。
   *
   * 加一种 kind 必须同时在下面那条 `v-if` 链上加一条分支：认不出的 kind 会落到最后那个
   * `v-else`，被画成一张写着「已生成候选方向」的卡片，点开右栏是空的 —— 读起来像那一版丢了。
   */
  kind: 'text' | 'directions' | 'draft' | 'entry' | 'discard' | 'decisions' | 'decided'
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
const briefDraft = ref('')
const savingBrief = ref(false)
const briefSaved = ref(false)
const workspaceTab = ref<'task' | 'kb'>('task')
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
  () => !!runningStage.value || drafting.value || loadingDirections.value || loadingDecisions.value || applying.value
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
onUnmounted(() => stopRunPoll())

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
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 「继续下一步」：切过去之后把中间这一栏滚回顶上。
 *
 * 必须显式滚：`messages` 那个 watch 每次换阶段都把滚动条推到**底**（聊天该那样），
 * 而下一步是从头开始的 —— 落在底部时他看到的是输入条和一句「还没开始分析」，
 * 阶段标题、要回答的问题、那份「该怎么想」全在视口上面，读起来就是「点了下一步却什么
 * 都没换」（上一步的报告本来也是滚到底才看见这颗按钮的）。
 * 排在 watch 的回调之后：那次 `nextTick` 是 `select` 里赋值 messages 时排的，比这里早。
 */
async function goNextStage(key: string) {
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
  workspaceTab.value = 'task'

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

/** 把「正在跑」的三个状态位一起清掉。漏一个的话按钮或转圈圈会单独卡住。 */
function clearRunState() {
  runningStage.value = ''
  drafting.value = false
  loadingDirections.value = false
  loadingDecisions.value = false
  stopRunPoll()
}

function startRunPoll(key: string) {
  stopRunPoll()
  const seen = new Set(messages.value.map(m => m.id))
  let ticks = 0
  runPoll = window.setInterval(async () => {
    // 那次 POST 已经正常返回（或换了别的步在跑）就不用捞了
    if (runningStage.value !== key) return stopRunPoll()
    ticks++
    try {
      const res = await apiGet(`/api/consult/projects/${projectId}/stages/${key}/messages`)
      const fresh = (res.messages as Msg[]).filter(
        m =>
          !seen.has(m.id) &&
          (m.kind === 'draft' || m.kind === 'directions' || m.kind === 'decisions')
      )
      if (fresh.length) {
        if (runningStage.value !== key) return stopRunPoll()
        // 库里那行是在 `res.json` 前一刻写的，所以正常的一次分析也会被这里撞上。
        // 先让那次返回有 3 秒机会自己回来 —— 不等的话每次分析结束都要多弹一句
        // 「这一版是捞回来的」，而它其实一切正常，看多了就没人当真了。
        await new Promise(r => setTimeout(r, 3000))
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
          err.value =
            '⚠ 这一版是直接从服务端捞回来的 —— 那次请求的返回没收到（页面热更新过 / 网络断了一下 / 服务重启都会这样）。' +
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
    if (res.message) messages.value = [...messages.value, res.message]

    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出方向失败'
  } finally {
    clearRunState()
  }
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
    if (res.message) messages.value = [...messages.value, res.message]
    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出待定方向失败'
  } finally {
    clearRunState()
  }
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
    if (res.message) messages.value = [...messages.value, res.message]
    openWorkspace('task')
  } catch (e: any) {
    err.value = e?.message || '出草稿失败'
  } finally {
    clearRunState()
  }
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


const levelNow = computed(() => {
  if (sources.value.length) return 'L1 联网检索'
  if ((project.value?.brief || '').trim()) return 'L2 客户资料'
  return 'L3 模型内置知识（只给区间）'
})

const selectedNo = computed(() => {
  const i = stages.value.findIndex(s => s.key === selectedKey.value)
  return i < 0 ? '00' : String(i + 1).padStart(2, '0')
})

const laneTag = (lane: string) => (lane === 'fast' ? '快' : lane === 'plan' ? '案' : '慢')
const isDraftLane = computed(() => !!selected.value && selected.value.lane !== 'slow')

const md = (s: string) => renderMarkdown(s)

function openWorkspace(tab?: 'task' | 'kb') {
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
    <div v-if="err" class="alert-banner">
      <span>{{ err }}</span>
      <button class="alert-close" @click="err = ''" title="关闭提示">×</button>
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
      <button v-if="!sidebarOpen" class="btn-global-sidebar-toggle" @click="sidebarOpen = true" title="展开侧边栏">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      <div class="chat-scroll-area" ref="chatScrollRef">
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

        <!-- 还没有产出时，这一步唯一的推进入口就是这个按钮（原来是进阶段自动跑，
             见 showRunCta 的注释）。放在对话末尾而不是顶上：先聊几句再点是这次改动的
             全部目的，按钮跟着对话往下走，聊到哪儿它就在哪儿。 -->
        <div v-if="showRunCta && !chatting" class="run-cta">
          <div class="run-cta-body">
            <div class="run-cta-title">
              {{ hasDecided ? '方向已经定了，还没出正文' : isDraftLane ? '这一步还没有草稿' : '这一步还没开始分析' }}
            </div>
            <p class="run-cta-sub">
              可以先在下面把你的判断交代给 AI（重点是谁、哪些事实别写错、忌讳什么），
              <strong>本步最近 16 条对话会一起进 prompt</strong>，聊完再点右边的按钮。
              <!-- 每种状态都要说清那个按钮会干什么。慢车道「开始分析」**不写正文**，
                   不说的话他点完看到一屏选项，会以为分析失败了（或者以为这就是产出）。 -->
              <template v-if="hasDecided">
                <br />右栏那 {{ decided!.picks.length }} 处取舍已经由你定了，正文会照它写
                （正文出来还要你定稿）。
              </template>
              <template v-else-if="!isDraftLane">
                <br />这一步<strong>先问后写</strong>：「开始分析」出来的是几处要你拍板的取舍
                （竞品挑哪几家、定位取哪个角色这类），<strong>还不是正文</strong>；定完之后
                才照你定的方向写一份完整的。
              </template>
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
                <strong>通常十几秒到 1 分钟</strong>（这一步要写六节带表格的正文）。别刷新，也不用再点一次生成 —— 那会再花一次额度。
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
      <div class="input-capsule-wrapper" v-else-if="selected && selected.unlocked">
        <!-- 为什么停掉输入，要写在他眼皮底下：只把发送键变灰的话，他会以为是网络卡了，
             刷新页面（正在跑的那一版就此变成孤儿）或者反复点发送。 -->
        <div v-if="stageBusy" class="capsule-note">
          ⏳ 这一步正在分析，先不接受输入 —— 现在发的话<strong>进不了</strong>正在写的这一版
          （它开写的那一刻就把对话取完了）。等它出来再说，那句话会进下一版。
        </div>
        <div class="input-capsule" :class="{ busy: stageBusy }">
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
           这一颗**还会把视口滚回顶上**（见 goNextStage）：换过去之后落在底部的话，阶段标题
           和「该怎么想」全在视口上面，读起来是「点了下一步却什么都没换」。

           **必须放在上面那条 v-if / v-else-if 链之外**：夹在链子中间的话
           `v-else-if="selected && selected.unlocked"`（输入条）就找不到它的 v-if 了，
           于是已定稿的阶段上一边是只读报告、一边冒出一条能打字的输入框 ——
           在那里说的话既进不了任何 prompt 也改不动结论，而它看起来完全正常。 -->
      <button
        v-if="stageLocked && nextInOrder"
        class="btn-next-corner"
        @click="goNextStage(nextInOrder.key)"
      >
        下一步「{{ nextInOrder.label }}」→
      </button>
    </main>

    <!-- Right Workspace Drawer -->
    <aside class="drawer-workspace" :class="{ open: workspaceOpen }">
      <div class="drawer-header">
        <div class="drawer-tabs">
          <button :class="{active: workspaceTab === 'task'}" @click="workspaceTab = 'task'">当前工作区</button>
          <button :class="{active: workspaceTab === 'kb'}" @click="workspaceTab = 'kb'">全局知识库</button>
        </div>
        <button class="btn-close" @click="workspaceOpen = false">×</button>
      </div>

      <div class="drawer-body">
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
                <textarea v-model="draft.conclusion" rows="2"></textarea>
              </label>
              <div class="dfield">
                <div class="dlabel-bar">
                  <span class="dlabel">正文详情</span>
                  <div class="dlabel-actions">
                    <button class="link-btn" :class="{ active: !draftPreview }" @click="draftPreview = false">✏️ 编辑模式</button>
                    <button class="link-btn" :class="{ active: draftPreview }" @click="draftPreview = true">👁️ 预览模式</button>
                  </div>
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
                <span class="draft-tag">🛤 待定方向（动笔前的取舍）</span>
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
                  <div class="dec-opt-label">{{ p.label }} <span class="dec-chosen-tag">✓ 你定的</span></div>
                  <div v-if="p.detail" class="dec-opt-detail">{{ p.detail }}</div>
                  <!-- 放弃了什么必须一直显示：正文只会讲选中那条路的好处，
                       而这半句是这一步唯一不可逆的信息 -->
                  <div class="dec-opt-cost">放弃：{{ p.cost }}</div>
                </div>
                <div v-if="p.note" class="dec-recommend">你的补充：{{ p.note }}</div>
              </div>
              <div class="dirs-note">
                正文会照这几条写，并在开头的「方法论速览」里写明哪几处是你定的、放弃了什么。
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
              <button class="btn-ghost small" @click="router.push(`/consult/projects/${projectId}/intake`)">
                {{ intake && intake.questions.length ? '去填问卷 →' : '让 AI 再出一轮 →' }}
              </button>
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

.editorial-theme {
  --font-sans: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --brand: #3B5BDB;
  --brand-soft: rgba(59, 91, 219, 0.08);
  --brand-ink: #2B45A8;
  --navy: #111827;
  --navy-2: #374151;
  --color-text: #111827;
  --color-muted: #4B5563;
  --color-soft: #9CA3AF;
  --color-border: #E5E7EB;
  --color-border-strong: #D1D5DB;
  --color-fill: #F9FAFB;
  
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.02);
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  --shadow-lg: 0 16px 32px rgba(0, 0, 0, 0.08);

  height: 100vh;
  display: flex;
  overflow: hidden;
  background-color: #FDFDFD;
  background-image: linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  color: var(--color-text);
  font-family: var(--font-sans);
  position: relative;
}

.alert-banner {
  position: absolute;
  top: 0; left: 0; right: 0; z-index: 100;
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
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(40px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
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
.btn-toggle-sidebar:hover { background: #fff; color: var(--navy); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

.btn-back {
  width: 28px; height: 28px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--navy);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-back:hover { background: var(--color-fill); border-color: var(--color-border-strong); }

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
  border: 1px solid var(--navy);
  border-radius: 12px;
  background: var(--navy);
  color: #fff;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s;
}
.btn-export:hover:not(:disabled) { opacity: 0.85; }
.btn-export:disabled {
  background: transparent;
  color: var(--color-soft);
  border-color: rgba(0,0,0,0.12);
  cursor: not-allowed;
}
.export-sub {
  margin-top: 6px;
  font-size: 11px; line-height: 1.6;
  color: var(--color-soft);
}

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
.rail-item:hover { color: var(--navy); background: rgba(0,0,0,0.03); }
.rail-item.active {
  color: var(--navy);
  background: #fff;
  font-weight: 700;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.rail-item.locked { color: var(--color-soft); opacity: 0.8; }
.rail-item .dot {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: var(--color-soft);
  background: rgba(0,0,0,0.05); border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s;
}
.rail-item.active .dot { background: var(--brand); color: #fff; box-shadow: 0 2px 8px rgba(59, 91, 219, 0.3); }
.rail-item.done .dot { background: #10B981; color: #fff; }
.rail-item.done.active .dot { box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); }

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

.btn-global-sidebar-toggle {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 10;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  color: var(--navy);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-global-sidebar-toggle:hover {
  background: #fff;
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
  border-bottom: 1px solid var(--color-border);
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
  color: var(--navy);
}

.trigger-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-fill);
  transition: background 0.2s;
}
.methodology-trigger:hover .trigger-icon {
  background: rgba(0,0,0,0.04);
}

.chevron {
  color: currentColor;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.methodology-content {
  margin-top: 20px;
  padding: 24px 32px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px) saturate(150%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 24px rgba(0,0,0,0.02), inset 0 0 0 1px rgba(255,255,255,0.5);
  font-size: 14px;
  color: var(--navy-2);
  line-height: 1.8;
}

.sys-section { margin-bottom: 24px; }
.sys-section:last-child { margin-bottom: 0; }
.sys-section strong { 
  color: var(--brand-ink); 
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
  background: var(--navy);
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
  background: #F8F9FA;
  border: none;
  box-shadow: none;
  color: var(--color-text);
}
.msg.user .msg-bubble {
  background: var(--brand);
  color: #fff;
  border-radius: 20px 20px 4px 20px;
  white-space: pre-wrap;
}
.msg.user .msg-bubble.user-pick {
  background: var(--brand-soft);
  color: var(--brand-ink);
  box-shadow: none;
  border: 1px solid rgba(59, 91, 219, 0.1);
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
  background: #F8F9FA;
  border: 1px solid transparent;
  box-shadow: none;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.msg-artifact:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px -8px rgba(0,0,0,0.06);
}
.msg-artifact:active {
  transform: scale(0.98);
}
.artifact-icon { font-size: 24px; }
.artifact-meta { display: flex; flex-direction: column; flex: 1; }
.artifact-meta strong { font-size: 14px; color: var(--navy); }
.artifact-meta span { font-size: 12px; color: var(--color-soft); margin-top: 2px; }
.artifact-action { font-size: 13px; font-weight: 600; color: var(--brand); }
.artifact-action.muted { color: var(--color-soft); font-weight: 500; }

/* 作废的产出卡片。留在时间线上（那一步确实出过一版），但要一眼看出点不开 —— 不置灰的话
   它和还在的那版长得一样，点了什么都不发生，读起来像界面坏了。 */
.msg-artifact.discarded {
  cursor: default;
  background: var(--color-fill);
  border-style: dashed;
  box-shadow: none;
  opacity: 0.7;
}
.msg-artifact.discarded:hover { border-color: rgba(0,0,0,0.12); box-shadow: none; }
.msg-artifact.discarded .artifact-meta strong { text-decoration: line-through; color: var(--color-muted); }

/* 「已丢弃」是这一步的状态，不是 AI 说的话，所以做成一条细提示而不是气泡 */
.discard-note {
  margin: 8px 0 0; padding: 10px 14px; max-width: 640px;
  background: var(--color-fill); border: 1px dashed var(--color-border-strong);
  border-radius: 12px;
  font-size: 12px; line-height: 1.8; color: var(--color-muted);
}

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
  background: var(--navy);
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
  color: var(--navy);
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

/* 定稿气泡：和普通回答区分开（左边一条绿边），否则它读起来像 AI 又说了一段话 */
.entry-msg { border-left: 3px solid #10B981; }
.entry-msg :deep(p:last-of-type) { margin-bottom: 8px; }

/* 这一步还没产出时的生成入口。刻意做得比输入条上那两个小按钮显眼：
   进阶段不再自动跑之后，看不见它的人会以为这一步只能聊天。 */
.run-cta {
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  padding: 24px 28px;
  background: rgba(248, 249, 250, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: none; border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
}
.run-cta-body { flex: 1 1 260px; min-width: 0; }
.run-cta-title { font-size: 16px; font-weight: 800; color: var(--navy); letter-spacing: -0.02em; }
.run-cta-sub { margin: 8px 0 0; font-size: 13px; line-height: 1.8; color: var(--color-muted); }
.btn-run-cta {
  flex: 0 0 auto; padding: 14px 24px;
  background: var(--navy, #1E293B); color: #fff;
  border: none; border-radius: 14px;
  font-size: 14px; font-weight: 700; cursor: pointer;
  box-shadow: 0 6px 16px rgba(30, 41, 59, 0.18);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-run-cta:active:not(:disabled) {
  transform: scale(0.98);
  box-shadow: 0 2px 8px rgba(30, 41, 59, 0.1);
}
.btn-run-cta:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; transform: none; }
/* 慢车道那个次要入口（AI 直接出方向）。做成描边的：两个实心按钮并排的话，
   「先定方向」那条推荐路径看不出来 */
.btn-run-cta.secondary {
  background: rgba(255, 255, 255, 0.6); color: var(--navy, #1E293B);
  border: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  font-weight: 600;
}

/* 别的步在跑。刻意不做成 AI 气泡：气泡长在这一步的对话里，读起来还是「这一步在跑」 */
.other-running {
  margin: 8px 0 0; padding: 10px 14px; max-width: 640px;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px;
  font-size: 12px; line-height: 1.8; color: #92400E;
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
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 16px;
  font-size: 12px; line-height: 1.7; color: #92400E;
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
  background: var(--navy); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: var(--shadow);
}
.btn-next-corner:hover { background: var(--navy-2); }
@media (max-width: 900px) {
  .btn-next-corner { right: 16px; bottom: 112px; }
}
.locked-capsule {
  padding: 16px 32px;
  background: rgba(255,255,255,0.8);
  backdrop-filter: blur(12px);
  border-radius: 999px;
  border: 1px solid var(--color-border);
  font-size: 14px; font-weight: 600; color: var(--color-soft);
  box-shadow: var(--shadow);
}
/* 已定稿那一条：不是「被锁在门外」，而是「这一步做完了」，所以颜色和字重跟前者分开 */
.locked-capsule.done {
  display: flex; align-items: center; gap: 16px;
  color: var(--navy);
  background: rgba(255,255,255,0.92);
}
.locked-capsule .lc-sub { font-weight: 500; color: var(--color-soft); }
.btn-next-stage {
  padding: 8px 18px; border: none; border-radius: 999px;
  background: var(--navy); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.btn-next-stage:hover { background: var(--navy-2); }

/* --- 定稿之后中间这一栏：只读的咨询报告 --- */
.report { max-width: 100%; }
.report-head {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px;
  padding-bottom: 12px; border-bottom: 1px solid var(--color-border);
}
.report-tag { font-size: 16px; font-weight: 800; color: var(--navy); letter-spacing: -0.5px; }
.report-meta { font-size: 12px; color: var(--color-soft); }
.report-warn {
  margin-top: 16px; padding: 12px 16px;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px;
  font-size: 12.5px; line-height: 1.8; color: #92400E;
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
  padding: 12px 16px; background: var(--color-fill);
  border: 1px dashed var(--color-border-strong); border-radius: 12px;
  font-size: 12.5px; color: var(--color-muted);
}
.report-ai { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.9; color: var(--color-text); }

/* 折叠起来的讨论记录。summary 要看得出能点 —— 看不出的话那段记录等于消失了。 */
.msg-log { display: flex; flex-direction: column; gap: 24px; }
details.msg-log { margin-top: 32px; gap: 0; }
.msg-log-summary {
  cursor: pointer; padding: 10px 0; margin-bottom: 8px;
  font-size: 13px; font-weight: 600; color: var(--color-muted);
  border-top: 1px solid var(--color-border);
}
.msg-log-summary:hover { color: var(--navy); }
details.msg-log[open] > .msg { margin-bottom: 24px; }

.entry-locked {
  margin-top: 20px; padding: 12px 16px;
  background: var(--color-fill); border: 1px solid var(--color-border); border-radius: 12px;
  font-size: 12.5px; line-height: 1.8; color: var(--color-muted);
}

.input-capsule {
  pointer-events: auto;
  width: 100%;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 28px;
  padding: 12px 12px 12px 24px;
  display: flex; align-items: flex-end; gap: 16px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.input-capsule:focus-within {
  border-color: rgba(59, 91, 219, 0.4);
  background: #fff;
  box-shadow: 0 16px 40px rgba(59, 91, 219, 0.08), 0 4px 12px rgba(59, 91, 219, 0.04);
}
.input-capsule.busy { background: rgba(249, 250, 251, 0.9); border-style: dashed; }
.input-capsule textarea:disabled { cursor: not-allowed; color: var(--color-soft); }
.input-capsule textarea {
  flex: 1;
  background: transparent;
  border: none; outline: none;
  resize: none;
  font-size: 15px;
  font-family: var(--font-sans);
  color: var(--navy);
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
  color: #fff;
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
  width: 60%;
  min-width: 480px;
  max-width: 1080px; /* kimi3 的 main 就是这个宽度，再宽一行字读起来要来回扫 */
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(32px);
  border: 1px solid rgba(0,0,0,0.05);
  border-radius: 20px;
  box-shadow: -12px 0 48px rgba(0,0,0,0.08);
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
  border-bottom: 1px solid rgba(0,0,0,0.05);
}
.drawer-tabs { display: flex; gap: 24px; }
.drawer-tabs button {
  padding: 20px 0;
  background: transparent; border: none;
  font-size: 15px; font-weight: 600; color: var(--color-soft);
  border-bottom: 2px solid transparent;
  cursor: pointer; transition: all 0.2s;
}
.drawer-tabs button:hover { color: var(--navy-2); }
.drawer-tabs button.active { color: var(--navy); border-bottom-color: var(--brand); }

.btn-close {
  width: 32px; height: 32px;
  border-radius: 16px;
  border: none; background: var(--color-fill);
  color: var(--color-muted);
  font-size: 20px; line-height: 1;
  cursor: pointer; transition: background 0.2s;
}
.btn-close:hover { background: var(--color-border); color: var(--navy); }

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
.empty-state h3 { font-size: 18px; font-weight: 700; color: var(--navy); margin: 0 0 8px; }
.empty-state p { font-size: 14px; max-width: 280px; line-height: 1.6; }

/* Buttons */
.btn-primary {
  padding: 10px 24px;
  background: var(--navy); color: #fff;
  border: none; border-radius: 999px;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) { background: #000; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-ghost {
  padding: 10px 24px;
  background: transparent; color: var(--navy);
  border: 1px solid var(--color-border-strong); border-radius: 999px;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-ghost:hover:not(:disabled) { background: var(--color-fill); border-color: var(--navy-2); }
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
  background: transparent; border: 1px solid var(--color-border); color: var(--color-muted); cursor: pointer; 
  font-size: 12px; padding: 4px 12px; border-radius: 6px; font-weight: 600; 
  transition: all 0.2s;
}
.link-btn:hover { background: var(--color-fill); color: var(--navy); border-color: var(--color-border-strong); }
.link-btn.active { color: var(--brand-ink); background: var(--brand-soft); border-color: transparent; }

/* Draft Editor */
.draft-box { border: none; padding: 0; background: transparent; box-shadow: none; margin-bottom: 24px; }
.draft-head { margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
.draft-tag { padding: 0; background: transparent; color: var(--navy); font-size: 20px; font-weight: 800; border-radius: 0; letter-spacing: -0.02em; margin-bottom: 8px; display: inline-block; }

/* 采纳 = 直接定稿、不可逆，这句必须在卡片上方说清（见 pickDirection） */
.dirs-note {
  margin-bottom: 24px; padding: 16px 20px;
  background: rgba(245, 158, 11, 0.08); border: none; border-radius: 16px;
  font-size: 13.5px; line-height: 1.8; color: #92400E;
}

/* 正在重出一版：这块内容马上会被换掉。按钮变灰不解释的话，读起来是「保存不了了」 */
.draft-busy {
  margin-bottom: 24px; padding: 16px 20px;
  background: rgba(245, 158, 11, 0.08); border: none; border-radius: 16px;
  font-size: 13.5px; line-height: 1.8; color: #92400E;
}

.inline-gaps {
  margin-bottom: 24px;
  padding: 16px 20px;
  background: rgba(245, 158, 11, 0.08);
  border-radius: 16px;
  border: none;
  font-size: 13.5px;
  color: #92400E;
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
  color: var(--navy); 
  margin-bottom: 12px; 
  display: flex; 
  justify-content: space-between; 
  letter-spacing: 0.5px;
}
.dfield textarea { 
  width: 100%; 
  box-sizing: border-box; 
  padding: 16px; 
  border: 1px solid var(--color-border); 
  border-radius: 12px; 
  font-family: var(--font-sans); 
  font-size: 15px; 
  line-height: 1.6; 
  background: #FAFAFA; 
  transition: all 0.2s; 
  resize: none; 
  color: var(--color-text);
}
.dfield textarea:focus { 
  outline: none; 
  border-color: var(--brand); 
  background: #fff;
  box-shadow: 0 0 0 3px var(--brand-soft); 
}
.draft-actions { display: flex; gap: 12px; margin-top: 32px; }

.dir-card { 
  padding: 32px 0 48px; 
  background: transparent; border: none; 
  border-bottom: 1px solid rgba(0, 0, 0, 0.04); 
  margin-bottom: 0; 
}
.dir-card:last-child { border-bottom: none; }
.dir-top { position: relative; margin-bottom: 24px; }
.dir-idx {
  position: absolute; left: -48px; top: -4px;
  font-size: 32px; font-weight: 800;
  color: rgba(30, 41, 59, 0.08); line-height: 1;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.dir-top h3 {
  font-size: 20px; font-weight: 800; color: var(--navy);
  margin: 0; line-height: 1.4; letter-spacing: -0.02em;
}

/* 待定方向（岔路口）。选项做成「卡中卡」而不是列表：每一条要读的是
   「这条路是什么 + 放弃什么」两行，压成一行的话代价那半句会被跳过。 */
.dec-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; margin: 8px 0 24px; }
.dec-tag {
  flex: 0 0 auto; padding: 4px 10px; border-radius: 8px;
  background: var(--brand-soft, #EEF2FF); color: var(--brand, #4F46E5);
  font-size: 12px; font-weight: 700;
}
/* 那一条的原文。自己占一行、最多两行（悬停看全文）：这些条目是一两百字的长句，
   整段摊开的话一屏只放得下一张卡片，几处取舍之间就没法比着看了 ——
   而这一屏的全部作用就是比着挑。 */
.dec-method {
  flex: 1 1 100%; min-width: 0;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  font-size: 13px; line-height: 1.7; color: var(--color-text-soft, #64748B); cursor: help;
}
.dec-basis { font-size: 13px; line-height: 1.7; color: var(--color-text-soft, #64748B); }
/* 选项是按钮：`display:block` + `text-align:left` 是必需的（按钮默认居中且是
   inline-flex，三行文字会挤成居中一团，读起来像标题而不是可点的选项）。 */
.dec-opt {
  display: block; width: 100%; text-align: left; cursor: pointer; font: inherit;
  margin-bottom: 12px; padding: 20px 24px;
  background: rgba(248, 249, 250, 0.65); border: none; border-radius: 16px;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s, background 0.2s;
}
button.dec-opt:active:not(:disabled) { transform: scale(0.98); }
button.dec-opt:hover:not(:disabled) { background: rgba(248, 249, 250, 0.9); }
button.dec-opt:disabled { cursor: default; opacity: 0.7; }
/* 选中态要看得出来：只靠一个小勾的话，八处岔路口里漏选一处很难发现，
   而提交按钮上那句「还差 N 处」是他唯一的线索。 */
.dec-opt.chosen {
  background: #fff;
  box-shadow: 0 8px 24px rgba(79, 70, 229, 0.12);
}
.dec-chosen-tag { margin-left: 8px; font-size: 12px; font-weight: 700; color: var(--brand, #4F46E5); }
.dec-recommend {
  margin: 16px 0; padding: 16px 20px;
  background: rgba(245, 158, 11, 0.08); border-radius: 16px;
  font-size: 13.5px; line-height: 1.7; color: #92400E;
}
.dec-note { display: block; margin: 16px 0 0; }
.dec-note > span { display: block; margin-bottom: 8px; font-size: 13px; color: var(--color-text-soft, #64748B); }
.dec-note textarea {
  width: 100%; padding: 16px 20px; font: inherit; font-size: 14px; line-height: 1.7;
  border: none; border-radius: 16px; background: rgba(248, 249, 250, 0.65);
  color: var(--color-text); resize: vertical; transition: all 0.2s;
}
.dec-note textarea:focus { outline: none; background: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06); }
/* 拍板那条对话记录。它 `role='user'`（那几处是**他**定的，记成 AI 说的就成了
   「AI 说它定了」），所以必须把用户气泡那身满色底 + `pre-wrap` 覆盖掉 ——
   不覆盖的话渲染出来的 markdown 挤在一块蓝底上，那几行「放弃：…」读不出来，
   而那半句是这一步唯一不可逆的信息。左侧竖线用品牌色而不是定稿那条的绿色：
   两条长得一样的话，「方向定了」会被读成「这一步已经定稿了」。 */
.msg.user .msg-bubble.decided-msg {
  background: var(--brand-soft, #EEF2FF);
  color: var(--color-text);
  white-space: normal;
  font-size: 14px;
  border-left: 3px solid var(--brand, #4F46E5);
  border-radius: 20px 20px 4px 20px;
}
.dec-opt-label { font-size: 15px; font-weight: 700; color: var(--navy, #1E293B); }
.dec-opt-detail { margin-top: 6px; font-size: 13.5px; line-height: 1.7; color: var(--color-text); }
.dec-opt-cost { margin-top: 8px; font-size: 13px; line-height: 1.7; color: #B45309; }

/* 已定稿内容 */
.entry-box { border: none; padding: 0; background: transparent; box-shadow: none; }
.entry-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.entry-box .tag { padding: 0; background: transparent; color: var(--navy); font-size: 16px; font-weight: 800; border-radius: 0; letter-spacing: -0.5px; }

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
  color: var(--navy);
  letter-spacing: -0.4px;
  line-height: 1.4;
}
.md :deep(h1) { font-size: 24px; }
.md :deep(h2) { font-size: 20px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px; }
.md :deep(h3) { font-size: 16.5px; }
.md :deep(h4) { font-size: 14.5px; margin: 24px 0 10px; color: var(--navy-2); }
.md :deep(h5), .md :deep(h6) { font-size: 13.5px; margin: 20px 0 8px; font-weight: 600; color: var(--color-muted); }
.md :deep(p) { margin: 0 0 16px; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 16px; padding-left: 22px; }
.md :deep(li) { margin: 0 0 6px; }
.md :deep(li > p) { margin: 0; }
.md :deep(li > ul), .md :deep(li > ol) { margin: 6px 0 0; }
.md :deep(strong) { font-weight: 600; color: var(--navy); }
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
  background: var(--color-fill);
  border: 1px solid var(--color-border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  color: var(--navy-2);
}
.md :deep(pre) {
  margin: 0 0 16px;
  padding: 16px;
  border-radius: 10px;
  background: var(--navy);
  overflow-x: auto;
}
.md :deep(pre code) { padding: 0; border: none; background: transparent; color: #E8EEF6; line-height: 1.6; }
.md :deep(blockquote) {
  margin: 16px 0;
  padding: 12px 16px;
  background: var(--brand-soft);
  border-left: 3px solid var(--brand);
  border-radius: 0 8px 8px 0;
  color: var(--brand-ink);
  font-size: 14px;
}
.md :deep(blockquote p:last-child) { margin-bottom: 0; }

/* 表格 */
.md :deep(.md-table) {
  margin: 24px 0;
  overflow-x: auto; /* 圆角同时把里面那张表裁齐，所以边框/圆角挂在这一层而不是 table 上 */
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow);
  transition: box-shadow 0.3s;
}
.md :deep(.md-table:hover) { box-shadow: var(--shadow-lg); }
.md :deep(table) { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.md :deep(th) {
  background: var(--navy);
  color: #E8EEF6;
  text-align: left;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.5px;
  white-space: nowrap; /* 表头是短标签，断行会变成「竞\n品」 */
}
.md :deep(td) {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  color: var(--navy-2);
  vertical-align: top;
  min-width: 96px; /* 列宽的下限：再挤就横向滚动，不把中文压成竖排 */
}
.md :deep(tbody tr:hover td) { background: #F8FAFC; }
.md :deep(td p) { margin: 0; }
.md :deep(td ul), .md :deep(td ol) { margin: 0; padding-left: 18px; }

.md.md-preview {
  padding: 32px 40px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 20px rgba(0,0,0,0.03);
  min-height: 400px;
}

/* Intake：这一页只留一个去问卷页的入口，问卷本身在 ConsultIntake.vue */
.intake-link {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 16px; padding: 12px 14px;
  background: #FAFAFA; border: 1px solid var(--color-border); border-radius: 12px;
}
.intake-link .il-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.7; color: var(--color-muted); }

/* KB */
.brief-side textarea { width: 100%; box-sizing: border-box; padding: 16px; border: 1px solid var(--color-border); border-radius: 12px; font-size: 14px; line-height: 1.6; background: #FAFAFA; margin-bottom: 16px; transition: all 0.2s; }
.brief-side textarea:focus { outline: none; border-color: var(--brand); background: #fff; box-shadow: 0 0 0 3px var(--brand-soft); }
.kb-history { margin-top: 40px; }
.kb-history h4 { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.kb-item { display: block; width: 100%; text-align: left; padding: 16px; border: 1px solid var(--color-border); border-radius: 12px; background: #fff; margin-bottom: 12px; cursor: pointer; transition: border-color 0.2s; }
.kb-item:hover { border-color: var(--brand); box-shadow: var(--shadow-sm); }
.kb-item-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; font-weight: 700; color: var(--navy); }
.kb-item-text { font-size: 14px; color: var(--color-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
