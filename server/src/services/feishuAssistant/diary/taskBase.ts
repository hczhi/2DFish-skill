import type { Client } from '@larksuiteoapi/node-sdk';
import { assertOk, describeFeishuError } from '../feishuError.js';
import * as store from './store.js';
import type { DiaryProjectRow } from './store.js';
import {
  TASK_STATUS_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  statusLabel,
  priorityLabel,
  statusFromLabel,
  priorityFromLabel,
  normalizeStatus,
  type TaskStatus,
  type TaskPriority,
} from './taskStatus.js';
import { withTableParam, type Warning } from './bitable.js';

// 任务表的飞书侧：建一个**独立的** base、开放给群成员编辑、按 field_id 写入。
//
// ── 为什么独立一个 base（不在项目日记那个 base 里）──
// 见 migration 070 的文件头：文档权限的粒度是 base，不是表。任务表要可编辑、
// 日志表必须只读，同一个 base 里没法两者兼得。
//
// 唯一的例外是多维表格的**高级权限**（`bitable.app.update({is_advanced:true})`
// + `appRole.create` 的 per-table `table_roles`），它能做到「同 base 内 A 表只读、
// B 表可编辑」。**但这是付费能力**：实测（2026-08）本租户 `appRole.create` 返回
// `1254304 Only Available For Business and Enterprise Editions`。
// 所以「合并成一个文档、多一个 tab」的代价是整个文档一个权限级别 ——
// 日志表跟着变成可编辑，而同步是只追加的（表里被删掉的行不会重推），
// 于是网页上看到的和表里看到的会不一样，且没有任何提示。已按此拍板不合并。
//
// ── 这个模块和 bitable.ts 的分工 ──
// bitable.ts 管项目日记那侧（只追加、只读、库为数据源）。这里是反过来的：
// **表格就是数据源**，我们库里不存任务。于是失败处理的原则也反过来 ——
// bitable.ts 里每一步失败都降级成 warning（因为库里已经有了），
// 这里**写失败必须抛**：没有第二份数据，回一句「已创建」而表里没有那行，
// 就是最坏的那种失败。
//
// 建表/建视图/授权这些一次性动作仍然降级成 warning：那时候还没有任何任务数据，
// 而抛出去会让「新建项目」整条失败。

/** 任务 base 里那张表的名字。用户会在飞书里看到它。 */
const TASK_TABLE_NAME = '任务管理表';

/** 三个视图。名字是用户在飞书标签页上看到的那几个字。 */
const BOARD_VIEW_NAME = '进度看板';
const PERSON_VIEW_NAME = '人员任务分配看板';
/**
 * 甘特图。原来在项目日记 base 的那张老「任务」表上（068），这张表接管之后
 * 必须一起接过来 —— 否则合表的净结果是用户**丢了一个甘特图**。
 */
const GANTT_VIEW_NAME = '甘特图';

/**
 * 字段类型编号（同 bitable.ts）：1 文本 / 2 数字 / 3 单选 / 5 日期 / 11 人员 / 15 超链接 / 20 公式
 *
 * 第一个字段是**索引字段**，只能是 1/2/5/13/15/20/22 —— 人员和单选都不行，
 * 所以第一列是「任务描述」（文本）。
 */
const F_TEXT = 1;
const F_SELECT = 3;
const F_DATE = 5;
const F_USER = 11;
const F_URL = 15;
const F_FORMULA = 20;

/** 建表时的一列。`property` 只有单选/公式那类字段需要。 */
interface FieldSpec {
  field_name: string;
  type: number;
  property?: Record<string, unknown>;
}

/**
 * 列名常量。**代码里所有对列的引用都必须走这里**，不要在别处写中文字面量 ——
 * 写入路径是靠 field_id 反查当前列名的（见 resolveFieldNames），
 * 而反查的键就是这些常量。散落的字面量改不动，会在用户改列名后静默失配。
 */
export const COL = {
  title: '任务描述',
  digest: '任务情况总结',
  owner: '任务执行人',
  status: '进展',
  start: '开始日期',
  due: '预计完成日期',
  overdue: '是否延期',
  doneAt: '实际完成日期',
  latest: '最新进展记录',
  priority: '重要紧急程度',
  taskUrl: '飞书任务',
  idem: '助理标记',
} as const;

/**
 * 任务表的列。顺序就是用户在表里看到的顺序。
 *
 * 「是否延期」是**公式列**：延期不是一个可以手填的事实，它是
 * 「预计完成日期 < 今天 且 还没完成」的推论。手填的后果是它一天后就不准了，
 * 而看板上那个红色的「已延期」标签会一直挂着 —— 一个看起来在正常工作的错误提示。
 */
const TASK_FIELDS: FieldSpec[] = [
  { field_name: COL.title, type: F_TEXT },
  // 由助理写（不是飞书的 AI 字段 —— 那种字段 API 建不出来）。
  // 内容是这条任务的来龙去脉，派活时是原始要求，之后追加进展。
  { field_name: COL.digest, type: F_TEXT },
  { field_name: COL.owner, type: F_USER },
  {
    field_name: COL.status,
    type: F_SELECT,
    property: { options: TASK_STATUS_OPTIONS.map((name) => ({ name })) },
  },
  { field_name: COL.start, type: F_DATE },
  { field_name: COL.due, type: F_DATE },
  {
    field_name: COL.overdue,
    type: F_FORMULA,
    // 公式引用列名（不是 field_id）。用户改了列名飞书会自己跟着改公式里的引用，
    // 所以这里写中文常量是安全的 —— 和记录写入那条路不同。
    property: {
      formula_expression: `IF(AND(NOT(ISBLANK([${COL.due}])),[${COL.due}]<TODAY(),[${COL.status}]!="已完成"),"⚠️ 已延期","✅ 正常")`,
    },
  },
  { field_name: COL.doneAt, type: F_DATE },
  { field_name: COL.latest, type: F_TEXT },
  {
    field_name: COL.priority,
    type: F_SELECT,
    property: { options: TASK_PRIORITY_OPTIONS.map((name) => ({ name })) },
  },
  // 对应的飞书任务（applink）。
  //
  // **这一列是「库里那份将来要砍掉」的前提。** 现在「改哪一个任务」是拿
  // `feishu_project_tasks` 里的 guid 反查的；那份一删，guid 就只剩这一列里的
  // 链接了（applink 里带 guid）。没有它的话老任务在库删掉之后就永远改不动了，
  // 而表面上一切正常 —— 助理只会说「我只能改我自己帮你建的那些」。
  { field_name: COL.taskUrl, type: F_URL },
  // 幂等键：`<message_id>#<step_index>`。
  //
  // **这一列是纯 bitable 方案的重放防线。** 飞书事件是 at-least-once
  // （成功也会重投，最长 6 小时），而 claimEvent 的去重表在库里 —— 进程在
  // 「写完表格」和「落 claim」之间崩一次，重投就会再写一行。多维表格没有唯一
  // 约束、record create 也没有 client_token（飞书任务那侧有，表格侧没有），
  // 所以只能自己带一个键、写之前先 search 一次。
  //
  // 用户会看到这一列（API 建不出隐藏列，隐藏是视图属性，可以在两个看板视图里
  // 藏掉，但默认表格视图里还是在的）。所以名字取得像「助理内部用的东西」，
  // 而不是 `idempotency_key`。
  { field_name: COL.idem, type: F_TEXT },
];

