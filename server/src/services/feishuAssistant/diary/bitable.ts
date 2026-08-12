import type { Client } from '@larksuiteoapi/node-sdk';
import { assertOk, describeFeishuError } from '../feishuError.js';
import * as store from './store.js';
import type { DiaryProjectRow, DiaryRecordRow, DiarySummaryRow } from './store.js';

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
 * 1 文本 / 2 数字 / 5 日期 / 11 人员 / 15 超链接 / 23 群
 *
 * 第一个字段是**索引字段**，只能是 1/2/5/13/15/20/22 —— 人员和群都不行。
 * 所以「记录」表第一列是文本（记录正文），项目总表第一列是文本（项目名称）。
 */
const F_TEXT = 1;
const F_NUMBER = 2;
const F_DATE = 5;
const F_USER = 11;
const F_URL = 15;
const F_CHAT = 23;

/** 单次 batch_create 上限 1000，留余量。 */
const BATCH_SIZE = 500;

/** 项目总表的名字。用户会在飞书里看到它，所以用中文。 */
const INDEX_BASE_NAME = '项目总表';
const INDEX_TABLE_NAME = '项目列表';

/** 每个项目自己的两张表。任务在独立的任务 base 里（070）。 */
const RECORD_TABLE_NAME = '记录';
const REVIEW_TABLE_NAME = '复盘';

// 表结构故意和 xzy-diary-skills 那版**不完全一致**：
// 那版有「类型/负责人/部门成员/项目状态/总结文档链接」等列，但它们全靠
// 智能体手填、没有任何代码在维护，实际用起来大半是空的。这里只建
// 「代码会写、或用户明确会用来筛」的列 —— 空列比没有列更误导人。
/** 总表里那一列的名字。老总表是第一次建项目/派活时补这一列的（074）。 */
const INDEX_TASK_FIELD = '任务表';

