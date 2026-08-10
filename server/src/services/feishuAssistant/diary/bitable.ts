import type { Client } from '@larksuiteoapi/node-sdk';
import { assertOk, describeFeishuError } from '../feishuError.js';
import * as store from './store.js';
import type {
  DiaryProjectRow,
  DiaryRecordRow,
  DiarySummaryRow,
  FeishuProjectTaskRow,
} from './store.js';
import { TASK_STATUS_OPTIONS, statusLabel } from './taskStatus.js';

// 项目日记的飞书侧：建多维表格、收权限、追加记录。
//
// **刻意不 import services/tender/feishuBitable.ts。** 那个模块自己管
// tenant_access_token 和裸 HTTP 调用，而且按迁移 061 的说法「每个子项目数据独立，
// 后期可能整个拆出去单独部署」。这里全部走 `ctx.client`（长连接那份 SDK 实例），
// 换来的是零 token 管理、零 HTTP 层。字段类型编号和「先关链接分享再授权」这些
// **规则**是从那边学来的，代码不共用。
//
// 失败处理的统一原则：**表格是镜像，库是数据源**。所以除了「建 base」本身，
// 其余每一步失败都不抛，而是返回一个能说给用户听的 warning ——
// 记录已经在库里了，下次操作会自动补推；抛出去只会让用户以为记录没记上，
// 于是他再说一遍，最后表里两条。

/**
 * 字段类型编号（飞书字段编辑指南）：
 * 1 文本 / 2 数字 / 3 单选 / 5 日期 / 11 人员 / 15 超链接 / 23 群
 *
 * 第一个字段是**索引字段**，只能是 1/2/5/13/15/20/22 —— 人员和群都不行。
 * 所以「记录」表第一列是文本（记录正文），项目总表第一列是文本（项目名称），
 * 「任务」表第一列是文本（任务名称）。
 */
const F_TEXT = 1;
const F_NUMBER = 2;
const F_SELECT = 3;
const F_DATE = 5;
const F_USER = 11;
const F_URL = 15;
const F_CHAT = 23;

/** 单次 batch_create 上限 1000，留余量。 */
const BATCH_SIZE = 500;

/** 项目总表的名字。用户会在飞书里看到它，所以用中文。 */
const INDEX_BASE_NAME = '项目总表';
const INDEX_TABLE_NAME = '项目列表';

/** 每个项目自己的三张表。 */
const RECORD_TABLE_NAME = '记录';
const REVIEW_TABLE_NAME = '复盘';
const TASK_TABLE_NAME = '任务';

/** 「任务」表上那个甘特视图的名字。用户在飞书里会看到这几个字。 */
const TASK_GANTT_VIEW_NAME = '甘特图';

// 表结构故意和 xzy-diary-skills 那版**不完全一致**：
// 那版有「类型/负责人/部门成员/项目状态/总结文档链接」等列，但它们全靠
// 智能体手填、没有任何代码在维护，实际用起来大半是空的。这里只建
// 「代码会写、或用户明确会用来筛」的列 —— 空列比没有列更误导人。
const INDEX_FIELDS = [
  { field_name: '项目名称', type: F_TEXT },
  { field_name: '日志表', type: F_URL },
  // 群用 type 23（群）而不是文本：这一列点开就能跳进那个群，
  // 而 oc_xxx 存成文本对人完全没有意义（客户端里看不到这串 id）。
  { field_name: '关联群聊', type: F_CHAT },
  { field_name: '记录数', type: F_NUMBER },
  { field_name: '创建人', type: F_USER },
  { field_name: '创建时间', type: F_DATE },
];

const RECORD_FIELDS = [
  // 正文是索引列：飞书列表视图第一列就是它，扫一眼就是「都记了什么」。
  { field_name: '记录', type: F_TEXT },
  { field_name: '时间', type: F_DATE },
  { field_name: '记录人', type: F_USER },
];