/** 列名 → field_id 的映射，存进 `projects.task_field_map`。 */
type FieldMap = Record<string, string>;

/**
 * 建任务 base。**只有建 base 本身失败会抛** —— 没有 base 就没有任务表，
 * 调用方（建项目）据此决定要不要回滚。
 *
 * 返回的 warning 是「建好了但有一步没做全」：视图没建成、授权没成功、
 * 链接分享没关上。每一条都必须进回帖 —— 尤其是授权失败，那意味着群里
 * 谁都打不开这张表（链接分享是关掉的），而表面上项目建好了。
 */
export async function createTaskBase(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ url: string; warning: Warning }> {
  const created = assertOk(
    await client.bitable.app.create({
      data: { name: `${project.name} - 任务管理`, time_zone: 'Asia/Shanghai' },
    }),
    '创建任务多维表格',
  );
  const appToken = created.data?.app?.app_token;
  if (!appToken) throw new Error('创建任务多维表格成功但未返回 app_token');
  const baseUrl = created.data?.app?.url || `https://feishu.cn/base/${appToken}`;

  // 建之前先记下自带的空表，建完再删。顺序反了删不掉（一个 base 至少要有一张表）。
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
    console.error('[task] 列出自带表失败，跳过清理:', (e as Error).message);
  }

  const warnings: string[] = [];

  // ── 建表 ──
  // 公式列在建表时一起建。如果公式表达式不被接受，整张表就建不出来 ——
  // 那是最糟的形态（有 base 没表），所以失败时**去掉公式列重建一次**：
  // 少一列「是否延期」是可接受的降级，没有表不是。
  let tableId = '';
  let overdueDropped = false;
  try {
    tableId = await createTable(client, appToken, TASK_FIELDS);
  } catch (e) {
    console.error('[task] 建任务表失败，尝试去掉公式列重建:', (e as Error).message);
    tableId = await createTable(
      client,
      appToken,
      TASK_FIELDS.filter((f) => f.type !== F_FORMULA),
    );
    overdueDropped = true;
    warnings.push(
      `「${COL.overdue}」这一列没建成（${describeFeishuError(e)}），其余都正常。` +
        `想要它可以在飞书里手动加一个公式列。`,
    );
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
      console.error(`[task] 删除自带空表 ${id} 失败:`, (e as Error).message);
    }
  }

  // ── 列名 → field_id ──
  // 建表的响应里有 field_id_list，但**顺序不保证和我们传的一致**，而且不带名字。
  // 所以老老实实 list 一次拿「名字 + id」的对应关系。
  const { map, warning: mapWarning } = await loadFieldMap(client, appToken, tableId);
  if (mapWarning) warnings.push(mapWarning);

  const linkShareClosed = await closeLinkShare(client, appToken);

  // ── 两个看板视图 ──
  // 建不出来只是少两个视图，数据全在默认表格视图里，所以只降级成 warning。
  const board = await createKanbanView(client, appToken, tableId, BOARD_VIEW_NAME, map, [COL.idem]);
  const person = await createKanbanView(client, appToken, tableId, PERSON_VIEW_NAME, map, [
    COL.idem,
  ]);
  if (board.warning) warnings.push(board.warning);
  if (person.warning) warnings.push(person.warning);

  // ── 甘特视图 ──
  // 同样只降级成 warning：数据全在，少的是一种画法。
  const gantt = await createGanttView(client, appToken, tableId);
  if (gantt.warning) warnings.push(gantt.warning);

  const url = withTableParam(baseUrl, tableId);
  store.attachTaskBase(project.id, {
    appToken,
    tableId,
    url,
    fieldMap: map,
    boardViewId: board.viewId,
    personViewId: person.viewId,
    ganttViewId: gantt.viewId,
    linkShareClosed,
  });

  // ── 授权给群：edit ──
  // 这是这一整片改动的目的。**失败必须说出来** —— 链接分享是关掉的，
  // 授权没成功的话群里谁都打不开这张表，而「项目已建好」的回帖照常发出去。
  const granted = await grantEdit(client, appToken, project.chat_id);
  if (granted) warnings.push(granted);

  if (!linkShareClosed) {
    warnings.push('⚠️ 任务表的链接分享没关成功，组织内拿到链接的人都能看，请在飞书里手动收紧。');
  }

  // 「分组依据」API 设不了（appTableView.patch 的 property 里没有分组）。
  // 这一句是**必须**的：不说的话用户打开看板看到的是一堆没分列的卡片，
  // 而他会以为功能没做完 —— 实际是差他手点一下。
  if (board.viewId || person.viewId) {
    warnings.push(
      `📌 两个看板视图已建好，但**分组要你手点一次**（飞书的接口设不了分组）：\n` +
        `· 「${BOARD_VIEW_NAME}」→ 分组依据选「${COL.status}」\n` +
        `· 「${PERSON_VIEW_NAME}」→ 分组依据选「${COL.owner}」\n` +
        `设一次就一直生效。`,
    );
  }
  if (gantt.viewId) warnings.push(ganttHint());
  if (overdueDropped) {
    // 上面已经报过公式列没建成，这里不重复。
  }

  return { url, warning: warnings.length ? warnings.join('\n') : null };
}

async function createTable(client: Client, appToken: string, fields: FieldSpec[]): Promise<string> {
  const res = assertOk(
    await client.bitable.appTable.create({
      path: { app_token: appToken },
      data: {
        table: { name: TASK_TABLE_NAME, default_view_name: '全部任务', fields },
      },
    }),
    '创建数据表',
  );
  const id = res.data?.table_id;
  if (!id) throw new Error('创建任务数据表成功但未返回 table_id');
  return id;
}

/**
 * 拉一次字段清单，得到「当前列名 → field_id」。
 *
 * 拿不到时返回空映射 + warning，而不是抛：空映射意味着写入那侧只能用中文列名
 * 硬写（`fieldNames()` 的降级分支），那在用户还没改过列名时是完全正常工作的。
 * 抛出去反而会让刚建好的表变成孤儿。
 */
