import { getDatabase } from '../../db/index.js';
import { visibleSql } from './retention.js';
import { getTenantToken, callOpenApi } from './feishuOpen.js';
import {
  loadRecommendCandidates, loadAllTenderCandidates, parsePlatforms,
} from './candidates.js';

// 飞书多维表格同步。
//
// 鉴权、token 缓存和统一报错在 feishuOpen.ts（和 feishuNotify.ts 的群推送共用同一个
// 自建应用与同一份 token 缓存）。这里只管表结构和写记录。
// 文档：https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/batch_create
//
// 数据流是单向的：多维表格自己不会来拉数据，只有我们往里写。
// 表结构由本文件的 TABLE_FIELDS 定义并由服务端建表，所以列名不可能和代码对不上
// （手工建表最常见的坑：「采购方」写成「采购单位」→ 该列静默无值，飞书不报错）。
//
// 应用是每家客户在自己飞书企业里建的自建应用（自建应用只能在创建它的租户内使用），
// 因此 app_id/app_secret 存在 per-user 的 tender_user_preferences 上，而不是平台级 system_config。

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
  ygcg: '广州国企阳光采购',
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

// ==================== 建表 ====================

export interface CreatedBitable {
  appToken: string;
  tableId: string;
  allTableId: string;
  url: string;
  /** false = 设置链接分享失败，表停在租户默认值，可见范围不确定，必须告知管理员。 */
  tenantReadable: boolean;
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
 * 给多维表格地址补上 `?table=`，让链接直接落在指定的那张表上。
 *
 * 不带这个参数时飞书打开 base 里的**第一张**表。而新建 App 自带一张
 * 只有索引列的空「数据表」，排在我们建的两张前面 —— 于是卡片按钮点进去
 * 是一张空表，用户以为链接错了或者数据没同步。
 * （现在 createBitable 会删掉那张自带表，但历史数据里还有，
 *   所以 getBitableUrl 读的时候也过一遍这个函数。）
 *
 * 已经带 table 参数的原样返回，不重复拼。
 */
export function withTableParam(url: string, tableId: string): string {
  if (!url || !tableId) return url;
  if (/[?&]table=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}table=${tableId}`;
}

/**
 * 把链接分享设成「本企业内获得链接的人可阅读」，同时禁止转发到组织外。
 *
 * 这是用户拍的板，和 diary 模块（bitable.ts:closeLinkShare）**故意不一样**：
 * 标讯表要在应用所属企业内全员可见 —— 推送卡片是发到群里的，群里换一个人、
 * 或者把链接转给同事，都应该能直接打开，而不是一个个去 grantPermission。
 * 所以这里给的是 `tenant_readable`（企业内可阅读）而不是 `closed`。
 *
 * 为什么必须显式设置、不能省掉这一步：不设就跟随租户默认值，而默认值是
 * 租户管理员配的，可能是 `anyone_readable`（互联网上拿到链接的人都能看）。
 * 表里是这个账号的全部投标信息：预算、评分、AI 分析与策略。所以
 * `external_access` 必须显式关掉 —— 企业内可见是要的，公开到互联网不是。
 *
 * 这跟 grantPermission 是两件事：那个管「能不能改」，这个管「能不能看到」。
 * 企业内的人靠这个字段就能只读打开，不需要再授权；要能编辑（维护「跟进状态」
 * 那类列）才需要 grantPermission。
 *
 * 字段名有个坑：这个 v1 端点要的是 `external_access`（布尔），
 * v2 才是 `external_access_entity`（枚举）。传错的那个会被**静默忽略**，
 * 接口照样返回 code=0 —— 于是「已设置」是真的，「不能转发到组织外」是假的。
 * diary 那两处（bitable.ts / taskBase.ts）注释里也记着同一条。
 *
 * 失败不抛异常，返回 false 由调用方报出来：这一步失败时表已经建好了，
 * 抛出去只会留下一张孤儿表格，而且下次重建又是一张新的。
 */
export async function setTenantReadable(
  cfg: { appId: string; appSecret: string },
  appToken: string,
  nowMs: number
): Promise<boolean> {
  try {
    const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
    await callOpenApi(token, `/drive/v1/permissions/${appToken}/public?type=bitable`, 'PATCH', {
      link_share_entity: 'tenant_readable',
      external_access: false,
    });
    return true;
  } catch (e: any) {
    console.error('[bitable] 设置链接分享（企业内可阅读）失败:', e.message);
    return false;
  }
}

/**
 * 删掉建 App 时自带的那张空表。
 *
 * 传进来的是**建我们的表之前**列出的 table_id —— 不靠名字或位置猜。
 * （一个 base 至少要有一张表，所以必须先建好我们的再删它。）
 * 失败只记日志：这时候 url 已经带 ?table= 指向正确的表了，残留一张空表是观感问题。
 */
async function deleteTables(
  cfg: { appId: string; appSecret: string },
  appToken: string,
  tableIds: string[],
  nowMs: number
): Promise<void> {
  if (tableIds.length === 0) return;
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
  for (const id of tableIds) {
    try {
      await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables/${id}`, 'DELETE');
    } catch (e: any) {
      console.error(`[bitable] 删除自带空表 ${id} 失败:`, e.message);
    }
  }
}