const REVIEW_FIELDS = [
  { field_name: '时间范围', type: F_TEXT },
  { field_name: '生成时间', type: F_DATE },
  { field_name: '记录数', type: F_NUMBER },
  { field_name: '发起人', type: F_USER },
  { field_name: '总结', type: F_TEXT },
];

/**
 * 「任务」表（068）。列的顺序和取舍就是**甘特图能不能用**：
 * 甘特视图要的是「一个标题 + 开始 + 结束」，缺开始时间的行在图上只是个点。
 *
 * 状态用单选（type 3）而不是文本，而且**选项在建表时就写死**：
 * 单选字段的选项在写入未知值时会自动新建，而 LLM 对同一个意思有四五种写法
 * （「进行中」「进行中的」「in progress」「已完成✅」），于是那一列很快就有一堆
 * 看起来一样的选项 —— 甘特图按状态上色因此失效，按状态筛也只筛到一部分，
 * 而每一行看上去都是对的。取值收敛在 diary/taskStatus.ts。
 */
const TASK_FIELDS = [
  // 索引列（第一列）只能是 1/2/5/13/15/20/22，所以任务名称用文本。
  { field_name: '任务名称', type: F_TEXT },
  { field_name: '负责人', type: F_USER },
  { field_name: '开始时间', type: F_DATE },
  { field_name: '结束时间', type: F_DATE },
  {
    field_name: '状态',
    type: F_SELECT,
    property: { options: TASK_STATUS_OPTIONS.map((name) => ({ name })) },
  },
  { field_name: '内容', type: F_TEXT },
  { field_name: '派活人', type: F_USER },
  { field_name: '飞书任务', type: F_URL },
];

/** 一步失败但不致命时的说明。调用方必须把它拼进回帖 —— 静默降级读起来就是成功。 */
export type Warning = string | null;

// ==================== 建表 ====================

interface CreatedBase {
  appToken: string;
  url: string;
  /** false = 收紧链接分享失败，表处于租户默认可见范围（很可能「组织内可阅读」）。 */
  linkShareClosed: boolean;
}

/**
 * 建一个多维表格 base，并把飞书自带的空表删掉。
 *
 * `tables` 里每张表建完的 id 按顺序返回。**先建我们的表再删自带的** ——
 * 一个 base 至少要有一张表，顺序反了删不掉。
 * 自带表的 id 是「建我们的表之前列出来的那些」，不靠名字猜。
 */
/** 建表时的一列。`property` 只有单选那类字段需要（选项清单）。 */
interface FieldSpec {
  field_name: string;
  type: number;
  property?: Record<string, unknown>;
}

async function createBase(
  client: Client,
  name: string,
  tables: Array<{ name: string; fields: FieldSpec[] }>,
): Promise<CreatedBase & { tableIds: string[] }> {
  const created = assertOk(
    await client.bitable.app.create({
      data: { name, time_zone: 'Asia/Shanghai' },
    }),
    '创建多维表格',
  );
  const appToken = created.data?.app?.app_token;
  if (!appToken) throw new Error('创建多维表格成功但未返回 app_token');
  const baseUrl = created.data?.app?.url || `https://feishu.cn/base/${appToken}`;

  // 建之前先记下自带的表。列不出来就跳过清理（残留一张空表是观感问题，
  // 而这一步失败不该让整个建项目失败）。
  let preexisting: string[] = [];
  try {
    const listed = assertOk(
      await client.bitable.appTable.list({
        path: { app_token: appToken },
        params: { page_size: 50 },
      }),
      '列出数据表',
    );
    preexisting = (listed.data?.items ?? []).map((t) => t.table_id).filter(Boolean) as string[];
  } catch (e) {
    console.error('[diary] 列出自带表失败，跳过清理:', (e as Error).message);
  }

  const tableIds: string[] = [];
  for (const t of tables) {
    const res = assertOk(
      await client.bitable.appTable.create({
        path: { app_token: appToken },
        data: {
          table: { name: t.name, default_view_name: '全部', fields: t.fields },
        },
      }),
      '创建数据表',
    );
    const id = res.data?.table_id;
    if (!id) throw new Error(`创建数据表「${t.name}」成功但未返回 table_id`);
    tableIds.push(id);
  }

  for (const id of preexisting) {
    try {
      assertOk(
        await client.bitable.appTable.delete({
          path: { app_token: appToken, table_id: id },
        }),
        '删除自带空表',
      );
    } catch (e) {
      console.error(`[diary] 删除自带空表 ${id} 失败:`, (e as Error).message);
    }
  }

  const linkShareClosed = await closeLinkShare(client, appToken);
  return { appToken, url: baseUrl, linkShareClosed, tableIds };
}

