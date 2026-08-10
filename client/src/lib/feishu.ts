import type { FeishuErrorDetailData } from '../components/feishu/FeishuErrorDetail.vue'

// 飞书助理两个页面共用的类型 + 展示函数。
//
// 用户侧 /feishu 和后台 /admin 走的是**同一批接口**（管理员身份下天然看到全平台），
// 于是每个状态枚举、每段话术都被抄了两遍。抄两遍本身不要紧，问题是它们会**漂**：
// 后端加一个状态（比如连接状态多了 'reconnecting'）只有一边跟上，
// 另一边就把 'reconnecting' 原样吐在页面上 —— 而漂掉的那边通常是没人天天看的后台，
// 于是排障的人看到一个陌生英文词，第一反应是"坏了"。
//
// 这里只放**纯函数和类型**。轮询、加载这些各页面节奏不同（用户侧盯着日志刷 5 秒，
// 后台只在点了同步之后刷 3 秒），硬统一反而要加一堆开关。

/** 应用行里和"状态展示"有关的那几个字段。两个页面各自的接口类型都能满足它。 */
export interface FeishuAppState {
  live_state: string
  dir_sync_state: string
  dir_source: string
}

/** 指令日志行里和"展开详情"有关的那几个字段。 */
export interface FeishuCommandLike {
  status: string
  params: string | null
  result: string | null
  error: string | null
  error_detail: FeishuErrorDetailData | null
}

/** 会话（群）清单的一行。GET /apps/:id/chats */
export interface FeishuChatRow {
  chat_id: string
  name: string
  chat_type: string
  /** 'bot_added' = 机器人被拉进来时记的；'rejected' = 只在白名单外被拦时见过 */
  source: string
  reject_count: number
  last_seen_at: string
  last_rejected_at: string | null
  /** 服务端算的：白名单为空时全部为 true。前端不要自己算这条规则。 */
  in_allowlist: boolean
}

// ---- 长连接状态 ----

const CONN_LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  reconnecting: '重连中',
  failed: '连接失败',
  idle: '未连接',
  closed: '已断开',
}

/** 未知状态原样返回：吐一个英文词也比显示空白好，至少能搜。 */
export function connStateLabel(s: string): string {
  return CONN_LABELS[s] || s
}

export function connStateClass(s: string): string {
  if (s === 'connected') return 'ok'
  if (s === 'connecting' || s === 'reconnecting') return 'warn'
  if (s === 'failed') return 'bad'
  return 'idle'
}

// ---- 名册同步状态 ----

const DIR_LABELS: Record<string, string> = {
  idle: '未同步',
  syncing: '同步中',
  ok: '已同步',
  failed: '同步失败',
}

export function dirStateLabel(app: FeishuAppState | undefined | null): string {
  if (!app) return '—'
  return DIR_LABELS[app.dir_sync_state] || app.dir_sync_state || '未同步'
}

export function dirStateClass(app: FeishuAppState | undefined | null): string {
  if (!app) return 'idle'
  // 「已同步但只有群成员」不显示成绿色：它是能用但覆盖不全的状态，
  // 显示成成功会让人不去开通讯录权限，然后在「查不到某人」上浪费一下午。
  if (app.dir_sync_state === 'ok') return app.dir_source === 'chats' ? 'warn' : 'ok'
  if (app.dir_sync_state === 'syncing') return 'warn'
  if (app.dir_sync_state === 'failed') return 'bad'
  return 'idle'
}

// ---- 指令状态 ----

const CMD_LABELS: Record<string, string> = {
  pending: '排队中',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  ignored: '未识别',
}

export function commandStatusLabel(s: string): string {
  return CMD_LABELS[s] || s
}

/** 两个页面的状态下拉框都从这里生成，省得加了状态只有一边跟上。 */
export const COMMAND_STATUS_OPTIONS = Object.entries(CMD_LABELS).map(([value, label]) => ({
  value,
  label,
}))

// ---- 格式化 ----

/**
 * 时间。日志列表要秒（同一分钟里的几条指令得能排出先后），
 * 应用状态那一栏不要（“最后状态变更”精确到分就够，多两位是噪音）。
 */
export function fmtTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}${withSeconds ? `:${p(d.getSeconds())}` : ''}`
}

/** result 存的是 JSON，展开时拿 summary 给人看；解析不出来就原样显示。 */
export function resultSummary(row: Pick<FeishuCommandLike, 'result'>): string {
  if (!row.result) return ''
  try {
    const parsed = JSON.parse(row.result)
    return parsed.summary || row.result
  } catch {
    return row.result
  }
}

/** 参数缩进一下。坏 JSON 原样显示 —— 一行脏数据不该让详情打不开。 */
export function prettyParams(row: Pick<FeishuCommandLike, 'params'>): string {
  if (!row.params) return ''
  try {
    return JSON.stringify(JSON.parse(row.params), null, 2)
  } catch {
    return row.params
  }
}

/**
 * 会话在清单里显示成什么。
 *
 * 群名要靠 `im:chat:readonly` 才拿得到，而它不是必需权限，所以经常是空的 ——
 * 此时退回 chat_id。不能显示成「未命名群聊」：用户勾白名单时要能分辨是哪个群，
 * 一串 id 至少能和指令日志里的对上，而「未命名群聊」什么都对不上。
 */
export function chatLabel(chat: Pick<FeishuChatRow, 'name' | 'chat_id'>): string {
  return chat.name?.trim() || chat.chat_id
}

/** 一行指令日志/一个下拉项里和"这是哪个群"有关的那几个字段。 */
export interface FeishuChatLabelled {
  chat_id: string
  chat_name: string
  project_name: string
}

/**
 * 一条指令属于哪个群/项目。
 *
 * **项目名优先，群名兜底，最后是 chat_id 尾号。** 三级都要，因为三种情况都常见：
 * 建了项目的群有项目名（用户心里的称呼就是它）；没建项目的群只有群名；
 * 而群名要 `im:chat:readonly` 才拿得到，那不是必需权限，所以经常两个都空。
 * 最后那级不能省成空白 —— 一片空白的日志列表看起来像坏了，
 * 而尾号至少能和展开详情里那串完整 id 对上。
 *
 * 放在这里而不是各页面自己写：用户侧和后台都要显示这一列，
 * 而这个函数的三级兜底恰恰是最容易只改一边的那种逻辑。
 */
export function commandChatLabel(row: FeishuChatLabelled): string {
  const project = row.project_name?.trim()
  const chat = row.chat_name?.trim()
  if (project) return chat ? `${project}（${chat}）` : project
  if (chat) return chat
  return `未命名群 …${(row.chat_id || '').slice(-6)}`
}

/**
 * 「按项目群筛」下拉里那一项的文字。
 *
 * 没建项目的群要**标出来**：不标的话它和有项目的群长得一样，
 * 用户会以为在那个群里说「记一下」也有地方记（实际会被回一句「先建项目」）。
 */
export function commandChatOptionLabel(row: FeishuChatLabelled): string {
  const base = commandChatLabel(row)
  return row.project_name?.trim() ? base : `${base}（未建项目）`
}
