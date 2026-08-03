import { getDatabase } from '../../db/index.js';
import { decryptSecret } from '../../core/secrets.js';

// 飞书多维表格同步。
//
// 和 feishuNotify.ts（群自定义机器人 webhook + HMAC 加签）是两套完全不同的鉴权：
// 这里走开放平台应用凭据链 app_id/app_secret → tenant_access_token → 多维表格记录接口。
// 文档：https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/batch_create
//
// 数据流是单向的：多维表格自己不会来拉数据，只有我们往里写。
// 表结构由本文件的 TABLE_FIELDS 定义并由服务端建表，所以列名不可能和代码对不上
// （手工建表最常见的坑：「采购方」写成「采购单位」→ 该列静默无值，飞书不报错）。
//
// 应用是每家客户在自己飞书企业里建的自建应用（自建应用只能在创建它的租户内使用），
// 因此 app_id/app_secret 存在 per-user 的 tender_user_preferences 上，而不是平台级 system_config。

const OPEN_BASE = 'https://open.feishu.cn/open-apis';

export interface BitableConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
}

export interface BitableRecordItem {
  tenderId: string;
  title: string;
  purchaserName?: string | null;
  totalScore: number;
  tier: string;
  budgetAmount?: number | null;
  budgetText?: string | null;
  regionName?: string | null;
  url?: string | null;
  publishDate?: string | null;
  createdAt?: string | null;
}

const TIER_LABEL: Record<string, string> = {
  priority: '🔴 优先',
  consider: '🟡 考虑',
  watch: '🔵 关注',
};

// 平台 id → 中文名。和 crawlerRegistry 里的 name 保持一致，
// 但这里不 import registry：registry 会拉起两个爬虫模块，同步逻辑不该依赖它们。
const PLATFORM_LABEL: Record<string, string> = {
  gdgpo: '广东省政府采购网',
  meicloud: '美的询源云',
  szecp: '华润守正',
};

// 「全部标讯」表的单选项。爬虫写入是 draft，AI 抽取后 extracted，评分后 scored。
const STATUS_LABEL: Record<string, string> = {
  draft: '待处理',
  extracted: '已抽取',
  scored: '已评分',
};

// 单次 batch_create 上限 1000，留出余量分批。
const BATCH_SIZE = 500;

// 建表时一次把列建对。type 取值见字段编辑指南：
// 1 文本 / 2 数字 / 3 单选 / 5 日期 / 15 超链接
// 第一个字段是索引字段，只能是 1/2/5/13/15/20/22，这里用超链接（标题点了直接跳标讯详情）。
const TABLE_FIELDS = [
  { field_name: '标题', type: 15 },
  { field_name: '采购方', type: 1 },
  { field_name: '评分', type: 2 },
  {
    field_name: '等级',
    type: 3,
    property: {
      options: [{ name: TIER_LABEL.priority }, { name: TIER_LABEL.consider }, { name: TIER_LABEL.watch }],
    },
  },
  { field_name: '预算', type: 1 },
  { field_name: '地区', type: 1 },
  { field_name: '发布日期', type: 1 },
  { field_name: '推荐时间', type: 5 },
  // 「跟进状态」我们只建不写，留给用户在飞书里自己点。同步只追加新行、永不覆盖，标记不会被冲掉。
  {
    field_name: '跟进状态',
    type: 3,
    property: {
      options: [{ name: '待看' }, { name: '跟进中' }, { name: '已报名' }, { name: '放弃' }],
    },
  },
  { field_name: '标讯ID', type: 1 },
];

// 「全部标讯」表：库里所有标讯，不做阈值过滤，也没有评分/等级（未评分的标讯没有这些值）。
// 定位和推荐表互补 —— 推荐表是「该看的」，这张表是「全都在这」，供用户自己筛。
const ALL_TABLE_FIELDS = [
  { field_name: '标题', type: 15 },
  { field_name: '采购方', type: 1 },
  {
    field_name: '平台',
    type: 3,
    property: { options: Object.values(PLATFORM_LABEL).map((name) => ({ name })) },
  },
  { field_name: '预算', type: 1 },
  // 预算数值单独一列（单位：万元）。文本列没法排序/筛选「预算 > 100 万」，
  // 而这正是用户翻全量表时最需要的动作。未知则留空，不写 0（0 会污染排序）。
  { field_name: '预算(万元)', type: 2 },
  { field_name: '地区', type: 1 },
  { field_name: '公告类型', type: 1 },
  { field_name: '关键词', type: 1 },
  { field_name: '发布日期', type: 5 },
  // 截止日期：过期与否是用户第一位关心的，推荐表当初漏了这列。
  { field_name: '截止日期', type: 5 },
  {
    field_name: '处理状态',
    type: 3,
    property: { options: Object.values(STATUS_LABEL).map((name) => ({ name })) },
  },
  { field_name: '标讯ID', type: 1 },
];

