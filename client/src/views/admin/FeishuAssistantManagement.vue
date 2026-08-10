<template>
  <div class="page">
    <div class="page-header">
      <h1>飞书助理</h1>
    </div>
    <p class="desc">
      全平台绑定的飞书应用与长连接状态。长连接是服务端主动连出去的，进程重启后会自动重建；
      连接掉了但凭证没变时点「重连」即可，不必重启服务。每个应用的 AI 消耗记在归属账号名下。
    </p>

    <!-- ===== 应用列表 ===== -->
    <div class="hc-table-container" v-if="apps.length">
      <table class="hc-table">
        <thead>
          <tr>
            <th>应用</th>
            <th>归属账号</th>
            <th>连接状态</th>
            <th>组织架构名册</th>
            <th>群白名单</th>
            <th>项目日记</th>
            <th>助理规则</th>
            <th>最后状态变更</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in apps" :key="app.id">
            <td>
              <div class="app-name">{{ app.name }}</div>
              <div class="app-id mono">{{ app.app_id }}</div>
            </td>
            <td>{{ app.owner_username || '—' }}</td>
            <td>
              <span :class="['state-pill', stateClass(app.live_state)]">{{ stateLabel(app.live_state) }}</span>
              <span v-if="!app.enabled" class="state-pill idle">已停用</span>
              <div v-if="app.conn_error" class="conn-error">{{ app.conn_error }}</div>
            </td>
            <td>
              <span :class="['state-pill', dirStateClass(app)]">{{ dirStateLabel(app) }}</span>
              <div v-if="app.dir_sync_state === 'ok'" class="subtle">
                {{ app.dir_user_count }} 人 ·
                {{ app.dir_source === 'chats' ? '仅群成员' : '全公司通讯录' }}
              </div>
              <!-- 名册是「私聊里指名同事」的前提。没有它助理只能认 @ 到的人，
                   而用户往往不知道这回事，所以这里要说清楚后果。 -->
              <div v-else-if="app.dir_sync_state === 'failed'" class="conn-error">
                {{ app.dir_sync_error }}
              </div>
              <div v-else class="warn-text">私聊里按姓名找人会失败</div>
              <button
                class="hc-btn hc-btn-secondary sync-btn"
                :disabled="busy === app.id || app.dir_sync_state === 'syncing'"
                @click="syncDirectory(app)"
              >{{ app.dir_sync_state === 'syncing' ? '同步中…' : '同步' }}</button>
            </td>
            <td>
              <span v-if="app.allowed_chats.length">{{ app.allowed_chats.length }} 个群</span>
              <span v-else class="warn-text">不限（任意群可 @）</span>
              <!-- 被拦时机器人不回话，用户只看到「@ 了没反应」。后台这边要能一眼
                   看出是白名单拦的，否则排障会往连接状态和飞书权限上找。
                   放行动作留给用户自己在 /feishu 里做（那是他的群）。 -->
              <div v-if="blockedCount(app)" class="warn-text">
                有 {{ blockedCount(app) }} 个群被拦下过
              </div>
            </td>
            <!-- 项目日记（066）。只看规模和「未同步」，不列内容 ——
                 那是那家公司的项目进展，后台没有理由把它铺在页面上；
                 用户自己在 /feishu >「项目日记」里看。
                 「未同步」要露出来的理由：补推是跟着下一次记录发生的（没有定时任务），
                 所以数字只升不降的项目 = 那个群已经不活跃了，而表格里永远缺那几条。 -->
            <td>
              <template v-if="diary[app.id]">
                <span v-if="diary[app.id].projects" class="subtle">
                  {{ diary[app.id].projects }} 个项目 · {{ diary[app.id].records }} 条记录<!--
                    群聊摘要单独括出来：它们是 AI 归纳的，不是一手记录。
                    混进总数的话，「这家公司记了 400 条」里可能有 300 条是自动生成的。
                  --><template v-if="diary[app.id].digests">（含 {{ diary[app.id].digests }} 条 AI 摘要）</template>
                  · {{ diary[app.id].tasks }} 个任务
                </span>
                <span v-else class="subtle">未使用</span>
                <div v-if="diary[app.id].unsynced" class="warn-text">
                  {{ diary[app.id].unsynced }} 条记录/任务未同步到多维表格
                </div>
                <div v-if="diary[app.id].projects && !diary[app.id].hasIndex" class="warn-text">
                  项目总表缺失
                </div>
              </template>
              <span v-else class="subtle">—</span>
            </td>
            <!-- 「本企业的补充规则」（059）。只读：那段话描述的是那家公司怎么说话，
                 平台这边既不知道也不该代填。这一列存在的意义是排障 ——
                 「助理忽然听不懂话了 / 老是理解成别的事」第一件要确认的就是
                 这家企业自己写了规则、还是在用平台默认那份示例模板。 -->
            <td>
              <span v-if="app.intent_supplement" class="state-pill ok">已填 {{ app.intent_supplement.length }} 字</span>
              <span v-else class="state-pill idle">平台默认</span>
            </td>
            <td><span class="subtle">{{ fmtTime(app.conn_at) }}</span></td>
            <td>
              <div class="table-actions">
                <button class="hc-btn hc-btn-secondary" :disabled="!app.enabled || busy === app.id" @click="reconnect(app)">
                  {{ busy === app.id ? '…' : '重连' }}
                </button>
                <button class="hc-btn hc-btn-secondary" :disabled="busy === app.id" @click="toggleEnabled(app)">
                  {{ app.enabled ? '停用' : '启用' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty">暂无绑定的飞书应用（用户在 /feishu 页面自行绑定）</p>

    <!-- ===== 指令日志 ===== -->
    <div class="page-header logs-header">
      <h1>指令日志</h1>
      <div class="filters">
        <select v-model="cmdStatus" @change="applyFilter">
          <option value="">全部状态</option>
          <option v-for="o in COMMAND_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="cmdAppId" @change="pickCmdApp">
          <option value="">全部应用</option>
          <option v-for="a in apps" :key="a.id" :value="a.app_id">{{ a.name }}</option>
        </select>
        <!-- 群名在不同租户之间会重名，所以只在选定应用后才给这个下拉（后端同理）。 -->
        <select v-if="cmdAppId" v-model="cmdChatId" @change="applyFilter">
          <option value="">全部项目群</option>
          <option v-for="c in cmdChats" :key="c.chat_id" :value="c.chat_id">
            {{ cmdChatOptionLabel(c) }}
          </option>
        </select>
        <button class="hc-btn hc-btn-secondary" @click="loadCommands">刷新</button>
      </div>
    </div>
    <p class="desc">
      排查「@ 了没反应」的顺序：这里没记录 → 事件没进来（看上面的连接状态、飞书后台的权限是否已发版）；
      有记录但「未识别」→ 收到了没听懂；「失败」→ 调飞书接口报错，错误原文在展开里。
    </p>

    <div class="hc-table-container" v-if="commands.length">
      <table class="hc-table">
        <thead>
          <tr>
            <th style="width: 80px">状态</th>
            <th style="width: 140px">项目 / 群</th>
            <th style="width: 100px">发起人</th>
            <th>原文</th>
            <th style="width: 130px">动作</th>
            <th style="width: 120px">时间</th>
            <th style="width: 70px">耗时</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in commands" :key="row.id">
            <tr class="clickable" @click="expanded[row.id] = !expanded[row.id]">
              <td><span :class="['status-pill', row.status]">{{ statusLabel(row.status) }}</span></td>
              <!-- 折叠状态下就要看得见：一个群 = 一个项目，混排时这是唯一的项目维度。 -->
              <td class="cmd-project" :title="row.chat_id">{{ cmdChatLabel(row) }}</td>
              <td>{{ row.sender_name || '未知' }}</td>
              <td class="cmd-text">{{ row.text }}</td>
              <td><span class="mono subtle">{{ row.action || '—' }}</span></td>
              <!-- 日志要秒：同一分钟里的连发指令得能排出先后。 -->
              <td><span class="subtle">{{ fmtTime(row.created_at, true) }}</span></td>
              <td><span class="subtle mono">{{ row.duration_ms != null ? `${row.duration_ms}ms` : '' }}</span></td>
            </tr>
            <tr v-if="expanded[row.id]" class="detail-row">
              <td colspan="7">
                <div class="detail-grid">
                  <div class="detail-line">
                    <span class="detail-label">来源</span>
                    <span class="mono">{{ row.chat_type === 'p2p' ? '私聊' : '群聊' }} · {{ cmdChatLabel(row) }} · {{ row.chat_id }} · app {{ row.app_id }}</span>
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
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <AdminPagination v-model="cmdPage" :total="cmdTotal" :total-pages="totalPages" />
    </div>
    <p v-else class="empty">暂无指令记录</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { apiGet, apiPost } from '../../lib/api'
import AdminPagination from '../../components/common/AdminPagination.vue'
import FeishuErrorDetail, { type FeishuErrorDetailData } from '../../components/feishu/FeishuErrorDetail.vue'
import {
  COMMAND_STATUS_OPTIONS,
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

// 后台视角。和用户侧 /feishu 走的是同一批接口 —— 管理员身份下
// GET /apps 和 GET /commands 天然返回全平台数据，不需要另一套路由。
//
// 状态文案和格式化都从 lib/feishu.ts 来：两个页面各写一份的时候，
// 后端加状态只会有一边跟上，而漏掉的那边正是这个没人天天看的后台。

const PAGE_SIZE = 20

interface AppRow {
  id: string
  name: string
  app_id: string
  enabled: boolean
  allowed_chats: string[]
  conn_state: string
  conn_error: string | null
  conn_at: string | null
  live_state: string
  dir_sync_state: string
  dir_sync_error: string | null
  dir_sync_at: string | null
  dir_user_count: number
  dir_source: string
  /** 本企业自己填的补充规则（059）。空串 = 该应用走平台默认那份。 */
  intent_supplement: string
  owner_username?: string
}

interface CommandRow {
  id: string
  app_id: string
  chat_id: string
  chat_type: string
  /** 群名。飞书不给的时候是空串（`im:chat:readonly` 不是必需权限）。 */
  chat_name: string
  /** 这个群绑的项目名。空串 = 没建项目。一个群 = 一个项目，所以它就是项目维度。 */
  project_name: string
  sender_name: string
  text: string
  action: string | null
  params: string | null
  status: string
  error: string | null
  /** 结构化失败原因。migration 055 之前的历史记录是 null。 */
  error_detail: FeishuErrorDetailData | null
  result: string | null
  duration_ms: number | null
  created_at: string
}

const apps = ref<AppRow[]>([])
const busy = ref('')

const commands = ref<CommandRow[]>([])
const cmdTotal = ref(0)
const cmdPage = ref(1)
const cmdStatus = ref('')
const cmdAppId = ref('')
/** 按项目群筛。选项只在选定应用后才有 —— 群名跨租户会重名。 */
const cmdChatId = ref('')
const cmdChats = ref<FeishuChatLabelled[]>([])
const expanded = ref<Record<string, boolean>>({})

const totalPages = computed(() => Math.max(1, Math.ceil(cmdTotal.value / PAGE_SIZE)))

/** 每个应用「被白名单拦下过、且现在仍没放行」的群数。辅助信息，拉不到就当 0。 */
const blocked = ref<Record<string, number>>({})

function blockedCount(app: AppRow): number {
  return blocked.value[app.id] || 0
}

/**
 * 项目日记的规模概览。**只有计数，没有内容** —— 日志正文是那家公司的项目进展。
 * 和 blocked 一样是辅助信息，拉不到就当没有。
 */
const diary = ref<
  Record<
    string,
    {
      projects: number
      records: number
      /** records 里有多少条是 AI 从群聊归纳的（不是谁的原话）。 */
      digests: number
      tasks: number
      /** 记录 + 任务的未同步总数。两者是两条同步路径，但这一列只回答「表里缺东西吗」。 */
      unsynced: number
      hasIndex: boolean
    }
  >
>({})

async function loadApps() {
  try {
    const res = await apiGet<{ apps: AppRow[] }>('/api/feishu-assistant/apps')
    apps.value = res.apps
    const counts: Record<string, number> = {}
    const diaryStats: typeof diary.value = {}
    await Promise.all(
      res.apps.map(async (app) => {
        try {
          const r = await apiGet<{ chats: FeishuChatRow[] }>(`/api/feishu-assistant/apps/${app.id}/chats`)
          counts[app.id] = r.chats.filter((c) => c.reject_count > 0 && !c.in_allowlist).length
        } catch (e) {
          console.error(e)
        }
        try {
          const d = await apiGet<{
            index: { url: string } | null
            projects: Array<{
              record_count: number
              digest_count: number
              unsynced_count: number
              task_count: number
              unsynced_task_count: number
            }>
          }>(`/api/feishu-assistant/apps/${app.id}/diary/projects`)
          const sum = (f: (p: (typeof d.projects)[number]) => number) =>
            d.projects.reduce((n, p) => n + f(p), 0)
          diaryStats[app.id] = {
            projects: d.projects.length,
            records: sum((p) => p.record_count),
            digests: sum((p) => p.digest_count),
            tasks: sum((p) => p.task_count),
            unsynced: sum((p) => p.unsynced_count + p.unsynced_task_count),
            hasIndex: !!d.index?.url,
          }
        } catch (e) {
          console.error(e)
        }
      })
    )
    blocked.value = counts
    diary.value = diaryStats
  } catch (e: any) {
    console.error(e)
  }
}

async function loadCommands() {
  try {
    const res = await apiGet<{ commands: CommandRow[]; total: number; chats: FeishuChatLabelled[] }>(
      '/api/feishu-assistant/commands',
      {
        status: cmdStatus.value || undefined,
        app_id: cmdAppId.value || undefined,
        chat_id: cmdChatId.value || undefined,
        page: cmdPage.value,
        page_size: PAGE_SIZE,
      }
    )
    commands.value = res.commands
    cmdTotal.value = res.total
    cmdChats.value = res.chats || []
  } catch (e: any) {
    console.error(e)
  }
}

function applyFilter() {
  cmdPage.value = 1
  loadCommands()
}

/**
 * 换应用时清掉群筛选。留着的话结果永远是空列表，
 * 而那个 chat_id 已经不在下拉选项里了 —— 页面上看不出为什么空。
 */
function pickCmdApp() {
  cmdChatId.value = ''
  applyFilter()
}

async function reconnect(app: AppRow) {
  busy.value = app.id
  try {
    await apiPost(`/api/feishu-assistant/apps/${app.id}/reconnect`)
    await loadApps()
  } catch (e: any) {
    alert(e?.message || '重连失败')
  } finally {
    busy.value = ''
  }
}

async function toggleEnabled(app: AppRow) {
  busy.value = app.id
  try {
    // 复用 upsert：不传 app_secret 就保留原密钥。
    await apiPost('/api/feishu-assistant/apps', {
      id: app.id,
      name: app.name,
      app_id: app.app_id,
      enabled: !app.enabled,
      allowed_chats: app.allowed_chats,
    })
    await loadApps()
  } catch (e: any) {
    alert(e?.message || '操作失败')
  } finally {
    busy.value = ''
  }
}

/**
 * 触发名册同步。接口是 202（已受理，几十秒后才跑完），所以刷一次列表不够 ——
 * 用轮询等它变成终态。管理员这边不需要看名册内容，只关心「同步成功了没」。
 */
async function syncDirectory(app: AppRow) {
  busy.value = app.id
  try {
    await apiPost(`/api/feishu-assistant/apps/${app.id}/directory/sync`)
    await loadApps()
    pollSync(app.app_id)
  } catch (e: any) {
    alert(e?.message || '同步失败')
  } finally {
    busy.value = ''
  }
}

function pollSync(appId: string) {
  const timer = setInterval(async () => {
    await loadApps()
    const row = apps.value.find((a) => a.app_id === appId)
    // 应用被删掉、或状态已经落定，都该停。不设上限的话切走页面后它还在打接口。
    if (!row || row.dir_sync_state !== 'syncing') clearInterval(timer)
  }, 3000)
}

watch(cmdPage, loadCommands)
onMounted(() => {
  loadApps()
  loadCommands()
})
</script>

<style scoped>
.page { max-width: 1200px; }

.desc {
  color: var(--c-text-sub);
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  margin-bottom: 32px;
  line-height: 1.6;
  border-left: 4px solid #3B5BDB;
  padding-left: 16px;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 48px;
  flex-wrap: wrap;
}

.filters { display: flex; gap: 8px; }

.filters select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--c-border, #e5e7eb);
  border-radius: 6px;
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  background: #fff;
  outline: none;
}

.app-name { font-weight: 600; color: var(--c-text-main); }
.app-id { font-size: 11px; color: var(--c-text-sub); margin-top: 2px; }

.mono { font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; }
.subtle { color: var(--c-text-sub); font-size: 12px; }
.warn-text { color: #b45309; font-size: 12px; }

.state-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  margin-right: 6px;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 600;
}

.state-pill.ok { background: #ecfdf5; color: #047857; }
.state-pill.warn { background: #fffbeb; color: #b45309; }
.state-pill.bad { background: #fef2f2; color: #b91c1c; }
.state-pill.idle { background: #f3f4f6; color: #6b7280; }

.sync-btn { margin-top: 6px; }

.conn-error {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: #b91c1c;
  max-width: 260px;
  /* 名册同步失败的说明是分行写的（原因一行、怎么办一行）。 */
  white-space: pre-wrap;
}

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

.clickable { cursor: pointer; }
.clickable:hover { background: #f9fafb; }

.cmd-text {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-project {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted, #6b7280);
}

.detail-row td { background: #f9fafb; }

.detail-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 0;
}

.detail-line { display: flex; flex-direction: column; gap: 4px; }

.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text-sub);
}

.detail-pre {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e5e7eb;
  font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-pre { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }

.empty {
  color: var(--c-text-sub);
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  margin-top: 32px;
  text-align: center;
  padding: 40px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
}
</style>
