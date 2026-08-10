<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import FeishuErrorDetail, { type FeishuErrorDetailData } from '../../components/feishu/FeishuErrorDetail.vue'
import {
  COMMAND_STATUS_OPTIONS,
  chatLabel,
  commandChatLabel as cmdChatLabel,
  commandChatOptionLabel as cmdChatOptionLabel,
  commandStatusLabel as statusLabel,
  connStateClass as stateClass,
  connStateLabel as stateLabel,
  dirStateClass,
  dirStateLabel,
  fmtTime,
  prettyParams,
  resultSummary,
  type FeishuChatLabelled,
  type FeishuChatRow,
} from '../../lib/feishu'

// 飞书助理的自助配置台。
//
// 这个页面要解决的是接入过程里最容易卡住的三件事：
// 1. 飞书后台要开哪些权限 —— 权限漏一项时飞书只回一个 error code，
//    自己猜要来回几轮，所以 /capabilities 把清单直接列出来。
// 2. 连上了没 —— 长连接是我们主动连出去的，用户在飞书后台看不到任何迹象，
//    所以必须在这里显示实时状态。
// 3. @ 了没反应是哪一步断的 —— 靠指令日志区分"事件没收到 / 意图没解析出 / 接口报错"。

interface AppView {
  id: string
  name: string
  app_id: string
  /** 已脱敏，仅供展示 */
  app_secret: string
  enabled: boolean
  allowed_chats: string[]
  conn_state: string
  conn_error: string | null
  conn_at: string | null
  live_state: string
  /** 组织架构名册的同步状态。名册决定了「私聊里能不能指名同事」。 */
  dir_sync_state: string
  dir_sync_error: string | null
  dir_sync_at: string | null
  dir_user_count: number
  /** 'contact' = 全公司通讯录；'chats' = 只有机器人所在群的成员 */
  dir_source: string
  /** 本企业的补充规则（059）。空串 = 用平台默认那份。 */
  intent_supplement: string
  updated_at: string
}

interface DirectoryUser {
  open_id: string
  name: string
  en_name: string
  department_names: string
  job_title: string
  is_resigned: number
}

interface CommandRow {
  id: string
  app_id: string
  chat_id: string
  chat_type: string
  /** 群名。飞书后台不给的时候是空串（要 `im:chat:readonly`，那不是必需权限）。 */
  chat_name: string
  /** 这个群绑的项目名。空串 = 这个群没建项目。 */
  project_name: string
  sender_name: string
  text: string
  action: string | null
  params: string | null
  status: string
  error: string | null
  /** 结构化失败原因。缺权限时渲染成一键补权限，见 FeishuErrorDetail.vue。 */
  error_detail: FeishuErrorDetailData | null
  result: string | null
  duration_ms: number | null
  created_at: string
}

/** 日志页「按项目群筛」下拉的一项。文字由 lib/feishu 的 commandChatOptionLabel 算。 */
type CommandChatOption = FeishuChatLabelled

/** 项目日记的一行。逐条记录只读 —— 记录只能通过在飞书群里 @ 助理产生。 */
interface DiaryProject {
  id: string
  name: string
  chat_id: string
  chat_name: string
  /** 「记录」表的可点链接。空串 = 建表那一步失败过。 */
  url: string
  /** 「复盘」表（同一个 base 的第二张表）。完整版总结在这里。 */
  review_url: string
  link_share_closed: boolean
  /** false = 当初写进项目总表失败了，下次在群里记录会自动补登记。 */
  in_index: boolean
  created_by_name: string
  created_at: string
  record_count: number
  /**
   * record_count 里有多少条是 AI 从群聊归纳的（不是谁的原话）。
   * 单独显示，不混进总数：40 条记录读起来像 40 条一手事实，
   * 而其中 30 条可能是自动生成的。
   */
  digest_count: number
  /** 库里有、多维表格里还没有的条数。补推跟着下一次记录发生，没有定时任务。 */
  unsynced_count: number
  last_record_ms: number | null
  summary_count: number
  last_summary_at: string | null
  task_count: number
  /** 未完成（待办 / 进行中）的条数。 */
  open_task_count: number
  /** 任务里还没推进多维表格的条数。和 unsynced_count 同理，必须露出来。 */
  unsynced_task_count: number
}

interface DiaryRecord {
  id: string
  content: string
  author_name: string
  created_ms: number
  created_at: string
  synced: boolean
  /**
   * 'manual' = 人说的原话，'chat_digest' = AI 从群聊归纳的。
   * 必须标出来：这张表的价值全在「当时到底怎么说的」，
   * 而归纳的那些和原话并排放着。
   */
  origin: 'manual' | 'chat_digest'
}

interface DiarySummary {
  id: string
  range_label: string
  record_count: number
  summary: string
  created_by_name: string
  created_at: string
  synced: boolean
}

type Tab = 'apps' | 'diary' | 'directory' | 'rules' | 'logs' | 'guide'

const activeTab = ref<Tab>('apps')

const apps = ref<AppView[]>([])
const capabilities = ref<{
  actions: any[]
  scopes: string[]
  directory_scopes: string[]
  /** 开了才多一个功能的权限点，按功能分组。不开也能用助理的其余全部功能。 */
  optional_scopes: Array<{ scopes: string[]; feature: string }>
  events: string[]
  /** 应用没填补充规则时实际生效的那份，「填入示例模板」按钮用它。 */
  default_supplement: string
} | null>(null)
const loading = ref(false)
const saving = ref(false)

// 编辑中的应用。id 为空表示新增。
const draft = ref({ id: '', name: '', app_id: '', app_secret: '', enabled: true, allowedChats: [] as string[] })
const showForm = ref(false)
const manualChatId = ref('')

// ---- 机器人见过的群 ----
// 白名单以前要手打 `oc_xxx`，而这串 id 在飞书客户端里根本看不到，
// 于是唯一可行的配法是「先留空（不设防）跑一遍 → 去日志里抄 id → 回来粘上」，
// 最后一步基本没人做。这份清单就是为了把它变成勾选。
const chatsByApp = ref<Record<string, { chats: FeishuChatRow[]; allowlist_empty: boolean }>>({})

/** 清单是辅助信息：拉不到就当没有，不能挡住绑定和编辑。 */
async function loadChatsFor(list: AppView[]) {
  await Promise.all(
    list.map(async (app) => {
      try {
        const res = await apiGet<{ chats: FeishuChatRow[]; allowlist_empty: boolean }>(
          `/api/feishu-assistant/apps/${app.id}/chats`
        )
        chatsByApp.value = { ...chatsByApp.value, [app.id]: res }
      } catch (e) {
        console.error(e)
      }
    })
  )
}

/** 被白名单拦下过、且现在仍然没放行的群。用户口中的「@ 了没反应」就是这些。 */
function blockedChats(app: AppView): FeishuChatRow[] {
  return (chatsByApp.value[app.id]?.chats || []).filter((c) => c.reject_count > 0 && !c.in_allowlist)
}

/** 表单里列出来的候选群。 */
type ChatChoice = FeishuChatRow & { unknown?: boolean }

const formChats = computed<ChatChoice[]>(() => {
  const known: ChatChoice[] = (draft.value.id ? chatsByApp.value[draft.value.id]?.chats : undefined) || []
  const ids = new Set(known.map((c) => c.chat_id))
  // 白名单里有、但清单里没有的 id 也要列出来（并保持勾选）：只渲染清单的话，
  // 保存动作会静默把它们删掉 —— 表现是一个本来正常的群突然不响应了。
  const orphans: ChatChoice[] = draft.value.allowedChats
    .filter((id) => !ids.has(id))
    .map((id) => ({
      chat_id: id,
      name: '',
      chat_type: 'group',
      source: 'manual',
      reject_count: 0,
      last_seen_at: '',
      last_rejected_at: null,
      in_allowlist: true,
      unknown: true,
    }))
  return [...known, ...orphans]
})

function toggleChat(chatId: string) {
  const list = draft.value.allowedChats
  const i = list.indexOf(chatId)
  if (i >= 0) list.splice(i, 1)
  else list.push(chatId)
}

function addManualChat() {
  const id = manualChatId.value.trim()
  if (!id) return
  if (!draft.value.allowedChats.includes(id)) draft.value.allowedChats.push(id)
  manualChatId.value = ''
}

// ---- 本企业的补充规则（059）----
// 这段话只用来让助理听懂本公司的说法（术语、简称、时间口语）。
// 按应用存，因为一个应用 = 一家企业；同一个账号帮两家公司各绑一个应用时，
// 两段规则不能互相污染。
const rulesAppId = ref('')
const rulesText = ref('')
const rulesSaving = ref(false)
const rulesSaved = ref(false)

const rulesApp = computed(() => apps.value.find((a) => a.id === rulesAppId.value))

/** 用户改过、还没保存。切应用/离开页面前用它提醒一次，否则那段话就白写了。 */
const rulesDirty = computed(() => rulesText.value !== (rulesApp.value?.intent_supplement ?? ''))

function pickRulesApp(id: string) {
  if (rulesDirty.value && !confirm('当前的补充规则还没保存，切换应用会丢掉改动。继续？')) return
  rulesAppId.value = id
  rulesText.value = apps.value.find((a) => a.id === id)?.intent_supplement ?? ''
  rulesSaved.value = false
}

async function saveRules() {
  const app = rulesApp.value
  if (!app) return
  rulesSaving.value = true
  try {
    const res = await apiPut<{ app: AppView }>(
      `/api/feishu-assistant/apps/${app.id}/intent-supplement`,
      { text: rulesText.value }
    )
    // 就地替换那一行，而不是 loadAll()：整页重载会把用户正在看的这段文本
    // 换成服务端返回的版本，视觉上像是"内容跳了一下"。
    apps.value = apps.value.map((a) => (a.id === app.id ? { ...a, ...res.app } : a))
    rulesText.value = res.app.intent_supplement
    rulesSaved.value = true
  } catch (e: any) {
    alert(e?.message || '保存失败')
  } finally {
    rulesSaving.value = false
  }
}