/**
 * 清理历史 base 里那张建 App 时自带的空表。
 *
 * createBitable 现在建完就删，但早先创建的 base 里还留着它，而且排在
 * 客户端 tab 的第一位 —— 用户切 tab 很容易点进去看到一张空表。
 *
 * 判定条件是**同时**满足三条，缺一不删：
 *   1. 不是我们记录在库的两张表（keepIds）；
 *   2. 一条记录都没有；
 *   3. 只有一个字段（自带表就是一个「文本」索引列）。
 * 只看前两条不够 —— 用户自己新建的表在他填数据之前也是 0 条，
 * 而这个函数是管理员点一次按钮就跑的，误删了没有回收站。
 *
 * @returns 实际删掉的 table_id
 */
export async function cleanupDefaultTables(
  cfg: { appId: string; appSecret: string },
  appToken: string,
  keepIds: string[],
  nowMs: number
): Promise<string[]> {
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
  const listed = await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables?page_size=50`, 'GET');
  const keep = new Set(keepIds.filter(Boolean));
  const removed: string[] = [];

  for (const t of listed?.items || []) {
    const id: string = t.table_id;
    if (!id || keep.has(id)) continue;

    // 空 + 单字段才动它。任何一步查询失败就跳过 —— 拿不准就不删。
    try {
      const recs = await callOpenApi(
        token,
        `/bitable/v1/apps/${appToken}/tables/${id}/records?page_size=1`,
        'GET'
      );
      if ((recs?.items || []).length > 0) continue;

      const fields = await callOpenApi(
        token,
        `/bitable/v1/apps/${appToken}/tables/${id}/fields?page_size=10`,
        'GET'
      );
      if ((fields?.items || []).length !== 1) continue;

      await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables/${id}`, 'DELETE');
      removed.push(id);
    } catch (e: any) {
      console.error(`[bitable] 清理表 ${id} 时跳过:`, e.message);
    }
  }
  return removed;
}