// ==================== tenant_access_token ====================

interface TokenCacheEntry {
  token: string;
  expireAtMs: number;
}

// 按 app_id 缓存（每家客户一个自建应用）。token 有效期 2h，提前 5min 过期避免边界失效。
const tokenCache = new Map<string, TokenCacheEntry>();

async function getTenantToken(appId: string, appSecret: string, nowMs: number): Promise<string> {
  const cached = tokenCache.get(appId);
  if (cached && cached.expireAtMs > nowMs) return cached.token;

  // app_secret 在库里是加密的（migrations/050）。解密收在这一个点上：
  // 它是 secret 唯一真正被使用的地方，各处 SELECT 出来的密文可以照原样传递，
  // 于是 tender.ts 那几个只是把 row 转手传进来的调用点一行都不用改。
  // decryptSecret 对旧明文原样返回，解不开则抛出可读原因。
  const plainSecret = decryptSecret(appSecret);

  const res = await fetch(`${OPEN_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: plainSecret }),
    signal: AbortSignal.timeout(15000),
  });

  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败（code=${data.code ?? '?'} ${data.msg ?? ''}）`);
  }

  const ttlSec = typeof data.expire === 'number' ? data.expire : 7200;
  tokenCache.set(appId, {
    token: data.tenant_access_token,
    expireAtMs: nowMs + Math.max(60, ttlSec - 300) * 1000,
  });
  return data.tenant_access_token;
}

// 凭据改了要立刻失效，否则后台换了 secret 还在用旧 token。
export function invalidateTokenCache(appId?: string): void {
  if (appId) tokenCache.delete(appId);
  else tokenCache.clear();
}

async function callOpenApi(
  token: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<any> {
  const res = await fetch(`${OPEN_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: any };
  if (data.code !== 0) {
    // 1254302 / 403 基本都是同一个原因：应用没被加成这张表的协作者。
    const hint =
      data.code === 1254302 || res.status === 403
        ? '（请确认应用已被添加为该多维表格的文档应用并授予「可编辑」）'
        : '';
    throw new Error(`飞书接口 ${path} 失败（code=${data.code ?? res.status} ${data.msg ?? ''}）${hint}`);
  }
  return data.data ?? {};
}

// ==================== 建表 ====================

export interface CreatedBitable {
  appToken: string;
  tableId: string;
  allTableId: string;
  url: string;
}

/**
 * 在既有多维表格里补建「全部标讯」表。
 *
 * 单独成函数（而不是只在 createBitable 里建）是因为已经在用的用户不能重建 ——
 * 重建会换掉 app_token，旧表里的跟进标记全部失联。这个函数只加表，不动既有数据。
 */
export async function createAllTendersTable(
  cfg: { appId: string; appSecret: string },
  appToken: string,
  nowMs: number
): Promise<string> {
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
  const table = await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables`, 'POST', {
    table: {
      name: '全部标讯',
      default_view_name: '全部',
      fields: ALL_TABLE_FIELDS,
    },
  });
  const tableId: string = table?.table_id;
  if (!tableId) throw new Error('创建「全部标讯」数据表成功但未返回 table_id');
  return tableId;
}

/**
 * 由服务端创建多维表格并建好列，返回 app_token / table_id / url。
 *
 * 相比让用户手工建表，这样列名不可能对不上，用户一个 id 都不用填，
 * 而且表是应用自己创建的 → 天然有编辑权限，不需要「添加文档应用」那一步。
 *
 * 副作用：应用创建的文件归应用所有，默认不在用户云空间可见，
 * 所以建完要调 grantPermission 把表授权给用户/群，否则用户打不开。
 */
export async function createBitable(
  cfg: { appId: string; appSecret: string },
  name: string,
  nowMs: number
): Promise<CreatedBitable> {
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);

  const created = await callOpenApi(token, '/bitable/v1/apps', 'POST', {
    name,
    time_zone: 'Asia/Shanghai',
  });

  const appToken: string = created?.app?.app_token;
  const url: string = created?.app?.url || '';
  if (!appToken) throw new Error('创建多维表格成功但未返回 app_token');

  // 新建的 App 自带一个只有索引列的空数据表，我们另建一张列齐全的，不去改默认表。
  const table = await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables`, 'POST', {
    table: {
      name: '标讯推荐',
      default_view_name: '全部推荐',
      fields: TABLE_FIELDS,
    },
  });

  const tableId: string = table?.table_id;
  if (!tableId) throw new Error('创建数据表成功但未返回 table_id');

  // 第二张表：全部标讯。和推荐表在同一个 App 里，用户在飞书里切 tab 就能看。
  const allTableId = await createAllTendersTable(cfg, appToken, nowMs);

  return { appToken, tableId, allTableId, url: url || `https://feishu.cn/base/${appToken}` };
}