// ---- 项目日记 ----
// 这一页**除了删掉整个项目之外是只读的**，理由和群里只给 view 权限是同一条：
// 同步是只追加的，网页上删掉一条记录，多维表格里那行永远不会被删掉，库和表从此不一致。
// 要改就在群里 @ 助理说，那条路径每步都有记录人和时间。
// 删整个项目是例外，因为它不试图和表格保持一致 —— 飞书那侧一个字都不动，
// 只是助理不再认识那几张表（于是删除回执里必须把链接给出来，见 diaryDeleted）。
//
// 页面存在的理由是那些多维表格**在飞书里搜不到**（建表时没传 folder_token，
// 链接分享也是关掉的）。群里能 @ 助理问「有哪些项目」，但那要求你在群里。
const diaryAppId = ref('')
const diaryIndex = ref<{ url: string; link_share_closed: boolean } | null>(null)
const diaryProjects = ref<DiaryProject[]>([])
const diaryLoading = ref(false)
/** 展开看日志的那个项目。null = 只看清单。 */
const diaryOpenId = ref<string | null>(null)
const diaryView = ref<'records' | 'summaries'>('records')
const diaryRecords = ref<DiaryRecord[]>([])
const diarySummaries = ref<DiarySummary[]>([])
const diaryDetailTotal = ref(0)
const diaryDetailPage = ref(1)
const DIARY_PAGE_SIZE = 50
const diaryDetailLoading = ref(false)

const diaryApp = computed(() => apps.value.find((a) => a.app_id === diaryAppId.value))
const diaryDetailPages = computed(() => Math.max(1, Math.ceil(diaryDetailTotal.value / DIARY_PAGE_SIZE)))

/**
 * 库里有、表里还没有的总条数。非 0 时要在页面上说清楚，否则「表里少几条」查不出原因。
 *
 * 记录和任务**加在一起**：这条横幅回答的是「表里为什么少东西」，
 * 而用户不会先分清少的是记录还是任务。分开报在每个项目那一行上。
 */
const diaryUnsyncedTotal = computed(() =>
  diaryProjects.value.reduce((n, p) => n + p.unsynced_count + p.unsynced_task_count, 0)
)

async function loadDiary() {
  const app = diaryApp.value
  if (!app) { diaryProjects.value = []; diaryIndex.value = null; return }
  diaryLoading.value = true
  try {
    const res = await apiGet<{ index: typeof diaryIndex.value; projects: DiaryProject[] }>(
      `/api/feishu-assistant/apps/${app.id}/diary/projects`
    )
    diaryIndex.value = res.index
    diaryProjects.value = res.projects
  } catch (e: any) {
    console.error(e)
  } finally {
    diaryLoading.value = false
  }
}

async function loadDiaryDetail() {
  const app = diaryApp.value
  const pid = diaryOpenId.value
  if (!app || !pid) return
  diaryDetailLoading.value = true
  try {
    if (diaryView.value === 'records') {
      const res = await apiGet<{ records: DiaryRecord[]; total: number }>(
        `/api/feishu-assistant/apps/${app.id}/diary/projects/${pid}/records`,
        { page: diaryDetailPage.value, page_size: DIARY_PAGE_SIZE }
      )
      diaryRecords.value = res.records
      diaryDetailTotal.value = res.total
    } else {
      const res = await apiGet<{ summaries: DiarySummary[]; total: number }>(
        `/api/feishu-assistant/apps/${app.id}/diary/projects/${pid}/summaries`,
        { page: diaryDetailPage.value, page_size: DIARY_PAGE_SIZE }
      )
      diarySummaries.value = res.summaries
      diaryDetailTotal.value = res.total
    }
  } catch (e: any) {
    console.error(e)
  } finally {
    diaryDetailLoading.value = false
  }
}

function openDiaryProject(p: DiaryProject) {
  // 再点一次收起：清单本身就是这一页的主视图。
  if (diaryOpenId.value === p.id) { diaryOpenId.value = null; return }
  diaryOpenId.value = p.id
  diaryView.value = 'records'
  diaryDetailPage.value = 1
  diaryRecords.value = []
  diarySummaries.value = []
  loadDiaryDetail()
}

function switchDiaryView(v: 'records' | 'summaries') {
  if (diaryView.value === v) return
  diaryView.value = v
  diaryDetailPage.value = 1
  loadDiaryDetail()
}

function goDiaryPage(n: number) {
  if (n < 1 || n > diaryDetailPages.value) return
  diaryDetailPage.value = n
  loadDiaryDetail()
}

/**
 * 删掉项目之后的回执。**留在页面上，不用 alert**。
 *
 * 那几张多维表格在飞书里搜不到（建表时没传 folder_token，链接分享是关掉的），
 * 而项目行一删，助理就不再认识它们、群里问「有哪些项目」也不会再列出来 ——
 * 这份回执里的链接是最后一次拿到它们的机会。用 alert 的话用户点掉「确定」
 * 就没了，而这个操作看起来只是"删掉了一个条目"。
 */
const diaryDeleted = ref<{
  name: string
  record_count: number
  summary_count: number
  log_url: string
  review_url: string
  task_url: string
  still_in_index: boolean
} | null>(null)
const diaryDeleting = ref('')

async function removeDiaryProject(p: DiaryProject) {
  const app = diaryApp.value
  if (!app) return
  // 说清三件事：库里丢什么、飞书里不丢什么、这个群之后会怎样。
  // 只写「确定删除吗」的话，用户以为连飞书表格一起删了（或者反过来以为什么都没删）。
  if (
    !confirm(
      `确定删除项目「${p.name}」吗？\n\n` +
        `· 会删掉本系统里的 ${p.record_count} 条日志记录、${p.summary_count} 次复盘，助理不再认识这个项目。\n` +
        `· 飞书多维表格（日志表 / 复盘表 / 任务管理表）**不会被删除**，删完会把链接列给你 —— ` +
        `那些表在飞书里搜不到，链接丢了就找不回。\n` +
        `· 「${p.chat_name || '这个群'}」之后可以重新新建项目，但会另建一套新表，和老表没有关系。`
    )
  )
    return
  diaryDeleting.value = p.id
  try {
    const res = await apiDelete<{ deleted: NonNullable<typeof diaryDeleted.value> }>(
      `/api/feishu-assistant/apps/${app.id}/diary/projects/${p.id}`
    )
    diaryDeleted.value = res.deleted
    if (diaryOpenId.value === p.id) diaryOpenId.value = null
    await loadDiary()
  } catch (e: any) {
    alert(e?.message || '删除失败')
  } finally {
    diaryDeleting.value = ''
  }
}

function pickDiaryApp() {
  diaryOpenId.value = null
  // 回执属于上一个应用，换应用后留着会指向另一家公司的表。
  diaryDeleted.value = null
  loadDiary()
}

const commands = ref<CommandRow[]>([])
const cmdTotal = ref(0)
const cmdStatus = ref('')
const cmdAppId = ref('')
/** 按项目群筛。空 = 全部群。选项只在选定了应用之后才有（见后端注释）。 */
const cmdChatId = ref('')
const cmdChats = ref<CommandChatOption[]>([])
const cmdPage = ref(1)
const CMD_PAGE_SIZE = 20
const expanded = ref<Record<string, boolean>>({})


// ---- 组织架构名册 ----
const dirAppId = ref('')
const dirUsers = ref<DirectoryUser[]>([])
const dirTotal = ref(0)
const dirQuery = ref('')
const dirPage = ref(1)
const DIR_PAGE_SIZE = 50
const dirLoading = ref(false)
const syncing = ref(false)

/** 名册页当前看的是哪个应用。同步状态挂在应用行上，不是名册接口里。 */
const dirApp = computed(() => apps.value.find((a) => a.app_id === dirAppId.value))
const dirTotalPages = computed(() => Math.max(1, Math.ceil(dirTotal.value / DIR_PAGE_SIZE)))

// 日志/同步轮询。刚下过指令时用户会盯着这个页面看结果，
// 而执行是异步的（先回飞书成功，再慢慢跑），不轮询就得手动刷。
// 名册同步同理：接口是 202 立刻返回，真正跑完要几十秒。
let pollTimer: ReturnType<typeof setInterval> | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(cmdTotal.value / CMD_PAGE_SIZE)))

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '飞书助理配置需要登录')
    return
  }
  loadAll()
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