/**
 * 由服务端创建多维表格并建好列，返回 app_token / table_id / url。
 *
 * 相比让用户手工建表，这样列名不可能对不上，用户一个 id 都不用填，
 * 而且表是应用自己创建的 → 天然有编辑权限，不需要「添加文档应用」那一步。
 *
 * 副作用：应用创建的文件归应用所有，默认不在用户云空间可见 ——
 * 所以表**不会**出现在任何人的「我的空间」里，只能靠链接打开。
 * 建完会把链接分享设成企业内可阅读（见 setTenantReadable），于是企业内的人
 * 拿到链接就能看；要能编辑才需要额外 grantPermission。
 *
 * `tenantReadable: false` 表示设置链接分享这一步失败了，表仍然可用但停在
 * 租户默认值（可能比企业内更宽，也可能更严），调用方必须把这件事说出来。
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
  const baseUrl: string = created?.app?.url || `https://feishu.cn/base/${appToken}`;
  if (!appToken) throw new Error('创建多维表格成功但未返回 app_token');

  // 建我们的表**之前**先记下自带的表有哪些，建完再删 —— 不靠名字猜哪张是自带的。
  let preexisting: string[] = [];
  try {
    const listed = await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables?page_size=50`, 'GET');
    preexisting = (listed?.items || []).map((t: any) => t.table_id).filter(Boolean);
  } catch (e: any) {
    console.error('[bitable] 列出自带表失败，跳过清理:', e.message);
  }

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

  // 自带的空表现在可以删了（我们的表已存在，base 不会空）。
  // 这里用 deleteTables 直删而不是 cleanupDefaultTables：base 是上面刚建的，
  // 建我们的表之前列出来的**必然**是飞书自带的，比「空 + 单字段」的启发式判定更准。
  // cleanupDefaultTables 是给历史 base 补救用的 —— 那时候已经分不清哪张是自带的，
  // 只能靠特征猜，所以它才需要那三条严格条件。
  await deleteTables(cfg, appToken, preexisting, nowMs);

  const tenantReadable = await setTenantReadable(cfg, appToken, nowMs);

  return {
    appToken,
    tableId,
    allTableId,
    // 带上 ?table=，否则点进去是 base 里的第一张表。
    url: withTableParam(baseUrl, tableId),
    tenantReadable,
  };
}

/**
 * 把多维表格授权给用户或群。
 * memberType: 'openid'（用户 open_id）| 'openchat'（群 chat_id）| 'email'（飞书邮箱）
 *
 * 注意：授权给群需要应用已作为机器人在该群内，否则接口会因「互相不可见」失败。
 *
 * 表本身已经是「企业内获得链接的人可阅读」（setTenantReadable），所以授权
 * **不再是**「能不能打开」的前提，只用于给人**编辑**权（维护「跟进状态」那类列）。
 *
 * perm 在这里是原样透传的，但**群授权应当只给 'view'**：授权给群等于该群
 * 全体成员都能开这张表，而表里是一个账号的全部投标信息（预算、评分、AI 分析
 * 与策略）；给整群 edit 意味着任何成员都能改、能删记录，而 appendRecords
 * 只追加不更新，别人删掉的行不会被补回来。这条规则由
 * api/tender.ts 的 /admin/bitable/:userId/grant 强制（openchat → view），
 * 新的调用方需要自己守住同一条线。
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

/**
 * 「平台」单选列补齐缺失的选项。
 *
 * 选项是建表那一刻按 PLATFORM_LABEL 写死的，所以**新增信息源后，老用户表里
 * 没有这个选项** —— 而单选列写未登记的选项会整批 batch_create 失败，
 * 于是那位用户的「全部标讯」表从此一条都同步不进来（toAllFields 那里的
 * 「映射不到就留空」只挡代码侧不认识的 platform，挡不了这种表侧缺选项）。
 *
 * 不在这里报错也不静默跳过：直接把缺的选项补上。补齐要带上**全部**已有选项，
 * 飞书的字段更新是整列替换，只传新选项会把旧的全删掉（旧记录的值随之失效）。
 * 任何一步失败都只警告不抛 —— 补选项是尽力而为，真写不进去时让 batch_create
 * 自己报那句更明确的错。
 */