/**
 * 把多维表格授权给用户或群。
 * memberType: 'openid'（用户 open_id）| 'openchat'（群 chat_id）| 'email'（飞书邮箱）
 *
 * 注意：授权给群需要应用已作为机器人在该群内，否则接口会因「互相不可见」失败。
 */
export async function grantPermission(
  cfg: { appId: string; appSecret: string },
  appToken: string,
  memberType: 'openid' | 'openchat' | 'email' | 'userid',
  memberId: string,
  perm: 'view' | 'edit' | 'full_access',
  nowMs: number
): Promise<void> {
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
  await callOpenApi(token, `/drive/v1/permissions/${appToken}/members?type=bitable`, 'POST', {
    member_type: memberType,
    member_id: memberId,
    perm,
    type: memberType === 'openchat' ? 'chat' : 'user',
  });
}

// ==================== 写记录 ====================

function fmtBudget(item: BitableRecordItem): string {
  if (item.budgetText && item.budgetText !== '0') return item.budgetText;
  if (!item.budgetAmount) return '未知';
  return `${(item.budgetAmount / 10000).toFixed(1)} 万`;
}

function toFields(item: BitableRecordItem, nowMs: number): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    // 超链接字段：link 为空会被飞书拒绝，没有 url 就退化成纯文本列的写法不成立，
    // 因此无 url 时用平台自身地址兜底，保证这一列始终可写。
    标题: { text: item.title, link: item.url || 'https://open.feishu.cn' },
    采购方: item.purchaserName || '',
    评分: Math.round(item.totalScore),
    等级: TIER_LABEL[item.tier] || item.tier,
    预算: fmtBudget(item),
    地区: item.regionName || '',
    发布日期: item.publishDate || '',
    推荐时间: nowMs,
    标讯ID: item.tenderId,
  };
  return fields;
}

/**
 * 追加记录到多维表格。只新增、不更新，用户在表里加的「跟进状态」等标记不会被覆盖。
 * @returns 实际写入条数
 */
export async function appendRecords(
  cfg: BitableConfig,
  items: BitableRecordItem[],
  nowMs: number
): Promise<number> {
  return batchCreate(
    cfg,
    cfg.tableId,
    items.map((it) => toFields(it, nowMs)),
    nowMs
  );
}

/** 分批 batch_create 的公共实现。单次上限 1000，BATCH_SIZE 留了余量。 */
async function batchCreate(
  cfg: { appId: string; appSecret: string; appToken: string },
  tableId: string,
  fieldsList: Array<Record<string, unknown>>,
  nowMs: number
): Promise<number> {
  if (fieldsList.length === 0) return 0;
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);

  let created = 0;
  for (let i = 0; i < fieldsList.length; i += BATCH_SIZE) {
    const chunk = fieldsList.slice(i, i + BATCH_SIZE);
    const data = await callOpenApi(
      token,
      `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records/batch_create`,
      'POST',
      { records: chunk.map((fields) => ({ fields })) }
    );
    created += Array.isArray(data?.records) ? data.records.length : chunk.length;
  }
  return created;
}

/**
 * 「YYYY-MM-DD hh:mm:ss」/「YYYY-MM-DD」→ 毫秒时间戳（日期字段要的格式）。
 * 解析不出来返回 undefined —— 日期字段写非法值会整批 1254015 失败，
 * 而库里 deadline 有大量空串（gdgpo 爬虫压根没写这一列）。
 */
function toMs(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]/.test(s) ? s.replace(' ', 'T') : s;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? undefined : t;
}