async function loadFieldMap(
  client: Client,
  appToken: string,
  tableId: string,
): Promise<{ map: FieldMap; warning: Warning }> {
  try {
    const res = assertOk(
      await client.bitable.appTableField.list({
        path: { app_token: appToken, table_id: tableId },
        params: { page_size: 100 },
      }),
      '读取表字段',
    );
    const map: FieldMap = {};
    for (const f of res.data?.items ?? []) {
      if (f.field_name && f.field_id) map[f.field_name] = f.field_id;
    }
    return { map, warning: null };
  } catch (e) {
    return {
      map: {},
      warning:
        `任务表已建好，但没能读到它的字段编号（${describeFeishuError(e)}）—— ` +
        `暂时按列名写入，如果有人改了列名派任务会失败（我会明确报出来）。`,
    };
  }
}

/**
 * 建一个看板视图，并把指定列藏掉。
 *
 * **分组设不了**（见 createTaskBase 末尾那句提示）。这里能做的只有两件：
 * 建出视图、把「助理标记」这种内部列藏起来。藏列是 patch 的 hidden_fields，
 * 要 field_id —— 拿不到映射时就不藏（多一列噪音，不影响用）。
 */
async function createKanbanView(
  client: Client,
  appToken: string,
  tableId: string,
  viewName: string,
  map: FieldMap,
  hide: string[],
): Promise<{ viewId: string; warning: Warning }> {
  if (!tableId) return { viewId: '', warning: null };
  let viewId = '';
  try {
    const res = assertOk(
      await client.bitable.appTableView.create({
        path: { app_token: appToken, table_id: tableId },
        data: { view_name: viewName, view_type: 'kanban' },
      }),
      '创建看板视图',
    );
    viewId = res.data?.view?.view_id ?? '';
  } catch (e) {
    return {
      viewId: '',
      warning: `看板视图「${viewName}」没建成（${describeFeishuError(e)}），任务照样记进表里；想要的话可以在飞书里手动加一个看板视图。`,
    };
  }

  const hidden = hide.map((n) => map[n]).filter(Boolean);
  if (viewId && hidden.length) {
    try {
      assertOk(
        await client.bitable.appTableView.patch({
          path: { app_token: appToken, table_id: tableId, view_id: viewId },
          data: { property: { hidden_fields: hidden } },
        }),
        '配置看板视图',
      );
    } catch (e) {
      // 藏不掉只是多一列内部标记露在外面，不值得报给用户。
      console.error(`[task] 隐藏「${viewName}」的内部列失败:`, (e as Error).message);
    }
  }
  return { viewId, warning: null };
}

/**
 * 建甘特视图。
 *
 * 用哪两列当起止是**飞书自己按字段类型认的**，接口不收这个参数
 * （`appTableView.create` 只有 view_name / view_type）。而这张表有**三个**日期列
 * （开始 / 预计完成 / 实际完成），所以它认哪一对说不准 —— 认错了不会报错，
 * 只是横条画在别的区间上，看起来完全像是正常工作的。所以建成之后必须提醒一句
 * （见 ganttHint），让用户扫一眼。
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
        data: { view_name: GANTT_VIEW_NAME, view_type: 'gantt' },
      }),
      '创建甘特视图',
    );
    return { viewId: res.data?.view?.view_id ?? '', warning: null };
  } catch (e) {
    return {
      viewId: '',
      warning:
        `「${GANTT_VIEW_NAME}」视图没建成（${describeFeishuError(e)}），任务照样记进表里；` +
        `想要的话可以在飞书里手动加一个甘特视图。`,
    };
  }
}

function ganttHint(): string {
  return (
    `📌 「${GANTT_VIEW_NAME}」视图已建好。表里有三个日期列，飞书会自己挑一对当横条的` +
    `起止 —— 扫一眼是不是「${COL.start}」到「${COL.due}」，不对的话在视图设置里改一下` +
    `（接口指定不了）。`
  );
}

/**
 * 关掉链接分享。理由和 bitable.ts:closeLinkShare 完全一样（默认是「组织内拿到
 * 链接的人可阅读」，而这个链接是发在群里的）。
 *
 * 代价同样要说出来：关掉之后没被授权的人打开链接是「无权限访问」，
 * 所以下面那步 grantEdit 不是可选的。
 */
async function closeLinkShare(client: Client, appToken: string): Promise<boolean> {
  try {
    assertOk(
      await client.drive.permissionPublic.patch({
        path: { token: appToken },
        params: { type: 'bitable' },
        // SDK v1 这里是 external_access（布尔），不是 v2 的 external_access_entity
        // （枚举）—— 传错那个会被忽略，于是「可转发到组织外」悄悄留着。
        data: { link_share_entity: 'closed', external_access: false },
      }),
      '关闭链接分享',
    );
    return true;
  } catch (e) {
    console.error('[task] 关闭任务表链接分享失败:', (e as Error).message);
    return false;
  }
}

/**
 * 把任务表授权给群，**给 edit**。
 *
 * 和日志表只给 view 是刻意相反的，理由是这张表**没有第二份数据**：
 * 库里不存任务，表格就是数据源。所以「群成员自己改进展」不是绕过助理的旁路，
 * 它就是主路 —— 助理读的也是这张表。
 *
 * 代价必须认下来：群成员能删行，删掉就真的没有了（没有库可以补回来）。
 * 这是用户拍的板 —— 换来的是「在表里改状态，助理立刻知道」。
 */
async function grantEdit(client: Client, appToken: string, chatId: string): Promise<Warning> {
  try {
    assertOk(
      await client.drive.permissionMember.create({
        path: { token: appToken },
        params: { type: 'bitable', need_notification: false },
        data: {
          member_type: 'openchat',
          member_id: chatId,
          perm: 'edit',
          type: 'chat',
        },
      }),
      '把任务表开放给群',
    );
    return null;
  } catch (e) {
    return (
      `⚠️ 任务表建好了，但**开放给本群失败了**（${describeFeishuError(e)}）—— ` +
      `群里点链接会显示无权限。请在飞书里手动把这张表分享给本群（可编辑）。`
    );
  }
}

/**
 * 拿到（必要时补建）这个项目的任务 base。
 *
 * 070 之前建的项目没有任务 base（迁移里不能调飞书接口），所以是第一次派活时
 * 补建的。判据只看 `task_base_app_token` 是否为空 —— 068 那两列指向的是
 * 项目日记 base 里那张老「任务」表，非空，不能拿来判断（见 070 文件头）。
 */
export async function ensureTaskBase(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ project: DiaryProjectRow; warning: Warning }> {
  if (!project.task_base_app_token) {
    const created = await createTaskBase(client, project);
    return { project: store.getProjectById(project.id)!, warning: created.warning };
  }
  return upgradeTaskBase(client, project);
}