/**
 * 关掉链接分享。
 *
 * 必须显式设置：不设就跟随租户默认值，而实测默认是「组织内获得链接的人可阅读」
 * 且「可转发到组织外」。日志表链接是**发在群里**的，于是全公司任何拿到链接的人
 * 都能看这个项目的全部日志。这跟「授权给谁、只读还是可编辑」是两件事 ——
 * grantView 管的是「能不能改」，这一项管的是「能不能看到」。
 *
 * 代价要说出来：关掉之后，没被授权的人打开链接是「无权限访问」。所以
 * 「授权给群」不是可选步骤 —— 不授权谁都打不开，包括建项目的人自己。
 *
 * 失败返回 false 不抛：这一步失败时表已经建好了，抛出去只留下一张孤儿表格。
 */
async function closeLinkShare(client: Client, appToken: string): Promise<boolean> {
  try {
    assertOk(
      await client.drive.permissionPublic.patch({
        path: { token: appToken },
        params: { type: 'bitable' },
        // SDK v1 这里的字段是 external_access（布尔），不是 v2 的
        // external_access_entity（枚举）—— 传错的那个会被忽略，
        // 于是「可转发到组织外」悄悄留着。
        data: { link_share_entity: 'closed', external_access: false },
      }),
      '关闭链接分享',
    );
    return true;
  } catch (e) {
    console.error('[diary] 关闭链接分享失败:', (e as Error).message);
    return false;
  }
}

/**
 * 把表授权给一个群，**只给 view**。
 *
 * 这是用户拍的板，理由值得写下来：同步是**只追加**的 ——
 * 库里的记录推上去之后状态位就置了，永远不会再推第二遍。所以群里任何人
 * 删掉一行，那行就再也不会回来（库里还有，但表和库从此不一致，而人看的是表）。
 * 给整群 edit 等于让任何成员都能不可逆地删掉项目日志。
 * 要改内容就在群里 @ 助理，那条路径有日志、有作者、可追溯。
 *
 * 授权给群要求应用已经在这个群里 —— 建项目的指令本来就来自群内，所以成立。
 *
 * 失败返回 warning 不抛：表建好了，链接也存了，只是别人打不开。
 * 抛出去会走到回滚分支，把一张已经建好的表变成孤儿。
 */
async function grantView(client: Client, appToken: string, chatId: string): Promise<Warning> {
  try {
    assertOk(
      await client.drive.permissionMember.create({
        path: { token: appToken },
        params: { type: 'bitable', need_notification: false },
        data: {
          member_type: 'openchat',
          member_id: chatId,
          perm: 'view',
          type: 'chat',
        },
      }),
      '把表开放给群',
    );
    return null;
  } catch (e) {
    return `表已建好，但把它开放给本群失败了（${describeFeishuError(e)}）。群里点链接会显示无权限，请在飞书里手动把这张表分享给本群。`;
  }
}

