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
  /** 'entry' = 定稿那一刻留在对话里的记录（服务端 chatService.entryToText 生成） */
  kind: 'text' | 'directions' | 'draft' | 'entry' | 'discard'
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

const chatOpen = ref(false)
const openMsgs = ref<Record<string, boolean>>({})
const directions = ref<Direction[] | null>(null)
const directionsStageKey = ref('')
const directionsVerdict = ref('')
const loadingDirections = ref(false)
const draft = ref<Draft | null>(null)
const draftStageKey = ref('')
const drafting = ref(false)
const draftTruncated = ref(false)
const draftDiscussion = ref<{ used: number; dropped: number } | null>(null)
/** 正在自动分析的阶段 key（空 = 这次是用户自己点的）。只用来换一句文案：
    用户没点任何按钮，界面上不说清「这是自动开始的、在花额度」的话，
    他会以为页面卡住了，接着去点「重新生成草稿」，于是同一步花两次额度。 */
const autoStage = ref('')
/**
 * 正在被分析的**那一步**的 key（手点的和自动跑的都记）。
 *
 * `drafting` / `loadingDirections` 是全局布尔，拿它当「转圈圈」的条件的话：在「看行业」
 * 自动分析的中途切到「看自己」，「看自己」的对话里也挂着一句「正在自动分析这一步」——
 * 而那一步压根没在跑，额度花在别的步上，出来的草稿也会出现在别的步里。用户会一直等，
 * 等到的是另一步的结果，两边都不报错。所以气泡只在 `runningStage === 当前步` 时出现，
 * 别的步在跑时改成明说「哪一步在跑」（顺便解释按钮为什么是灰的）。
 */
const runningStage = ref('')
/** 这次会话里已经自动跑过（或跑失败过）的步骤。失败也算 —— 不记的话
    「跑完补跑当前步」那条 watch 会对一个稳定失败的步骤无限重试，每次都扣额度。 */
const autoTried = new Set<string>()
const draftPreview = ref(true)
const savingEntry = ref(false)
const staledNote = ref<string[]>([])
const briefDraft = ref('')
const savingBrief = ref(false)
const briefSaved = ref(false)
const workspaceTab = ref<'task' | 'kb'>('task')
const workspaceOpen = ref(false) // Drawer state
const sidebarOpen = ref(true) // Sidebar state

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
const anyRunning = computed(() => !!runningStage.value || drafting.value || loadingDirections.value)