/**
 * 给**已经存在**的任务 base 补上后来加的东西（现在是「飞书任务」列和甘特视图）。
 *
 * 为什么在这里而不是在迁移里：迁移跑在启动路径上，而这几步要调飞书接口 ——
 * 一次网络抖动会让整个服务起不来，而它换来的只是一列。所以和 068/070 一样，
 * 补建挂在**下一次派活**上。
 *
 * 因此这段代码会被反复执行，幂等靠的是两个存下来的值，各有各的坑：
 * - 列：只在**存下来的映射里没有这个键**时才 create。用「表里有没有这一列」
 *   判断是错的 —— 用户手动删掉那一列之后我们会一直重建，他删一次我们加一次；
 *   而映射里有键、表里没列，是 resolveFieldNames 的 missing 分支（会明说）。
 * - 视图：只在 `task_gantt_view_id` 为空时建。见 migration 072 —— 少了这一位
 *   就是每次派活多一个同名「甘特图」视图，而每次都成功、没有任何报错。
 *
 * 全部失败都只是 warning：补不上一列不该让派活失败（任务已经建到人头上了）。
 */
async function upgradeTaskBase(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ project: DiaryProjectRow; warning: Warning }> {
  const warnings: string[] = [];
  let current = project;

  if (current.task_base_table_id) {
    // 映射是空的（建表时 list 字段失败过）→ 先补读一次。不补的话下面
    // 「映射里有没有这个键」永远是「没有」，于是每次派活都试着 create 一次列。
    let map = parseFieldMap(current.task_field_map);
    if (!Object.keys(map).length) {
      const loaded = await loadFieldMap(client, current.task_base_app_token, current.task_base_table_id);
      if (Object.keys(loaded.map).length) {
        map = loaded.map;
        store.setTaskFieldMap(current.id, map);
        current = store.getProjectById(current.id)!;
      }
    }

    // 缺哪列补哪列。现在只有「飞书任务」，写成循环是因为下一次加列还会走这里。
    //
    // 公式列（「是否延期」）不在补的范围内：它缺失的唯一原因就是建表时公式被拒过
    // （createTaskBase 那个降级分支，已经提示用户手动加了）。放进来的话每次派活都
    // 重试一次、每次都失败、每次都在回帖里挂一句 warning —— 一个永远不会好的提示
    // 比没有提示更糟。
    const wanted = TASK_FIELDS.filter((f) => f.type !== F_FORMULA && !(f.field_name in map));
    if (Object.keys(map).length && wanted.length) {
      for (const spec of wanted) {
        try {
          const res = assertOk(
            await client.bitable.appTableField.create({
              path: {
                app_token: current.task_base_app_token,
                table_id: current.task_base_table_id,
              },
              data: { field_name: spec.field_name, type: spec.type, property: spec.property },
            }),
            `给任务表补上「${spec.field_name}」列`,
          );
          const fid = res.data?.field?.field_id;
          if (fid) map[spec.field_name] = fid;
        } catch (e) {
          warnings.push(
            `⚠️ 任务表里少了「${spec.field_name}」这一列，补的时候失败了` +
              `（${describeFeishuError(e)}），这一项的内容暂时写不进表里。`,
          );
        }
      }
      store.setTaskFieldMap(current.id, map);
      current = store.getProjectById(current.id)!;
    }

    // 补出来的「飞书任务」列对**已经在表里的行**是空的 —— 回填一次。
    // 挂在补列之后：列还没建出来时下面那个 names[COL.taskUrl] 是空的，会自己跳过。
    if (!current.task_url_backfilled) {
      const filled = await backfillTaskUrls(client, current);
      if (filled) warnings.push(filled);
      current = store.getProjectById(current.id)!;
    }

    if (!current.task_gantt_view_id) {
      const gantt = await createGanttView(
        client,
        current.task_base_app_token,
        current.task_base_table_id,
      );
      if (gantt.warning) warnings.push(gantt.warning);
      if (gantt.viewId) {
        store.setTaskGanttView(current.id, gantt.viewId);
        current = store.getProjectById(current.id)!;
        warnings.push(ganttHint());
      }
    }
  }

  return { project: current, warning: warnings.length ? warnings.join('\n') : null };
}

// 回填一次最多读这么多行。比 MAX_ROWS（读回用的 300）大：那边截断只是一次回帖里
// 少几条，这边截断是**永久**少几个链接（下面置了位就不再回来了）。
const MAX_BACKFILL_ROWS = 1000;

/** 超链接列当前的值 → 链接。空 = 这一格还没填过。 */
function urlLink(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const o = v as { link?: string; text?: string };
    return (o.link || '').trim();
  }
  return '';
}

/**
 * 把库里那份任务的 applink 回填进表里老行的「飞书任务」列（073）。
 *
 * 为什么非做不可：这一列是 072 之后才有的，而它是**库里那份任务被砍掉之后**唯一
 * 还能定位到飞书任务的东西（guid 藏在 applink 里）。老行不补的话，砍库那一天
 * 那些任务就只剩一个标题 —— 不报错，只是从此点不进飞书、也改不动。
 *
 * 对齐靠「助理标记」（`<message_id>#<step_index>`），不靠标题：标题会被改（表是
 * 开放编辑的，`update_task` 自己也改它），按标题对齐会把链接贴到另一个任务上，
 * 而那一格看着完全正常 —— 点进去是别人的活。
 *
 * **已经有值的格子不覆盖。** 那里的链接只可能是我们自己写的或用户手填的，两种都比
 * 库里那份新（库里那份是派活当时的）。覆盖不会报错，只是把用户的手工修正吃掉。
 *
 * 失败**不置位**（下次派活再试），所以这里的 warning 说的是「这次没补上」。
 */
