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
  commandStatusLabel as statusLabel,
  connStateClass as stateClass,
  connStateLabel as stateLabel,
  dirStateClass,
  dirStateLabel,
  fmtTime,
  prettyParams,
  resultSummary,
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
  chat_type: string
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

type Tab = 'apps' | 'directory' | 'rules' | 'logs' | 'guide'

const activeTab = ref<Tab>('apps')

const apps = ref<AppView[]>([])
const capabilities = ref<{
  actions: any[]
  scopes: string[]
  directory_scopes: string[]
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

const commands = ref<CommandRow[]>([])
const cmdTotal = ref(0)
const cmdStatus = ref('')
const cmdAppId = ref('')
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
    const res = await apiGet<{ commands: CommandRow[]; total: number }>('/api/feishu-assistant/commands', {
      status: cmdStatus.value || undefined,
      app_id: cmdAppId.value || undefined,
      page: cmdPage.value,
      // 后端 parsePagination 读的是 page_size（下划线），传 pageSize 会被忽略。
      page_size: CMD_PAGE_SIZE,
    })
    commands.value = res.commands
    cmdTotal.value = res.total
  } catch (e: any) {
    console.error(e)
  }
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
  if (tab === 'logs') {
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
    if (res.conn_error) {
      alert(`配置已保存，但长连接没建起来：\n${res.conn_error}\n\n请核对 App ID / App Secret，以及应用是否已开启「长连接」订阅方式。`)
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
              在飞书里 @ 一下机器人，用一句话建任务、约日程、给同事发消息，
              也能改它建过的那些。
            </p>
          </div>
          <div class="header-controls">
            <div class="fs-tabs">
              <button :class="{ active: activeTab === 'apps' }" @click="switchTab('apps')">应用绑定</button>
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
                      还没有名册 —— 私聊里说「给张三发消息」会查不到人
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
                试通之后建议回来勾上白名单。私聊不受此限制。
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

        <!-- ============ 组织架构名册 ============ -->
        <div v-if="activeTab === 'directory'" class="tab-content">
          <section class="fs-section">
            <div class="section-head">
              <div>
                <h2>组织架构名册</h2>
                <p class="section-desc">
                  同步一份公司通讯录到本地，助理就能在<strong>私聊里</strong>按姓名找人 ——
                  「给李四建个任务」不用先把他 @ 到。
                  没有名册时只认这条消息里 @ 出来的人，而私聊里没法 @ 任何人。
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
                查不到、有同名、已离职三种情况它都会回来问你，而不是挑一个发出去。
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
                  「早会」是九点半、「同步一下」是发消息而不是建任务。
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
                </p>
              </div>
              <div class="filters">
                <select v-model="cmdStatus" @change="applyCmdFilter">
                  <option value="">全部状态</option>
                  <option v-for="o in COMMAND_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <select v-model="cmdAppId" @change="applyCmdFilter">
                  <option value="">全部应用</option>
                  <option v-for="a in apps" :key="a.id" :value="a.app_id">{{ a.name }}</option>
                </select>
                <button class="btn-sm" @click="loadCommands">刷新</button>
              </div>
            </div>

            <p v-if="commands.length === 0" class="empty-hint">暂无指令记录。</p>

            <div v-else class="log-list">
              <div v-for="row in commands" :key="row.id" class="log-row">
                <div class="log-head" @click="expanded[row.id] = !expanded[row.id]">
                  <span :class="['status-pill', row.status]">{{ statusLabel(row.status) }}</span>
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
                    <span class="mono">{{ row.chat_type === 'p2p' ? '私聊' : '群聊' }} · {{ row.app_id }}</span>
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
              </li>
              <li>
                <!--
                  这一步是用户最容易漏的：可用范围默认只有创建者本人，
                  于是「给同事发消息」必然报 230013，而飞书的报错是英文的、
                  一个字都没提可用范围。
                -->
                <strong>把「可用范围」放开</strong>
                <p>
                  「应用发布」→「版本管理与发布」→ 可用范围选<strong>全体成员</strong>
                  （或加上要用它的部门）。
                </p>
                <p class="sub-hint">
                  这是和权限完全无关的第三套设置，默认<strong>只有你自己</strong>可用。
                  不放开的话，机器人给同事发消息会报
                  <code>Bot has NO availability to this user</code>。
                </p>
              </li>
              <li>
                <strong>回来绑定，然后在飞书里试</strong>
                <p>
                  把 App ID / App Secret 填到「应用绑定」，状态变成「已连接」即可。
                  在群里 @ 机器人，或直接私聊它说一句话。
                </p>
                <p class="sub-hint">
                  绑定成功会自动同步一次公司组织架构 —— 有了名册，
                  私聊里说「给李四建个任务」才能查到人。同步结果在「组织架构」页看。
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
                <strong>日程是机器人建的，你是被邀请人。</strong>
                免去授权流程的代价：日程落在机器人自己的日历上，你会收到邀请。
              </li>
              <li>
                <strong>只能改它自己帮你建过的东西。</strong>
                助理认得的任务和日程，只有它自己建的那些（最近 7 天内）——
                你在飞书里手动建的它看不见，也改不动。
                说「那个任务完成了」而它同时建过好几个时，
                它会把候选列出来让你挑，不会替你猜一个。
              </li>
              <li>
                <strong>不能列清单。</strong>
                「我今天有哪些任务」「明天有什么日程」做不到 ——
                读你自己的列表需要单独的用户授权。
                但「某人什么时候有空」可以（那只回时间段，不回内容）。
              </li>
              <li>
                <strong>给别人建任务 / 发消息，要么 @ 一下，要么先同步组织架构。</strong>
                @ 过来的账号最准；同步过名册之后在私聊里直接说姓名也行。
                两者都没有时助理会回来问你，不会猜 —— 猜错人比不做更糟。
                详见「组织架构」页。
              </li>
              <li>
                <strong>执行是异步的。</strong>
                飞书要求 3 秒内响应，而理解一句话要调大模型，
                所以它先默默接单、干完再回帖。慢几秒是正常的。
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
  grid-template-columns: 72px 90px minmax(0, 1fr) 130px 100px 62px 20px;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
}

.log-head:hover { background: #f3f4f6; }

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
  .log-action, .log-time, .log-dur { display: none; }
}
</style>