async function ensurePlatformOptions(
  token: string,
  appToken: string,
  tableId: string
): Promise<void> {
  try {
    const list = await callOpenApi(token, `/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`, 'GET');
    const field = (list?.items || []).find((f: any) => f.field_name === '平台');
    if (!field?.field_id || field.type !== 3) return;

    const existing: string[] = (field.property?.options || []).map((o: any) => o.name).filter(Boolean);
    const missing = Object.values(PLATFORM_LABEL).filter((name) => !existing.includes(name));
    if (missing.length === 0) return;

    await callOpenApi(
      token,
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${field.field_id}`,
      'PUT',
      {
        field_name: '平台',
        type: 3,
        // 已有选项在前且保留 id，飞书才认得出「这是同一个选项」而不是删了重建。
        property: {
          options: [
            ...(field.property?.options || []).map((o: any) => ({ id: o.id, name: o.name })),
            ...missing.map((name) => ({ name })),
          ],
        },
      }
    );
    console.log(`[bitable] 「平台」列补齐选项: ${missing.join(', ')}`);
  } catch (e: any) {
    console.warn(`[bitable] 补齐「平台」选项失败（继续写入，若报 1254xxx 请手动在表里加选项）: ${e.message}`);
  }
}

/**
 * 把一张表整个读出来：record_id 列表 + 「标讯ID → 用户手填列的值」。
 *
 * 两件事一次读完，不分两趟：清空要 record_id，保「跟进状态」要那一列，
 * 分两趟就是同一张表读两遍（几千行时是两倍的分页往返），而且两趟之间
 * 表可能被人改过 —— 读到的标记对应的行已经不是要删的那些。
 *
 * 「跟进状态」我们只建不写，是用户在飞书里自己点的。不保的话每次重灌他的标记
 * 清零，而后台报「✅ 已重建」。单选列的值飞书返回字符串，非字符串一律跳过
 * （写回去时类型不对会整批 1254xxx 失败，等于重灌失败）。
 */
async function snapshotTable(
  token: string,
  appToken: string,
  tableId: string,
  keepColumn?: string
): Promise<{ recordIds: string[]; kept: Map<string, string> }> {
  const recordIds: string[] = [];
  const kept = new Map<string, string>();
  let pageToken = '';
  do {
    const q = `page_size=500${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await callOpenApi(
      token,
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${q}`,
      'GET'
    );
    for (const rec of data?.items || []) {
      if (rec?.record_id) recordIds.push(rec.record_id);
      if (!keepColumn) continue;
      const id = rec?.fields?.['标讯ID'];
      const val = rec?.fields?.[keepColumn];
      if (typeof id === 'string' && id && typeof val === 'string' && val) kept.set(id, val);
    }
    pageToken = data?.has_more ? data?.page_token || '' : '';
  } while (pageToken);
  return { recordIds, kept };
}

/**
 * 删掉给定的记录。
 *
 * 顺序对调用方是硬要求：**先删干净、成功了再灌**。删一半就开始灌等于表里出现
 * 重复行，而日志说「已重建」—— 所以这里任何一步失败都**抛**，不吞。
 * （batchCreate 那边是相反的约定：写失败保持状态位不动，下轮重试。）
 *
 * batch_delete 单次上限 500，和 BATCH_SIZE 一致。
 */
async function deleteRecords(
  token: string,
  appToken: string,
  tableId: string,
  recordIds: string[]
): Promise<void> {
  for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
    await callOpenApi(
      token,
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
      'POST',
      { records: recordIds.slice(i, i + BATCH_SIZE) }
    );
  }
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

/**
 * 卡片按钮和后台「打开表格」用的地址。
 *
 * 一律过一遍 withTableParam：库里存的可能是老数据 —— 早先存的是飞书返回的
 * 裸 base 地址，不带 ?table=，点进去落在 base 的第一张表（那时候还有一张
 * 建 App 时自带的空表排在前面），用户看到的是一张空表。
 */
export function getBitableUrl(userId: string): string {
  const pref = loadBitablePref(userId);
  if (!bitableReady(pref)) return '';
  const base = pref!.bitable_url || `https://feishu.cn/base/${pref!.bitable_app_token}`;
  return withTableParam(base, pref!.bitable_table_id || '');
}

/**
 * 同步该用户所有未推送过的推荐到多维表格。
 *
 * 用 bitable_synced_at 状态位驱动，而不是只推「本轮新评出来的」：
 * 推荐行在评分时就已入库，下一轮会被 existing 判断跳过，
 * 若只推内存里那批，一次推送失败这些标讯就永久漏掉了。
 * 状态位换来三件事：失败下轮自动重试、历史推荐可一键回填、后台可手动触发。
 *
 * 21 天时效闸门（retention.ts）也在这条 SQL 里。它和上面那个「失败下轮重试」
 * 有一处交互要知道：一条推荐若连续 21 天推送失败（webhook 配错、飞书配额打满），
 * 它会越过闸门，从此不再重试 —— 状态位仍是 NULL，但查询已经取不到它了。
 * 这是有意的（21 天前的标讯推过去也没用），代价是它在库里留成一条
 * 永远 pending 的记录。真要排查同步为什么没动，看 bitable_synced_at IS NULL
 * 且 publish_date 已过期的行数。
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
         AND ${visibleSql('t.publish_date')}
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
 *
 * 21 天时效闸门（retention.ts）也在这条 SQL 里：过期标讯不再推给用户。
 * 注意它挡掉的行**不会**落状态位 —— 这是故意的，把闸门放宽回 30 天后
 * 它们会自动补推。代价是：入库时就已经超过 21 天的标讯永远不会进这张表
 * （比如首次接入一个新平台、抓了三个月的历史公告），这符合「过期的不要推」的本意。
 * 想补历史请调 TENDER_VISIBLE_DAYS，不要在这里绕过闸门。
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
       WHERE s.tender_id IS NULL${platformFilter} AND ${visibleSql('t.publish_date')}
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

  // 新增信息源后老用户的表里没有对应的「平台」选项，不补齐会整批写入失败。
  // 只有这张表有「平台」单选列，所以只在这条路径上补。
  await ensurePlatformOptions(
    await getTenantToken(cfg.appId, cfg.appSecret, nowMs),
    cfg.appToken,
    pref!.bitable_all_table_id!
  );

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

// ==================== 清空重灌 ====================

export interface RebuildResult {
  /** 推荐表：清掉多少行、写进多少行。 */
  recommend: { cleared: number; written: number };
  /** 全部标讯表。没建过这张表时是 undefined。 */
  all?: { cleared: number; written: number };
  /** 保住了多少条用户手填的「跟进状态」。 */
  followKept: number;
  /** 清空成功但灌入失败时的说明。有值意味着**表现在是空的**，必须报给用户。 */
  error?: string;
}

/**
 * 把两张表清空、按当前数据全量重灌。
 *
 * 为什么需要它：写入路径是 append-only（`appendRecords` 只 batch_create），
 * 一行写进去就再也不会变，而底层 `tenders` 还在变 —— AI 抽取事后补上的截止日期
 * 和预算、`status` 从 draft 变成 scored，全都进不了表。于是用户点开卡片按钮看到的是
 * 「处理状态：待处理」和空的截止日期，而这两列正是他最关心的。表还会随时间单调增长
 * （21 天闸门只挡「还没同步的」，管不了已经写进去的行）。
 *
 * 三条不能改的约定：
 *
 * 1. **先清空，成功了再灌**。反过来或者边清边灌 = 表里重复行，而回报是「✅ 已重建」。
 *    所以 clearTable 失败直接抛，不吞。
 * 2. **「跟进状态」列先读出来再写回去**。那一列我们只建不写，是用户在飞书里
 *    自己点的。不保的话每次重灌他的标记清零 —— 这是整条链路当初做成 append-only
 *    的唯一原因，改成重灌就必须自己接住它。
 * 3. **清空成功、灌入失败要显式报出来**（`error` 字段）。这时表是空的，
 *    只报一句「同步失败」的话用户点开卡片按钮看到空表，会以为数据丢了。
 *
 * 两个状态位（`bitable_synced_at` / `tender_bitable_sync`）在重灌成功后按重灌的内容
 * 重置：不重置的话下一次增量同步会把已经在表里的行再追加一遍（状态位是 NULL 的那些），
 * 或者反过来漏掉重灌时被 limit 截断的那些。
 */
export async function rebuildBitableTables(
  userId: string,
  nowMs: number
): Promise<RebuildResult & { skipped?: string }> {
  const db = getDatabase();
  const pref = loadBitablePref(userId);
  if (!bitableReady(pref)) {
    return { recommend: { cleared: 0, written: 0 }, followKept: 0, skipped: '未启用或配置不完整' };
  }

  const cfg: BitableConfig = {
    appId: pref!.feishu_app_id!,
    appSecret: pref!.feishu_app_secret!,
    appToken: pref!.bitable_app_token!,
    tableId: pref!.bitable_table_id!,
  };
  const token = await getTenantToken(cfg.appId, cfg.appSecret, nowMs);
  const minScore = pref!.feishu_min_score ?? 55;
  const platforms = parsePlatforms(pref!.platforms);

  // 1. 先把表读一遍（在清空之前，否则手填的列就读不到了）。
  const recSnap = await snapshotTable(token, cfg.appToken, cfg.tableId, '跟进状态');
  const follow = recSnap.kept;
  const allSnap = pref!.bitable_all_table_id
    ? await snapshotTable(token, cfg.appToken, pref!.bitable_all_table_id)
    : { recordIds: [], kept: new Map<string, string>() };

  // 2. 取数用 candidates.ts —— 和手动推送的预览数/卡片内容同一条 SQL。
  const recItems: BitableRecordItem[] = loadRecommendCandidates(userId, minScore).map((c) => ({
    tenderId: c.tenderId,
    title: c.title,
    purchaserName: c.purchaserName,
    totalScore: c.totalScore,
    tier: c.tier,
    budgetAmount: c.budgetAmount,
    budgetText: c.budgetText,
    regionName: c.regionName,
    url: c.url,
    publishDate: c.publishDate,
  }));
  const allItems = pref!.bitable_all_table_id ? loadAllTenderCandidates(platforms) : [];

  // 3. 清空。任何一张失败就整体中止（deleteRecords 抛）—— 只清了一张就灌两张，
  //    表之间会对不上，而回报是「已重建」。
  await deleteRecords(token, cfg.appToken, cfg.tableId, recSnap.recordIds);
  const recCleared = recSnap.recordIds.length;
  let allCleared = 0;
  if (pref!.bitable_all_table_id) {
    await deleteRecords(token, cfg.appToken, pref!.bitable_all_table_id, allSnap.recordIds);
    allCleared = allSnap.recordIds.length;
  }

  // 4. 灌入。到这里表已经空了，所以失败必须带着 cleared 数一起报出来。
  let recWritten = 0;
  let allWritten = 0;
  try {
    recWritten = await batchCreate(
      cfg,
      cfg.tableId,
      recItems.map((it) => ({ ...toFields(it, nowMs), ...(follow.has(it.tenderId) ? { 跟进状态: follow.get(it.tenderId) } : {}) })),
      nowMs
    );

    if (pref!.bitable_all_table_id) {
      await ensurePlatformOptions(token, cfg.appToken, pref!.bitable_all_table_id);
      allWritten = await batchCreate(cfg, pref!.bitable_all_table_id, allItems.map(toAllFields), nowMs);
    }
  } catch (e: any) {
    return {
      recommend: { cleared: recCleared, written: recWritten },
      all: pref!.bitable_all_table_id ? { cleared: allCleared, written: allWritten } : undefined,
      followKept: 0,
      error: `表已清空，但写入中断（${e.message}）—— 表格现在是不完整的，请再点一次重建。`,
    };
  }

  // 5. 状态位对齐重灌后的内容。见函数注释第三段。
  const stamp = new Date(nowMs).toISOString();
  const resetRec = db.transaction(() => {
    db.prepare('UPDATE tender_recommendations SET bitable_synced_at = NULL WHERE user_id = ?').run(userId);
    const mark = db.prepare(
      `UPDATE tender_recommendations SET bitable_synced_at = ? WHERE user_id = ? AND tender_id = ?`
    );
    for (const it of recItems) mark.run(stamp, userId, it.tenderId);
  });
  resetRec();

  if (pref!.bitable_all_table_id) {
    const resetAll = db.transaction(() => {
      db.prepare('DELETE FROM tender_bitable_sync WHERE user_id = ?').run(userId);
      const mark = db.prepare(
        'INSERT OR IGNORE INTO tender_bitable_sync (user_id, tender_id, synced_at) VALUES (?, ?, ?)'
      );
      for (const it of allItems) mark.run(userId, it.tenderId, stamp);
    });
    resetAll();
  }

  return {
    recommend: { cleared: recCleared, written: recWritten },
    all: pref!.bitable_all_table_id ? { cleared: allCleared, written: allWritten } : undefined,
    // 只算真的写回去了的那些：读到 5 条但只有 3 条还在达标名单里，报 5 会让用户
    // 以为标记都在，而另 2 条已经随着 21 天闸门/阈值变化从表里消失了。
    followKept: recItems.filter((it) => follow.has(it.tenderId)).length,
  };
}