async function loadAll() {
  loading.value = true
  try {
    const [appsRes, capRes] = await Promise.all([
      apiGet<{ apps: AppView[] }>('/api/feishu-assistant/apps'),
      apiGet<any>('/api/feishu-assistant/capabilities'),
    ])
    apps.value = appsRes.apps
    capabilities.value = capRes
    await loadChatsFor(appsRes.apps)
  } catch (e: any) {
    alert(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadCommands() {
  try {
    const res = await apiGet<{ commands: CommandRow[]; total: number; chats: CommandChatOption[] }>(
      '/api/feishu-assistant/commands',
      {
        status: cmdStatus.value || undefined,
        app_id: cmdAppId.value || undefined,
        chat_id: cmdChatId.value || undefined,
        page: cmdPage.value,
        // 后端 parsePagination 读的是 page_size（下划线），传 pageSize 会被忽略。
        page_size: CMD_PAGE_SIZE,
      }
    )
    commands.value = res.commands
    cmdTotal.value = res.total
    cmdChats.value = res.chats || []
  } catch (e: any) {
    console.error(e)
  }
}

/**
 * 换应用时必须清掉群筛选。
 *
 * 不清的话，选了 A 应用的某个群、再切到 B 应用，chat_id 还挂在请求上 ——
 * 结果永远是空列表，而下拉里那一项已经不在选项里了，页面上看不出为什么空。
 */
function pickCmdApp() {
  cmdChatId.value = ''
  applyCmdFilter()
}

async function loadDirectory() {
  if (!dirAppId.value) { dirUsers.value = []; dirTotal.value = 0; return }
  const app = apps.value.find((a) => a.app_id === dirAppId.value)
  if (!app) return
  dirLoading.value = true
  try {
    const res = await apiGet<{ users: DirectoryUser[]; total: number }>(
      `/api/feishu-assistant/apps/${app.id}/directory`,
      { q: dirQuery.value || undefined, page: dirPage.value, page_size: DIR_PAGE_SIZE }
    )
    dirUsers.value = res.users
    dirTotal.value = res.total
  } catch (e: any) {
    console.error(e)
  } finally {
    dirLoading.value = false
  }
}

/**
 * 同步期间要同时刷「应用列表」（同步状态挂在那上面）和名册本身。
 * 同步跑完（状态不再是 syncing）就停掉轮询，别一直打接口。
 */
async function pollDirectory() {
  await loadAll()
  await loadDirectory()
  if (dirApp.value?.dir_sync_state !== 'syncing') {
    syncing.value = false
    if (pollTimer && activeTab.value === 'directory') { clearInterval(pollTimer); pollTimer = null }
  }
}

async function syncDirectory() {
  const app = dirApp.value
  if (!app) { alert('请先选择一个应用'); return }
  syncing.value = true
  try {
    await apiPost(`/api/feishu-assistant/apps/${app.id}/directory/sync`)
    // 接口是 202：已受理，还没跑完。所以这里不刷新一次就完事，要轮询。
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(pollDirectory, 3000)
  } catch (e: any) {
    syncing.value = false
    alert(e?.message || '同步失败')
  }
}

function applyDirFilter() {
  dirPage.value = 1
  loadDirectory()
}

function goDirPage(n: number) {
  if (n < 1 || n > dirTotalPages.value) return
  dirPage.value = n
  loadDirectory()
}

function switchTab(tab: Tab) {
  activeTab.value = tab
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (tab === 'rules') {
    // 默认选第一个应用，和「组织架构」页一致：绝大多数账号只绑了一个。
    // 已经选过就别重置 —— 那会把用户写了一半、还没保存的文本冲掉。
    if (!rulesAppId.value && apps.value.length) pickRulesApp(apps.value[0].id)
  }
  if (tab === 'diary') {
    // 默认选第一个应用，和「组织架构」页一致。
    if (!diaryAppId.value && apps.value.length) diaryAppId.value = apps.value[0].app_id
    loadDiary()
  }
  if (tab === 'logs') {
    // 默认选中第一个应用，和「项目日记」「组织架构」两页一致。
    // 这里还多一层理由：**按项目群筛的下拉只在选定应用后才有内容**
    // （不同租户的群名会重名，混在一个下拉里选出来的结果对不上预期），
    // 而按项目分正是这一页最常用的看法。停在「全部应用」等于默认藏起这个筛选。
    if (!cmdAppId.value && apps.value.length) cmdAppId.value = apps.value[0].app_id
    loadCommands()
    // pending/running 的指令几秒内就会变成终态，5 秒够用又不至于打接口太狠。
    pollTimer = setInterval(loadCommands, 5000)
  }
  if (tab === 'directory') {
    // 默认选第一个应用：绝大多数账号只绑了一个，让他再点一次选择框没意义。
    if (!dirAppId.value && apps.value.length) dirAppId.value = apps.value[0].app_id
    loadDirectory()
    // 上次同步还在跑（比如刚绑完应用触发了自动同步，用户直接切过来）时接着轮询。
    if (dirApp.value?.dir_sync_state === 'syncing') {
      syncing.value = true
      pollTimer = setInterval(pollDirectory, 3000)
    }
  }
}

function openCreate() {
  draft.value = { id: '', name: '飞书助理', app_id: '', app_secret: '', enabled: true, allowedChats: [] }
  manualChatId.value = ''
  showForm.value = true
}

function openEdit(app: AppView) {
  draft.value = {
    id: app.id,
    name: app.name,
    app_id: app.app_id,
    // 密钥不回显。留空 = 不改（后端 resolveSubmittedSecret 会保留原值）。
    app_secret: '',
    enabled: app.enabled,
    allowedChats: [...(app.allowed_chats || [])],
  }
  manualChatId.value = ''
  showForm.value = true
}

/** 从「@ 过但被拦」的提示里一键放行，不用先进编辑表单。 */
async function allowChat(app: AppView, chatId: string) {
  try {
    await apiPost('/api/feishu-assistant/apps', {
      id: app.id,
      name: app.name,
      app_id: app.app_id,
      enabled: app.enabled,
      allowed_chats: [...(app.allowed_chats || []), chatId],
    })
    await loadAll()
  } catch (e: any) {
    alert(e?.message || '操作失败')
  }
}

async function saveApp() {
  if (!draft.value.app_id.trim()) { alert('请填写 App ID'); return }
  if (!draft.value.id && !draft.value.app_secret.trim()) { alert('请填写 App Secret'); return }

  saving.value = true
  try {
    const res = await apiPost<any>('/api/feishu-assistant/apps', {
      id: draft.value.id || undefined,
      name: draft.value.name,
      app_id: draft.value.app_id.trim(),
      // 编辑时留空就不传，后端据此保留原密钥。
      app_secret: draft.value.app_secret.trim() || undefined,
      enabled: draft.value.enabled,
      allowed_chats: draft.value.allowedChats,
    })
    showForm.value = false
    await loadAll()
    // 保存成功但建连失败要单独说 —— 凭证填错是最常见的情况，
    // 只提示"已保存"会让用户以为可以去飞书里试了。
    //
    // 排查方向由后端给（connection.ts:explainConnectError 按 SDK 的错误码分类）。
    // 这里不再追加「请核对 App ID / App Secret」——网络不通时那句是错的方向，
    // 而它曾经无条件出现在每一种失败后面。
    if (res.conn_error) {
      alert(`配置已保存，但长连接没建起来：\n${res.conn_error}`)
    }
  } catch (e: any) {
    alert(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeApp(app: AppView) {
  if (!confirm(`确定删除「${app.name}」的绑定吗？删除后飞书里 @ 这个机器人不会再有响应。`)) return
  try {
    await apiDelete(`/api/feishu-assistant/apps/${app.id}`)
    await loadAll()
  } catch (e: any) {
    alert(e?.message || '删除失败')
  }
}

async function reconnect(app: AppView) {
  try {
    await apiPost(`/api/feishu-assistant/apps/${app.id}/reconnect`)
    await loadAll()
  } catch (e: any) {
    alert(e?.message || '重连失败')
  }
}

async function toggleEnabled(app: AppView) {
  try {
    await apiPost('/api/feishu-assistant/apps', {
      id: app.id,
      name: app.name,
      app_id: app.app_id,
      enabled: !app.enabled,
      allowed_chats: app.allowed_chats,
    })
    await loadAll()
  } catch (e: any) {
    alert(e?.message || '操作失败')
  }
}

function goPage(n: number) {
  if (n < 1 || n > totalPages.value) return
  cmdPage.value = n
  loadCommands()
}

function applyCmdFilter() {
  cmdPage.value = 1
  loadCommands()
}
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />
    <main class="fs-page">
      <div class="fs-container">

        <div class="dashboard-header">
          <div class="header-titles">
            <h1 class="hero-title">飞书助理</h1>
            <p class="fs-subtitle">
              把机器人拉进项目群 @ 一下，用一句话建项目、记日志、派任务、复盘，
              也能改它建过的那些。
            </p>
          </div>
          <div class="header-controls">
            <div class="fs-tabs">
              <button :class="{ active: activeTab === 'apps' }" @click="switchTab('apps')">应用绑定</button>
              <button :class="{ active: activeTab === 'diary' }" @click="switchTab('diary')">项目日记</button>
              <button :class="{ active: activeTab === 'directory' }" @click="switchTab('directory')">组织架构</button>
              <button :class="{ active: activeTab === 'rules' }" @click="switchTab('rules')">助理规则</button>
              <button :class="{ active: activeTab === 'logs' }" @click="switchTab('logs')">指令日志</button>
              <button :class="{ active: activeTab === 'guide' }" @click="switchTab('guide')">接入指引</button>
            </div>
          </div>
        </div>

        <!-- ============ 应用绑定 ============ -->
        <div v-if="activeTab === 'apps'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>已绑定的飞书应用</h2>
                <p class="section-desc">
                  一个账号可以绑定多个自建应用，AI 消耗统一记在本账号名下。
                  没有配置专属 AI 渠道时走平台额度。
                </p>
              </div>
              <button class="save-btn" @click="openCreate">+ 绑定新应用</button>
            </div>

            <p v-if="loading" class="empty-hint">加载中…</p>
            <p v-else-if="apps.length === 0" class="empty-hint">
              还没有绑定任何飞书应用。先去「接入指引」看一遍要开的权限，再回来绑定。
            </p>

            <div v-else class="app-list">
              <div v-for="app in apps" :key="app.id" class="app-card">
                <div class="app-main">
                  <div class="app-title-row">
                    <span class="app-name">{{ app.name }}</span>
                    <span :class="['state-pill', stateClass(app.live_state)]">
                      {{ stateLabel(app.live_state) }}
                    </span>
                    <span v-if="!app.enabled" class="state-pill idle">已停用</span>
                  </div>
                  <div class="app-meta">
                    <span class="mono">{{ app.app_id }}</span>
                    <span class="dot">·</span>
                    <span class="mono">{{ app.app_secret }}</span>
                  </div>
                  <div class="app-meta">
                    <span v-if="app.allowed_chats.length">
                      仅响应 {{ app.allowed_chats.length }} 个指定群
                    </span>
                    <span v-else class="warn-text">未限制群聊 —— 任何群拉入机器人都能消耗本账号额度</span>
                  </div>
                  <div class="app-meta">
                    <span :class="['state-pill', dirStateClass(app)]">名册 {{ dirStateLabel(app) }}</span>
                    <span v-if="app.dir_user_count">{{ app.dir_user_count }} 人</span>
                    <span v-else class="warn-text">
                      还没有名册 —— 说「派给张三」时没 @ 他就查不到人
                    </span>
                  </div>
                  <p v-if="app.conn_error" class="conn-error">{{ app.conn_error }}</p>

                  <!-- 「在群里 @ 了没反应」最常见的原因就是这个群不在白名单里，
                       而被拦时机器人是**不回话**的（回了就等于向任意群暴露自己的存在）。
                       所以只能在这里说，否则用户会一路去查连接状态和飞书权限。 -->
                  <div v-for="c in blockedChats(app)" :key="c.chat_id" class="blocked-chat">
                    <span>
                      「{{ chatLabel(c) }}」@ 过 {{ c.reject_count }} 次，都被群白名单拦下了。
                    </span>
                    <button class="btn-sm" @click="allowChat(app, c.chat_id)">放行这个群</button>
                  </div>
                </div>
                <div class="app-actions">
                  <button class="btn-sm" @click="openEdit(app)">编辑</button>
                  <button class="btn-sm" @click="toggleEnabled(app)">{{ app.enabled ? '停用' : '启用' }}</button>
                  <button class="btn-sm" :disabled="!app.enabled" @click="reconnect(app)">重连</button>
                  <button class="btn-sm btn-danger" @click="removeApp(app)">删除</button>
                </div>
              </div>
            </div>
          </section>

          <!-- 编辑表单 -->
          <section v-if="showForm" class="fs-section">
            <h2>{{ draft.id ? '编辑应用' : '绑定新应用' }}</h2>
            <p class="section-desc">
              在飞书开发者后台「凭证与基础信息」里拿 App ID 和 App Secret，
              并把事件订阅方式设为「使用长连接接收事件」。
            </p>

            <div class="form-grid">
              <label class="field">
                <span class="field-label">名称</span>
                <input v-model="draft.name" placeholder="例：市场部助理" />
              </label>
              <label class="field">
                <span class="field-label">App ID</span>
                <input v-model="draft.app_id" placeholder="cli_xxxxxxxxxxxx" class="mono" />
              </label>
              <label class="field">
                <span class="field-label">App Secret</span>
                <input
                  v-model="draft.app_secret"
                  type="password"
                  :placeholder="draft.id ? '留空表示不修改' : '必填'"
                  class="mono"
                />
              </label>
              <label class="field checkbox-field">
                <input type="checkbox" v-model="draft.enabled" />
                <span>启用（保存后立刻建立长连接）</span>
              </label>
            </div>

            <div class="field">
              <span class="field-label">允许响应的群</span>
              <!-- 机器人被拉进群时和被白名单拦下时都会记一行，所以这里勾的是群名，
                   不是那串在飞书客户端里看不到的 oc_xxx。 -->
              <div v-if="formChats.length" class="chat-picker">
                <label v-for="c in formChats" :key="c.chat_id" class="chat-item">
                  <input
                    type="checkbox"
                    :checked="draft.allowedChats.includes(c.chat_id)"
                    @change="toggleChat(c.chat_id)"
                  />
                  <span class="chat-name">{{ chatLabel(c) }}</span>
                  <span v-if="c.reject_count > 0" class="chat-tag bad">
                    @ 过 {{ c.reject_count }} 次，被白名单拦下
                  </span>
                  <span v-else-if="c.unknown" class="chat-tag idle">已配置，机器人尚未见到此群</span>
                  <span class="chat-id mono">{{ c.chat_id }}</span>
                </label>
              </div>
              <p v-else class="section-hint">
                还没见过任何群。把机器人拉进群、或在群里 @ 它一次，这里就会出现可勾选的群名。
              </p>

              <div class="chat-manual">
                <input v-model="manualChatId" placeholder="oc_xxxxxxxxxxxxxxxx" class="mono" />
                <button type="button" class="btn-sm" @click="addManualChat">手动添加 chat_id</button>
              </div>

              <p class="section-hint">
                一个都不勾 = 不限群聊，首次接入时方便调试。
                但机器人被拉进任何群都能被 @，会消耗本账号的 AI 额度 ——
                试通之后建议回来勾上白名单。
                （助理<strong>只在群聊里工作</strong>，私聊会被回一句「请到群里 @ 我」，
                不会花额度。）
              </p>
            </div>

            <div class="form-actions">
              <button class="save-btn" :disabled="saving" @click="saveApp">
                {{ saving ? '保存中…' : '保存并连接' }}
              </button>
              <button class="btn-sm" @click="showForm = false">取消</button>
            </div>
          </section>
        </div>

        <!-- ============ 项目日记 ============ -->
        <div v-if="activeTab === 'diary'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>项目日记</h2>
                <p class="section-desc">
                  在飞书群里 @ 助理说「记一下：……」产生的日志，和「复盘一下本周」生成的总结。
                  这里<strong>只能看</strong> —— 记录要在群里 @ 助理来记，
                  这样每条都带记录人和时间，也没人能误删。
                </p>
              </div>
              <div class="filters">
                <select v-model="diaryAppId" @change="pickDiaryApp">
                  <option value="">选择应用</option>
                  <option v-for="a in apps" :key="a.id" :value="a.app_id">{{ a.name }}</option>
                </select>
                <button class="btn-sm" :disabled="!diaryAppId" @click="loadDiary">刷新</button>
              </div>
            </div>

            <p v-if="apps.length === 0" class="empty-hint">
              先在「应用绑定」里绑一个飞书应用，然后在飞书群里说一句「新建项目：XXX」。
            </p>

            <template v-else-if="diaryApp">
              <!--
                项目总表在飞书里搜不到（建表时没传 folder_token，链接分享也是关掉的），
                所以这个链接是它在网页侧唯一的入口。没有它的时候要说清是为什么，
                否则「我的总表呢」查不出原因。
              -->
              <div v-if="diaryIndex" class="diary-index">
                <a :href="diaryIndex.url" target="_blank" rel="noopener" class="diary-index-link">
                  📊 打开项目总表（飞书多维表格）
                </a>
                <span v-if="!diaryIndex.link_share_closed" class="warn-text">
                  ⚠️ 这张表的链接分享没关成功，组织内拿到链接的人都能看，请在飞书里手动收紧。
                </span>
              </div>
              <p v-else-if="diaryProjects.length === 0" class="empty-hint">
                这个应用还没有任何项目。去飞书群里 @ 助理说一句「新建项目：XXX」——
                项目是跟群绑定的，一个群一个项目，所以私聊里建不了。
              </p>
              <p v-else class="section-hint warn-text">
                还没有项目总表（当初建它的那一步失败了）。各项目的日志表仍然正常，
                下面每一行都有链接。
              </p>

              <p v-if="diaryUnsyncedTotal > 0" class="section-hint warn-text">
                有 {{ diaryUnsyncedTotal }} 条记录/任务还没同步到多维表格 ——
                <strong>库里在、表里看不到</strong>。补推是跟着下一次记录发生的（没有后台定时任务），
                在对应群里随便再记一条就会连着补上。
              </p>

              <!--
                删除回执。**必须留在页面上**（不是 alert）：那几张表在飞书里搜不到，
                项目一删助理就不再认识它们，这是最后一次能拿到链接的机会。
                关掉要用户自己点 ×。
              -->
              <div v-if="diaryDeleted" class="diary-receipt">
                <button class="receipt-close" @click="diaryDeleted = null" title="关闭">×</button>
                <p>
                  已删除项目「<strong>{{ diaryDeleted.name }}</strong>」：本系统里的
                  {{ diaryDeleted.record_count }} 条记录、{{ diaryDeleted.summary_count }} 次复盘已清除，
                  助理不再认识这个项目。
                </p>
                <p>
                  <strong>飞书多维表格没有被删除</strong>，但它们在飞书里搜不到 ——
                  下面是最后一次拿到链接的机会，需要的话现在存下来：
                </p>
                <p class="receipt-links">
                  <a v-if="diaryDeleted.log_url" :href="diaryDeleted.log_url" target="_blank" rel="noopener">日志表 ↗</a>
                  <a v-if="diaryDeleted.review_url" :href="diaryDeleted.review_url" target="_blank" rel="noopener">复盘表 ↗</a>
                  <a v-if="diaryDeleted.task_url" :href="diaryDeleted.task_url" target="_blank" rel="noopener">任务管理表 ↗</a>
                  <span v-if="!diaryDeleted.log_url && !diaryDeleted.review_url && !diaryDeleted.task_url">
                    这个项目当初没有建出任何表格。
                  </span>
                </p>
                <p v-if="diaryDeleted.still_in_index">
                  项目总表里那一行<strong>留着</strong>（它也是事后找回上面这几个链接的途径），
                  所以总表里还会看到这个项目 —— 需要的话去飞书里手动删那一行。
                </p>
              </div>

              <p v-if="diaryLoading" class="empty-hint">加载中…</p>

              <div v-else-if="diaryProjects.length" class="diary-list">
                <div v-for="p in diaryProjects" :key="p.id" class="diary-card">
                  <div class="diary-head" @click="openDiaryProject(p)">
                    <span class="diary-name">{{ p.name }}</span>
                    <span class="diary-meta">
                      {{ p.record_count }} 条记录<!--
                        群聊摘要单独括出来，不混进总数：40 条记录读起来像 40 条
                        一手事实，而其中 30 条可能是 AI 从群聊里归纳的。
                      -->
                      <template v-if="p.digest_count > 0">（含 {{ p.digest_count }} 条群聊摘要）</template>
                      · {{ p.task_count }} 个任务<template v-if="p.open_task_count > 0">（{{ p.open_task_count }} 在办）</template>
                      · {{ p.summary_count }} 次复盘
                      <template v-if="p.last_record_ms">
                        · 最近 {{ fmtTime(new Date(p.last_record_ms).toISOString()) }}
                      </template>
                    </span>
                    <span v-if="p.unsynced_count > 0" class="chat-tag bad">
                      {{ p.unsynced_count }} 条记录未同步
                    </span>
                    <!-- 任务的未同步要单独报：它和记录走的是两张表、两条同步路径，
                         合成一个数字的话「甘特图上少了两条」查不到原因。 -->
                    <span v-if="p.unsynced_task_count > 0" class="chat-tag bad">
                      {{ p.unsynced_task_count }} 个任务未同步
                    </span>
                    <span v-if="!p.in_index" class="chat-tag idle">未登记进总表</span>
                    <span class="log-caret">{{ diaryOpenId === p.id ? '▾' : '▸' }}</span>
                  </div>
                  <div class="diary-sub">
                    <span>群：{{ p.chat_name || p.chat_id }}</span>
                    <span class="dot">·</span>
                    <span>{{ p.created_by_name || '未知' }} 建于 {{ fmtTime(p.created_at) }}</span>
                    <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="diary-link">日志表 ↗</a>
                    <a v-if="p.review_url" :href="p.review_url" target="_blank" rel="noopener" class="diary-link">复盘表 ↗</a>
                    <span v-if="!p.link_share_closed" class="warn-text">链接分享未关闭</span>
                    <!-- 删除放在这一行的最右，不放标题行：标题行整条是展开/收起的点击区，
                         按钮挤在那里等于把「想看日志」变成一次误删。 -->
                    <button
                      class="btn-sm btn-danger diary-del"
                      :disabled="diaryDeleting === p.id"
                      @click="removeDiaryProject(p)"
                    >
                      {{ diaryDeleting === p.id ? '删除中…' : '删除项目' }}
                    </button>
                  </div>

                  <div v-if="diaryOpenId === p.id" class="diary-detail">
                    <div class="diary-switch">
                      <button :class="{ active: diaryView === 'records' }" @click="switchDiaryView('records')">
                        日志记录（{{ p.record_count }}）
                      </button>
                      <button :class="{ active: diaryView === 'summaries' }" @click="switchDiaryView('summaries')">
                        复盘（{{ p.summary_count }}）
                      </button>
                    </div>

                    <p v-if="diaryDetailLoading" class="empty-hint">加载中…</p>

                    <template v-else-if="diaryView === 'records'">
                      <p v-if="diaryRecords.length === 0" class="empty-hint">
                        还没有记录。在「{{ p.chat_name || '这个群' }}」里 @ 助理说「记一下：……」。
                      </p>
                      <ul v-else class="diary-records">
                        <li v-for="r in diaryRecords" :key="r.id">
                          <div class="rec-meta">
                            <span class="rec-author">{{ r.author_name || '未知' }}</span>
                            <span class="rec-time">{{ fmtTime(r.created_at, true) }}</span>
                            <!--
                              AI 归纳的那些必须一眼能认出来。正文里也有「【群聊摘要 …】」
                              前缀（那是给飞书表格用的，那边加不了列），但这一页要能扫着看：
                              这张表的价值全在「当时到底怎么说的」，而归纳的和原话并排放着。
                            -->
                            <span v-if="r.origin === 'chat_digest'" class="chat-tag idle">
                              AI 归纳（非原话）
                            </span>
                            <span v-if="!r.synced" class="chat-tag bad">未同步到表格</span>
                          </div>
                          <!-- 原文照抄，不做任何 markdown 渲染：日志的价值就在于当时怎么说的。 -->
                          <div class="rec-body">{{ r.content }}</div>
                        </li>
                      </ul>
                    </template>

                    <template v-else>
                      <p v-if="diarySummaries.length === 0" class="empty-hint">
                        还没有复盘。在群里 @ 助理说「复盘一下本周」。
                      </p>
                      <ul v-else class="diary-records">
                        <li v-for="s in diarySummaries" :key="s.id">
                          <div class="rec-meta">
                            <span class="rec-author">{{ s.range_label || '（未标注范围）' }}</span>
                            <span class="rec-time">{{ s.record_count }} 条 · {{ s.created_by_name || '未知' }} · {{ fmtTime(s.created_at, true) }}</span>
                            <span v-if="!s.synced" class="chat-tag bad">未同步到表格</span>
                          </div>
                          <!-- 完整版：群里那条被截到 1500 字，这一份没截。 -->
                          <div class="rec-body pre-wrap">{{ s.summary }}</div>
                        </li>
                      </ul>
                    </template>

                    <div v-if="diaryDetailPages > 1" class="pager">
                      <button class="btn-sm" :disabled="diaryDetailPage <= 1" @click="goDiaryPage(diaryDetailPage - 1)">上一页</button>
                      <span class="pager-info">{{ diaryDetailPage }} / {{ diaryDetailPages }}（共 {{ diaryDetailTotal }} 条）</span>
                      <button class="btn-sm" :disabled="diaryDetailPage >= diaryDetailPages" @click="goDiaryPage(diaryDetailPage + 1)">下一页</button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </section>

          <section v-if="diaryApp" class="fs-section">
            <h2>关于这一页的几件事</h2>
            <ul class="caveats">
              <li>
                <strong>逐条记录只能看，不能改。</strong>
                同步是只追加的 —— 记录推进多维表格之后就不会再推第二遍。
                所以网页上删掉一条，表格里那行也删不掉，库和表从此不一致，
                而人看的是表。要改就在群里 @ 助理说。
              </li>
              <li>
                <strong>「删除项目」删的只是本系统里的关联。</strong>
                飞书的日志表 / 复盘表 / 任务管理表都不会被删除（我们没有回收站，
                而 070 之后任务只存在于表格里），项目总表里那一行也留着。
                删完的回执里会把那几个链接列出来 —— <strong>那是最后一次能拿到它们的机会</strong>，
                因为助理从此不再认识这个项目。那个群之后可以重新新建项目，但会另建一套新表。
              </li>
              <li>
                <strong>飞书里搜不到那些表格，链接是唯一入口。</strong>
                项目总表和各项目日志表都由机器人身份创建，不在任何人的云文档空间里，
                链接分享也是主动关掉的。上面这些链接（和群里 @ 助理说「有哪些项目」）
                就是全部的入口。
              </li>
              <li>
                <strong>「未同步」= 库里有、表格里没有。</strong>
                写飞书会失败（限流、权限没发版）。记录已经安全落库了，
                但补推是<strong>跟着下一次记录</strong>发生的，没有后台定时任务 ——
                不再活跃的项目会长期停在这个状态，在群里随便再记一条就补上。
              </li>
              <li>
                <strong>复盘这里的是完整版。</strong>
                群里的回帖最多 1500 字，超了会截断；这一页和「复盘」表里的那份没截。
              </li>
              <li>
                <strong>一个群一个项目。</strong>
                项目跟群绑定（这样群里说「记一下……」才知道记到哪儿），
                所以新项目要另建一个群、把助理拉进去，在里面说「新建项目：XXX」。
              </li>
              <li>
                <strong>带「AI 归纳」标记的那些不是原话。</strong>
                群里说「总结一下今天聊了什么」时，助理会读群消息、挑出值得记的写进日志 ——
                那几条是<strong>模型归纳的</strong>，和大家自己记的原话并排存在同一张表里，
                所以单独标了出来（飞书表格里是「【群聊摘要 …】」前缀）。
                归纳错了在群里说一句，助理会按你说的原话再记一条。
              </li>
              <li>
                <strong>「总结群聊」要额外开一个权限。</strong>
                读没有 @ 助理的消息需要
                <code>im:message.group_msg</code>，它在飞书后台要单独说明用途，
                所以没有列进「接入前请先开通」那份清单里（见「接入指引」最后那一组可选权限）。
                没开的话第一次用会报缺权限，其余功能都不受影响。
              </li>
              <li>
                <strong>任务和记录是两条同步路径。</strong>
                记录只追加，任务会被改（改期、改状态、换负责人），所以推表的方式不一样，
                「未同步」也分开报。任务在项目日志表的「任务」表里，还有一个甘特图视图。
              </li>
            </ul>
          </section>
        </div>

        <!-- ============ 组织架构名册 ============ -->
        <div v-if="activeTab === 'directory'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>组织架构名册</h2>
                <p class="section-desc">
                  同步一份公司通讯录到本地，助理就能<strong>按姓名找人</strong> ——
                  「给李四建个任务」不用先把他 @ 到，他也不必在这个群里。
                  没有名册时只认这条消息里 @ 出来的人。
                </p>
              </div>
              <div class="filters">
                <select v-model="dirAppId" @change="applyDirFilter">
                  <option value="">选择应用</option>
                  <option v-for="a in apps" :key="a.id" :value="a.app_id">{{ a.name }}</option>
                </select>
                <button class="save-btn" :disabled="!dirAppId || syncing" @click="syncDirectory">
                  {{ syncing ? '同步中…' : '同步组织架构' }}
                </button>
              </div>
            </div>

            <p v-if="apps.length === 0" class="empty-hint">
              先在「应用绑定」里绑一个飞书应用，然后回来同步。
            </p>

            <template v-else-if="dirApp">
              <div class="dir-status">
                <span :class="['state-pill', dirStateClass(dirApp)]">{{ dirStateLabel(dirApp) }}</span>
                <span class="dir-status-text">
                  <template v-if="dirApp.dir_sync_state === 'ok'">
                    {{ dirApp.dir_user_count }} 人 ·
                    {{ dirApp.dir_source === 'chats' ? '来源：机器人所在群的成员' : '来源：公司通讯录' }}
                    <template v-if="dirApp.dir_sync_at"> · {{ fmtTime(dirApp.dir_sync_at) }}</template>
                  </template>
                  <template v-else-if="dirApp.dir_sync_state === 'syncing'">
                    正在从飞书拉取，大企业可能要几十秒。这个页面会自己刷新。
                  </template>
                  <template v-else-if="dirApp.dir_sync_state === 'failed'">
                    上次同步没成功。已有的名册没有被清空，助理还能用旧数据。
                  </template>
                  <template v-else>
                    还没有同步过。
                  </template>
                </span>
              </div>

              <!-- 兜底路生效时必须显式说清覆盖面：不然「查不到某人」会被当成 bug。 -->
              <p
                v-if="dirApp.dir_sync_error"
                :class="dirApp.dir_sync_state === 'failed' ? 'conn-error' : 'dir-note'"
              >{{ dirApp.dir_sync_error }}</p>

              <div class="dir-toolbar">
                <input
                  v-model="dirQuery"
                  placeholder="搜索姓名 / 部门 / 职位"
                  @keyup.enter="applyDirFilter"
                />
                <button class="btn-sm" @click="applyDirFilter">搜索</button>
                <span class="pager-info" v-if="dirTotal">共 {{ dirTotal }} 人</span>
              </div>

              <p v-if="dirLoading" class="empty-hint">加载中…</p>
              <!--
                同步刚失败时不能说「点右上角同步一次」—— 他刚点过，再点还是一样的结果。
                上面那条红色说明里已经写了该去飞书后台做什么，这里就别添乱。
              -->
              <p v-else-if="dirUsers.length === 0" class="empty-hint">
                <template v-if="dirQuery">没有匹配的人。</template>
                <template v-else-if="dirApp.dir_sync_state === 'failed'">
                  名册是空的。按上面的说明处理完，再同步一次。
                </template>
                <template v-else-if="dirApp.dir_sync_state === 'syncing'">
                  名册是空的，同步还在跑。
                </template>
                <template v-else>名册是空的，点右上角同步一次。</template>
              </p>

              <table v-else class="dir-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>部门</th>
                    <th>职位</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in dirUsers" :key="u.open_id" :class="{ resigned: u.is_resigned }">
                    <td>
                      {{ u.name }}
                      <span v-if="u.en_name" class="dir-en">{{ u.en_name }}</span>
                    </td>
                    <td>{{ u.department_names || '—' }}</td>
                    <td>{{ u.job_title || '—' }}</td>
                    <td>
                      <span v-if="u.is_resigned" class="state-pill idle">已离职</span>
                      <span v-else class="state-pill ok">在职</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="dirTotalPages > 1" class="pager">
                <button class="btn-sm" :disabled="dirPage <= 1" @click="goDirPage(dirPage - 1)">上一页</button>
                <span class="pager-info">{{ dirPage }} / {{ dirTotalPages }}</span>
                <button class="btn-sm" :disabled="dirPage >= dirTotalPages" @click="goDirPage(dirPage + 1)">下一页</button>
              </div>
            </template>
          </section>

          <section class="fs-section">
            <h2>关于名册的几件事</h2>
            <ul class="caveats">
              <li>
                <strong>助理永远不会自己编一个账号。</strong>
                大模型只负责把你说的姓名原样交出来，账号是在这份名册里精确查到的。
                查不到、有同名、已离职三种情况它都会回来问你，而不是挑一个派过去。
              </li>
              <li>
                <strong>同名的人必须 @ 一下。</strong>
                名册里有两个「李四」时助理会把部门列出来让你重说一遍。
                最省事的办法是在群里 @ 一下那个人 —— @ 带过来的账号永远是准的。
              </li>
              <li>
                <strong>通讯录权限没开也能用，但覆盖面小。</strong>
                拿不到通讯录时会退而收集「机器人所在群的成员」，只有姓名和账号、
                没有部门。想要全公司名册，去飞书后台开通下面这些权限并
                <strong>发布版本</strong>，然后回来重新同步：
                <span class="scope-grid">
                  <code v-for="s in capabilities?.directory_scopes || []" :key="s">{{ s }}</code>
                </span>
              </li>
              <li>
                <strong>名册是快照，不会自动更新。</strong>
                有人入职/离职/调岗之后回来点一次同步。同步失败不会清空旧名册 ——
                一次网络抖动不该让助理突然谁都不认识。
              </li>
            </ul>
          </section>
        </div>

        <!-- ============ 助理规则 ============ -->
        <div v-if="activeTab === 'rules'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>本企业的补充规则</h2>
                <p class="section-desc">
                  写下你们公司自己的说法，助理就能听懂 ——「过一下方案」是评审会、
                  「小 P」指的是某个项目、「盯一下」是派任务而不是记日志。
                  <strong>只写"怎么听懂人话"这一件事</strong>：能做哪些动作、
                  参数长什么样、账号怎么查，都由系统保证，写在这里无效。
                </p>
              </div>
              <div class="filters">
                <select :value="rulesAppId" @change="pickRulesApp(($event.target as HTMLSelectElement).value)">
                  <option value="">选择应用</option>
                  <option v-for="a in apps" :key="a.id" :value="a.id">{{ a.name }}</option>
                </select>
              </div>
            </div>

            <p v-if="apps.length === 0" class="empty-hint">
              先在「应用绑定」里绑一个飞书应用，然后回来给它写规则。
            </p>

            <template v-else-if="rulesApp">
              <!-- 规则按应用存，这一点必须写在界面上：绑了两个应用的人
                   （常见于帮多家公司接入）不知道的话，会以为在这里写一次就全生效了。 -->
              <p class="section-hint">
                这段规则只作用于<strong>「{{ rulesApp.name }}」</strong>这一个应用。
                同一个账号下的其他应用各写各的 —— 一个应用就是一家企业。
              </p>

              <textarea
                v-model="rulesText"
                class="rules-textarea"
                rows="18"
                placeholder="留空 = 使用平台提供的默认规则。点下面的「填入示例模板」可以看到该写什么。"
              ></textarea>

              <div class="form-actions">
                <button class="save-btn" :disabled="rulesSaving || !rulesDirty" @click="saveRules">
                  {{ rulesSaving ? '保存中…' : rulesDirty ? '保存' : '已保存' }}
                </button>
                <!-- 只在文本框是空的时候可点：已经写过东西了，一键覆盖是纯粹的破坏。 -->
                <button
                  v-if="capabilities?.default_supplement"
                  class="btn-sm"
                  :disabled="!!rulesText.trim()"
                  @click="rulesText = capabilities!.default_supplement"
                >
                  填入示例模板
                </button>
                <span class="rules-hint">
                  <template v-if="rulesDirty">还没保存</template>
                  <template v-else-if="rulesSaved">已生效，下一条指令就按新规则理解</template>
                  <template v-else-if="rulesText.trim()">
                    {{ rulesText.length }} 字 · 上次更新 {{ fmtTime(rulesApp.updated_at) }}
                  </template>
                  <template v-else>当前使用平台默认规则</template>
                </span>
              </div>
            </template>
          </section>

          <section v-if="rulesApp" class="fs-section">
            <h2>写这段话之前</h2>
            <ul class="caveats">
              <li>
                <strong>不用重启、不用重连。</strong>
                每条指令都会重新读一遍这段话，保存完在飞书里直接试下一句就行。
              </li>
              <li>
                <strong>它管不了硬性规则。</strong>
                「必须输出 JSON」「账号只能从名册里查」这些写在代码里，
                和你这段话冲突时一律以代码为准 —— 否则一句随手写的规则
                就能让助理把消息发给错误的人。
              </li>
              <li>
                <strong>短比长好。</strong>
                这段话每条指令都会随 prompt 发一次。塞一份员工手册进来的结果是
                每条指令都更慢更贵，而且长文本会把后面的硬性规则压下去。
                真正有用的内容几百字就够（上限 4000 字）。
              </li>
              <li>
                <strong>清空 = 回到平台默认。</strong>
                不是"没有规则"。默认那份是一个带注释的示例模板，不影响行为。
              </li>
            </ul>
          </section>
        </div>

        <!-- ============ 指令日志 ============ -->
        <div v-if="activeTab === 'logs'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>指令日志</h2>
                <p class="section-desc">
                  @ 了没反应时看这里：没有记录 = 事件没进来（连接或权限问题）；
                  「未识别」= 收到了但没听懂；「失败」= 调飞书接口报错，错误原文在展开里。
                  一个群 = 一个项目，所以按项目群筛就是按项目看。
                </p>
              </div>
              <div class="filters">
                <select v-model="cmdStatus" @change="applyCmdFilter">
                  <option value="">全部状态</option>
                  <option v-for="o in COMMAND_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <select v-model="cmdAppId" @change="pickCmdApp">
                  <option value="">全部应用</option>
                  <option v-for="a in apps" :key="a.id" :value="a.app_id">{{ a.name }}</option>
                </select>
                <!--
                  只有选定了应用才给这个下拉：不同租户的群名会重名，
                  混在一起选出来的结果对不上用户的预期（后端也只在带 app_id 时返回选项）。
                -->
                <select v-if="cmdAppId" v-model="cmdChatId" @change="applyCmdFilter">
                  <option value="">全部项目群</option>
                  <option v-for="c in cmdChats" :key="c.chat_id" :value="c.chat_id">
                    {{ cmdChatOptionLabel(c) }}
                  </option>
                </select>
                <button class="btn-sm" @click="loadCommands">刷新</button>
              </div>
            </div>

            <p v-if="cmdChatId && commands.length === 0" class="empty-hint">
              这个群还没有指令记录。换个群，或者选「全部项目群」看看。
            </p>

            <p v-else-if="commands.length === 0" class="empty-hint">暂无指令记录。</p>

            <div v-if="commands.length" class="log-list">
              <div v-for="row in commands" :key="row.id" class="log-row">
                <div class="log-head" @click="expanded[row.id] = !expanded[row.id]">
                  <span :class="['status-pill', row.status]">{{ statusLabel(row.status) }}</span>
                  <!--
                    项目/群名要在**折叠状态下**就看得见。
                    藏进展开里的话，「A 项目那条记录进去了没有」这个最常见的问题
                    要一行行点开才能回答，而 chat_id 在飞书里看不到，
                    等于没有办法确认自己看的是哪个群。
                  -->
                  <span class="log-project" :title="row.chat_id">{{ cmdChatLabel(row) }}</span>
                  <span class="log-sender">{{ row.sender_name || '未知' }}</span>
                  <span class="log-text">{{ row.text }}</span>
                  <span class="log-action">{{ row.action || '—' }}</span>
                  <!-- 要秒：连着下几条指令时，只到分钟就分不出先后了。 -->
                  <span class="log-time">{{ fmtTime(row.created_at, true) }}</span>
                  <span class="log-dur">{{ row.duration_ms != null ? `${row.duration_ms}ms` : '' }}</span>
                  <span class="log-caret">{{ expanded[row.id] ? '▾' : '▸' }}</span>
                </div>
                <div v-if="expanded[row.id]" class="log-detail">
                  <div class="detail-line">
                    <span class="detail-label">来源</span>
                    <!-- chat_id 也印出来：配白名单、去库里查这个群的数据都要用它。 -->
                    <span class="mono">
                      {{ row.chat_type === 'p2p' ? '私聊' : '群聊' }} · {{ cmdChatLabel(row) }} ·
                      {{ row.chat_id }} · {{ row.app_id }}
                    </span>
                  </div>
                  <div v-if="row.params" class="detail-line">
                    <span class="detail-label">解析出的参数</span>
                    <pre class="detail-pre">{{ prettyParams(row) }}</pre>
                  </div>
                  <div v-if="row.result" class="detail-line">
                    <span class="detail-label">回复内容</span>
                    <pre class="detail-pre">{{ resultSummary(row) }}</pre>
                  </div>
                  <div v-if="row.error" class="detail-line">
                    <span class="detail-label">错误</span>
                    <FeishuErrorDetail :text="row.error" :detail="row.error_detail" />
                  </div>
                </div>
              </div>
            </div>

            <div v-if="totalPages > 1" class="pager">
              <button class="btn-sm" :disabled="cmdPage <= 1" @click="goPage(cmdPage - 1)">上一页</button>
              <span class="pager-info">{{ cmdPage }} / {{ totalPages }}（共 {{ cmdTotal }} 条）</span>
              <button class="btn-sm" :disabled="cmdPage >= totalPages" @click="goPage(cmdPage + 1)">下一页</button>
            </div>
          </section>
        </div>

        <!-- ============ 接入指引 ============ -->
        <div v-if="activeTab === 'guide'" class="tab-content guide-content">
          <section class="fs-section">
            <h2>五步接入</h2>
            <ol class="steps">
              <li>
                <strong>建自建应用</strong>
                <p>
                  打开
                  <a href="https://open.feishu.cn/app" target="_blank" rel="noopener">飞书开发者后台</a>
                  →「创建企业自建应用」。自建应用只能在你自己的企业里用，不需要审核上架。
                </p>
              </li>
              <li>
                <strong>添加机器人能力</strong>
                <p>「添加应用能力」→ 勾选「机器人」。没有这一步，别人在飞书里搜不到它，也没法 @。</p>
              </li>
              <li>
                <strong>配事件订阅：选长连接</strong>
                <p>
                  「事件与回调」→「订阅方式」选<strong>「使用长连接接收事件」</strong>，
                  不要填回调地址。这是我们主动连出去的，所以你不需要有公网地址、
                  不需要配 Encrypt Key，也不用处理飞书的 URL 校验。
                </p>
                <p class="sub-hint">
                  然后添加事件：
                  <code v-for="ev in capabilities?.events || []" :key="ev">{{ ev }}</code>
                </p>
              </li>
              <li>
                <strong>开权限</strong>
                <p>「权限管理」里把下面这些一次性加齐，然后<strong>发布版本</strong>（权限不发版不生效）：</p>
                <div class="scope-grid">
                  <code v-for="s in capabilities?.scopes || []" :key="s">{{ s }}</code>
                </div>
                <p class="sub-hint">
                  同一页往下还有<strong>「数据权限」</strong>，把「通讯录范围」也加上部门
                  （或全部成员）—— 只勾上面的权限点是读不到通讯录的，报错会是
                  <code>no dept authority error</code>。
                </p>
                <!--
                  单列一段，而不是混进上面那张 scope-grid：读群聊记录那两项在飞书
                  后台要额外填用途说明，是最难批的一档。混进「一次性加齐」里的话，
                  每个人的接入都会卡在一个大部分人用不到的功能上。
                  但也不能不说 —— 不说的话「总结群聊」在所有人那里都缺权限，
                  而没人知道要去开。见 actions/index.ts 的 OPTIONAL_SCOPES。
                -->
                <div
                  v-for="g in capabilities?.optional_scopes || []"
                  :key="g.feature"
                  class="optional-scopes"
                >
                  <p class="sub-hint">
                    <strong>下面这组是可选的</strong>，用到「{{ g.feature }}」时再开：
                  </p>
                  <div class="scope-grid">
                    <code v-for="s in g.scopes" :key="s">{{ s }}</code>
                  </div>
                </div>
              </li>
              <li>
                <!--
                  这一步是用户最容易漏的：可用范围默认只有创建者本人，
                  于是「派给同事」必然报 230013，而飞书的报错是英文的、
                  一个字都没提可用范围。
                -->
                <strong>把「可用范围」放开</strong>
                <p>
                  「应用发布」→「版本管理与发布」→ 可用范围选<strong>全体成员</strong>
                  （或加上要用它的部门）。
                </p>
                <p class="sub-hint">
                  这是和权限完全无关的第三套设置，默认<strong>只有你自己</strong>可用。
                  不放开的话，把任务派给同事会报
                  <code>Bot has NO availability to this user</code>，
                  群里其他同事也没法 @ 它。
                </p>
              </li>
              <li>
                <strong>回来绑定，然后在飞书里试</strong>
                <p>
                  把 App ID / App Secret 填到「应用绑定」，状态变成「已连接」即可。
                  然后把机器人拉进一个群，在群里 @ 它说话 ——
                  <strong>助理只在群聊里工作</strong>，私聊会被回一句「请到群里 @ 我」。
                </p>
                <p class="sub-hint">
                  绑定成功会自动同步一次公司组织架构 —— 有了名册，
                  说「给李四建个任务」时不 @ 他也能查到人。同步结果在「组织架构」页看。
                </p>
              </li>
            </ol>
          </section>

          <section class="fs-section">
            <h2>它现在会做什么</h2>
            <p class="section-desc">
              说不清楚的时候它会回一句「没听懂」而不是瞎猜着建东西。
            </p>
            <div class="action-list">
              <div v-for="a in capabilities?.actions || []" :key="a.name" class="action-card">
                <div class="action-head">
                  <span class="action-name">{{ a.name }}</span>
                  <span v-for="s in a.scopes" :key="s" class="scope-tag">{{ s }}</span>
                </div>
                <p class="action-desc">{{ a.description }}</p>
                <ul class="action-examples">
                  <li v-for="(ex, i) in a.examples" :key="i">「{{ ex }}」</li>
                </ul>
              </div>
            </div>
          </section>

          <section class="fs-section">
            <h2>几个必须知道的限制</h2>
            <ul class="caveats">
              <li>
                <strong>任务是机器人建的，你是负责人。</strong>
                免去授权流程的代价：任务的创建者显示为机器人，
                指派的那个人会在任务中心的「我负责的」里看到它。
              </li>
              <li>
                <strong>只能改它自己帮你建过的任务。</strong>
                助理认得的任务只有它自己建的那些（最近 7 天内）——
                你在飞书里手动建的它看不见，也改不动。
                说「那个任务完成了」而它同时建过好几个时，
                它会把候选列出来让你挑，不会替你猜一个。
              </li>
              <li>
                <strong>不能列任务清单。</strong>
                「我今天有哪些任务」做不到 —— 读你自己的任务列表需要单独的用户授权。
                项目的进展要用「复盘一下本周」，那读的是本群项目的日志记录。
              </li>
              <li>
                <strong>派任务给别人，要么 @ 一下，要么先同步组织架构。</strong>
                @ 过来的账号最准；同步过名册之后直接说姓名也行（他不必在这个群里）。
                两者都没有时助理会回来问你，不会猜 —— 猜错人比不做更糟。
                详见「组织架构」页。
              </li>
              <li>
                <!-- 私聊不是"暂未支持"而是有意关掉的，理由要写出来：
                     不然用户会当成 bug 报上来，或者一直等它哪天支持。 -->
                <strong>只在群聊里工作，私聊不处理指令。</strong>
                私聊 @ 它只会收到一句「请到群里 @ 我」。
                这样每条指令都留在群里，同事看得到谁让助理做了什么；
                而且项目日记本身就是绑群的，私聊里能做的事本来就是群聊的真子集。
              </li>
              <li>
                <strong>执行是异步的。</strong>
                飞书要求 3 秒内响应，而理解一句话要调大模型，
                所以它先默默接单、干完再回帖。慢几秒是正常的。
              </li>
              <li>
                <strong>项目日记：一个群一个项目。</strong>
                项目是跟群绑定的（这样群里说「记一下……」才知道记到哪儿），
                所以要在项目群里说「新建项目：XXX」，私聊里建不了。
                要开第二个项目就另建一个群。
              </li>
              <li>
                <!--
                  这些多维表格不在任何人的云文档空间里（建表时没传 folder_token），
                  链接分享也是关掉的 —— 链接被消息刷走之后，"问回来"是唯一的途径。
                -->
                <strong>表格链接丢了：这一页的「项目日记」标签里都有，或者 @ 助理说「有哪些项目」。</strong>
                项目总表和各项目日志表都不在你的云文档列表里，也搜不到，链接是唯一入口。
                「项目日记」标签列出了本应用所有项目和它们的两个表格链接，
                在群里问助理会得到同样的一份。
              </li>
              <li>
                <strong>项目日志表对群里是只读的。</strong>
                日志只能通过 @ 助理来记 —— 这样每条都带记录人和时间，
                也没人能误删。同步是只追加的，表里被删掉的行不会被补回来，
                所以不给群编辑权限。要改就在群里 @ 助理说。
              </li>
              <li>
                <strong>记录原样存，不会被改写。</strong>
                助理只去掉「记一下」这类前缀，其余一个字不动 ——
                日志的价值就在于当时是怎么说的。
                复盘是在这些原文之上另外生成的摘要，不覆盖原始记录。
              </li>
              <li>
                <strong>复盘一次要花 2 次 AI 额度。</strong>
                一次用来听懂指令，一次用来归纳。
                如果给「飞书助理」单独配了应用额度，记得把这件事算进去。
              </li>
            </ul>
          </section>
        </div>

      </div>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.page-wrapper {
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
  --color-text: #111827;
  --color-muted: #6b7280;
  --color-soft: #9ca3af;
  --color-bg-elevated: #ffffff;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-fill: #f9fafb;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --primary-color: #0f172a;

  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #f8fafc;
  background-image:
    radial-gradient(at 50% 0%, #ffffff 0%, transparent 70%),
    radial-gradient(#cbd5e1 1px, transparent 1px);
  background-size: 100% 100%, 24px 24px;
  background-attachment: fixed;
  color: var(--color-text);
  font-family: var(--font-sans);
  overflow-x: hidden;
}

.fs-page {
  flex: 1;
  padding: 80px 40px 64px;
}

.fs-container {
  max-width: 1100px;
  margin: 0 auto;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding-bottom: 20px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--color-border-strong);
}

.hero-title {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.fs-subtitle {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-muted);
}

.fs-tabs {
  display: inline-flex;
  gap: 8px;
  background: var(--color-fill);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.fs-tabs button {
  min-height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
}

.fs-tabs button.active {
  color: var(--color-text);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.fs-section {
  padding: 24px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.fs-section h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.section-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-muted);
  max-width: 640px;
}

.section-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-muted);
}

.empty-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--color-soft);
}

/* ---- 应用卡片 ---- */
.app-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.app-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-fill);
}

.app-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.app-name {
  font-size: 15px;
  font-weight: 600;
}

.app-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.8;
  flex-wrap: wrap;
}

.dot { color: var(--color-soft); }

.warn-text { color: #b45309; }

.conn-error {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.6;
  /* 名册同步失败的说明是分行写的（原因一行、怎么办一行），挤成一坨就没人看了。 */
  white-space: pre-wrap;
}

.app-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 600;
}

.state-pill.ok { background: #ecfdf5; color: #047857; }
.state-pill.warn { background: #fffbeb; color: #b45309; }
.state-pill.bad { background: #fef2f2; color: #b91c1c; }
.state-pill.idle { background: #f3f4f6; color: #6b7280; }

/* ---- 表单 ---- */
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin: 16px 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}

.checkbox-field {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  align-self: end;
  padding-bottom: 8px;
}

.checkbox-field input {
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
}

/* ---- 群白名单勾选 ---- */
.chat-picker {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 8px;
  /* 群多了不要把整个表单撑到看不见「保存」。 */
  max-height: 240px;
  overflow-y: auto;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border, #f3f4f6);
}

.chat-item:last-child { border-bottom: none; }
.chat-item:hover { background: #f9fafb; }

.chat-item input {
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  flex-shrink: 0;
}

.chat-name {
  font-weight: 600;
  /* 拿不到群名时这里显示的是 chat_id 本身（见 chatLabel），会很长。 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.chat-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.chat-tag.bad { background: #fef2f2; color: #b91c1c; }
.chat-tag.idle { background: #f3f4f6; color: #6b7280; }

.chat-id {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-soft);
}

.chat-manual {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.chat-manual input { flex: 1; font-size: 12px; }

/* ---- 本企业的补充规则 ---- */
.rules-textarea {
  width: 100%;
  margin-top: 12px;
  padding: 12px 14px;
  /* 写的是分节的 markdown，等宽字体下缩进和层级看得清。 */
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
}

.rules-hint {
  font-size: 12px;
  color: var(--color-muted);
}

.blocked-chat {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 12px;
  line-height: 1.6;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

/* ---- 名册 ---- */
.dir-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.dir-status-text {
  font-size: 12px;
  color: var(--color-muted);
}

/* 降级到群成员时用的提示 —— 是「注意覆盖面」而不是「出错了」，所以是黄不是红。 */
.dir-note {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 12px;
  line-height: 1.7;
  /* 同步失败/降级的说明是分行写的（原因一行、怎么办一行）。不保留换行的话
     会挤成一大坨，而这段文字的全部价值就在于让人能照着一步步做。 */
  white-space: pre-wrap;
}

.dir-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.dir-toolbar input { flex: 1; max-width: 320px; }

.dir-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.dir-table th {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-strong);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}

.dir-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.dir-table tr.resigned td { color: var(--color-soft); }

.dir-en {
  margin-left: 6px;
  font-size: 11px;
  color: var(--color-soft);
  font-family: var(--font-mono);
}

/* ---- 日志 ---- */
.filters {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-row {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
  overflow: hidden;
}

.log-head {
  display: grid;
  grid-template-columns: 72px 120px 90px minmax(0, 1fr) 130px 100px 62px 20px;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
}

.log-head:hover { background: #f3f4f6; }

.log-project {
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-sender {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-text {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-action, .log-time, .log-dur {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.log-dur { text-align: right; }
.log-caret { color: var(--color-soft); text-align: center; }

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.status-pill.done { background: #ecfdf5; color: #047857; }
.status-pill.failed { background: #fef2f2; color: #b91c1c; }
.status-pill.ignored { background: #fffbeb; color: #b45309; }
.status-pill.pending, .status-pill.running { background: #eff6ff; color: #1d4ed8; }

.log-detail {
  padding: 12px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-line {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
}

.detail-pre {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: var(--color-fill);
  border: 1px solid var(--color-border);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-pre {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

/* ---- 项目日记 ---- */
.diary-index {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
  font-size: 13px;
}

.diary-index-link {
  font-weight: 600;
  color: var(--primary-color);
  text-decoration: none;
}

.diary-index-link:hover { text-decoration: underline; }

.diary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diary-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
  overflow: hidden;
}

.diary-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px 4px;
  cursor: pointer;
  font-size: 13px;
}

.diary-head:hover { background: #f3f4f6; }
.diary-head .log-caret { margin-left: auto; }

.diary-name { font-weight: 600; }

.diary-meta {
  font-size: 12px;
  color: var(--color-muted);
}

.diary-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 10px;
  font-size: 11px;
  color: var(--color-muted);
}

.diary-link {
  color: var(--primary-color);
  text-decoration: none;
  font-weight: 600;
}

.diary-link:hover { text-decoration: underline; }

/* 推到最右，和「日志表 ↗」这些链接拉开距离 —— 挨着放的话点链接容易点到删除。 */
.diary-del { margin-left: auto; }

.diary-receipt {
  position: relative;
  margin: 0 0 12px;
  padding: 12px 32px 12px 14px;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  background: #fffbeb;
  font-size: 12px;
  line-height: 1.7;
  color: #78350f;
}

.diary-receipt p { margin: 0 0 4px; }
.diary-receipt p:last-child { margin-bottom: 0; }

.receipt-links {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.receipt-links a {
  color: var(--primary-color);
  font-weight: 600;
  text-decoration: none;
}

.receipt-links a:hover { text-decoration: underline; }

.receipt-close {
  position: absolute;
  top: 6px;
  right: 8px;
  border: none;
  background: none;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  color: #92400e;
}

.diary-detail {
  padding: 12px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

.diary-switch {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.diary-switch button {
  padding: 5px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
}

.diary-switch button.active {
  border-color: var(--primary-color);
  color: var(--primary-color);
  font-weight: 600;
}

.diary-records {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diary-records li {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-fill);
}

.rec-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
}

.rec-author { font-weight: 600; color: var(--color-text); }
.rec-time { color: var(--color-muted); font-family: var(--font-mono); }

.rec-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
  /* 原文里的换行要留着 —— 一条会议记录被压成一行就看不出结构了。 */
  white-space: pre-wrap;
  word-break: break-word;
}

.pre-wrap { white-space: pre-wrap; }

.pager-info {
  font-size: 12px;
  color: var(--color-muted);
}

/* ---- 指引 ---- */
.guide-content { max-width: 860px; }

.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.steps li { font-size: 14px; }

.steps strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 600;
}

.steps p {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-muted);
}

.steps a { color: #1d4ed8; }

.sub-hint code, .scope-grid code, .action-head .scope-tag {
  font-family: var(--font-mono);
}

.sub-hint code {
  display: inline-block;
  margin-right: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-fill);
  border: 1px solid var(--color-border);
  font-size: 11px;
  color: var(--color-text);
}

.scope-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.scope-grid code {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--color-fill);
  border: 1px solid var(--color-border);
  font-size: 11px;
}

/* 可选权限：和上面那张必需清单在视觉上分开，否则又变成「一次性加齐」的一部分。 */
.optional-scopes {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px dashed var(--color-border);
}

.optional-scopes .sub-hint {
  margin: 0;
}

.action-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.action-card {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-fill);
}

.action-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.action-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
}

.scope-tag {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  font-size: 10px;
  color: var(--color-muted);
}

.action-desc {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-muted);
}

.action-examples {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--color-soft);
}

.caveats {
  margin: 12px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.caveats li {
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-muted);
}

.caveats strong { color: var(--color-text); }

.mono { font-family: var(--font-mono); }

/* ---- 控件 ---- */
input, select, textarea {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  font-size: 13px;
  color: var(--color-text);
  font-family: var(--font-sans);
}

input:focus, select:focus, textarea:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.1);
  outline: none;
}

.save-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border-radius: 6px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.save-btn:hover { background: #1e293b; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.btn-sm:hover {
  background: var(--color-fill);
  border-color: var(--color-border-strong);
}

.btn-sm:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-sm.btn-danger {
  color: #ef4444;
  border-color: #fecaca;
  background: #fef2f2;
}

.btn-sm.btn-danger:hover { background: #fee2e2; }

@media (max-width: 860px) {
  .fs-page { padding: 80px 20px 48px; }
  .dashboard-header { flex-direction: column; align-items: stretch; }
  .section-head { flex-direction: column; }
  .app-card { flex-direction: column; }
  .log-head {
    grid-template-columns: 72px minmax(0, 1fr) 20px;
    row-gap: 4px;
  }
  /* 项目名占满第一行的剩余部分，第二行才是「谁说了什么」。
     窄屏上项目名比发言人更重要 —— 用户是带着「A 项目怎么了」来的。 */
  .log-project { grid-column: 2 / 4; }
  .log-action, .log-time, .log-dur { display: none; }
}
</style>