async function backfillTaskUrls(client: Client, project: DiaryProjectRow): Promise<Warning> {
  const { names } = await resolveFieldNames(client, project);
  const idemCol = names[COL.idem];
  const urlCol = names[COL.taskUrl];
  // 列还没建出来（补列那一步失败过）→ 什么都不做也不置位。补列的失败已经报过了，
  // 这里再说一遍只是重复。
  if (!idemCol || !urlCol) return null;

  // 库里那份任务：标记 → applink。没有 url 的行（建任务失败过的）跳过。
  const wanted = new Map<string, string>();
  for (const row of store.listTasks(project.id)) {
    if (row.url && row.message_id) wanted.set(idemKey(row.message_id, row.step_index), row.url);
  }
  if (!wanted.size) {
    // 没有可补的东西也要置位，否则这次扫描会挂在**每一条**派活指令上。
    store.markTaskUrlBackfilled(project.id);
    return null;
  }

  const path = {
    app_token: project.task_base_app_token,
    table_id: project.task_base_table_id,
  };
  const patches: Array<{ record_id: string; fields: Record<string, TaskFieldValue> }> = [];
  let scanned = 0;
  let truncated = false;
  let pageToken: string | undefined;

  try {
    for (;;) {
      const res = assertOk(
        await client.bitable.appTableRecord.search({
          path,
          params: {
            page_size: PAGE_SIZE,
            user_id_type: 'open_id',
            ...(pageToken ? { page_token: pageToken } : {}),
          },
          data: {},
        }),
        '查询任务表',
      );
      for (const item of res.data?.items ?? []) {
        scanned += 1;
        const fields = (item.fields ?? {}) as Record<string, unknown>;
        if (urlLink(fields[urlCol])) continue;
        const url = wanted.get(plainText(fields[idemCol]).trim());
        if (!url || !item.record_id) continue;
        patches.push({
          record_id: item.record_id,
          fields: { [urlCol]: { text: '打开任务', link: url } },
        });
      }
      pageToken = res.data?.page_token;
      if (!res.data?.has_more || !pageToken) break;
      if (scanned >= MAX_BACKFILL_ROWS) {
        truncated = true;
        break;
      }
    }

    // batch_update 一次最多 1000 行，这里按 100 切 —— 一批失败时重补的量小些。
    for (let i = 0; i < patches.length; i += 100) {
      assertOk(
        await client.bitable.appTableRecord.batchUpdate({
          path,
          params: { user_id_type: 'open_id' },
          data: { records: patches.slice(i, i + 100) },
        }),
        '回填任务链接',
      );
    }
  } catch (e) {
    return (
      `⚠️ 任务表里老任务的「${COL.taskUrl}」这次没补上（${describeFeishuError(e)}），` +
      `下次派活时我会再试。表里那几行暂时点不进飞书任务。`
    );
  }

  store.markTaskUrlBackfilled(project.id);
  if (truncated) {
    return (
      `⚠️ 任务表超过 ${MAX_BACKFILL_ROWS} 行，我只给前面这些补上了「${COL.taskUrl}」链接，` +
      `再往后的没补（**不会再自动补**）。需要的话在表里手动加一下。`
    );
  }
  return null;
}

/** 一次派活最多补几条老任务。超了的下次派活接着补（查重靠「助理标记」，不会重）。 */
const MAX_IMPORT_PER_RUN = 100;

/**
 * 把 070 之前派的活补进任务管理表（074，删掉老「任务」表之前的最后一步）。
 *
 * 那些任务只在库里和日记 base 那张老「任务」表里。老表一删，它们在飞书里就只剩
 * 各人任务中心那一条 —— 而 `list_tasks` 只读任务管理表，于是「还有什么没做完」
 * 从此漏掉它们，一句错都不报。这是这个函数存在的全部理由。
 *
 * 顺序上它必须在 `bitable.dropTaskTable` **之前**，而且**补不完就不删**
 * （返回 `ok:false`）：删了再补的话中间任何一次失败都是永久丢失。
 *
 * 查重和 appendTaskRow 用同一个键（「助理标记」列）。所以这段可以被反复执行 ——
 * 上次补到一半的下次接着补。**读不到那一列就整个放弃**（`ok:false`）：
 * 没有查重就补的话，每次派活都把同一批老任务再写一遍，而每次都成功。
 */
export async function importLegacyTasks(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ ok: boolean; imported: number; warning: Warning }> {
  if (!project.task_base_table_id) return { ok: false, imported: 0, warning: null };
  const { names } = await resolveFieldNames(client, project);
  const idemCol = names[COL.idem];
  if (!idemCol) {
    return {
      ok: false,
      imported: 0,
      warning:
        `任务表里读不到「${COL.idem}」这一列，所以老任务这次没搬过来（搬了会重复）。` +
        `日志表里那张老「任务」表先留着 —— 里面是派活当天的旧值，别拿它当准。`,
    };
  }

  // 没有 message_id 的行进不来（幂等键的一半），也就没法查重 —— 直接跳过。
  // 已完成/已取消的照样搬：清单里「做完了多少」也是从这张表数的。
  const pending = store.listTasks(project.id).filter((t) => t.message_id);
  if (!pending.length) return { ok: true, imported: 0, warning: null };

  // 表里已经有的标记。整张表读一遍 —— 分页上限和回填共用一个（超过就不敢删老表）。
  const seen = new Set<string>();
  let scanned = 0;
  let pageToken: string | undefined;
  const path = {
    app_token: project.task_base_app_token,
    table_id: project.task_base_table_id,
  };
  try {
    for (;;) {
      const res = assertOk(
        await client.bitable.appTableRecord.search({
          path,
          params: {
            page_size: PAGE_SIZE,
            user_id_type: 'open_id',
            ...(pageToken ? { page_token: pageToken } : {}),
          },
          data: {},
        }),
        '查询任务表',
      );
      for (const item of res.data?.items ?? []) {
        scanned += 1;
        const key = plainText((item.fields ?? {})[idemCol]).trim();
        if (key) seen.add(key);
      }
      pageToken = res.data?.page_token;
      if (!res.data?.has_more || !pageToken) break;
      if (scanned >= MAX_BACKFILL_ROWS) {
        return {
          ok: false,
          imported: 0,
          warning:
            `任务表超过 ${MAX_BACKFILL_ROWS} 行，我没法确认老任务有没有搬过来，所以这次没搬、` +
            `老「任务」表也先留着。里面是派活当天的旧值，别拿它当准。`,
        };
      }
    }
  } catch (e) {
    return {
      ok: false,
      imported: 0,
      warning: `这次没能核对任务表里已有的行（${describeFeishuError(e)}），老任务下次派活时再搬。`,
    };
  }

  const todo = pending.filter((t) => !seen.has(idemKey(t.message_id, t.step_index)));
  if (!todo.length) return { ok: true, imported: 0, warning: null };

  let imported = 0;
  for (const t of todo.slice(0, MAX_IMPORT_PER_RUN)) {
    try {
      const written = await appendTaskRow(
        client,
        project,
        {
          title: t.title,
          digest: t.content,
          ownerOpenId: t.owner_open_id,
          status: normalizeStatus(t.status),
          startMs: t.start_ms ?? undefined,
          dueMs: t.end_ms ?? undefined,
          taskUrl: t.url,
          messageId: t.message_id,
          stepIndex: t.step_index,
        },
        names,
      );
      if (written.recordId) store.markTaskSynced(t.id, written.recordId);
      imported += 1;
    } catch (e) {
      // 补一半就停：剩下的下次派活接着来（老表这次不删）。
      return {
        ok: false,
        imported,
        warning:
          `老任务搬了 ${imported} 条就出错了（${describeFeishuError(e)}），` +
          `剩下的下次派活时接着搬，日志表里那张老「任务」表先留着。`,
      };
    }
  }

  const left = todo.length - imported;
  if (left > 0) {
    return {
      ok: false,
      imported,
      warning: `老任务先搬了 ${imported} 条进任务管理表，还剩 ${left} 条，下次派活时接着搬。`,
    };
  }
  return {
    ok: true,
    imported,
    warning: imported
      ? `📦 顺手把 ${imported} 条老任务搬进了任务管理表（原来在日志表的「任务」tab 里）。`
      : null,
  };
}