const selected = computed(() => stages.value.find(s => s.key === selectedKey.value) || null)
const entryOf = (key: string) => entries.value.find(e => e.stage_key === key) || null
const labelOf = (key: string) => stages.value.find(s => s.key === key)?.label || key
const decidedCount = computed(() => stages.value.filter(s => s.hasEntry).length)

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
    // 第一轮问卷没提交过就先回问卷页。**必须在挑阶段、自动分析之前 return** ——
    // 落在后面的话这一步已经花掉一次额度出了一版照缺料资料的草稿，而它读起来完全正常。
    // 只挡第一轮（`intakeRounds === 0`）：后面几轮也挡的话，客户还没回话的那几天
    // 他连自己的项目都打不开。跳过入口见 `intakeSkipped`。
    if (res.intake && !intakeRounds.value && !intakeSkipped()) {
      await router.replace(`/consult/projects/${projectId}/intake`)
      return
    }
    let entering = ''
    if (!selectedKey.value) {
      selectedKey.value = (stages.value.find(s => !s.hasEntry) || stages.value[0])?.key || ''
      entering = selectedKey.value
      await loadMessages(selectedKey.value)
    }
    // 进工作台就把当前这一步跑出来。放在 loadMessages 之后：反过来的话
    // loadMessages 那句 `messages.value = res.messages` 会把刚生成的草稿气泡抹掉
    // （草稿还在右栏，只是对话里少一条，看起来像它没生成过）。
    if (entering) await autoRun(entering)
  } catch (e: any) {
    err.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function select(key: string) {
  if (key === selectedKey.value) return
  if (draft.value && !confirm('当前草稿还没定稿，切换阶段会丢掉它。继续？')) return
  draft.value = null
  draftStageKey.value = ''
  draftTruncated.value = false
  draftDiscussion.value = null
  staledNote.value = []
  directions.value = null
  directionsStageKey.value = ''
  directionsVerdict.value = ''
  chatText.value = ''
  chatDropped.value = 0
  chatOpen.value = false
  selectedKey.value = key
  workspaceTab.value = 'task'

  if (window.innerWidth < 1024) {
    workspaceOpen.value = false
  }

  // 先等对话拉完再自动跑（理由同 load()：顺序反了那条草稿气泡会被覆盖掉）
  await loadMessages(key)
  if (key !== selectedKey.value) return
  await autoRun(key)
}

// ── 分析结果的兜底：不只等那次 POST 的返回 ──────────────────
//
// 那个返回**可能永远收不到**：页面热更新过、网络断一下、服务重启、手机息屏、代理掐掉
// 长连接。而服务端那一版已经落在对话记录里了（`appendMessage` 在 `res.json` 之前），
// 于是界面上剩一个永远转的圈圈加一排灰按钮，用户只能靠刷新页面才发现「其实已经出来了」
// —— 在那之前他会以为额度白花了，再点一次生成（又花一次）。所以分析期间每 8 秒去库里
// 看一眼这一步有没有新的产出，有就直接收下并把转圈圈停掉。
const POLL_MS = 8000
/** 等多久就认定这次真的没戏（8s × 30 = 4 分钟）。到点必须**出声**并把界面解开：
    一直转下去的话「还在跑」和「早就断了」在屏幕上是同一个样子。 */
const POLL_MAX_TICKS = 30
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
  autoStage.value = ''
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
        m => !seen.has(m.id) && (m.kind === 'draft' || m.kind === 'directions')
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
        `「${labelOf(key)}」等了 4 分钟还没有结果，先把界面解开。额度可能已经花掉了 —— ` +
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
 * **草稿也要恢复，不能只恢复方向。** 自动分析上线之后这条路是常态：进「看自己」自动出了
 * 草稿 → 切去别处看一眼 → 切回来。不恢复的话对话里挂着一张「已生成草稿」的卡片、点开
 * 右栏是空的，而 `round` 已经是 1 所以再也不会自动跑 —— 那一步看起来就是卡死了，
 * 而唯一的出路（再点一次「重新生成草稿」）要再花一次额度。
 *
 * **「已丢弃」也算一份产出**（`kind='discard'` 排在同一条时间线上找最后一条）：只找
 * draft/directions 的话，用户点过「丢弃草稿」，切走再切回来那一版又原样回来了 ——
 * 卡片、正文、置信度全在，看不出它已经被丢过一次。
 */
function restoreArtifact(key: string) {
  if (entryOf(key) || draft.value) return
  const last = [...messages.value]
    .reverse()
    .find(m => m.kind === 'directions' || m.kind === 'draft' || m.kind === 'discard')
  if (!last || last.kind === 'discard') return
  try {
    const p = JSON.parse(last.payload || '{}')
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
 * 出候选方向（慢车道）。`key` 在发请求**之前**就取好，返回时如果用户已经切走
 * 就只留服务端那份 stages，不往界面上挂 —— 原来这里取的是返回时的
 * `selected.value.key`，切走之后这几个方向会挂在**新**阶段的名下，
 * 选一个方向再定稿就存到别的阶段去了，而两步都没有任何报错。
 * 自动分析（`autoRun`）会让这种切换变成常态，所以必须挡住。
 */
async function loadDirections(key?: string, auto = false) {
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
    // stages 照样收下：服务端那一轮已经计上了，本地不更新的话切回来又会自动跑一次
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
    err.value = (auto ? '自动分析失败：' : '') + (e?.message || '出方向失败')
  } finally {
    clearRunState()
  }
}

function pickDirection(d: Direction) {
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
}

/** 出草稿（快车道 / 内容方案）。`key` 的取法和 `loadDirections` 同一条理由。 */
async function makeDraft(key?: string, auto = false) {
  const stageKey = key || selected.value?.key
  if (!stageKey) return
  // 右栏已经有一版就先问一句：新的一版是整个盖进去的，他在编辑器里改的那些没有任何
  // 地方留着（草稿不落库），而两次都显示成功。自动跑那条路进不来（autoRun 已经挡了
  // 「这一步有草稿」的情况），所以只问手点的这条。
  if (!auto && draft.value && draftStageKey.value === stageKey) {
    if (!confirm('重出一版会覆盖右栏现在这一版（包括你改过的部分），并再花 1 次 AI 额度。继续？')) return
  }
  drafting.value = true
  runningStage.value = stageKey
  err.value = ''
  staledNote.value = []
  startRunPoll(stageKey)
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
    err.value = (auto ? '自动分析失败：' : '') + (e?.message || '出草稿失败')
  } finally {
    clearRunState()
  }
}

/**
 * 进入一个阶段时自动分析一次。
 *
 * 判据是「这一步压根还没跑过」：`round === 0 && !hasEntry`。少了这两条的话每次点回
 * 这一步都重跑一次 —— 白扣一次额度，还会把用户正在右栏改的那版草稿顶掉，两件事都不报错。
 * stale（上游改了建议重跑）**故意不自动跑**：那一步已经有定稿了，自动覆盖等于把他
 * 确认过的结论换成一版没人看过的。锁住的步骤当然也不跑（前置没定稿，出来的是编的）。
 */
async function autoRun(key: string) {
  if (autoTried.has(key)) return
  const s = stages.value.find(x => x.key === key)
  if (!s || !s.unlocked || s.hasEntry || s.round > 0) return
  // 一次只跑一个：全局的 drafting/loadingDirections 被第二个调用覆盖之后，
  // 先结束的那个会把 loading 关掉，界面上另一步就成了「没在跑」而它还在花额度。
  if (runningStage.value) return
  if (draftStageKey.value === key || directionsStageKey.value === key) return
  autoStage.value = key
  autoTried.add(key)
  try {
    if (s.lane === 'slow') await loadDirections(key, true)
    else await makeDraft(key, true)
  } finally {
    autoStage.value = ''
  }
}

/**
 * 上一步跑完了，补跑用户现在停在的那一步。
 *
 * 上面那句 `if (runningStage.value) return` 单独存在的话是个静默丢弃：在「看行业」分析
 * 的中途切到「看自己」，「看自己」这一辈子都不会自动分析了 —— 右栏空的、对话空的，
 * 读起来就是「这一步本来就没东西」，而它其实是被跳过的。
 */
watch(runningStage, (now, before) => {
  if (now || !before) return
  if (selectedKey.value) void autoRun(selectedKey.value)
})

function editEntry() {
  const e = selected.value && entryOf(selected.value.key)
  if (!e) return
  draft.value = {
    conclusion: e.conclusion,
    body: e.body || '',
    rationale: e.rationale,
    evidence: e.evidence,
    gaps: [],
  }
  draftStageKey.value = selected.value!.key
  draftTruncated.value = false
  draftDiscussion.value = null
  openWorkspace('task')
}

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

        <!-- Chat messages -->
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
                <strong>{{ m.kind === 'draft' ? '已生成草稿' : '已生成候选方向' }}</strong>
                <!-- 作废的卡片要明说点不开：留着「查看 →」的话点了什么都不发生 -->
                <span>{{ discardedMsgs[m.id] ? '这一版已丢弃，右侧工作区里没有它了' : '点击在右侧工作区查看详情' }}</span>
              </div>
              <div v-if="!discardedMsgs[m.id]" class="artifact-action">查看 →</div>
              <div v-else class="artifact-action muted">已丢弃</div>
            </div>
          </div>
        </div>
        
        <!-- 自动分析/对话思考中的 loading 状态 -->
        <!-- 如果是自动跑（runningStage）或者正在对话（chatting），都显示思考气泡 -->
        <div v-if="(runningStage && runningStage === selectedKey) || chatting" class="msg assistant">
          <div class="msg-avatar">AI</div>
          <div class="msg-content">
            <div class="msg-bubble loading-bubble">
              <span class="loading-dots">
                {{ chatting ? '思考中' : (autoStage ? '正在自动分析这一步' : '思考中') }}<span>.</span><span>.</span><span>.</span>
              </span>
              <div v-if="autoStage && !chatting" class="loading-sub">
                第一次进入这一步会自动跑一遍（消耗 1 次 AI 额度），通常 30–60 秒。
                别刷新，也不用再点「{{ isDraftLane ? '重新生成草稿' : '生成新方向' }}」——
                那会再花一次额度。
              </div>
            </div>
          </div>
        </div>
        <!-- 别的步在跑：这一步的按钮是灰的，不说清哪一步在跑的话看起来像界面坏了 -->
        <div v-else-if="runningStage" class="other-running">
          ⏳ 「{{ labelOf(runningStage) }}」正在分析中，结果会出现在那一步里。
          这一步要等它跑完（同时跑两个会互相顶掉），跑完会自动接着分析这一步。
        </div>
        
        <!-- Bottom spacing for capsule -->
        <div class="chat-bottom-spacer"></div>
      </div>

      <!-- Floating Input Capsule -->
      <div class="input-capsule-wrapper" v-if="selected && selected.unlocked">
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
            <button
              v-if="isDraftLane"
              class="btn-ghost small"
              :disabled="drafting || stageBusy"
              :title="runningStage && runningStage !== selectedKey ? `「${labelOf(runningStage)}」正在分析中` : ''"
              @click="makeDraft()"
            >
               重新生成草稿
            </button>
            <button
              v-if="!isDraftLane"
              class="btn-ghost small"
              :disabled="loadingDirections || stageBusy"
              :title="runningStage && runningStage !== selectedKey ? `「${labelOf(runningStage)}」正在分析中` : ''"
              @click="loadDirections()"
            >
               生成新方向
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
                <div class="draft-actions">
                  <button class="btn-primary" :disabled="stageBusy" @click="pickDirection(d)">采纳此方向</button>
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

            <!-- 已定稿内容 -->
            <div v-else-if="entryOf(selected.key)" class="entry-box">
              <div class="entry-head">
                <span class="tag">✅ 已定稿 (v{{ entryOf(selected.key)!.version }})</span>
                <span v-if="entryOf(selected.key)!.stale" class="tag warn">⚠ 建议重跑</span>
              </div>
              <p class="entry-conclusion">{{ entryOf(selected.key)!.conclusion }}</p>
              <div v-if="entryOf(selected.key)!.body" class="md" v-html="md(entryOf(selected.key)!.body)"></div>
              <div class="draft-actions">
                <!-- 正在重出一版时也停：editEntry 把定稿抄进草稿编辑器，而那一版一到
                     就把编辑器整个换掉，他刚开始改的东西没了。 -->
                <button class="btn-ghost" :disabled="stageBusy" @click="editEntry">修改定稿</button>
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
  margin: 0 auto 32px;
  max-width: 800px;
  width: 100%;
  flex-shrink: 0; /* 修复由于处于 flex 容器中导致的底部截断问题 */
}