export interface AllTenderItem {
  tenderId: string;
  title: string;
  purchaserName?: string | null;
  platform?: string | null;
  budgetAmount?: number | null;
  budgetText?: string | null;
  regionName?: string | null;
  noticeType?: string | null;
  keyword?: string | null;
  publishDate?: string | null;
  deadline?: string | null;
  status?: string | null;
  url?: string | null;
}

function toAllFields(item: AllTenderItem): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    标题: { text: item.title, link: item.url || 'https://open.feishu.cn' },
    采购方: item.purchaserName || '',
    预算: item.budgetText && item.budgetText !== '0' ? item.budgetText : '未知',
    地区: item.regionName || '',
    公告类型: item.noticeType || '',
    关键词: item.keyword || '',
    标讯ID: item.tenderId,
  };

  // 单选字段写未登记的选项会报错，映射不到就整列留空（飞书会忽略未给的字段）。
  const platform = PLATFORM_LABEL[item.platform || ''];
  if (platform) fields['平台'] = platform;
  const status = STATUS_LABEL[item.status || ''];
  if (status) fields['处理状态'] = status;

  // 预算未知时留空而不是写 0，否则「按预算排序」会把一堆未知项排在最前。
  if (item.budgetAmount && item.budgetAmount > 0) {
    fields['预算(万元)'] = Math.round(item.budgetAmount / 100) / 100;
  }

  const pub = toMs(item.publishDate);
  if (pub !== undefined) fields['发布日期'] = pub;
  const dl = toMs(item.deadline);
  if (dl !== undefined) fields['截止日期'] = dl;

  return fields;
}

// ==================== 同步编排 ====================

interface PrefRow {
  feishu_app_id: string | null;
  feishu_app_secret: string | null;
  bitable_app_token: string | null;
  bitable_table_id: string | null;
  bitable_all_table_id: string | null;
  bitable_url: string | null;
  bitable_enabled: number | null;
  feishu_min_score: number | null;
  platforms: string | null;
}

export function loadBitablePref(userId: string): PrefRow | undefined {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT feishu_app_id, feishu_app_secret, bitable_app_token, bitable_table_id,
              bitable_all_table_id, bitable_url, bitable_enabled, feishu_min_score, platforms
       FROM tender_user_preferences WHERE user_id = ?`
    )
    .get(userId) as PrefRow | undefined;
}

export function bitableReady(pref: PrefRow | undefined): boolean {
  return !!(
    pref?.bitable_enabled &&
    pref.feishu_app_id &&
    pref.feishu_app_secret &&
    pref.bitable_app_token &&
    pref.bitable_table_id
  );
}

export function getBitableUrl(userId: string): string {
  const pref = loadBitablePref(userId);
  if (!bitableReady(pref)) return '';
  return (
    pref!.bitable_url ||
    `https://feishu.cn/base/${pref!.bitable_app_token}?table=${pref!.bitable_table_id}`
  );
}

/**
 * 同步该用户所有未推送过的推荐到多维表格。
 *
 * 用 bitable_synced_at 状态位驱动，而不是只推「本轮新评出来的」：
 * 推荐行在评分时就已入库，下一轮会被 existing 判断跳过，
 * 若只推内存里那批，一次推送失败这些标讯就永久漏掉了。
 * 状态位换来三件事：失败下轮自动重试、历史推荐可一键回填、后台可手动触发。
 */