/**
 * 「这次写入该用哪些列名」。
 *
 * 表可编辑意味着列名会变。写记录的接口只收「字段名 → 值」的 map（没有按
 * field_id 写入这个选项），所以每次写之前都要用建表时存下的 field_id
 * 反查**当前**的列名。
 *
 * 三种情况：
 * - 有映射、列还在 → 用当前名字（用户改成什么都能写进去）；
 * - 有映射、列**没了**（被删了）→ 这一列的值写不进去，返回 missing 让调用方说出来；
 * - 没有映射（建表时 list 失败过）→ 退回中文常量，能用就用。
 *
 * 不缓存：列名随时会被改，而这是每条派活指令都要走的路。一次 list 换一次
 * 「派任务突然失败」的排查，值得。
 */
export async function resolveFieldNames(
  client: Client,
  project: DiaryProjectRow,
): Promise<{
  names: Record<string, string>;
  missing: string[];
  warning: Warning;
}> {
  const saved = parseFieldMap(project.task_field_map);
  // 没有存过映射：只能按中文常量写。这在没人改过列名时是对的。
  if (!Object.keys(saved).length) {
    const names: Record<string, string> = {};
    for (const key of Object.values(COL)) names[key] = key;
    return { names, missing: [], warning: null };
  }

  let current: Record<string, string> = {};
  try {
    const res = assertOk(
      await client.bitable.appTableField.list({
        path: {
          app_token: project.task_base_app_token,
          table_id: project.task_base_table_id,
        },
        params: { page_size: 100 },
      }),
      '读取任务表字段',
    );
    for (const f of res.data?.items ?? []) {
      if (f.field_id && f.field_name) current[f.field_id] = f.field_name;
    }
  } catch (e) {
    // 读不到字段清单时**不猜**：直接抛。写入是有副作用的，而按旧列名硬写
    // 有可能只写进去一半（飞书对未知列名整条报错，但列名对上一半的情况
    // 说不准），一条半成品任务比一次明确的失败糟得多。
    throw new Error(`读不到任务表的字段（${describeFeishuError(e)}），这次没有创建任何任务。`);
  }

  const names: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of Object.values(COL)) {
    const fid = saved[key];
    const now = fid ? current[fid] : undefined;
    if (now) names[key] = now;
    else missing.push(key);
  }
  return { names, missing, warning: null };
}

function parseFieldMap(raw: string): FieldMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as FieldMap) : {};
  } catch {
    return {};
  }
}

/** 写一行任务需要的东西。日期是**毫秒**（多维表格的日期字段就是毫秒时间戳）。 */
export interface TaskRowInput {
  title: string;
  /** 任务情况总结：派活时是原始要求。 */
  digest?: string;
  ownerOpenId?: string;
  status: TaskStatus;
  startMs?: number;
  dueMs?: number;
  priority?: TaskPriority;
  /** 对应飞书任务的 applink。空 = 没建出任务（或者是网页侧建的行）。 */
  taskUrl?: string;
  /** 幂等键的两半，拼成 `<message_id>#<step_index>`。 */
  messageId: string;
  stepIndex: number;
}

/**
 * 这张表实际会写的几种值：文本 / 单选（也是文本）/ 日期毫秒 / 人员数组 / 超链接。
 * 不用飞书那个完整联合类型 —— 写全了就看不出这张表用了什么。
 */
type TaskFieldValue = string | number | Array<{ id?: string }> | { text: string; link: string };

/** 幂等键。**格式改了等于所有历史行都失去防线**（重放会各写一行）。 */
function idemKey(messageId: string, stepIndex: number): string {
  return `${messageId}#${stepIndex}`;
}

/**
 * 一行任务 → 写给飞书的 `fields`。列名从 `names` 来（用户改过名就是新名字）。
 *
 * 空值一律**省掉字段**，不写空串/空数组：飞书对人员字段的空数组会整条报错，
 * 而写空串会把用户手填的东西清掉。
 */
function rowFields(
  input: TaskRowInput,
  names: Record<string, string>,
): Record<string, TaskFieldValue> {
  const f: Record<string, TaskFieldValue> = {
    [names[COL.title]]: input.title,
    // 进展永远写：它是看板分列的依据，空着那张卡片就落在「未分组」里。
    [names[COL.status]]: statusLabel(input.status),
    [names[COL.idem]]: idemKey(input.messageId, input.stepIndex),
  };
  if (input.digest) f[names[COL.digest]] = input.digest;
  if (input.ownerOpenId) f[names[COL.owner]] = [{ id: input.ownerOpenId }];
  if (input.startMs != null) f[names[COL.start]] = input.startMs;
  if (input.dueMs != null) f[names[COL.due]] = input.dueMs;
  if (input.priority) f[names[COL.priority]] = priorityLabel(input.priority);
  // 超链接字段收的是 {text, link}，给个纯字符串会被当成文本存进去 ——
  // 不报错，只是表里那一格点不动。
  if (input.taskUrl) f[names[COL.taskUrl]] = { text: '打开任务', link: input.taskUrl };
  // 列被删掉时 names 里没有它，键就成了 undefined —— 那会让飞书整条报错。
  // 调用方已经拿到 missing 并会说出来，这里只保证不发出一个坏请求。
  delete f['undefined'];
  return f;
}

/**
 * 往任务表里写一行。**写失败抛错** —— 库里没有第二份，回「已创建」而表里没有
 * 那一行是最坏的失败。
 *
 * 重放防线（飞书事件 at-least-once，成功也重投最长 6 小时）：写之前先按
 * 「助理标记」列 search 一次。多维表格没有唯一约束、record create 也没有
 * client_token，所以这一次多余的查询是唯一的办法。查询本身失败**不阻止写入**：
 * 那样每次网络抖动都会让派活失败，而重复行是看得见、能删的。
 */
export async function appendTaskRow(
  client: Client,
  project: DiaryProjectRow,
  input: TaskRowInput,
  names: Record<string, string>,
): Promise<{ recordId: string; duplicate: boolean }> {
  const path = {
    app_token: project.task_base_app_token,
    table_id: project.task_base_table_id,
  };
  const idemCol = names[COL.idem];

  if (idemCol) {
    try {
      const found = assertOk(
        await client.bitable.appTableRecord.search({
          path,
          params: { page_size: 1, user_id_type: 'open_id' },
          data: {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  field_name: idemCol,
                  operator: 'is',
                  value: [idemKey(input.messageId, input.stepIndex)],
                },
              ],
            },
          },
        }),
        '查询任务表',
      );
      const hit = (found.data?.items ?? [])[0];
      if (hit?.record_id) return { recordId: hit.record_id, duplicate: true };
    } catch (e) {
      console.error('[task] 查重放标记失败，继续写入:', (e as Error).message);
    }
  }

  const res = assertOk(
    await client.bitable.appTableRecord.create({
      path,
      params: { user_id_type: 'open_id' },
      data: { fields: rowFields(input, names) },
    }),
    '写入任务行',
  );
  const recordId = res.data?.record?.record_id ?? '';
  return { recordId, duplicate: false };
}