.intro-header {
  padding-bottom: 24px;
}

.intro-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-badge {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 4px 10px;
  border-radius: 6px;
  flex-shrink: 0;
}

.stage-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--navy);
  margin: 0;
  flex-shrink: 0;
}

.stage-question {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0;
  line-height: 1.6;
  font-weight: 500;
  margin-left: 8px;
  padding-left: 16px;
  border-left: 2px solid rgba(0,0,0,0.06);
}

/* Collapsible Methodology */
.intro-methodology {
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-top: 16px;
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
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
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

.msg-content {
  max-width: 85%;
  display: flex; flex-direction: column; gap: 8px;
}
.msg.user .msg-content { align-items: flex-end; }

.msg-bubble {
  padding: 16px 20px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.6;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: var(--shadow-sm);
  color: var(--navy-2);
}
.msg.user .msg-bubble {
  background: var(--brand);
  color: #fff;
  border: none;
  border-top-right-radius: 4px;
  white-space: pre-wrap;
}
.msg.user .msg-bubble.user-pick {
  background: var(--brand-soft);
  color: var(--brand-ink);
  border: 1px solid rgba(59, 91, 219, 0.2);
  font-size: 14px;
}
.msg.user .msg-bubble.user-pick strong {
  font-size: 15px;
}
.msg.user .msg-bubble.user-pick blockquote {
  margin: 8px 0 0;
  padding-left: 12px;
  border-left: 3px solid rgba(59, 91, 219, 0.3);
  color: var(--navy-2);
  font-size: 13px;
}
.msg.assistant .msg-bubble { border-top-left-radius: 4px; }

.msg-artifact {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 20px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}
.msg-artifact:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow);
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