export async function syncUserRecommendations(
  userId: string,
  nowMs: number,
  limit = 1000
): Promise<{ synced: number; skipped?: string }> {
  const db = getDatabase();
  const pref = loadBitablePref(userId);
  if (!bitableReady(pref)) return { synced: 0, skipped: '未启用或配置不完整' };

  const minScore = pref!.feishu_min_score ?? 55;

  const rows = db
    .prepare(
      `SELECT r.id, r.tender_id, r.total_score, r.tier,
              t.title, t.purchaser_name, t.budget_amount, t.budget,
              t.region_name, t.url, t.publish_date
       FROM tender_recommendations r
       JOIN tenders t ON t.id = r.tender_id
       WHERE r.user_id = ?
         AND r.bitable_synced_at IS NULL
         AND r.tier != 'filter'
         AND r.total_score >= ?
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(userId, minScore, limit) as any[];

  if (rows.length === 0) return { synced: 0 };

  const items: BitableRecordItem[] = rows.map((r) => ({
    tenderId: r.tender_id,
    title: r.title,
    purchaserName: r.purchaser_name,
    totalScore: r.total_score,
    tier: r.tier,
    budgetAmount: r.budget_amount,
    budgetText: r.budget,
    regionName: r.region_name,
    url: r.url,
    publishDate: r.publish_date,
  }));

  const cfg: BitableConfig = {
    appId: pref!.feishu_app_id!,
    appSecret: pref!.feishu_app_secret!,
    appToken: pref!.bitable_app_token!,
    tableId: pref!.bitable_table_id!,
  };

  const created = await appendRecords(cfg, items, nowMs);

  // 只在写入成功后回写状态位；抛异常则整批保持未同步，下轮重试。
  const stamp = new Date(nowMs).toISOString();
  const mark = db.prepare('UPDATE tender_recommendations SET bitable_synced_at = ? WHERE id = ?');
  const markAll = db.transaction((ids: string[]) => {
    for (const id of ids) mark.run(stamp, id);
  });
  markAll(rows.map((r) => r.id));

  return { synced: created };
}

/**
 * 同步「全部标讯」表：把该用户还没推过的标讯全部追加进去。
 *
 * 与推荐表的三个区别：
 * 1. 不按分数过滤 —— 这张表的定位就是全量，用户自己在飞书里筛。
 * 2. 只按用户勾选的平台过滤（空 = 不限），和评分逻辑保持一致，
 *    否则用户会在表里看到自己压根没关注的平台的标讯。
 * 3. 状态位在关联表 tender_bitable_sync 上（标讯是全局共享的，状态位必须 per-user）。
 *
 * limit 默认 2000：首次开启时库里可能已有几万条，一轮全推会打满飞书写入配额，
 * 分轮补齐即可（状态位保证不重不漏）。
 */
export async function syncAllTenders(
  userId: string,
  nowMs: number,
  limit = 2000
): Promise<{ synced: number; skipped?: string }> {
  const db = getDatabase();
  const pref = loadBitablePref(userId);
  if (!bitableReady(pref)) return { synced: 0, skipped: '未启用或配置不完整' };
  if (!pref!.bitable_all_table_id) {
    return { synced: 0, skipped: '尚未创建「全部标讯」表' };
  }

  let platforms: string[] = [];
  try {
    platforms = JSON.parse(pref!.platforms || '[]');
  } catch {
    platforms = [];
  }
  const platformFilter =
    platforms.length > 0
      ? ` AND t.platform IN (${platforms.map(() => '?').join(',')})`
      : '';

  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.purchaser_name, t.platform, t.budget_amount, t.budget,
              t.region_name, t.notice_type, t.keyword, t.publish_date, t.deadline,
              t.status, t.url
       FROM tenders t
       LEFT JOIN tender_bitable_sync s ON s.tender_id = t.id AND s.user_id = ?
       WHERE s.tender_id IS NULL${platformFilter}
       ORDER BY t.publish_date DESC
       LIMIT ?`
    )
    .all(userId, ...platforms, limit) as any[];

  if (rows.length === 0) return { synced: 0 };

  const cfg = {
    appId: pref!.feishu_app_id!,
    appSecret: pref!.feishu_app_secret!,
    appToken: pref!.bitable_app_token!,
  };

  const items: AllTenderItem[] = rows.map((r) => ({
    tenderId: r.id,
    title: r.title,
    purchaserName: r.purchaser_name,
    platform: r.platform,
    budgetAmount: r.budget_amount,
    budgetText: r.budget,
    regionName: r.region_name,
    noticeType: r.notice_type,
    keyword: r.keyword,
    publishDate: r.publish_date,
    deadline: r.deadline,
    status: r.status,
    url: r.url,
  }));

  const created = await batchCreate(
    cfg,
    pref!.bitable_all_table_id!,
    items.map(toAllFields),
    nowMs
  );

  // 同上：只在写成功后落状态位，抛异常则整批保持未同步，下轮重试。
  const stamp = new Date(nowMs).toISOString();
  const mark = db.prepare(
    'INSERT OR IGNORE INTO tender_bitable_sync (user_id, tender_id, synced_at) VALUES (?, ?, ?)'
  );
  const markAll = db.transaction((ids: string[]) => {
    for (const id of ids) mark.run(userId, id, stamp);
  });
  markAll(rows.map((r) => r.id));

  return { synced: created };
}