/**
 * 改一行任务时能动的列。`undefined` = 这次不碰它（**不是**清空），
 * 和 store.updateTask / 飞书 task.patch 的 `update_fields` 是同一条约定。
 *
 * `doneAtMs` 是唯一允许显式清空的：任务被重新打开时那个日期必须去掉，
 * 留着的话表里是「进展=进行中 + 实际完成日期=前天」，而回帖说的是「已重新打开」。
 */
export interface TaskRowPatch {
  title?: string;
  status?: TaskStatus;
  startMs?: number;
  dueMs?: number;
  /** null = 清掉。 */
  doneAtMs?: number | null;
  latest?: string;
}

function patchFields(
  patch: TaskRowPatch,
  names: Record<string, string>,
): Record<string, TaskFieldValue | null> {
  const f: Record<string, TaskFieldValue | null> = {};
  // 列被改名/删掉时 names 里没有它 —— 跳过而不是写一个 `undefined` 键，
  // 那会让飞书对整条请求报错，于是能改的几列也一起没改成。
  const put = (col: string, v: TaskFieldValue | null) => {
    if (names[col]) f[names[col]] = v;
  };
  if (patch.title) put(COL.title, patch.title);
  if (patch.status) put(COL.status, statusLabel(patch.status));
  if (patch.startMs != null) put(COL.start, patch.startMs);
  if (patch.dueMs != null) put(COL.due, patch.dueMs);
  if (patch.doneAtMs !== undefined) put(COL.doneAt, patch.doneAtMs);
  if (patch.latest) put(COL.latest, patch.latest);
  return f;
}

/**
 * 把一次改动写回表里那一行。行是按「助理标记」列（`<message_id>#<step_index>`，
 * 建它的时候写进去的）找的 —— 和 appendTaskRow 的查重用同一个键。
 *
 * **这条路不跟上就是一次假成功。** `list_tasks` 只读这张表：标记完成没写进去，
 * 下一句「还有什么没做完」照样把它列出来，而刚才那句回帖是「✅ 已标记完成」。
 * 两句话都不报错，只是互相打脸。所以：
 * - 找不到那一行（070 之前建的任务、或者行被人删了）→ 返回 `found: false`，
 *   由调用方说出来，**不能**当成写成功；
 * - search / update 失败 → 抛，调用方转成一句明确的 warning。
 *   降级成静默返回等于「表里还是旧的」没人知道。
 *
 * 清空「实际完成日期」用 `null`。万一这个租户/这版接口不吃 null，退一步把这一列
 * 摘掉重试一次：丢一个日期比丢掉同一条请求里的进展改动小得多（进展才是看板分列
 * 的依据），而摘掉这件事要说出来。
 */
export async function updateTaskRow(
  client: Client,
  project: DiaryProjectRow,
  key: { messageId: string; stepIndex: number },
  patch: TaskRowPatch,
  names: Record<string, string>,
): Promise<{ recordId: string; found: boolean; warning: Warning }> {
  const path = {
    app_token: project.task_base_app_token,
    table_id: project.task_base_table_id,
  };
  const idemCol = names[COL.idem];
  // 没有标记列 / 没有消息 id 就定位不到行。这不是「没改动」，得说出来。
  if (!idemCol || !key.messageId) return { recordId: '', found: false, warning: null };

  const found = assertOk(
    await client.bitable.appTableRecord.search({
      path,
      params: { page_size: 1, user_id_type: 'open_id' },
      data: {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: idemCol,
              operator: 'is',
              value: [idemKey(key.messageId, key.stepIndex)],
            },
          ],
        },
      },
    }),
    '查询任务表',
  );
  const recordId = (found.data?.items ?? [])[0]?.record_id ?? '';
  if (!recordId) return { recordId: '', found: false, warning: null };

  const warning = await writeTaskRow(client, project, recordId, patch, names);
  return { recordId, found: true, warning };
}

/**
 * 改表里**已经知道行号**的那一行。
 *
 * 分出来是因为「改哪一个」现在优先从表里认（updateTask.ts:resolveTarget），
 * 那条路手上已经有 record_id 了 —— 再按「助理标记」查一遍不只是浪费一次请求：
 * 用户在表里改标题是常事，而助理标记那一列他也能改/删，查不到就变成一句
 * 「表里没找到那一行」，而那一行明明就是刚才列给他看的那个。
 */
export async function writeTaskRow(
  client: Client,
  project: DiaryProjectRow,
  recordId: string,
  patch: TaskRowPatch,
  names: Record<string, string>,
): Promise<Warning> {
  const fields = patchFields(patch, names);
  if (!Object.keys(fields).length) return null;

  const write = (data: Record<string, TaskFieldValue | null>) =>
    client.bitable.appTableRecord.update({
      path: {
        app_token: project.task_base_app_token,
        table_id: project.task_base_table_id,
        record_id: recordId,
      },
      params: { user_id_type: 'open_id' },
      // SDK 的字段值类型里没有 null —— 「把字段值设成 null 即清空」是接口支持
      // 但类型没写进去的用法，所以这里断言掉。
      data: { fields: data as Record<string, TaskFieldValue> },
    });

  try {
    assertOk(await write(fields), '更新任务行');
  } catch (e) {
    const nulls = Object.keys(fields).filter((k) => fields[k] === null);
    if (!nulls.length) throw e;
    const rest = { ...fields };
    for (const k of nulls) delete rest[k];
    if (!Object.keys(rest).length) throw e;
    assertOk(await write(rest), '更新任务行');
    return (
      `⚠️ 任务表里的「${COL.doneAt}」没能清掉（${describeFeishuError(e)}），` +
      `那一列还留着上次完成的日期，其余都改好了。`
    );
  }
  return null;
}

// ── 读回 ──
//
// 这是「表格就是数据源」真正兑现的地方：群成员在表里改了进展/负责人/日期，
// 助理下一句话读到的就是改过的值。库里那份（068）压根不参与。
//
// 一次最多读这么多行。**超了要说出来**：一个项目几十条任务是常态，几百条
// 意味着这张表被当别的用了，而「只读到前 300 条」和「一共就这些」在回帖里
// 完全同形 —— 用户会以为剩下的活都没了。
const MAX_ROWS = 300;
const PAGE_SIZE = 100;