const INDEX_FIELDS = [
  { field_name: '项目名称', type: F_TEXT },
  { field_name: '日志表', type: F_URL },
  // 任务表的入口（074）。这两张表在**两个不同的 base** 里（070：权限粒度是 base，
  // 日志只读、任务可编辑），而它们都不在任何人的云文档空间里 ——
  // 群消息一被刷走，总表就是唯一还能找到任务表的地方。
  { field_name: INDEX_TASK_FIELD, type: F_URL },
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

/**
 * 任务表的可点链接，尽量落在进度看板上。
 *
 * 定义在这里而不是 taskBase.ts（那才是任务表的主人）：项目总表要把这个链接写进
 * 「任务表」那一列，而 taskBase 已经 import 了本模块 —— 反向再 import 就成环了。
 * 这个函数只读项目行上的两列，不碰任务表的任何逻辑，所以放这边没有代价。
 * taskBase 那边 re-export 了它，调用方照旧从那儿拿。
 */
export function taskBaseUrl(project: DiaryProjectRow): string {
  if (!project.task_base_url) return '';
  if (!project.task_board_view_id) return project.task_base_url;
  const sep = project.task_base_url.includes('?') ? '&' : '?';
  return `${project.task_base_url}${sep}view=${project.task_board_view_id}`;
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
            // 任务表在另一个 base 里（070），链接是这一行唯一的入口。
            // 任务 base 建失败的项目这一格留空 —— 写一个空链接会点出「无权限」。
            ...(taskBaseUrl(project)
              ? { [INDEX_TASK_FIELD]: { text: '任务表', link: taskBaseUrl(project) } }
              : {}),
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
 * 给老的项目总表补上「任务表」那一列（074）。
 *
 * 为什么不在迁移里做：要调飞书接口，而迁移跑在启动路径上（一次网络抖动 = 服务起不来）。
 * 所以和 072/073 一样挂在下一次建项目/派活上，会被反复执行。
 *
 * 幂等靠 `task_col_added`，而**置位前先 list 一次**看列是不是已经在了：
 * 飞书对重名列是直接拒的，只凭那一位的话，一个已经有这列的老总表会在每次建项目时
 * 挂一句永远不会好的 warning。列真的不在才 create。
 *
 * 用户手动删掉这一列之后我们不再重建（那一位已经置了）—— 他删一次我们加一次
 * 才是更糟的那种：每次都成功，而他每次都得再删。
 */
export async function ensureIndexTaskColumn(client: Client, appId: string): Promise<Warning> {
  const index = store.getIndex(appId);
  if (!index || index.task_col_added) return null;
  try {
    const listed = assertOk(
      await client.bitable.appTableField.list({
        path: { app_token: index.base_app_token, table_id: index.table_id },
        params: { page_size: 100 },
      }),
      '读总表的列',
    );
    const has = (listed.data?.items ?? []).some((f) => f.field_name === INDEX_TASK_FIELD);
    if (!has) {
      assertOk(
        await client.bitable.appTableField.create({
          path: { app_token: index.base_app_token, table_id: index.table_id },
          data: { field_name: INDEX_TASK_FIELD, type: F_URL },
        }),
        `给总表补上「${INDEX_TASK_FIELD}」列`,
      );
    }
  } catch (e) {
    return `项目总表里还少一列「${INDEX_TASK_FIELD}」（${describeFeishuError(e)}），下次建项目/派活时会再试。`;
  }
  store.markIndexTaskCol(appId, 'added');
  return null;
}

/**
 * 把已有项目的任务表链接补进总表那一列（074）。
 *
 * 补出来的列对**已经在表里的行**是空的，而这一列是那些项目唯一还能找到任务表的
 * 地方（两个 base 都不在任何人的云文档空间里，链接分享也关着）。不补的话总表里
 * 那一列看着只是「没填」，谁都不会想到是漏了一批。
 *
 * 逐行 update 而不是 batchUpdate：某一行的 record_id 可能已经失效（用户在总表里
 * 手动删过行），而 batchUpdate 对一个坏 id 是**整批拒掉** —— 于是所有项目都补不上。
 *
 * 补完**无论成败都置位**，失败的那几个在 warning 里点名。这是有意的：一个永久失效的
 * record_id 会让这段代码每次派活都重跑一遍并每次都挂同一句 warning，而用户按提示
 * 手填一次就解决了。
 */
export async function backfillIndexTaskLinks(
  client: Client,
  appId: string,
  links: Array<{ recordId: string; name: string; url: string }>,
): Promise<Warning> {
  const index = store.getIndex(appId);
  if (!index || !index.task_col_added || index.task_col_backfilled) return null;

  const failed: string[] = [];
  for (const l of links) {
    try {
      assertOk(
        await client.bitable.appTableRecord.update({
          path: {
            app_token: index.base_app_token,
            table_id: index.table_id,
            record_id: l.recordId,
          },
          data: { fields: { [INDEX_TASK_FIELD]: { text: '任务表', link: l.url } } },
        }),
        '补总表里的任务表链接',
      );
    } catch (e) {
      console.error(`[diary] 补总表任务表链接失败（${l.name}）:`, (e as Error).message);
      failed.push(l.name);
    }
  }
  store.markIndexTaskCol(appId, 'backfilled');
  if (!failed.length) return null;
  return (
    `项目总表里这几个项目的「${INDEX_TASK_FIELD}」链接没补上：${failed.join('、')}。\n` +
    `在群里 @ 我说「有哪些项目」能拿到它们的链接，手动贴进那一列即可（我不会再自动补了）。`
  );
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

// ==================== 老「任务」表（068）的收尾 ====================

/**
 * 把日记 base 里那张老「任务」表从飞书那侧删掉。
 *
 * 为什么要删而不是留着看历史：两张表的内容**不同步**，而它们长得一样。老表是
 * 库里那份任务的投影（只追加/更新，不回读），任务管理表（070）才是数据源 ——
 * 群里的人在任务管理表里改了进展，老表那一格还是派活当天的样子。留着的净结果是
 * 同一个项目里两个互相矛盾的任务清单，而两个都不报错。用户已经拍板直接删。
 *
 * 删之前**必须先把老表里的任务补进任务管理表**（taskBase.importLegacyTasks）——
 * 070 之前派的活只在老表和库里，删完就只剩库里那份，而 `list_tasks` 只读新表：
 * 「还有什么没做完」从此漏掉它们，一句错都不报。
 *
 * 删成之后清空 `task_table_id`/`task_view_id`（那两列就是「飞书那边还有这张表」
 * 的凭据）。**顺序不能反**：先清库再删表的话，删失败之后我们再也不会回来，
 * 那张僵尸 tab 就永远留在用户的文档里。
 *
 * 失败只返回 warning：任务已经派出去了，而下次派活会再试一次。
 */
export async function dropTaskTable(client: Client, project: DiaryProjectRow): Promise<Warning> {
  if (!project.base_app_token || !project.task_table_id) return null;
  try {
    assertOk(
      await client.bitable.appTable.delete({
        path: { app_token: project.base_app_token, table_id: project.task_table_id },
      }),
      '删掉老「任务」表',
    );
  } catch (e) {
    return (
      `项目日志表里那张老「任务」表没能删掉（${describeFeishuError(e)}）。` +
      `它的内容已经搬进任务管理表了，**别再看它** —— 里面是派活当天的旧值。` +
      `下次派活时我会再试一次删。`
    );
  }
  store.clearProjectTaskTable(project.id);
  return null;
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