.loading-bubble { background: transparent; border: none; box-shadow: none; padding: 10px 0; }
.loading-dots { font-weight: 600; color: var(--color-soft); }
.loading-dots span { animation: blink 1.4s infinite both; }
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }
.loading-sub {
  margin-top: 6px; max-width: 520px;
  font-size: 12px; line-height: 1.8; color: var(--color-soft);
}
@keyframes blink { 0% { opacity: .2; } 20% { opacity: 1; } 100% { opacity: .2; } }

/* 定稿气泡：和普通回答区分开（左边一条绿边），否则它读起来像 AI 又说了一段话 */
.entry-msg { border-left: 3px solid #10B981; }
.entry-msg :deep(p:last-of-type) { margin-bottom: 8px; }

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
  /* column：分析中那条说明要压在输入条**上面**一行，横排的话它会把输入条挤窄 */
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
/* 为什么现在不能说话。放在输入条正上方 —— 只把它变灰的话，读起来是「界面坏了」 */
.capsule-note {
  pointer-events: auto;
  width: 100%; max-width: 700px;
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
.locked-capsule {
  padding: 16px 32px;
  background: rgba(255,255,255,0.8);
  backdrop-filter: blur(12px);
  border-radius: 999px;
  border: 1px solid var(--color-border);
  font-size: 14px; font-weight: 600; color: var(--color-soft);
  box-shadow: var(--shadow);
}

.input-capsule {
  pointer-events: auto;
  width: 100%; max-width: 800px;
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
.draft-tag { padding: 0; background: transparent; color: var(--navy); font-size: 16px; font-weight: 800; border-radius: 0; letter-spacing: -0.5px; }

/* 正在重出一版：这块内容马上会被换掉。按钮变灰不解释的话，读起来是「保存不了了」 */
.draft-busy {
  margin-bottom: 20px; padding: 12px 16px;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px;
  font-size: 12px; line-height: 1.8; color: #92400E;
}

.inline-gaps {
  margin-bottom: 24px;
  padding: 16px;
  background: rgba(255, 251, 235, 0.6);
  border-radius: 12px;
  border: 1px solid rgba(253, 230, 138, 0.5);
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

.dir-card { padding: 24px; border-top: 4px solid transparent; transition: border-color 0.2s, box-shadow 0.2s; background: #fff; border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 16px; }
.dir-card:hover { border-color: var(--brand); box-shadow: var(--shadow-lg); }

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