/** 给多维表格地址补 `?table=`，让链接落在指定那张表上，否则打开的是 base 第一张表。 */
export function withTableParam(url: string, tableId: string): string {
  if (!url || !tableId) return url;
  if (/[?&]table=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}table=${tableId}`;
}

// ==================== 项目总表 ====================

/**
 * 拿到（必要时创建）这家公司的项目总表。
 *
 * 自动建、不需要「初始化」步骤：原版 skill 有个显式的初始化命令，没跑过就
 * 什么都不能干（而且 config.json 一丢就退回未初始化）。这里第一次新建项目时
 * 顺手把总表建出来，用户永远不会看到「请先初始化」。
 *
 * **总表不授权给任何群**：它是全公司所有项目的清单，而项目群只该看到自己那个
 * 项目。总表的链接给的是建项目的人（`grantUser`）。
 */
export async function ensureIndex(
  client: Client,
  appId: string,
  ownerOpenId: string,
): Promise<{ index: store.DiaryIndexRow; warning: Warning }> {
  const existing = store.getIndex(appId);
  if (existing) return { index: existing, warning: null };

  const base = await createBase(client, INDEX_BASE_NAME, [
    { name: INDEX_TABLE_NAME, fields: INDEX_FIELDS },
  ]);
  const tableId = base.tableIds[0];
  store.saveIndex({
    appId,
    baseAppToken: base.appToken,
    tableId,
    url: withTableParam(base.url, tableId),
    linkShareClosed: base.linkShareClosed,
  });

  // 建总表的人要能打开它，否则关掉链接分享之后连他自己都进不去。
  let warning: Warning = null;
  if (ownerOpenId) {
    try {
      assertOk(
        await client.drive.permissionMember.create({
          path: { token: base.appToken },
          params: { type: 'bitable', need_notification: false },
          // 总表给 edit：项目列表是给管理者维护的（补备注、调顺序），
          // 而这里只授权给**建项目的那个人**，不是整群。风险面完全不同。
          data: {
            member_type: 'openid',
            member_id: ownerOpenId,
            perm: 'edit',
            type: 'user',
          },
        }),
        '把总表授权给你',
      );
    } catch (e) {
      warning = `项目总表已建好，但授权给你失败了（${describeFeishuError(e)}），你可能打不开它。`;
    }
  }
  if (!base.linkShareClosed) {
    warning = [
      warning,
      '⚠️ 项目总表的链接分享没关成功，组织内拿到链接的人都能看，请在飞书里手动收紧。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const saved = store.getIndex(appId)!;
  return { index: saved, warning };
}

/**
 * 在项目总表里登记一个项目。
 *
 * 失败只返回 warning：项目本身（库 + 日志表）已经成立了，总表只是索引。
 * 下次在这个群里记录时会自动补登记（见 backfillIndexRecord）。
 */
export async function addToIndex(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ recordId: string | null; warning: Warning }> {
  const index = store.getIndex(project.app_id);
  if (!index) return { recordId: null, warning: null };
  try {
    const res = assertOk(
      await client.bitable.appTableRecord.create({
        path: { app_token: index.base_app_token, table_id: index.table_id },
        params: { user_id_type: 'open_id' },
        data: {
          fields: {
            项目名称: project.name,
            ...(project.url ? { 日志表: { text: project.name, link: project.url } } : {}),
            // 群聊列（type 23）要的是 `[{id}]`，不是裸字符串数组。传错的后果不是
            // 这一列为空，而是**整条 record 被拒**（1254001 WrongRequestBody），
            // 而飞书是 HTTP 200 回的 —— 所以在加 assertOk 之前，这里的表现是
            // 「✅ 项目已建好」外加一个能点开的、空的总表。
            关联群聊: [{ id: project.chat_id }],
            记录数: 0,
            ...(project.created_by ? { 创建人: [{ id: project.created_by }] } : {}),
            创建时间: new Date(project.created_at).getTime(),
          },
        },
      }),
      '写进项目总表',
    );
    const recordId = res.data?.record?.record_id ?? null;
    if (recordId) store.setProjectIndexRecord(project.id, recordId);
    return { recordId, warning: null };
  } catch (e) {
    return {
      recordId: null,
      warning: `项目已建好，但写进项目总表失败了（${describeFeishuError(e)}），下次在本群记录时会自动补上。`,
    };
  }
}

/**
 * 改名之后把总表那一行的项目名刷一下。
 *
 * 失败只返回 warning：库里的名字才是数据源，总表是索引。抛出去会让「改名成功」
 * 变成失败，而用户重说一遍会撞上「已经有一个叫 XX 的项目了」——
 * 一个由我们自己造成的、看起来像用户操作错误的死结。
 *
 * 「日志表」那一列的显示文字也一起刷：它写的是项目名（链接不变），
 * 不刷的话总表里同一行的两列会写着两个不同的名字。
 * base 本身的标题（「旧名 - 项目日记」）不动 —— 改它要另一个权限域
 * （drive 的文件重命名），而多维表格里的表名对使用没有影响。
 */
export async function renameInIndex(client: Client, project: DiaryProjectRow): Promise<Warning> {
  const index = store.getIndex(project.app_id);
  if (!index || !project.index_record_id) return null;
  try {
    assertOk(
      await client.bitable.appTableRecord.update({
        path: {
          app_token: index.base_app_token,
          table_id: index.table_id,
          record_id: project.index_record_id,
        },
        data: {
          fields: {
            项目名称: project.name,
            ...(project.url ? { 日志表: { text: project.name, link: project.url } } : {}),
          },
        },
      }),
      '刷新总表里的项目名',
    );
    return null;
  } catch (e) {
    return `⚠️ 名字已改好，但项目总表里还是旧名字（${describeFeishuError(e)}）。`;
  }
}

/**
 * 补登记 + 刷新记录数。每次记录之后顺手做，失败一律忽略。
 *
 * 记录数是**总表里唯一会被更新的字段**（其余全是建项目时写死的），
 * 所以这里用 update 而不是 append —— 索引行是一行，不是流水。
 */
async function refreshIndexRow(client: Client, project: DiaryProjectRow): Promise<void> {
  const index = store.getIndex(project.app_id);
  if (!index) return;
  try {
    if (!project.index_record_id) {
      await addToIndex(client, project);
      return;
    }
    assertOk(
      await client.bitable.appTableRecord.update({
        path: {
          app_token: index.base_app_token,
          table_id: index.table_id,
          record_id: project.index_record_id,
        },
        data: { fields: { 记录数: store.countRecords(project.id) } },
      }),
      '刷新总表记录数',
    );
  } catch (e) {
    // 记录数不准是观感问题，不值得让「已记录」变成失败。
    console.error('[diary] 刷新项目总表记录数失败:', (e as Error).message);
  }
}

// ==================== 项目日志表 ====================

/**
 * 给一个已占位的项目建它自己的日志多维表格（「记录」+「复盘」两张表）。
 *
 * **任务表不在这个 base 里**（070）：文档权限的粒度是 base 而不是表，
 * 而任务表要开放给群成员编辑、这两张表必须只读（同步是只追加的，
 * 删掉一行就再也回不来）。任务 base 由 taskBase.createTaskBase 单独建。
 *
 * 只有这个函数会抛：base 都没建出来的话，项目等于不存在，调用方要
 * dropProject 把占位行删掉，否则这个群永远处于「已有项目但没有表」的死状态
 * （UNIQUE 挡着，重试也建不出来）。
 */
export async function createProjectBitable(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ url: string; warning: Warning }> {
  const base = await createBase(client, `${project.name} - 项目日记`, [
    { name: RECORD_TABLE_NAME, fields: RECORD_FIELDS },
    { name: REVIEW_TABLE_NAME, fields: REVIEW_FIELDS },
  ]);
  const [recordTableId, reviewTableId] = base.tableIds;
  const url = withTableParam(base.url, recordTableId);

  store.attachProjectBitable(project.id, {
    baseAppToken: base.appToken,
    recordTableId,
    reviewTableId,
    url,
    linkShareClosed: base.linkShareClosed,
  });

  const warnings = [
    await grantView(client, base.appToken, project.chat_id),
    base.linkShareClosed
      ? null
      : '⚠️ 这张表的链接分享没关成功，组织内拿到链接的人都能看，请在飞书里手动收紧。',
  ].filter(Boolean);

  return { url, warning: warnings.length ? warnings.join('\n') : null };
}

// ==================== 任务表 + 甘特图 ====================

/**
 * 在「任务」表上建一个甘特视图。
 *
 * 甘特图是这个功能被要求的形态，但它**只是一个视图** —— 同一张表的另一种画法。
 * 所以建不出来只降级成 warning：数据全在，用户看到的是表格而不是横条图。
 * 抛出去反而会把「任务已派」变成失败，而任务其实已经建好了。
 *
 * 视图上限 200 个/base（含个人视图），这里一个项目只建一个，撞不到。
 * 甘特图用哪两列做起止是飞书那侧按字段类型自己认的（表里只有「开始时间」
 * 「结束时间」两个日期列），API 不接受指定 —— 所以 TASK_FIELDS 里
 * 不要再加第三个日期列，否则它认哪一对就不好说了。
 */
async function createGanttView(
  client: Client,
  appToken: string,
  tableId: string,
): Promise<{ viewId: string; warning: Warning }> {
  if (!tableId) return { viewId: '', warning: null };
  try {
    const res = assertOk(
      await client.bitable.appTableView.create({
        path: { app_token: appToken, table_id: tableId },
        data: { view_name: TASK_GANTT_VIEW_NAME, view_type: 'gantt' },
      }),
      '创建视图',
    );
    return { viewId: res.data?.view?.view_id ?? '', warning: null };
  } catch (e) {
    return {
      viewId: '',
      warning: `「任务」表已建好，但甘特视图没建成（${describeFeishuError(e)}），任务仍然会记进表格里；想要甘特图可以在飞书里手动加一个视图。`,
    };
  }
}

/**
 * 拿到（必要时补建）这个项目的「任务」表。
 *
 * 存在的理由是 068 之前建的项目已经有 base 和前两张表了，而迁移里不能调飞书接口
 * （迁移失败会让整个服务起不来，而一次建表失败只该让那一条指令带个 warning）。
 * 所以老项目的「任务」表是第一次派活时补建的。
 *
 * 返回空 tableId = 补建失败或这个项目根本没有 base（建表那步当初失败过）。
 * 调用方据此跳过同步，任务仍然落库 —— 库是数据源，表格是镜像。
 */
export async function ensureTaskTable(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ tableId: string; warning: Warning }> {
  if (!project.base_app_token) return { tableId: '', warning: null };
  if (project.task_table_id) return { tableId: project.task_table_id, warning: null };

  let tableId = '';
  try {
    const res = assertOk(
      await client.bitable.appTable.create({
        path: { app_token: project.base_app_token },
        data: {
          table: {
            name: TASK_TABLE_NAME,
            default_view_name: '全部',
            fields: TASK_FIELDS,
          },
        },
      }),
      '创建数据表',
    );
    tableId = res.data?.table_id ?? '';
  } catch (e) {
    return {
      tableId: '',
      warning: `任务已记到系统里，但这个项目的「任务」表还没建出来（${describeFeishuError(e)}），下次派任务时会再试。`,
    };
  }
  if (!tableId) {
    return {
      tableId: '',
      warning: '任务已记到系统里，但建「任务」表没返回表 id，下次派任务时会再试。',
    };
  }

  const gantt = await createGanttView(client, project.base_app_token, tableId);
  // 先落库再管视图：视图建失败时表 id 也必须存下来，否则下次又建一张新的
  // 「任务」表，同一个 base 里两张同名表，而任务分散在两张里。
  store.setProjectTaskTable(project.id, tableId, gantt.viewId);
  return { tableId, warning: gantt.warning };
}

/**
 * 把未同步的任务写进「任务」表。
 *
 * 和 pushRecords 的关键区别：记录是**只追加**的，任务**会被改**（改期、改状态、
 * 换负责人）。所以这里按 `bitable_record_id` 分两路 —— 有行号的更新那一行，
 * 没有的追加一行并把行号存下来。少了这一步的后果是每次改任务都在表里多一条，
 * 甘特图上同一个任务好几条横条，各自的进度还不一样。
 *
 * 因此也不能用 batchCreate 一把梭：更新和追加混在一起，而追加必须逐条拿回
 * record_id。任务的量级是"一个项目几十条"，逐条调用是可以接受的。
 *
 * 失败只返回 warning：任务已经落库了（而且飞书任务也建了），状态位没置，
 * 下次派活或改任务时会连这次的一起补推。
 */
export async function pushTasks(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ pushed: number; warning: Warning }> {
  if (!project.base_app_token || !project.task_table_id) return { pushed: 0, warning: null };
  const pending = store.listUnsyncedTasks(project.id);
  if (!pending.length) return { pushed: 0, warning: null };

  let pushed = 0;
  try {
    for (const t of pending) {
      if (t.bitable_record_id) {
        assertOk(
          await client.bitable.appTableRecord.update({
            path: {
              app_token: project.base_app_token,
              table_id: project.task_table_id,
              record_id: t.bitable_record_id,
            },
            params: { user_id_type: 'open_id' },
            data: { fields: taskFields(t) },
          }),
          '更新任务行',
        );
        store.markTaskSynced(t.id, t.bitable_record_id);
      } else {
        const res = assertOk(
          await client.bitable.appTableRecord.create({
            path: {
              app_token: project.base_app_token,
              table_id: project.task_table_id,
            },
            params: { user_id_type: 'open_id' },
            data: { fields: taskFields(t) },
          }),
          '写入任务行',
        );
        const recordId = res.data?.record?.record_id ?? '';
        // 拿不到 record_id 也要置位，但**行号留空**：不置位的话下一次同步会
        // 再追加一行（表里两条）；而行号留空意味着以后改这条任务只能再追加，
        // 那是两害里轻的一个 —— 重复行看得见，静默不同步看不见。
        store.markTaskSynced(t.id, recordId);
      }
      pushed += 1;
    }
  } catch (e) {
    const left = pending.length - pushed;
    return {
      pushed,
      warning: `任务已记到系统里，但有 ${left} 条还没同步到项目表格（${describeFeishuError(e)}），下次派任务时会自动补推。`,
    };
  }
  return { pushed, warning: null };
}

/** 「任务」表（尽量落在甘特视图上）的可点链接。回帖里指过去用。 */
export function taskTableUrl(project: DiaryProjectRow): string {
  if (!project.url || !project.task_table_id) return project.url;
  const base = project.url.replace(/[?&]table=[^&]*/, '').replace(/[?&]view=[^&]*/, '');
  const withTable = withTableParam(base, project.task_table_id);
  // 不带 view 的话点进去是默认的表格视图，用户看不到甘特图 ——
  // 而甘特图正是这个功能被要求的形态。
  if (!project.task_view_id) return withTable;
  return `${withTable}${withTable.includes('?') ? '&' : '?'}view=${project.task_view_id}`;
}

/**
 * 把还没同步的记录追加进「记录」表。
 *
 * 只追加、不更新、不回读：用户自己在表里加的列（比如「跟进」）永远不会被冲掉。
 *
 * 返回写进去多少条。失败返回 warning 而不抛 —— 记录已经落库了，
 * 状态位没置，下一条记录进来时会连着这次的一起补推。
 */
export async function pushRecords(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ pushed: number; warning: Warning }> {
  if (!project.base_app_token || !project.record_table_id) {
    return { pushed: 0, warning: null };
  }
  const pending = store.listUnsyncedRecords(project.id);
  if (!pending.length) {
    await refreshIndexRow(client, project);
    return { pushed: 0, warning: null };
  }

  let pushed = 0;
  try {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      assertOk(
        await client.bitable.appTableRecord.batchCreate({
          path: {
            app_token: project.base_app_token,
            table_id: project.record_table_id,
          },
          params: { user_id_type: 'open_id' },
          data: { records: chunk.map((r) => ({ fields: recordFields(r) })) },
        }),
        '批量写入记录',
      );
      // 一批成功就立刻置位（在一个事务里）。整批跑完再统一置位的话，
      // 中途失败会让已经写进表的那批下次重复写入。
      store.markRecordsSynced(chunk.map((r) => r.id));
      pushed += chunk.length;
    }
  } catch (e) {
    const left = pending.length - pushed;
    await refreshIndexRow(client, project);
    return {
      pushed,
      warning: `已记到系统里，但有 ${left} 条还没同步到多维表格（${describeFeishuError(e)}），下次记录时会自动补推。`,
    };
  }

  await refreshIndexRow(client, project);
  return { pushed, warning: null };
}

/**
 * 一列的值。只列出本模块真正会写的几种形态（文本 / 数字 / 日期毫秒 /
 * 超链接 / 群 id 数组 / 人员数组），不是飞书那个完整的大联合类型 ——
 * 写全了反而看不出这几张表实际用了什么。
 */
type FieldValue =
  string | number | { text?: string; link?: string } | string[] | Array<{ id?: string }>;

function recordFields(r: DiaryRecordRow): Record<string, FieldValue> {
  return {
    记录: r.content,
    时间: r.created_ms,
    // 人员字段要 open_id 数组。没有作者 id 时整个字段省掉 ——
    // 传空数组会被飞书拒掉，那样整批都写不进去。
    ...(r.author_open_id ? { 记录人: [{ id: r.author_open_id }] } : {}),
  };
}

/**
 * 一条任务 → 「任务」表的一行。
 *
 * 空值一律**省掉字段**而不是写空串/空数组：这条是更新路径上的硬要求 ——
 * 更新是整字段覆盖，所以「这次没提到负责人」写成空数组会把原来的负责人清掉
 * （和飞书任务 `update_fields` 那个坑同一个形状）。省掉字段则保留原值。
 * 缺开始/结束时间的行在甘特图上只是个点，这是可接受的降级：
 * 用户说「派给张三设计 logo」但没说时间，也该记下来。
 *
 * 状态**永远写**（`statusLabel` 有兜底值），因为它是甘特图上色和筛选的依据，
 * 空着那一行在图上就没有颜色。
 */
function taskFields(t: FeishuProjectTaskRow): Record<string, FieldValue> {
  return {
    任务名称: t.title,
    ...(t.owner_open_id ? { 负责人: [{ id: t.owner_open_id }] } : {}),
    ...(t.start_ms != null ? { 开始时间: t.start_ms } : {}),
    ...(t.end_ms != null ? { 结束时间: t.end_ms } : {}),
    状态: statusLabel(t.status),
    ...(t.content ? { 内容: t.content } : {}),
    ...(t.created_by ? { 派活人: [{ id: t.created_by }] } : {}),
    ...(t.url ? { 飞书任务: { text: '打开任务', link: t.url } } : {}),
  };
}

/**
 * 把一次复盘写进「复盘」表。
 *
 * 存在的理由是群消息会被刷走，而复盘是这个功能真正的产出。
 * 失败只返回 warning：总结已经发到群里了（而且已经落库），
 * 这一步只是给它一个不会被刷走的位置。
 */
export async function pushSummary(
  client: Client,
  project: DiaryProjectRow,
  summary: DiarySummaryRow,
): Promise<Warning> {
  if (!project.base_app_token || !project.review_table_id) return null;
  try {
    assertOk(
      await client.bitable.appTableRecord.create({
        path: {
          app_token: project.base_app_token,
          table_id: project.review_table_id,
        },
        params: { user_id_type: 'open_id' },
        data: {
          fields: {
            时间范围: summary.range_label,
            生成时间: new Date(summary.created_at).getTime(),
            记录数: summary.record_count,
            ...(summary.created_by ? { 发起人: [{ id: summary.created_by }] } : {}),
            总结: summary.summary,
          },
        },
      }),
      '写入复盘',
    );
    store.markSummarySynced(summary.id);
    return null;
  } catch (e) {
    return `复盘已生成，但存进「复盘」表失败了（${describeFeishuError(e)}）。`;
  }
}

/** 复盘表的可点链接。回帖里指过去用。 */
export function reviewTableUrl(project: DiaryProjectRow): string {
  if (!project.url || !project.review_table_id) return project.url;
  return withTableParam(project.url.replace(/[?&]table=[^&]*/, ''), project.review_table_id);
}