/** 表里那一行，翻译成代码里的样子。 */
export interface TaskRow {
  recordId: string;
  title: string;
  digest: string;
  ownerName: string;
  ownerOpenId: string;
  /** 认得出来的进展。用户自己在表里加了选项时是 undefined —— 见 statusLabelRaw。 */
  status?: TaskStatus;
  /** 表里那一列的原文。**认不出来时回帖要照它原样说**，不能归成「待开始」。 */
  statusLabelRaw: string;
  startMs?: number;
  dueMs?: number;
  doneAtMs?: number;
  latest: string;
  priority?: TaskPriority;
  /** 「飞书任务」那一格的链接。空 = 老行还没回填（073），或者这行是手填的。 */
  taskUrl: string;
  /** 「助理标记」原文（`<message_id>#<step_index>`）。空 = 用户自己加的行。 */
  idem: string;
}

/**
 * 从 applink 里取出任务的 guid。
 *
 * 这是「表格就是数据源」最后一块拼图：库里那份任务（068）要砍掉，而改飞书任务
 * 必须有 guid —— 唯一还存着它的地方就是表里那一格链接的 query 参数。
 *
 * 取不到时返回空串，**调用方必须把这行从候选里剔掉**：拿空 guid 去 patch 只会
 * 撞一个莫名的参数错误，而用户看到的是「改任务本身失败」加一串飞书原文。
 */
export function guidFromUrl(url: string): string {
  const m = /[?&]guid=([^&#]+)/.exec(url || '');
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** 人员字段的值形状：`[{id, name}]`（search 带 user_id_type=open_id 时就是这个）。 */
function firstPerson(v: unknown): { id: string; name: string } {
  const arr = Array.isArray(v) ? v : [];
  const p = arr[0] as { id?: string; open_id?: string; name?: string } | undefined;
  return { id: p?.open_id || p?.id || '', name: p?.name || '' };
}

/** 文本字段的值：飞书有时给字符串，有时给 `[{type:'text',text:'…'}]`。 */
function plainText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map((seg) => (typeof seg === 'string' ? seg : ((seg as { text?: string })?.text ?? '')))
      .join('');
  }
  if (v && typeof v === 'object' && 'text' in (v as object)) {
    return String((v as { text?: string }).text ?? '');
  }
  return '';
}

function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** 单选字段的值：字符串，偶尔是 `{text}`。 */
function selectText(v: unknown): string {
  return plainText(v).trim();
}

/**
 * 把整张任务表读出来。
 *
 * **读失败必须抛。** 降级成「返回空数组」的后果是回一句「目前没有在办的任务」——
 * 而真相是权限掉了/接口挂了，那句话会让用户以为活都干完了。这是这一整片改动里
 * 最容易犯、也最难发现的错。
 *
 * 列名同样每次重新解析（表是开放编辑的）。缺列不抛：缺「预计完成日期」只是
 * 读不到截止时间，而缺列这件事由调用方一并说出来。
 */
export async function queryTasks(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ rows: TaskRow[]; missing: string[]; truncated: boolean }> {
  const { names, missing } = await resolveFieldNames(client, project);
  const path = {
    app_token: project.task_base_app_token,
    table_id: project.task_base_table_id,
  };

  const raw: Array<Record<string, unknown>> = [];
  let recordIds: string[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  // 分页读。search 不带 filter —— 筛选在代码里做，因为「进展」是个用户能随手
  // 加选项的单选列：按值 filter 的话，他新加的「待验收」会被服务端筛掉，
  // 那几条任务就在回帖里凭空消失了。
  for (;;) {
    const res = assertOk(
      await client.bitable.appTableRecord.search({
        path,
        params: {
          page_size: PAGE_SIZE,
          user_id_type: 'open_id',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        data: {},
      }),
      '查询任务表',
    );
    for (const item of res.data?.items ?? []) {
      raw.push((item.fields ?? {}) as Record<string, unknown>);
      recordIds.push(item.record_id ?? '');
    }
    pageToken = res.data?.page_token;
    if (!res.data?.has_more || !pageToken) break;
    if (raw.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  const rows: TaskRow[] = raw.map((f, i) => {
    const owner = firstPerson(f[names[COL.owner]]);
    const label = selectText(f[names[COL.status]]);
    return {
      recordId: recordIds[i] ?? '',
      title: plainText(f[names[COL.title]]),
      digest: plainText(f[names[COL.digest]]),
      ownerName: owner.name,
      ownerOpenId: owner.id,
      status: statusFromLabel(label),
      statusLabelRaw: label,
      startMs: numOrUndef(f[names[COL.start]]),
      dueMs: numOrUndef(f[names[COL.due]]),
      doneAtMs: numOrUndef(f[names[COL.doneAt]]),
      latest: plainText(f[names[COL.latest]]),
      priority: priorityFromLabel(selectText(f[names[COL.priority]])),
      taskUrl: urlLink(f[names[COL.taskUrl]]),
      idem: plainText(f[names[COL.idem]]).trim(),
    };
  });

  return { rows, missing, truncated };
}

/** 在办 = 不是已完成、也不是已取消。**认不出来的进展算在办** —— 见下。 */
export function isOpen(row: TaskRow): boolean {
  // 用户自己加的选项（「待验收」）status 是 undefined。算成在办是刻意的：
  // 漏报一件还在推进的活（「没有在办任务」）比多报一件已经收尾的糟得多。
  if (!row.status) return true;
  return row.status !== 'done' && row.status !== 'cancelled';
}

/**
 * 「有几列写不进去」这件事怎么说。
 *
 * 必须说出来的理由：表是开放编辑的，删掉/改名一列是一次点击的事，而后果是
 * 那一列的值悄悄丢了 —— 任务照样建出来，回帖照样是 ✅，只是负责人是空的。
 */
export function describeMissing(missing: string[]): Warning {
  if (!missing.length) return null;
  return (
    `⚠️ 任务表里这几列找不到了（大概是被改名或删掉了）：${missing.join('、')}。\n` +
    `这几项的内容这次**没写进去**，其余都正常。把列名改回来，或者在飞书里重新加上。`
  );
}

/**
 * 同上，但是**读**那侧的话术。
 *
 * 分开写而不是复用 describeMissing：那句话说的是「这次没写进去」，而读的时候
 * 缺列的后果是**清单里那一栏是空的** —— 用一句「没写进去」解释一份读出来的清单，
 * 用户会以为是他刚才派的活丢了字段。
 */
export function describeMissingOnRead(missing: string[]): Warning {
  if (!missing.length) return null;
  return (
    `⚠️ 任务表里这几列找不到了（大概是被改名或删掉了）：${missing.join('、')}。\n` +
    `上面清单里这几项因此是空的 —— 表里可能是有值的，只是我按不上号了。`
  );
}

/**
 * 任务表的可点链接。实现在 bitable.ts —— 项目总表要写这个链接，而那边不能
 * 反向 import 本模块（会成环）。从这里 re-export，调用方照旧。
 */
export { taskBaseUrl } from './bitable.js';
