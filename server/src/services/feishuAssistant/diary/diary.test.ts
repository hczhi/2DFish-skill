import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';

// 项目日记（migration 066）。这里守的是四类「错了不会报错、只会静默给出错结果」的事：
//
//   1. **时间窗口算在代码里**（range.ts）。算错不会抛异常 —— 只会生成一份写着
//      「本周」而实际取了上周记录的复盘，没人会去核对。周日那条尤其要紧：
//      weekday 里 0 = 周日，少了 `(weekday+6)%7` 就变成「本周只有今天」。
//   2. **一个群一个项目**。UNIQUE 撞上时要分清是「这个群已经有项目」还是
//      「名字被别的群占了」，两者解法不同；而建表失败必须回滚占位行，
//      否则这个群永远卡在「有项目但没有表」（重说一遍只会被 UNIQUE 挡回来）。
//   3. **群只读**。同步是只追加的，群里删掉一行就再也不会回来，所以授权只能是 view。
//   4. **记录原样存**，且飞书事件重投时不能记成两条、也不能谎称新记了一条。
//
// 飞书那侧全部用假 client：这一层要验的是我们发出去的参数长什么样
// （权限是 view 还是 edit、external_access 传没传、删的是自带表还是我们的表），
// 而不是 SDK 本身。

// aiGateway 必须 mock 掉：复盘会真的调 LLM。
// 顺带用它验一条最容易写错的事 —— 额度记在**绑应用的平台账号**上（getAppByAppId），
// 以及空范围时**一次都不许调**（那会白花额度，还把「没人记录」说成「没有进展」）。
const llm: { calls: Array<{ req: unknown; opts: Record<string, unknown> }>; content: string } = {
  calls: [],
  content: JSON.stringify({
    overview: '这周主要在推进分镜',
    progress: ['和导演对了分镜', '第三场要重拍'],
    issues: [],
    next: [],
  }),
};
vi.mock('../../../core/llm/gateway.js', () => ({
  SAMPLING: { analytic: {} },
  aiGateway: vi.fn(async (req: unknown, opts: Record<string, unknown>) => {
    llm.calls.push({ req, opts });
    return { response: { choices: [{ message: { content: llm.content } }] } };
  }),
}));

import { getAction, ACTIONS, allRequiredScopes, optionalScopeGroups } from '../actions/index.js';
import type { ActionContext } from '../actions/types.js';
import * as store from './store.js';
import { resolveRange, RANGE_KEYS } from './range.js';
import { buildDiaryContext, renderDiaryContext } from './context.js';

const APP_ID = 'cli_diary001';
const CHAT_ID = 'oc_group001';

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_diary_records').run();
  db.prepare('DELETE FROM feishu_diary_summaries').run();
  db.prepare('DELETE FROM feishu_diary_projects').run();
  db.prepare('DELETE FROM feishu_diary_indexes').run();
  db.prepare('DELETE FROM feishu_project_tasks').run();
  db.prepare('DELETE FROM feishu_apps').run();
  db.prepare('DELETE FROM feishu_chats').run();
  llm.calls = [];
  llm.content = JSON.stringify({ overview: '概述', progress: ['一件事'], issues: [], next: [] });
  resetFakeState();
});

/** 复盘要靠这一行找到「额度记谁的账上」。 */
function seedApp(appId = APP_ID, userId = 'user-1') {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_apps
         (id, user_id, name, app_id, app_secret, enabled, allowed_chats, conn_state, created_at, updated_at)
       VALUES (?, ?, '测试助理', ?, 'enc', 1, '[]', 'connected', ?, ?)`
    )
    .run(`row_${appId}`, userId, appId, now, now);
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    client: {} as Client,
    appId: APP_ID,
    senderOpenId: 'ou_sender',
    senderName: '张三',
    chatId: CHAT_ID,
    chatType: 'group',
    messageId: 'om_msg_001',
    mentions: [],
    ...overrides,
  };
}

interface FakeCalls {
  appCreate: Array<Record<string, any>>;
  tableCreate: Array<Record<string, any>>;
  tableDelete: Array<Record<string, any>>;
  viewCreate: Array<Record<string, any>>;
  publicPatch: Array<Record<string, any>>;
  memberCreate: Array<Record<string, any>>;
  recordCreate: Array<Record<string, any>>;
  recordUpdate: Array<Record<string, any>>;
  /** 重放查重（070）。 */
  recordSearch: Array<Record<string, any>>;
  batchCreate: Array<Record<string, any>>;
  taskCreate: Array<Record<string, any>>;
  taskPatch: Array<Record<string, any>>;
  /** 任务表的字段清单和视图配置（070）。 */
  fieldList: Array<Record<string, any>>;
  viewPatch: Array<Record<string, any>>;
  /** 读群聊记录（总结群聊）。断言里要看传出去的时间单位和排序方向。 */
  messageList: Array<Record<string, any>>;
}

/**
 * 假客户端的自增序号和 table_id → 表名的映射。
 *
 * **是模块级的，不是每个 client 一份**，而这一点是有用例逼出来的：任务那几组
 * （建项目用一个 client，之后每条指令各用一个）里，写行的失败注入要靠表名分流
 * （任务表写失败 ≠ 总表写失败），而表是**建项目那个 client** 建的。映射跟着
 * client 走的话，后来那个 client 眼里 `tbl_3` 是个陌生 id，于是注入不生效、
 * 用例安静地变成「同步成功」—— 测的东西没了，但用例是绿的。
 * id 因此也必须全局唯一（两个 client 各自从 1 开始会撞成同一个 `tbl_1`）。
 */
const seq = { base: 0, table: 0, record: 0, view: 0, task: 0, field: 0 };
let tableNames: Record<string, string> = {};

/**
 * table_id → 它的列（070）。和 `tableNames` 一样是模块级的，理由也一样：
 * 表是**建项目那个 client** 建的，而「改了列名之后派任务」要用后面另一个 client
 * 去读它。跟着 client 走的话后者眼里这张表没有列，于是降级分支被走到、
 * 用例安静地变绿 —— 而它本该验的正是不许降级。
 */
let tableFields: Record<string, Array<{ field_id: string; field_name: string }>> = {};

/**
 * table_id → 写进去的行（070）。存在的理由只有一个：**重放防线要 search 得到
 * 上一次写的那一行**。假实现不留行的话 search 永远返回空，于是「事件重投时表里
 * 不多一行」那条用例安静地变成「create 被调了两次也没人管」。
 */
let tableRows: Record<string, Array<{ recordId: string; fields: Record<string, any> }>> = {};

function resetFakeState() {
  seq.base = 0;
  seq.table = 0;
  seq.record = 0;
  seq.view = 0;
  seq.task = 0;
  seq.field = 0;
  tableNames = {};
  tableFields = {};
  tableRows = {};
}

/**
 * 模拟有人**在飞书表里手动改了一行**（改进展、换负责人、拖日期）。
 * 这是整片改动要支持的核心动作，所以造数据也得能造它。
 */
function editRow(tableId: string, title: string, patch: Record<string, any>) {
  const row = (tableRows[tableId] ?? []).find((r) => r.fields['任务描述'] === title);
  if (!row) throw new Error(`表 ${tableId} 里没有叫「${title}」的行`);
  Object.assign(row.fields, patch);
}

/** 直接往表里塞一行（不经过助理），模拟群成员自己加的活。 */
function putRow(tableId: string, fields: Record<string, any>) {
  (tableRows[tableId] ??= []).push({ recordId: `rec_${++seq.record}`, fields });
}

/** 模拟有人在飞书里把某一列改了名。field_id 不变 —— 真实行为就是这样。 */
function renameColumn(tableId: string, from: string, to: string) {
  const f = (tableFields[tableId] ?? []).find((x) => x.field_name === from);
  if (!f) throw new Error(`测试数据里没有「${from}」这一列`);
  f.field_name = to;
}

/** 模拟有人把某一列整个删掉。 */
function deleteColumn(tableId: string, name: string) {
  tableFields[tableId] = (tableFields[tableId] ?? []).filter((x) => x.field_name !== name);
}

/** 一条原始群消息（飞书 im.message.list 的 item 形状）。 */
type RawMessage = Record<string, any>;

/**
 * 造一条群里的文本消息。
 *
 * `body.content` 是**序列化过的 JSON 字符串**（不是对象）—— 这是飞书这个接口
 * 最容易踩的一处，所以造数据也要照着来，不然解析那段代码等于没测。
 */
function rawText(
  text: string,
  o: {
    id?: string;
    sender?: string;
    name?: string;
    ms?: number;
    type?: string;
    mentions?: Array<{ key: string; name?: string; id?: string }>;
    deleted?: boolean;
  } = {}
): RawMessage {
  return {
    message_id: o.id ?? `om_${text.slice(0, 6)}_${Math.random().toString(36).slice(2, 7)}`,
    msg_type: 'text',
    // 毫秒（而请求参数是秒 —— 单位在这个接口的两侧是不一致的）。
    create_time: String(o.ms ?? Date.parse('2026-08-10T10:00:00+08:00')),
    ...(o.deleted ? { deleted: true } : {}),
    sender: {
      id: o.sender ?? 'ou_wangwu',
      sender_type: o.type ?? 'user',
      sender_name: o.name ?? '王五',
    },
    body: { content: JSON.stringify({ text }) },
    ...(o.mentions ? { mentions: o.mentions } : {}),
  };
}

/**
 * 假的飞书 client。
 *
 * base 和表的 id 按调用顺序递增（`bascn_1` 是项目总表，`bascn_2` 是项目自己的表），
 * 这样断言里能直接指名道姓地说「授权给群的是哪张表」。
 * `appTable.list` 固定返回一张自带表 `tbl_default`，用来验「删的是自带表、不是我们建的」。
 */
function fakeClient(
  opts: {
    /** 第 N 次 app.create 抛错（1 = 项目总表，2 = 项目日志表） */
    failBaseAt?: number;
    failBatchCreate?: boolean;
    failGrantChat?: boolean;
    failLinkShare?: boolean;
    failIndexRecordCreate?: boolean;
    /** 甘特视图建不出来（缺权限 / 视图数超限）。任务本身不该因此失败。 */
    failViewCreate?: boolean;
    /** 任务**管理**表（070 那张开放编辑的）的行写不进去。 */
    failTaskBaseRecordCreate?: boolean;
    /** 重放查重的搜索接口挂了。这时候宁可多一行，也不能让派活失败。 */
    failRecordSearch?: boolean;
    /** 读不到任务表的字段清单（070）。写入这时**不许**按旧列名硬猜。 */
    failFieldList?: boolean;
    /** 公式列（是否延期）建不出来。整张表要能去掉它重建，而不是没有表。 */
    failFormulaField?: boolean;
    /**
     * 群聊记录接口的返回。**按倒序给**（和真接口一致，见 chatHistory 的
     * sort_type）—— 顺序给的话「读满上限时丢掉的是最早那批」这条测不出来。
     */
    messages?: RawMessage[];
    /** 读消息失败（最常见的是缺 im:message.group_msg）。这一步必须抛，不许降级。 */
    failMessageList?: boolean;
  } = {}
): { client: Client; calls: FakeCalls } {
  const calls: FakeCalls = {
    appCreate: [],
    tableCreate: [],
    tableDelete: [],
    viewCreate: [],
    publicPatch: [],
    memberCreate: [],
    recordCreate: [],
    recordUpdate: [],
    recordSearch: [],
    batchCreate: [],
    taskCreate: [],
    taskPatch: [],
    fieldList: [],
    viewPatch: [],
    messageList: [],
  };
  const client = {
    bitable: {
      app: {
        create: vi.fn(async (arg: Record<string, any>) => {
          calls.appCreate.push(arg);
          if (opts.failBaseAt === calls.appCreate.length) throw new Error('创建多维表格失败');
          const token = `bascn_${++seq.base}`;
          return { data: { app: { app_token: token, url: `https://feishu.cn/base/${token}` } } };
        }),
      },
      appTable: {
        create: vi.fn(async (arg: Record<string, any>) => {
          calls.tableCreate.push(arg);
          const fields: Array<Record<string, any>> = arg.data?.table?.fields ?? [];
          // 公式列建不出来（缺权限 / 表达式不被接受）。**整张表都建不出来** ——
          // 真接口就是这个行为，而 taskBase 的降级分支（去掉公式列重建一次）
          // 只有这样才走得到。
          if (opts.failFormulaField && fields.some((f) => f.type === 20)) {
            throw new Error('公式表达式无效');
          }
          const id = `tbl_${++seq.table}`;
          // 记下 id → 表名：写行的接口是同一个（appTableRecord.create），
          // 只有靠表名才能分清这一行是写进项目总表、复盘表还是任务表 ——
          // 而失败注入必须能分开（任务表写失败不该让「写总表失败」的用例也变色）。
          tableNames[id] = arg.data?.table?.name ?? '';
          tableFields[id] = fields.map((f) => ({
            field_id: `fld_${++seq.field}`,
            field_name: f.field_name,
          }));
          return { data: { table_id: id } };
        }),
        list: vi.fn(async () => ({ data: { items: [{ table_id: 'tbl_default' }] } })),
        delete: vi.fn(async (arg: Record<string, any>) => {
          calls.tableDelete.push(arg);
          return { code: 0 };
        }),
      },
      appTableView: {
        create: vi.fn(async (arg: Record<string, any>) => {
          calls.viewCreate.push(arg);
          if (opts.failViewCreate) throw new Error('视图数超出上限');
          return { data: { view: { view_id: `vew_${++seq.view}` } } };
        }),
        patch: vi.fn(async (arg: Record<string, any>) => {
          calls.viewPatch.push(arg);
          return { code: 0 };
        }),
      },
      // 任务表的列名 → field_id（070）。**用户改列名之后返回的是新名字** ——
      // 这是「表开放编辑」带来的那类失败的唯一入口，所以假实现要能改。
      appTableField: {
        list: vi.fn(async (arg: Record<string, any>) => {
          calls.fieldList.push(arg);
          if (opts.failFieldList) throw new Error('没有 bitable:app 权限');
          const tid = arg.path?.table_id ?? '';
          const fields = tableFields[tid] ?? [];
          return { data: { items: fields.map((f) => ({ ...f })) } };
        }),
      },
      appTableRecord: {
        create: vi.fn(async (arg: Record<string, any>) => {
          calls.recordCreate.push(arg);
          const tid = arg.path?.table_id;
          const name = tableNames[tid] ?? '';
          if (name === '任务管理表') {
            if (opts.failTaskBaseRecordCreate) throw new Error('写任务管理表失败');
            // 「🔗 相关链接」（074）也走这个接口。它必须单列一支：落到下面
            // failIndexRecordCreate 那一支的话，「总表写失败」的用例会连带
            // 让互跳入口也失败，报出来的原因和用例名字完全无关。
          } else if (name === '🔗 相关链接') {
            /* 导航表，不注入失败 */
          } else if (opts.failIndexRecordCreate) {
            throw new Error('写总表失败');
          }
          const recordId = `rec_${++seq.record}`;
          (tableRows[tid] ??= []).push({ recordId, fields: arg.data?.fields ?? {} });
          return { data: { record: { record_id: recordId } } };
        }),
        // 070 的两条路都走这个接口：写之前的重放查重（带 filter），
        // 和读回整张表（不带 filter，翻页）。
        //
        // **翻页要真的翻**：读回那侧有个 MAX_ROWS 上限，而「只读到前 N 条」
        // 和「一共就这些」在回帖里同形 —— 一页塞完的话那条用例走不到截断分支。
        search: vi.fn(async (arg: Record<string, any>) => {
          calls.recordSearch.push(arg);
          if (opts.failRecordSearch) throw new Error('搜索接口超时');
          const cond = arg.data?.filter?.conditions?.[0];
          const rows = tableRows[arg.path?.table_id] ?? [];
          const hit = cond
            ? rows.filter((r) => r.fields[cond.field_name] === cond.value?.[0])
            : rows;
          const size = Number(arg.params?.page_size ?? 100);
          const from = Number(arg.params?.page_token ?? 0);
          const page = hit.slice(from, from + size);
          const next = from + page.length;
          return {
            data: {
              items: page.map((r) => ({ record_id: r.recordId, fields: r.fields })),
              has_more: next < hit.length,
              page_token: String(next),
            },
          };
        }),
        update: vi.fn(async (arg: Record<string, any>) => {
          calls.recordUpdate.push(arg);
          return { code: 0 };
        }),
        batchCreate: vi.fn(async (arg: Record<string, any>) => {
          calls.batchCreate.push(arg);
          if (opts.failBatchCreate) throw new Error('触发限流');
          return { code: 0 };
        }),
      },
    },
    // 任务动作（068）会真的调这两个接口。假实现返回一个可反查的 guid，
    // 「改任务」的用例靠它验证 guid 从来不经过 LLM。
    task: {
      v2: {
        task: {
          create: vi.fn(async (arg: Record<string, any>) => {
            calls.taskCreate.push(arg);
            const n = ++seq.task;
            return {
              data: {
                task: {
                  guid: `guid_${n}`,
                  task_id: `t_${n}`,
                  url: `https://applink.feishu.cn/client/task/detail?guid=guid_${n}`,
                },
              },
            };
          }),
          patch: vi.fn(async (arg: Record<string, any>) => {
            calls.taskPatch.push(arg);
            return { data: { task: { guid: arg.path?.task_guid } } };
          }),
          addMembers: vi.fn(async () => ({ code: 0 })),
          addReminders: vi.fn(async () => ({ code: 0 })),
        },
        comment: { create: vi.fn(async () => ({ code: 0 })) },
      },
    },
    // 群聊记录（总结群聊）。分页按 50 条一页切，这样「读满 500 条要停」
    // 那条用例走的是真的翻页路径，而不是一页塞 800 条。
    im: {
      message: {
        list: vi.fn(async (arg: Record<string, any>) => {
          calls.messageList.push(arg);
          if (opts.failMessageList) throw new Error('缺少 im:message.group_msg 权限');
          const all = opts.messages ?? [];
          const from = Number(arg.params?.page_token ?? 0);
          const items = all.slice(from, from + 50);
          const next = from + items.length;
          return {
            data: { items, has_more: next < all.length, page_token: String(next) },
          };
        }),
      },
    },
    drive: {
      permissionPublic: {
        patch: vi.fn(async (arg: Record<string, any>) => {
          calls.publicPatch.push(arg);
          if (opts.failLinkShare) throw new Error('没有 drive:drive 权限');
          return { code: 0 };
        }),
      },
      permissionMember: {
        create: vi.fn(async (arg: Record<string, any>) => {
          calls.memberCreate.push(arg);
          if (opts.failGrantChat && arg.data?.member_type === 'openchat') {
            throw new Error('授权给群失败');
          }
          return { code: 0 };
        }),
      },
    },
  };
  return { client: client as unknown as Client, calls };
}

/** 走真实动作把项目建出来，后续用例大多以此为起点。 */
async function createProject(name = '印度纪录片', ctxOverrides: Partial<ActionContext> = {}) {
  const fake = fakeClient();
  const ctx = makeCtx({ client: fake.client, ...ctxOverrides });
  const res = await getAction('create_diary_project')!.run({ name }, ctx);
  return { ...fake, ctx, res, project: store.getProjectByChat(ctx.appId, ctx.chatId)! };
}

/** 直接落一条记录，可指定发生时间（范围筛选要用）。 */
function seedRecord(
  projectId: string,
  input: { content: string; ms?: number; messageId?: string; step?: number; author?: string }
) {
  const { row } = store.insertRecord({
    appId: APP_ID,
    projectId,
    content: input.content,
    sourceText: input.content,
    authorOpenId: 'ou_sender',
    authorName: input.author ?? '张三',
    messageId: input.messageId ?? `om_${Math.random().toString(36).slice(2)}`,
    stepIndex: input.step ?? 0,
  });
  if (input.ms !== undefined) {
    getDatabase()
      .prepare('UPDATE feishu_diary_records SET created_ms = ? WHERE id = ?')
      .run(input.ms, row.id);
  }
  return row;
}

// ==================== 时间范围 ====================

describe('resolveRange', () => {
  /** 2026-08-09 是**周日**，15:30。周日是最容易算错的一天。 */
  const SUN = Date.parse('2026-08-09T15:30:00+08:00');
  const at = (iso: string) => Date.parse(iso);

  it('今天 = 租户时区的 0 点到次日 0 点，不跟随服务器本地时区', () => {
    const r = resolveRange('today', SUN);
    // 服务器可能跑在 UTC。按本地时区切的话，「今天」会从北京时间早上 8 点开始，
    // 早会记的那几条就不在「今天」里了。
    expect(r.startMs).toBe(at('2026-08-09T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-10T00:00:00+08:00'));
    expect(r.label).toContain('08-09');
  });

  it('昨天是完整的一天，不含今天', () => {
    const r = resolveRange('yesterday', SUN);
    expect(r.startMs).toBe(at('2026-08-08T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-09T00:00:00+08:00'));
    expect(r.label).toContain('08-08');
  });

  it('周日的「本周」从**上周一**算起 —— 这是最容易算错的一天', () => {
    // weekday 里 0 = 周日。少了 (weekday+6)%7，周日复盘「本周」只会拿到周日一天，
    // 而周日通常一条记录都没有 —— 表现成「这周什么都没干」。
    const r = resolveRange('this_week', SUN);
    expect(r.startMs).toBe(at('2026-08-03T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-10T00:00:00+08:00'));
    expect(r.label).toContain('08-03');
    expect(r.label).toContain('08-09');
  });

  it('周中的「本周」也是从周一算起，且不含明天', () => {
    const wed = at('2026-08-05T10:00:00+08:00'); // 周三
    const r = resolveRange('this_week', wed);
    expect(r.startMs).toBe(at('2026-08-03T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-06T00:00:00+08:00'));
  });

  it('上周是完整的周一到周日', () => {
    const r = resolveRange('last_week', SUN);
    expect(r.startMs).toBe(at('2026-07-27T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-03T00:00:00+08:00'));
    // 标签里的结束日期是上周日（08-02），不是本周一。
    expect(r.label).toContain('07-27');
    expect(r.label).toContain('08-02');
  });

  it('跨月时「本周」照样退回上个月的周一', () => {
    const sat = at('2026-08-01T09:00:00+08:00'); // 周六
    const r = resolveRange('this_week', sat);
    expect(r.startMs).toBe(at('2026-07-27T00:00:00+08:00'));
  });

  it('本月从 1 号 0 点起', () => {
    const r = resolveRange('this_month', SUN);
    expect(r.startMs).toBe(at('2026-08-01T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-10T00:00:00+08:00'));
    expect(r.label).toContain('08-01');
  });

  it('最近 N 天含今天（N=3 是前天到今天）', () => {
    const r = resolveRange('recent_days', SUN, 3);
    expect(r.startMs).toBe(at('2026-08-07T00:00:00+08:00'));
    expect(r.endMs).toBe(at('2026-08-10T00:00:00+08:00'));
    expect(r.label).toContain('最近 3 天');
  });

  it('N 离谱时钳到 1–365，不让整表进 prompt', () => {
    expect(resolveRange('recent_days', SUN, 9999).startMs).toBe(
      resolveRange('recent_days', SUN, 365).startMs
    );
    expect(resolveRange('recent_days', SUN, 0).startMs).toBe(at('2026-08-09T00:00:00+08:00'));
    expect(resolveRange('recent_days', SUN, -5).startMs).toBe(at('2026-08-09T00:00:00+08:00'));
    // 没给 N 时默认 7 天。
    expect(resolveRange('recent_days', SUN).startMs).toBe(at('2026-08-03T00:00:00+08:00'));
  });

  it('全部 = 不设上下界', () => {
    const r = resolveRange('all', SUN);
    expect(r.startMs).toBeUndefined();
    expect(r.endMs).toBeUndefined();
    expect(r.label).toBe('全部记录');
  });

  it('认不出来的值当「今天」，并且在 label 里如实说是今天', () => {
    // 静默按「全部」处理会让一句「复盘一下」返回三个月的记录，摘要被稀释成没用的东西，
    // 而用户以为那就是今天的情况。
    for (const bad of [undefined, '', '本季度', 'last_month', '2026-08-01']) {
      const r = resolveRange(bad, SUN);
      expect(r.startMs).toBe(at('2026-08-09T00:00:00+08:00'));
      expect(r.label).toContain('今天');
    }
  });

  it('每个范围的 label 都带具体日期 —— 不写日期就无法核对', () => {
    for (const key of RANGE_KEYS) {
      const r = resolveRange(key, SUN, 5);
      if (key === 'all') continue;
      expect(r.label).toMatch(/\d{2}-\d{2}/);
    }
  });
});

// ==================== 库层 ====================

describe('项目占位与冲突', () => {
  const claim = (over: Partial<Parameters<typeof store.claimProject>[0]> = {}) =>
    store.claimProject({
      appId: APP_ID,
      chatId: CHAT_ID,
      name: '印度纪录片',
      createdBy: 'ou_sender',
      createdByName: '张三',
      ...over,
    });

  it('占位后能按群查到，且还没有表', () => {
    const row = claim();
    const found = store.getProjectByChat(APP_ID, CHAT_ID)!;
    expect(found.id).toBe(row.id);
    expect(found.base_app_token).toBe('');
  });

  it('同一个群再建 = chat 冲突，附上既有项目', () => {
    claim();
    try {
      claim({ name: '另一个项目' });
      expect.unreachable('应该抛 ProjectConflictError');
    } catch (e) {
      expect(e).toBeInstanceOf(store.ProjectConflictError);
      expect((e as store.ProjectConflictError).reason).toBe('chat');
      expect((e as store.ProjectConflictError).existing.name).toBe('印度纪录片');
    }
  });

  it('别的群用了同一个名字 = name 冲突（解法不同，不能混为一谈）', () => {
    claim();
    try {
      claim({ chatId: 'oc_other' });
      expect.unreachable('应该抛 ProjectConflictError');
    } catch (e) {
      expect((e as store.ProjectConflictError).reason).toBe('name');
    }
  });

  it('另一个应用可以有同名项目 —— 隔离键是 app_id', () => {
    claim();
    const other = claim({ appId: 'cli_other', chatId: 'oc_other' });
    expect(other.app_id).toBe('cli_other');
    expect(store.listProjects(APP_ID)).toHaveLength(1);
  });

  it('findProjectByName 只精确匹配，不做包含匹配', () => {
    claim();
    claim({ chatId: 'oc_two', name: '印度纪录片II' });
    // 原版 skill 用的是「关键词包含」，于是「印度纪录片」会命中「印度纪录片II」——
    // 记录进了错的项目，而回帖说「已记录」。
    expect(store.findProjectByName(APP_ID, '印度纪录片')!.chat_id).toBe(CHAT_ID);
    expect(store.findProjectByName(APP_ID, '印度纪录片II')!.chat_id).toBe('oc_two');
    expect(store.findProjectByName(APP_ID, '印度')).toBeUndefined();
    expect(store.findProjectByName(APP_ID, '纪录片')).toBeUndefined();
  });

  it('空格和大小写差异不影响匹配', () => {
    claim({ name: 'Brand Film' });
    expect(store.findProjectByName(APP_ID, ' brand film ')).toBeTruthy();
    expect(store.findProjectByName(APP_ID, '')).toBeUndefined();
  });

  it('dropProject 连带清掉挂在它下面的记录和复盘', () => {
    const p = claim();
    seedRecord(p.id, { content: 'x' });
    store.insertSummary({
      appId: APP_ID,
      projectId: p.id,
      rangeLabel: '今天',
      recordCount: 1,
      summary: 's',
      createdBy: 'ou_sender',
      createdByName: '张三',
    });
    store.dropProject(p.id);
    expect(store.getProjectByChat(APP_ID, CHAT_ID)).toBeUndefined();
    expect(store.countRecords(p.id)).toBe(0);
  });

  // 网页上删项目。两条都是「删完看起来很正常」的失败：
  // 少一个 WHERE 就把别的项目一起清了（回执照样写着刚删那个项目的名字和条数），
  // 或者回执没带上飞书那几张表的链接（那些表在飞书里搜不到，删完就再也找不回）。
  it('删一个项目不动另一个项目的记录和复盘', () => {
    const mine = claim();
    const other = claim({ chatId: 'oc_two', name: '另一个项目' });
    seedRecord(mine.id, { content: 'a' });
    seedRecord(other.id, { content: 'b' });
    store.insertSummary({
      appId: APP_ID,
      projectId: other.id,
      rangeLabel: '今天',
      recordCount: 1,
      summary: 's',
      createdBy: 'ou_sender',
      createdByName: '张三',
    });

    const removed = store.deleteProject(mine.id)!;

    expect(removed.recordCount).toBe(1);
    expect(store.getProjectById(mine.id)).toBeUndefined();
    expect(store.getProjectById(other.id)).toBeTruthy();
    expect(store.countRecords(other.id)).toBe(1);
    expect(store.listSummariesPage(other.id, { limit: 10, offset: 0 }).total).toBe(1);
  });

  it('回执必须带上飞书那几张表的链接（删完就找不回了）', () => {
    const p = claim();
    store.attachProjectBitable(p.id, {
      baseAppToken: 'bas_log',
      recordTableId: 'tbl_rec',
      reviewTableId: 'tbl_rev',
      url: 'https://f.cn/base/bas_log?table=tbl_rec',
      linkShareClosed: true,
    });
    store.attachTaskBase(p.id, {
      appToken: 'bas_task',
      tableId: 'tbl_task',
      url: 'https://f.cn/base/bas_task?table=tbl_task',
      fieldMap: {},
      boardViewId: 'vew1',
      personViewId: 'vew2',
      linkShareClosed: true,
    });

    const removed = store.deleteProject(p.id)!;

    expect(removed.project.url).toContain('bas_log');
    expect(removed.project.review_table_id).toBe('tbl_rev');
    expect(removed.project.task_base_url).toContain('bas_task');
  });

  it('deleteDiaryData 只清本应用那份', () => {
    const mine = claim();
    const theirs = claim({ appId: 'cli_other', chatId: 'oc_other', name: '别家的项目' });
    seedRecord(mine.id, { content: 'a' });
    store.saveIndex({ appId: APP_ID, baseAppToken: 'b1', tableId: 't1', url: 'u', linkShareClosed: true });

    store.deleteDiaryData(APP_ID);

    expect(store.listProjects(APP_ID)).toHaveLength(0);
    expect(store.getIndex(APP_ID)).toBeUndefined();
    expect(store.countRecords(mine.id)).toBe(0);
    // 另一家公司的项目一行都不能少。
    expect(store.getProjectById(theirs.id)).toBeTruthy();
  });
});

describe('记录的幂等与范围查询', () => {
  let projectId = '';
  beforeEach(() => {
    projectId = store.claimProject({
      appId: APP_ID,
      chatId: CHAT_ID,
      name: '印度纪录片',
      createdBy: 'ou_sender',
      createdByName: '张三',
    }).id;
  });

  const insert = (messageId: string, step = 0, content = '今天对了分镜') =>
    store.insertRecord({
      appId: APP_ID,
      projectId,
      content,
      sourceText: `记一下：${content}`,
      authorOpenId: 'ou_sender',
      authorName: '张三',
      messageId,
      stepIndex: step,
    });

  it('同一条消息的同一步重放不会写第二行，并明确 created=false', () => {
    // 飞书事件是 at-least-once（成功也重推），claimEvent 只在同一张库里挡得住。
    // 真正保证「一条消息只记一行」的是 (app_id, message_id, step_index) 这个 UNIQUE。
    const first = insert('om_a');
    const again = insert('om_a');
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.row.id).toBe(first.row.id);
    expect(store.countRecords(projectId)).toBe(1);
  });

  it('同一条消息的不同步是两条记录（一句话里记了两件事）', () => {
    insert('om_b', 0, '第一件');
    const second = insert('om_b', 1, '第二件');
    expect(second.created).toBe(true);
    expect(store.countRecords(projectId)).toBe(2);
  });

  it('原文一字不改地存下来，source_text 留着整句指令', () => {
    const { row } = insert('om_c', 0, '客户说预算追加 20 万，但要提前一周交片');
    expect(row.content).toBe('客户说预算追加 20 万，但要提前一周交片');
    expect(row.source_text).toContain('记一下：');
  });

  it('范围查询左闭右开，按时间正序返回', () => {
    const day = (iso: string) => Date.parse(iso);
    seedRecord(projectId, { content: '周一', ms: day('2026-08-03T10:00:00+08:00') });
    seedRecord(projectId, { content: '周三', ms: day('2026-08-05T10:00:00+08:00') });
    seedRecord(projectId, { content: '下周一', ms: day('2026-08-10T10:00:00+08:00') });

    const week = store.listRecords(projectId, {
      startMs: day('2026-08-03T00:00:00+08:00'),
      endMs: day('2026-08-10T00:00:00+08:00'),
    });
    expect(week.map((r) => r.content)).toEqual(['周一', '周三']);
  });

  it('limit 取的是**最近** N 条，返回时仍是正序', () => {
    // 正序 LIMIT 会截掉最近那些，正好是复盘最需要的部分。
    for (let i = 1; i <= 5; i++) {
      seedRecord(projectId, { content: `第${i}条`, ms: Date.parse(`2026-08-0${i}T10:00:00+08:00`) });
    }
    const got = store.listRecords(projectId, { limit: 2 });
    expect(got.map((r) => r.content)).toEqual(['第4条', '第5条']);
  });

  it('置位后不再出现在待同步列表里（只追加、不重复推）', () => {
    const a = insert('om_d').row;
    insert('om_e');
    expect(store.listUnsyncedRecords(projectId)).toHaveLength(2);
    store.markRecordsSynced([a.id]);
    const left = store.listUnsyncedRecords(projectId);
    expect(left).toHaveLength(1);
    expect(left[0].message_id).toBe('om_e');
  });
});

// ==================== 动作层 ====================

describe('create_diary_project', () => {
  it('私聊里不建项目，说清为什么要去群里', async () => {
    // 项目的身份就是那个群（chat_id 是 UNIQUE 键的一半）。绑到私聊上的话，
    // 「以后在群里记一下」这件事从一开始就不成立。
    const fake = fakeClient();
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client, chatType: 'p2p', chatId: 'oc_p2p' })
    );
    expect(res.summary).toContain('群');
    expect(fake.calls.appCreate).toHaveLength(0);
    expect(store.listProjects(APP_ID)).toHaveLength(0);
  });

  it('第一次建项目时顺手把项目总表建出来（没有「请先初始化」这一步）', async () => {
    const { calls, project } = await createProject();
    // 三个 base：项目总表 + 这个项目的日志表 + 这个项目的任务表。
    // 任务表**必须是独立的 base**（070）：文档权限的粒度是 base 而不是表，
    // 而任务表要开放给群成员编辑、日志表必须只读。
    expect(calls.appCreate).toHaveLength(3);
    expect(calls.appCreate[0].data.name).toBe('项目总表');
    expect(calls.appCreate[1].data.name).toContain('印度纪录片');
    expect(store.getIndex(APP_ID)!.base_app_token).toBe('bascn_1');
    expect(project.base_app_token).toBe('bascn_2');
    expect(project.task_base_app_token).toBe('bascn_3');
    // 两个 base 不能是同一个，否则给群 edit 会把日志表也放开。
    expect(project.task_base_app_token).not.toBe(project.base_app_token);
  });

  it('第二个项目复用已有的总表，不再建一份', async () => {
    await createProject('项目一');
    const fake = fakeClient();
    await getAction('create_diary_project')!.run(
      { name: '项目二' },
      makeCtx({ client: fake.client, chatId: 'oc_group002' })
    );
    // 只建了项目自己的两个 base（日志 + 任务），总表复用。
    expect(fake.calls.appCreate).toHaveLength(2);
    expect(fake.calls.appCreate.every((c) => c.data.name.includes('项目二'))).toBe(true);
  });

  it('先建我们的表再删自带的，且删的是**建之前列出来的**那张', async () => {
    // 一个 base 至少要有一张表，顺序反了删不掉；靠名字猜自带表则会删错。
    const { calls } = await createProject();
    expect(calls.tableDelete.map((c) => c.path.table_id)).toEqual([
      'tbl_default',
      'tbl_default',
      'tbl_default',
    ]);
    // 日志 base 只有「记录」+「复盘」两张（任务搬到独立 base 了），
    // 两个 base 最后各多一张「🔗 相关链接」（074 的互跳入口）。
    const names = calls.tableCreate.map((c) => c.data.table.name);
    expect(names).toEqual([
      '项目列表',
      '记录',
      '复盘',
      '任务管理表',
      '🔗 相关链接',
      '🔗 相关链接',
    ]);
  });

  it('任务表建在独立 base 里，且**开放给群 edit**（日志表仍然只给 view）', async () => {
    // 这两条权限刻意相反，而它们必须落在**两个 base** 上：
    // permissionMember 的 token 是 base 级，没有「只授权某张表」这个粒度。
    // 搞成一个 base 的后果是日志表跟着可编辑 —— 而日志同步是只追加的，
    // 群里删掉一行就再也回不来，库里还有但人看的是表。
    const { calls, project } = await createProject();
    const chatGrants = calls.memberCreate.filter((c) => c.data.member_type === 'openchat');
    expect(chatGrants).toHaveLength(2);

    const byToken = new Map(chatGrants.map((c) => [c.path.token, c.data.perm]));
    expect(byToken.get(project.base_app_token)).toBe('view');
    expect(byToken.get(project.task_base_app_token)).toBe('edit');
  });

  it('派活前把列名 → field_id 存下来，否则改一次列名就再也派不了任务', async () => {
    // 写记录的接口只收「字段名 → 值」的 map（没有按 field_id 写入这个选项），
    // 而这张表对群成员可编辑 —— 谁把「进展」改叫「状态」，写入就撞
    // FieldNameNotFound，一整条派活指令失败，而报错内容跟他刚做的事对不上号。
    const { project } = await createProject();
    const map = JSON.parse(project.task_field_map);
    expect(map['进展']).toBeTruthy();
    expect(map['任务执行人']).toBeTruthy();
    expect(map['助理标记']).toBeTruthy();
  });

  it('进展和重要紧急程度的选项写死在建表里，不靠写入时自动新建', async () => {
    // 单选字段的选项在写入未知值时会自动新建，而 LLM 对同一个意思有好几种写法。
    // 后果不是报错：那一列很快就有几个看起来一样的选项，看板按进展分列就此失效，
    // 而每一行看上去都是对的。
    const { calls } = await createProject();
    const table = calls.tableCreate.find((c) => c.data.table.name === '任务管理表')!;
    const field = (n: string) => table.data.table.fields.find((f: any) => f.field_name === n);

    expect(field('进展').type).toBe(3);
    expect(field('进展').property.options.map((o: any) => o.name)).toEqual([
      '待开始',
      '进行中',
      '已完成',
      '已停滞',
      '已取消',
    ]);
    expect(field('重要紧急程度').property.options.map((o: any) => o.name)).toEqual([
      '重要紧急',
      '重要不紧急',
      '紧急不重要',
      '不紧急不重要',
    ]);
    // 「是否延期」必须是公式（20），不能是可手填的列：延期是
    //「预计完成日期 < 今天 且没完成」的推论，手填的话一天后就不准了，
    // 而那个红色的「已延期」标签会一直挂着 —— 一个看起来在正常工作的错误提示。
    expect(field('是否延期').type).toBe(20);
  });

  it('公式列建不出来时去掉它重建，而不是让整个项目没有任务表', async () => {
    // 飞书对建表是整条成败：公式表达式不被接受，整张表都建不出来。
    // 「有 base 没表」是最糟的形态 —— 少一列「是否延期」是可接受的降级。
    const fake = fakeClient({ failFormulaField: true });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    const project = store.getProjectByChat(APP_ID, CHAT_ID)!;

    expect(project.task_base_table_id).toBeTruthy();
    expect(res.summary).toContain('是否延期');
    const built = fake.calls.tableCreate.filter((c) => c.data.table.name === '任务管理表');
    expect(built).toHaveLength(2);
    expect(built[1].data.table.fields.some((f: any) => f.type === 20)).toBe(false);
  });

  it('看板视图建好后要说「分组得你手点一次」—— 接口设不了分组', async () => {
    // appTableView.patch 的 property 只有 filter_info / hidden_fields /
    // hierarchy_config，没有分组。不说这句的话用户打开看板看到一堆没分列的卡片，
    // 会以为功能没做完，而实际只差他点一下。
    const { calls, res, project } = await createProject();
    const kanban = calls.viewCreate.filter((c) => c.data.view_type === 'kanban');
    expect(kanban.map((c) => c.data.view_name)).toEqual(['进度看板', '人员任务分配看板']);
    expect(project.task_board_view_id).toBeTruthy();
    expect(res.summary).toContain('分组');

    // 「助理标记」是内部幂等键，两个看板里都要藏掉。
    const map = JSON.parse(project.task_field_map);
    for (const p of calls.viewPatch) {
      expect(p.data.property.hidden_fields).toContain(map['助理标记']);
    }
  });

  it('看板视图建不出来也不影响项目本身，只带一句 warning', async () => {
    // 视图只是同一张表的另一种画法，数据全在。抛出去会把建项目变成失败，
    // 而表其实已经建好了 —— 那会留下一张孤儿表格。
    const fake = fakeClient({ failViewCreate: true });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    const project = store.getProjectByChat(APP_ID, CHAT_ID)!;

    expect(res.summary).toContain('看板视图');
    // 表 id 仍然要存下来，否则第一次派活时又会建一个新的任务 base。
    expect(project.task_base_table_id).toBeTruthy();
    expect(project.task_board_view_id).toBe('');
  });

  it('任务表授权失败必须说出来 —— 链接分享是关掉的，群里谁都打不开', async () => {
    // 「项目已建好」的回帖照常发出去，而群成员点任务表链接是「无权限访问」。
    // 不说的话这就是一个看起来成功的失败。
    const fake = fakeClient({ failGrantChat: true });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    expect(res.summary).toContain('无权限');
  });

  it('日志表授权给群只给 view，而且用 SDK v1 的 external_access 字段关掉链接分享', async () => {
    const { calls, project } = await createProject();

    // 同步是只追加的：群里删掉一行就再也不会回来。给整群 edit 等于让任何成员
    // 都能不可逆地删掉项目日志。（任务表相反，见上面那条用例。）
    const logGrant = calls.memberCreate.filter(
      (c) => c.data.member_type === 'openchat' && c.path.token === project.base_app_token
    );
    expect(logGrant).toHaveLength(1);
    expect(logGrant[0].data.perm).toBe('view');
    expect(logGrant[0].data.member_id).toBe(CHAT_ID);

    // 总表不授权给任何群（它是全公司所有项目的清单），只给建项目的人。
    const indexToken = store.getIndex(APP_ID)!.base_app_token;
    expect(
      calls.memberCreate.some((c) => c.data.member_type === 'openchat' && c.path.token === indexToken)
    ).toBe(false);
    const userGrant = calls.memberCreate.filter((c) => c.data.member_type === 'openid');
    expect(userGrant).toHaveLength(1);
    expect(userGrant[0].path.token).toBe(store.getIndex(APP_ID)!.base_app_token);
    expect(userGrant[0].data.perm).toBe('edit');

    // v1 的字段是 external_access（布尔），传 v2 的 external_access_entity 会被忽略，
    // 于是「可转发到组织外」悄悄留着。
    for (const p of calls.publicPatch) {
      expect(p.data.link_share_entity).toBe('closed');
      expect(p.data.external_access).toBe(false);
    }
    expect(project.link_share_closed).toBe(1);
  });

  it('回帖里主动说明表对群里是**只读**的', async () => {
    // 用户第一反应是去表里手动加一行，改不了才回来问。
    const { res, project } = await createProject();
    expect(res.summary).toContain('只读');
    expect(res.summary).toContain(project.url);
    expect(project.url).toContain('?table=');
  });

  it('回帖同时给出**项目总表**链接，并说明链接怎么问回来', async () => {
    // 这两张表都不在任何人的云文档空间里（建表时没传 folder_token），
    // 链接分享又是关掉的 —— 链接是唯一入口。不在这里给的话，
    // 那张全公司的项目清单谁都找不到（而它正是这个功能的核心）。
    const { res } = await createProject();
    expect(res.summary).toContain(store.getIndex(APP_ID)!.url);
    // 群消息会被刷走，所以必须告诉用户怎么把链接问回来。
    expect(res.summary).toContain('有哪些项目');
  });

  it('总表建失败时不硬塞一个空链接', async () => {
    const fake = fakeClient({ failBaseAt: 1 });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    expect(res.summary).not.toContain('[项目总表]()');
    expect(res.summary).not.toContain('项目总表](undefined');
  });

  it('「这个群已经有项目了」这条回帖也要带上日志表链接', async () => {
    // 说「新建项目」的人有一半其实是在找那张表的地址（消息被刷走了），
    // 而这条回帖是他最可能撞到的地方。
    const first = await createProject('印度纪录片');
    const res = await getAction('create_diary_project')!.run(
      { name: '再来一个' },
      makeCtx({ client: fakeClient().client })
    );
    expect(res.summary).toContain(first.project.url);
  });

  it('登记进项目总表，记录数初始为 0', async () => {
    const { calls, project } = await createProject();
    const idx = calls.recordCreate.find((c) => c.path.app_token === 'bascn_1')!;
    expect(idx.data.fields['项目名称']).toBe('印度纪录片');
    // 群那一列用的是「群」类型（点开能跳进群），不是一串对人没意义的 oc_xxx 文本。
    // 形状必须是 `[{id}]`：传裸字符串数组飞书会用 1254001 拒掉**整条 record**，
    // 而那是 HTTP 200 —— 群里照样收到「✅ 项目已建好」，只是总表是空的。
    expect(idx.data.fields['关联群聊']).toEqual([{ id: CHAT_ID }]);
    expect(idx.data.fields['记录数']).toBe(0);
    // 总表那一行的 record_id 要存下来：后面刷记录数/改名/补任务表链接都靠它。
    expect(project.index_record_id).toBeTruthy();
    // 074 起总表还多一列「任务表」，指向那个独立的任务 base。
    expect(idx.data.fields['任务表'].link).toContain(project.task_base_url);
  });

  it('日志表建不出来时回滚占位行，否则这个群永远卡在「有项目但没有表」', async () => {
    // 不回滚的话 UNIQUE 挡着，用户重说一遍只会收到「这个群已经是项目 X 了」。
    const fake = fakeClient({ failBaseAt: 2 });
    await expect(
      getAction('create_diary_project')!.run({ name: '印度纪录片' }, makeCtx({ client: fake.client }))
    ).rejects.toThrow();
    expect(store.getProjectByChat(APP_ID, CHAT_ID)).toBeUndefined();
    // 回滚之后重试能成功。
    const retry = await createProject();
    expect(retry.project).toBeTruthy();
  });

  it('总表建不出来不拦住项目本身，只在回帖里说一句', async () => {
    const fake = fakeClient({ failBaseAt: 1 });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    expect(store.getProjectByChat(APP_ID, CHAT_ID)!.base_app_token).toBeTruthy();
    expect(res.summary).toContain('项目总表');
  });

  it('授权给群失败时不抛错，但必须说出来（否则群里点链接是「无权限」而没人知道为什么）', async () => {
    const fake = fakeClient({ failGrantChat: true });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    expect(store.getProjectByChat(APP_ID, CHAT_ID)).toBeTruthy();
    expect(res.summary).toMatch(/无权限|手动/);
  });

  it('收紧链接分享失败时警告 —— 否则全公司拿到链接的人都能看这个项目', async () => {
    const fake = fakeClient({ failLinkShare: true });
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    expect(res.summary).toContain('链接分享');
    expect(store.getProjectByChat(APP_ID, CHAT_ID)!.link_share_closed).toBe(0);
  });

  it('同一个群再建时说清「一个群一个项目」，不再建第二套表', async () => {
    await createProject('印度纪录片');
    const fake = fakeClient();
    const res = await getAction('create_diary_project')!.run(
      { name: '春节品牌片' },
      makeCtx({ client: fake.client })
    );
    expect(res.summary).toContain('印度纪录片');
    expect(res.summary).toMatch(/一个群只能|已经是项目/);
    expect(fake.calls.appCreate).toHaveLength(0);
    expect(store.listProjects(APP_ID)).toHaveLength(1);
  });

  it('别的群占了这个名字时让用户换名字，而不是说「这个群已经有项目」', async () => {
    await createProject('印度纪录片');
    const fake = fakeClient();
    const res = await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client, chatId: 'oc_group002' })
    );
    expect(res.summary).toMatch(/换个名字/);
    expect(fake.calls.appCreate).toHaveLength(0);
  });

  it('缺项目名时抛出可读错误，不建任何东西', async () => {
    const fake = fakeClient();
    await expect(
      getAction('create_diary_project')!.run({}, makeCtx({ client: fake.client }))
    ).rejects.toThrow(/项目名称/);
    expect(fake.calls.appCreate).toHaveLength(0);
  });
});

describe('add_diary_record', () => {
  it('原样记下来并推进多维表格（人员字段用 open_id 数组、时间是毫秒）', async () => {
    const { project } = await createProject();
    const fake = fakeClient();
    const text = '今天和导演对了分镜，第三场要重拍';

    const res = await getAction('add_diary_record')!.run(
      { content: text },
      makeCtx({ client: fake.client, messageId: 'om_rec_1' })
    );

    const rows = store.listRecords(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe(text);

    const pushed = fake.calls.batchCreate[0].data.records;
    expect(pushed).toHaveLength(1);
    expect(pushed[0].fields['记录']).toBe(text);
    expect(pushed[0].fields['时间']).toBe(rows[0].created_ms);
    expect(pushed[0].fields['记录人']).toEqual([{ id: 'ou_sender' }]);
    // 推成功了就置位，下次不再重复推。
    expect(store.listUnsyncedRecords(project.id)).toHaveLength(0);
    expect(res.data?.synced).toBe(true);
    expect(res.summary).toContain('印度纪录片');
  });

  it('顺手把总表的记录数刷新成真实条数', async () => {
    const { project } = await createProject();
    const fake = fakeClient();
    await getAction('add_diary_record')!.run(
      { content: 'a' },
      makeCtx({ client: fake.client, messageId: 'om_1' })
    );
    await getAction('add_diary_record')!.run(
      { content: 'b' },
      makeCtx({ client: fake.client, messageId: 'om_2' })
    );
    const last = fake.calls.recordUpdate.at(-1)!;
    expect(last.path.record_id).toBe(project.index_record_id);
    expect(last.data.fields['记录数']).toBe(2);
  });

  it('重放时不写第二条，也不谎称新记了一条', async () => {
    await createProject();
    const fake = fakeClient();
    const args = { content: '预算追加 20 万' };
    const ctx = makeCtx({ client: fake.client, messageId: 'om_same' });

    await getAction('add_diary_record')!.run(args, ctx);
    const again = await getAction('add_diary_record')!.run(args, ctx);

    expect(again.data?.duplicate).toBe(true);
    expect(again.summary).toContain('已经记过');
    expect(store.countRecords(store.getProjectByChat(APP_ID, CHAT_ID)!.id)).toBe(1);
    // 第二次不再往表里写。
    expect(fake.calls.batchCreate).toHaveLength(1);
  });

  it('同步失败只回一句「下次补推」，记录仍在库里（否则用户会再说一遍，最后表里两条）', async () => {
    const { project } = await createProject();
    const fake = fakeClient({ failBatchCreate: true });

    const res = await getAction('add_diary_record')!.run(
      { content: '设备明天到' },
      makeCtx({ client: fake.client, messageId: 'om_fail' })
    );

    expect(store.countRecords(project.id)).toBe(1);
    expect(store.listUnsyncedRecords(project.id)).toHaveLength(1);
    expect(res.summary).toMatch(/没同步|补推/);
    expect(res.data?.synced).toBe(false);
  });

  it('欠账会在下一条记录时一起补推', async () => {
    const { project } = await createProject();
    await getAction('add_diary_record')!.run(
      { content: '第一条' },
      makeCtx({ client: fakeClient({ failBatchCreate: true }).client, messageId: 'om_x1' })
    );
    const ok = fakeClient();
    await getAction('add_diary_record')!.run(
      { content: '第二条' },
      makeCtx({ client: ok.client, messageId: 'om_x2' })
    );
    // 不断言先后顺序：两条的 created_ms 可能落在同一毫秒，SQLite 的排序对
    // 相等的键不保证稳定。要验的是「欠的那条也一起推了」。
    const pushed = ok.calls.batchCreate[0].data.records.map((r: any) => r.fields['记录']);
    expect(pushed).toHaveLength(2);
    expect(pushed).toEqual(expect.arrayContaining(['第一条', '第二条']));
    expect(store.listUnsyncedRecords(project.id)).toHaveLength(0);
  });

  it('本群还没有项目时提示先建项目，不写任何东西', async () => {
    const fake = fakeClient();
    const res = await getAction('add_diary_record')!.run(
      { content: '随便记一句' },
      makeCtx({ client: fake.client })
    );
    expect(res.summary).toContain('新建项目');
    expect(fake.calls.batchCreate).toHaveLength(0);
  });

  it('群里说话时忽略模型填的 project 参数 —— 群 id 是事实，参数是猜的', async () => {
    // 让参数能覆盖它意味着一句「记一下，跟上次那个项目一样」就可能把记录
    // 写进另一个群的项目里，而那个群的人根本不知道。
    await createProject('本群项目');
    const other = await createProject('别的群项目', { chatId: 'oc_group002' });

    const fake = fakeClient();
    await getAction('add_diary_record')!.run(
      { content: 'x', project: '别的群项目' },
      makeCtx({ client: fake.client, messageId: 'om_cross' })
    );

    expect(store.countRecords(store.getProjectByChat(APP_ID, CHAT_ID)!.id)).toBe(1);
    expect(store.countRecords(other.project.id)).toBe(0);
  });

  it('私聊里不带项目名就把项目列表给出来，绝不猜一个', async () => {
    await createProject('印度纪录片');
    const fake = fakeClient();
    const res = await getAction('add_diary_record')!.run(
      { content: 'x' },
      makeCtx({ client: fake.client, chatType: 'p2p', chatId: 'oc_p2p' })
    );
    expect(res.summary).toContain('印度纪录片');
    expect(fake.calls.batchCreate).toHaveLength(0);
  });

  it('私聊里项目名写不全时列出候选，不做包含匹配', async () => {
    await createProject('印度纪录片');
    const fake = fakeClient();
    const res = await getAction('add_diary_record')!.run(
      { content: 'x', project: '印度' },
      makeCtx({ client: fake.client, chatType: 'p2p', chatId: 'oc_p2p' })
    );
    expect(res.summary).toMatch(/完全一致|没有叫/);
    expect(fake.calls.batchCreate).toHaveLength(0);
  });

  it('私聊里带对项目名时正常记进去', async () => {
    const { project } = await createProject('印度纪录片');
    const fake = fakeClient();
    await getAction('add_diary_record')!.run(
      { content: '补一条', project: '印度纪录片' },
      makeCtx({ client: fake.client, chatType: 'p2p', chatId: 'oc_p2p', messageId: 'om_p2p' })
    );
    expect(store.countRecords(project.id)).toBe(1);
  });

  it('超长正文截断并说明，不静默丢字', async () => {
    const { project } = await createProject();
    const fake = fakeClient();
    const res = await getAction('add_diary_record')!.run(
      { content: 'x'.repeat(3000) },
      makeCtx({ client: fake.client, messageId: 'om_long' })
    );
    expect(res.summary).toContain('已截断');
    expect(store.listRecords(project.id)[0].content).toContain('已截断');
  });

  it('缺内容时抛出可读错误', async () => {
    await createProject();
    await expect(
      getAction('add_diary_record')!.run({}, makeCtx({ client: fakeClient().client }))
    ).rejects.toThrow();
  });
});

describe('list_diary_projects', () => {
  // 这个动作存在的唯一理由：那些多维表格**不在任何人的云文档空间里**
  // （建表没传 folder_token，表归机器人身份所有），链接分享又是关掉的，
  // 所以链接一被消息刷走就再也找不回来 —— 尤其是项目总表，
  // 它只在建第一个项目那一次的回帖里出现过。

  it('给出项目总表链接 —— 这是它最主要的用处', async () => {
    await createProject('印度纪录片');
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    const index = store.getIndex(APP_ID)!;
    expect(res.summary).toContain(index.url);
    expect(res.data?.index_url).toBe(index.url);
  });

  it('列出所有项目、各自的记录数和日志表链接', async () => {
    const a = await createProject('印度纪录片');
    const b = await createProject('春节品牌片', { chatId: 'oc_group002' });
    seedRecord(a.project.id, { content: '一' });
    seedRecord(a.project.id, { content: '二' });

    const res = await getAction('list_diary_projects')!.run({}, makeCtx());

    expect(res.summary).toContain('印度纪录片');
    expect(res.summary).toContain('春节品牌片');
    expect(res.summary).toContain('2 条');
    expect(res.summary).toContain('0 条');
    expect(res.summary).toContain(a.project.url);
    expect(res.summary).toContain(b.project.url);
    expect(res.data?.count).toBe(2);
  });

  it('标出「本群」那一个 —— 一屏项目名里靠名字认出自己在哪个群要费一秒', async () => {
    await createProject('印度纪录片');
    await createProject('春节品牌片', { chatId: 'oc_group002' });
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    expect(res.summary).toMatch(/印度纪录片\*\*（本群）/);
    expect(res.summary).not.toMatch(/春节品牌片\*\*（本群）/);
  });

  it('私聊里不标「本群」（私聊没有群）', async () => {
    await createProject('印度纪录片');
    const res = await getAction('list_diary_projects')!.run(
      {},
      makeCtx({ chatType: 'p2p', chatId: 'oc_p2p' })
    );
    expect(res.summary).toContain('印度纪录片');
    expect(res.summary).not.toContain('（本群）');
  });

  it('说明总表只有建项目的人能打开 —— 否则打不开会被当成链接坏了', async () => {
    await createProject();
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    expect(res.summary).toMatch(/只有.*才?能打开|建项目的人/);
  });

  it('一个项目都没有时引导去建，不报错也不给空清单', async () => {
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    expect(res.summary).toContain('新建项目');
    expect(res.data?.count).toBe(0);
  });

  it('只列本应用的项目', async () => {
    await createProject('我家的项目');
    store.claimProject({
      appId: 'cli_other',
      chatId: 'oc_other',
      name: '别家的项目',
      createdBy: 'ou_x',
      createdByName: 'X',
    });
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    expect(res.summary).toContain('我家的项目');
    expect(res.summary).not.toContain('别家的项目');
  });

  it('不调飞书接口，也不花 AI 额度（纯读库）', async () => {
    await createProject();
    const fake = fakeClient();
    await getAction('list_diary_projects')!.run({}, makeCtx({ client: fake.client }));
    expect(fake.calls.appCreate).toHaveLength(0);
    expect(fake.calls.recordCreate).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('总表还没建成时照样列项目，只是没有总表链接', async () => {
    // 建总表失败过的情况（见 create_diary_project 那个用例）。
    const fake = fakeClient({ failBaseAt: 1 });
    await getAction('create_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: fake.client })
    );
    const res = await getAction('list_diary_projects')!.run({}, makeCtx());
    expect(res.summary).toContain('印度纪录片');
    expect(res.summary).not.toContain('项目总表');
    expect(res.data?.index_url).toBe('');
  });
});

describe('review_diary', () => {
  it('空范围**一次 AI 额度都不花**，并区分「没人记录」和「没有进展」', async () => {
    seedApp();
    const { project } = await createProject();
    const fake = fakeClient();
    seedRecord(project.id, { content: '很久以前的一条', ms: Date.parse('2026-01-01T10:00:00+08:00') });

    const res = await getAction('review_diary')!.run(
      { range: 'today' },
      makeCtx({ client: fake.client })
    );

    expect(llm.calls).toHaveLength(0);
    expect(res.summary).toMatch(/没有任何记录/);
    // 项目一共有几条要说出来，否则用户以为日志丢了。
    expect(res.summary).toContain('1 条记录');
    expect(res.data?.record_count).toBe(0);
    expect(fake.calls.recordCreate.some((c) => c.path.table_id === project.review_table_id)).toBe(false);
  });

  it('一条记录都没有的项目引导他先去记，而不是让他换时间范围', async () => {
    seedApp();
    await createProject();
    const res = await getAction('review_diary')!.run(
      { range: 'this_week' },
      makeCtx({ client: fakeClient().client })
    );
    expect(res.summary).toContain('记一下');
    expect(llm.calls).toHaveLength(0);
  });

  it('额度记在绑应用的平台账号上（ctx.appId 是 cli_xxx，不是 feishu_apps 的行 id）', async () => {
    seedApp(APP_ID, 'user-1');
    const { project } = await createProject();
    seedRecord(project.id, { content: '今天对了分镜' });

    await getAction('review_diary')!.run({ range: 'today' }, makeCtx({ client: fakeClient().client }));

    expect(llm.calls).toHaveLength(1);
    // 用 getApp 查会一律查不到，于是额度记到空账号上 —— 而且不会报错。
    expect(llm.calls[0].opts.userId).toBe('user-1');
    expect(llm.calls[0].opts.source).toBe('feishu');
    expect(llm.calls[0].opts.operation).toBe('diary_review');
    // 走量的成文任务用 fast 档。
    expect(llm.calls[0].opts.tier).toBe('fast');
  });

  it('markdown 由代码渲染（小节固定），并落库 + 存进「复盘」表', async () => {
    seedApp();
    const { project } = await createProject();
    seedRecord(project.id, { content: '和导演对了分镜' });
    llm.content = JSON.stringify({
      overview: '本周以分镜为主',
      progress: ['和导演对了分镜'],
      issues: ['第三场要重拍'],
      next: [],
    });
    const fake = fakeClient();

    const res = await getAction('review_diary')!.run({ range: 'today' }, makeCtx({ client: fake.client }));

    expect(res.summary).toContain('关键进展');
    expect(res.summary).toContain('需要注意');
    // 空小节整个不渲染 —— 「下一步：（无）」会让人以为模型判断过了。
    expect(res.summary).not.toContain('下一步');

    const saved = getDatabase()
      .prepare('SELECT * FROM feishu_diary_summaries WHERE project_id = ?')
      .get(project.id) as { summary: string; record_count: number; bitable_synced_at: string | null };
    expect(saved.record_count).toBe(1);
    expect(saved.summary).toContain('关键进展');
    expect(saved.bitable_synced_at).toBeTruthy();

    const pushed = fake.calls.recordCreate.find((c) => c.path.table_id === project.review_table_id)!;
    expect(pushed.data.fields['记录数']).toBe(1);
    expect(pushed.data.fields['时间范围']).toContain('今天');
    // 回帖指向复盘表那一张，不是记录表。
    expect(res.summary).toContain(project.review_table_id);
  });

  it('模型没给可用 JSON 时退化成原始记录清单，并说明这不是总结', async () => {
    seedApp();
    const { project } = await createProject();
    seedRecord(project.id, { content: '设备明天到' });
    llm.content = '我觉得这周还不错';

    const res = await getAction('review_diary')!.run(
      { range: 'today' },
      makeCtx({ client: fakeClient().client })
    );

    expect(res.summary).toContain('原始记录');
    expect(res.summary).toContain('设备明天到');
    expect(res.summary).not.toContain('关键进展');
  });

  it('存进复盘表失败时说出来，但总结照样发（它已经在库里了）', async () => {
    seedApp();
    const { project } = await createProject();
    seedRecord(project.id, { content: 'a' });
    const fake = fakeClient({ failIndexRecordCreate: true });

    const res = await getAction('review_diary')!.run({ range: 'today' }, makeCtx({ client: fake.client }));

    expect(res.summary).toMatch(/复盘.*失败|存进/);
    const saved = getDatabase()
      .prepare('SELECT bitable_synced_at FROM feishu_diary_summaries WHERE project_id = ?')
      .get(project.id) as { bitable_synced_at: string | null };
    expect(saved.bitable_synced_at).toBeNull();
  });

  it('本群没有项目时不调 LLM', async () => {
    seedApp();
    const res = await getAction('review_diary')!.run(
      { range: 'today' },
      makeCtx({ client: fakeClient().client })
    );
    expect(res.summary).toContain('新建项目');
    expect(llm.calls).toHaveLength(0);
  });
});

// ==================== 项目任务（068 落库 / 070 任务管理表）====================

describe('create_task 落进项目任务表', () => {
  it('任务落库，起止时间按毫秒写', async () => {
    // 这是 req 5 的核心：飞书任务读不回来（tenant token 只看得到自己建的），
    // 所以「这个项目派了哪些活」只能问我们自己的表。
    const { calls, ctx, project } = await createProject();
    const res = await getAction('create_task')!.run(
      {
        summary: '设计项目 logo',
        description: '主视觉要能横竖版通用',
        start: '2026-08-10T09:00:00+08:00',
        due: '2026-08-13T18:00:00+08:00',
      },
      ctx
    );

    const rows = store.listTasks(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('设计项目 logo');
    expect(rows[0].start_ms).toBe(Date.parse('2026-08-10T09:00:00+08:00'));
    expect(rows[0].end_ms).toBe(Date.parse('2026-08-13T18:00:00+08:00'));
    expect(rows[0].status).toBe('todo');
    expect(rows[0].guid).toBe('guid_1');

    // 飞书任务本身也带上 start：负责人在任务中心能看到什么时候开工。
    const sent = calls.taskCreate[0].data;
    expect(sent.start.timestamp).toBe(String(Date.parse('2026-08-10T09:00:00+08:00')));
    expect(sent.due.timestamp).toBe(String(Date.parse('2026-08-13T18:00:00+08:00')));

    // 「N 个任务未同步」那个统计位要被置上：写进任务管理表之后不置位的话，
    // 后台会永远显示一个不存在的缺口。
    expect(store.listTasks(project.id)[0].bitable_record_id).toBeTruthy();
    expect(res.summary).toContain('任务管理表');
  });

  it('状态只收枚举里的词，模型编别的写法一律当未开始', async () => {
    // 单选字段的选项在写入未知值时会自动新建，于是「进行中」「in progress」
    // 会变成几个看起来一样的选项 —— 甘特图按状态上色随即失效。
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary: 'A', status: '正在做' }, ctx);
    expect(store.listTasks(project.id)[0].status).toBe('doing');

    const fake2 = fakeClient();
    await getAction('create_task')!.run(
      { summary: 'B', status: 'まだ' },
      makeCtx({ client: fake2.client, messageId: 'om_msg_b' })
    );
    expect(store.listTasks(project.id).find((t) => t.title === 'B')!.status).toBe('todo');
  });

  it('起止说反了自动换过来，并在回帖里把两个时间都列出来', async () => {
    // 「3 天后完成，今天开始」这种语序里模型偶尔会填颠倒。报错的代价（重说一整句）
    // 比静默纠正大，而纠正结果在回帖里是写明的，用户一眼能看出对不对。
    const { ctx, project } = await createProject();
    const res = await getAction('create_task')!.run(
      { summary: '剪片', start: '2026-08-13T18:00:00+08:00', due: '2026-08-10T09:00:00+08:00' },
      ctx
    );
    const row = store.listTasks(project.id)[0];
    expect(row.start_ms).toBeLessThan(row.end_ms!);
    expect(res.summary).toContain('开始');
    expect(res.summary).toContain('截止');
  });

  it('只有截止没有开始时，回帖当场说明甘特图上它只是个点', async () => {
    // 等用户打开甘特图发现少一条横条，他不会知道原因是缺开始时间。
    const { ctx } = await createProject();
    const res = await getAction('create_task')!.run(
      { summary: '交片', due: '2026-08-13T18:00:00+08:00' },
      ctx
    );
    expect(res.summary).toMatch(/点/);
  });

  it('没绑项目的群里也照样落库（project_id 为 NULL），不进任何表格', async () => {
    // 不记的话这条任务就只存在于飞书任务中心，而那里我们读不回来。
    const fake = fakeClient();
    const res = await getAction('create_task')!.run(
      { summary: '临时派个活' },
      makeCtx({ client: fake.client, chatId: 'oc_nowhere' })
    );
    expect(res.summary).toContain('✅ 任务已创建');
    expect(res.summary).not.toContain('任务管理表');
    const rows = store.findTasksByKeyword({ appId: APP_ID, senderOpenId: 'ou_sender' });
    expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBeNull();
  });

  it('事件重投时不会在库里记第二条，也不会在表格里多一行', async () => {
    // 飞书成功也重推（at-least-once）。幂等键是 (app_id, message_id, step_index)。
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary: '只该有一条' }, ctx);
    const fake = fakeClient();
    await getAction('create_task')!.run(
      { summary: '只该有一条' },
      makeCtx({ client: fake.client, messageId: ctx.messageId })
    );
    expect(store.listTasks(project.id)).toHaveLength(1);
  });

  // ── 070：写进那张开放编辑的「任务管理表」──
  //
  // 这一组守的三件事都属于「出错时会伪装成成功」：列被改名/删掉了照样回 ✅、
  // 重投在表里多一行、读不到列名时按旧名字硬写。

  /** 任务管理表里那一行的字段。 */
  function mgmtRowFields(calls: FakeCalls, project: store.DiaryProjectRow) {
    const fresh = store.getProjectById(project.id)!;
    const c = calls.recordCreate.find((x) => x.path.table_id === fresh.task_base_table_id);
    return c?.data.fields as Record<string, any> | undefined;
  }

  it('派活写进任务管理表：负责人是 open_id、日期是毫秒、带幂等标记', async () => {
    const { calls, ctx, project } = await createProject();
    const res = await getAction('create_task')!.run(
      {
        summary: '设计项目 logo',
        description: '主视觉要能横竖版通用',
        start: '2026-08-10T09:00:00+08:00',
        due: '2026-08-13T18:00:00+08:00',
        priority: '加急',
      },
      ctx
    );

    const f = mgmtRowFields(calls, project)!;
    expect(f['任务描述']).toBe('设计项目 logo');
    expect(f['任务情况总结']).toBe('主视觉要能横竖版通用');
    expect(f['任务执行人']).toEqual([{ id: 'ou_sender' }]);
    expect(f['进展']).toBe('待开始');
    expect(f['开始日期']).toBe(Date.parse('2026-08-10T09:00:00+08:00'));
    expect(f['预计完成日期']).toBe(Date.parse('2026-08-13T18:00:00+08:00'));
    expect(f['重要紧急程度']).toBe('重要紧急');
    // 幂等键 = message_id#step。它是重放的唯一防线（表格没有唯一约束，
    // record create 也没有 client_token）。
    expect(f['助理标记']).toBe(`${ctx.messageId}#0`);
    expect(res.summary).toContain('任务管理表');
  });

  it('有人把列改名了要说出来，而不是回一句 ✅ 就把那几项悄悄丢掉', async () => {
    // 表是开放编辑的，改列名是一次点击的事。写记录只能按**列名**写
    //（飞书没有按 field_id 写入这个选项），所以改名之后那一列的值写不进去 ——
    // 而任务照样建出来、回帖照样是 ✅。
    const { project } = await createProject();
    const fresh = store.getProjectById(project.id)!;
    renameColumn(fresh.task_base_table_id, '任务执行人', '谁干');
    deleteColumn(fresh.task_base_table_id, '重要紧急程度');

    const fake = fakeClient();
    const res = await getAction('create_task')!.run(
      { summary: '剪第三场', priority: '加急' },
      makeCtx({ client: fake.client, messageId: 'om_renamed' })
    );

    const f = fake.calls.recordCreate.find(
      (c) => c.path.table_id === fresh.task_base_table_id
    )!.data.fields;
    // 改了名的那一列照**新**名字写进去（field_id 没变，所以能跟上）。
    expect(f['谁干']).toEqual([{ id: 'ou_sender' }]);
    expect(f['任务执行人']).toBeUndefined();
    // 被删掉的那一列写不进去，必须明说是哪一列。
    expect(res.summary).toContain('重要紧急程度');
    expect(res.summary).toMatch(/改名|删掉/);
  });

  it('读不到列名时**一个任务都不写**，不按旧列名硬猜', async () => {
    // 硬猜的后果是可能只写进去一半（几列名字恰好没被改过），
    // 一条半成品任务比一次明确的失败糟得多。
    const { project } = await createProject();
    const fresh = store.getProjectById(project.id)!;
    const fake = fakeClient({ failFieldList: true });
    await expect(
      getAction('create_task')!.run(
        { summary: '不该写进去' },
        makeCtx({ client: fake.client, messageId: 'om_nofields' })
      )
    ).rejects.toThrow(/没能写进/);

    expect(
      fake.calls.recordCreate.filter((c) => c.path.table_id === fresh.task_base_table_id)
    ).toHaveLength(0);
  });

  it('写不进任务管理表就整条失败，并说清「别重说一遍」', async () => {
    // 老「任务」表砍掉之后这张表是唯一的数据源，`list_tasks` 也只读它。
    // 回一句「✅ 已创建」而表里没有那行 = 下一句「还有什么没做完」不会提它，
    // 两句都不报错。而飞书任务**已经建好了**，所以话术必须拦住重派 ——
    // 少这一句的话用户重说一遍，任务中心里就多一条一样的活。
    const { project } = await createProject();
    const fake = fakeClient({ failTaskBaseRecordCreate: true });
    await expect(
      getAction('create_task')!.run(
        { summary: '写不进去的活' },
        makeCtx({ client: fake.client, messageId: 'om_mgmt_fail' })
      )
    ).rejects.toThrow(/别重说一遍/);
    // 库里那份还留着（统计里会露出「未同步」），但状态位没置。
    expect(store.listTasks(project.id)[0].bitable_record_id).toBeFalsy();
  });

  it('事件重投时任务管理表里不多一行（靠助理标记查重）', async () => {
    // 库那侧的幂等键在 claimEvent / feishu_project_tasks 上，但表格没有唯一约束，
    // 而这张表**将来是唯一的数据源** —— 多一行就是凭空多一件活，且谁都不知道
    // 哪一行才是真的。
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary: '只该有一条' }, ctx);
    const fresh = store.getProjectById(project.id)!;

    const fake = fakeClient();
    await getAction('create_task')!.run(
      { summary: '只该有一条' },
      makeCtx({ client: fake.client, messageId: ctx.messageId })
    );
    expect(
      fake.calls.recordCreate.filter((c) => c.path.table_id === fresh.task_base_table_id)
    ).toHaveLength(0);
    expect(fake.calls.recordSearch).toHaveLength(1);
  });

  it('统计里露出任务数和未同步数（未同步只升不降 = 表格永远缺那几条）', async () => {
    await createProject();
    const project = store.getProjectByChat(APP_ID, CHAT_ID)!;
    await getAction('create_task')!.run(
      { summary: '同步成功的' },
      makeCtx({ client: fakeClient().client, messageId: 'om_ok' })
    );
    await expect(
      getAction('create_task')!.run(
        { summary: '没同步的' },
        makeCtx({ client: fakeClient({ failTaskBaseRecordCreate: true }).client, messageId: 'om_bad' })
      )
    ).rejects.toThrow();
    const stats = store.projectStats(APP_ID)[project.id];
    expect(stats.task_count).toBe(2);
    expect(stats.open_task_count).toBe(2);
    expect(stats.unsynced_task_count).toBe(1);
  });
});

describe('update_task 写回项目任务表', () => {
  async function seedTask(summary = '设计项目 logo', extra: Record<string, unknown> = {}) {
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary, ...extra }, ctx);
    return { project: store.getProjectById(project.id)!, row: store.listTasks(project.id)[0] };
  }

  it('从库里反查 guid（**不限 7 天**，而日志只留 7 天）', async () => {
    const { project, row } = await seedTask();
    // 把这条任务做旧到 30 天前：日志那条路会因为超出 7 天窗口而查不到。
    getDatabase()
      .prepare('UPDATE feishu_project_tasks SET created_ms = ? WHERE id = ?')
      .run(Date.now() - 30 * 86400_000, row.id);
    getDatabase().prepare('DELETE FROM feishu_commands').run();

    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: 'logo', completed: true },
      makeCtx({ client: fake.client, messageId: 'om_upd' })
    );

    expect(fake.calls.taskPatch[0].path.task_guid).toBe(row.guid);
    expect(store.getTaskById(row.id)!.status).toBe('done');
    expect(store.listTasks(project.id)[0].bitable_record_id).toBe(row.bitable_record_id);
  });

  it('标记完成同时把状态改成 done，并更新表里**那一行**而不是追加', async () => {
    // 追加的后果是甘特图上同一个任务好几条横条，各自的进度还不一样。
    const { project, row } = await seedTask();
    const fake = fakeClient();
    const res = await getAction('update_task')!.run(
      { task: 'logo', completed: true },
      makeCtx({ client: fake.client, messageId: 'om_upd2' })
    );

    expect(store.getTaskById(row.id)!.status).toBe('done');
    const updates = fake.calls.recordUpdate.filter(
      (c) => c.path.table_id === project.task_base_table_id
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].data.fields['进展']).toBe('已完成');
    expect(
      fake.calls.recordCreate.filter((c) => c.path.table_id === project.task_base_table_id)
    ).toHaveLength(0);
    expect(res.summary).toContain('任务管理表');
  });

  it('只说状态时不去动飞书的完成位（「取消」不等于「完成」）', async () => {
    const { row } = await seedTask();
    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: 'logo', status: 'cancelled' },
      makeCtx({ client: fake.client, messageId: 'om_upd3' })
    );
    expect(store.getTaskById(row.id)!.status).toBe('cancelled');
    expect(fake.calls.taskPatch).toHaveLength(0);
  });

  it('「重新打开」落到 doing 而不是 todo（活已经动过了）', async () => {
    const { row } = await seedTask();
    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: 'logo', completed: false },
      makeCtx({ client: fake.client, messageId: 'om_upd4' })
    );
    expect(store.getTaskById(row.id)!.status).toBe('doing');
  });

  it('改开始时间会走 patch 的 start，并同步进任务管理表那一列', async () => {
    const { project, row } = await seedTask();
    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: 'logo', start: '2026-08-11T09:00:00+08:00' },
      makeCtx({ client: fake.client, messageId: 'om_upd5' })
    );
    const body = fake.calls.taskPatch[0].data;
    expect(body.update_fields).toEqual(['start']);
    expect(body.task.start.timestamp).toBe(String(Date.parse('2026-08-11T09:00:00+08:00')));
    expect(store.getTaskById(row.id)!.start_ms).toBe(Date.parse('2026-08-11T09:00:00+08:00'));
    const updates = fake.calls.recordUpdate.filter(
      (c) => c.path.table_id === project.task_base_table_id
    );
    expect(updates[0].data.fields['开始日期']).toBe(Date.parse('2026-08-11T09:00:00+08:00'));
  });

  it('改名之后按**新**名字还能找到（日志里存的也是新标题）', async () => {
    const { row } = await seedTask();
    await getAction('update_task')!.run(
      { task: 'logo', summary: '设计品牌主视觉' },
      makeCtx({ client: fakeClient().client, messageId: 'om_upd6' })
    );
    expect(store.getTaskById(row.id)!.title).toBe('设计品牌主视觉');

    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: '品牌主视觉', completed: true },
      makeCtx({ client: fake.client, messageId: 'om_upd7' })
    );
    expect(fake.calls.taskPatch[0].path.task_guid).toBe(row.guid);
  });

  it('飞书那边 patch 失败时库里也不改（甘特图不该显示飞书上没生效的值）', async () => {
    const { row } = await seedTask();
    const fake = fakeClient();
    (fake.client as any).task.v2.task.patch = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      getAction('update_task')!.run(
        { task: 'logo', due: '2026-08-20T18:00:00+08:00' },
        makeCtx({ client: fake.client, messageId: 'om_upd8' })
      )
    ).rejects.toThrow(/一处都没改成/);
    expect(store.getTaskById(row.id)!.end_ms).toBeNull();
  });

  it('库里有多个候选时绝不挑一个，列出来让用户重说', async () => {
    const { ctx } = await createProject();
    await getAction('create_task')!.run({ summary: '季度报告初稿' }, ctx);
    await getAction('create_task')!.run(
      { summary: '季度报告终稿' },
      makeCtx({ client: fakeClient().client, messageId: 'om_two' })
    );
    const fake = fakeClient();
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', completed: true },
        makeCtx({ client: fake.client, messageId: 'om_amb' })
      )
    ).rejects.toThrow(/不敢替你挑/);
    expect(fake.calls.taskPatch).toHaveLength(0);
  });

  it('派给别人的活，对方也能改（A 派给 B，B 说「做完了」）', async () => {
    const { ctx } = await createProject();
    await getAction('create_task')!.run(
      { summary: '交初稿', assignee: '李四' },
      { ...ctx, mentions: [{ openId: 'ou_lisi', name: '李四' }] }
    );
    const fake = fakeClient();
    await getAction('update_task')!.run(
      { task: '交初稿', completed: true },
      makeCtx({ client: fake.client, senderOpenId: 'ou_lisi', senderName: '李四', messageId: 'om_b' })
    );
    expect(fake.calls.taskPatch[0].path.task_guid).toBe('guid_1');
  });

  it('不是自己派的也不是派给自己的，查不到（跨人是改别人的东西）', async () => {
    const { ctx } = await createProject();
    await getAction('create_task')!.run({ summary: '别人的活' }, ctx);
    getDatabase().prepare('DELETE FROM feishu_commands').run();
    await expect(
      getAction('update_task')!.run(
        { task: '别人的活', completed: true },
        makeCtx({ client: fakeClient().client, senderOpenId: 'ou_stranger', messageId: 'om_c' })
      )
    ).rejects.toThrow(/只能改我自己帮你建的/);
  });

  it('删项目时任务只解绑、不删除（飞书那边的任务还在提醒人）', async () => {
    const { project, row } = await seedTask();
    store.dropProject(project.id);
    const left = store.getTaskById(row.id);
    expect(left).toBeTruthy();
    expect(left!.project_id).toBeNull();
  });

  it('deleteDiaryData 会把任务真删掉（解绑那条规则只对单个项目成立）', async () => {
    const { row } = await seedTask();
    store.deleteDiaryData(APP_ID);
    expect(store.getTaskById(row.id)).toBeUndefined();
  });
});

// ==================== 改项目名 ====================

describe('rename_diary_project', () => {
  it('改名之后本群的记录/任务/复盘一条都不动，链接也不变', async () => {
    // 这是这个动作能不能被信任的关键：一个群只能有一个项目，改名如果连带
    // 丢东西，用户就再也不敢用它了 —— 而他唯一的替代方案是另建一个群。
    const { ctx, project } = await createProject('印度纪录片');
    seedRecord(project.id, { content: '第三场要重拍' });
    await getAction('create_task')!.run(
      { summary: '剪第三场' },
      makeCtx({ client: fakeClient().client, messageId: 'om_t1' })
    );
    const before = store.getProjectById(project.id)!;

    const res = await getAction('rename_diary_project')!.run({ name: '印度纪录片二期' }, ctx);

    const fresh = store.getProjectByChat(APP_ID, CHAT_ID)!;
    expect(fresh.id).toBe(project.id);
    expect(fresh.name).toBe('印度纪录片二期');
    expect(fresh.url).toBe(before.url);
    expect(fresh.base_app_token).toBe(before.base_app_token);
    expect(fresh.task_base_table_id).toBe(before.task_base_table_id);
    expect(before.task_base_table_id).toBeTruthy();
    expect(store.countRecords(project.id)).toBe(1);
    expect(store.listTasks(project.id)).toHaveLength(1);
    // 回帖要把「什么没变」说出来，否则用户会担心之前记的跟丢了。
    expect(res.summary).toContain('印度纪录片');
    expect(res.summary).toContain('印度纪录片二期');
    expect(res.summary).toMatch(/都还在|没变/);
  });

  it('总表那一行的项目名和「日志表」列的文字一起刷', async () => {
    // 只刷一个的话总表同一行的两列会写着两个不同的名字。
    const { project } = await createProject('印度纪录片');
    const fake = fakeClient();
    await getAction('rename_diary_project')!.run(
      { name: '印度纪录片二期' },
      makeCtx({ client: fake.client, messageId: 'om_rename' })
    );
    const upd = fake.calls.recordUpdate.find((c) => c.path.record_id === project.index_record_id)!;
    expect(upd.data.fields['项目名称']).toBe('印度纪录片二期');
    expect(upd.data.fields['日志表'].text).toBe('印度纪录片二期');
    // 链接不变：改的是显示文字。
    expect(upd.data.fields['日志表'].link).toBe(project.url);
  });

  it('总表刷失败只带一句 warning，库里的名字照样改成了', async () => {
    // 抛出去的后果很具体：用户重说一遍会撞上「已经有一个叫 X 的项目了」——
    // 一个我们自己造成的、看起来像用户操作错误的死结。
    const { project } = await createProject('印度纪录片');
    const fake = fakeClient();
    (fake.client as any).bitable.appTableRecord.update = vi
      .fn()
      .mockRejectedValue(new Error('没权限'));
    const res = await getAction('rename_diary_project')!.run(
      { name: '新名字' },
      makeCtx({ client: fake.client, messageId: 'om_rn2' })
    );
    expect(store.getProjectById(project.id)!.name).toBe('新名字');
    expect(res.summary).toContain('✅ 项目已改名');
    expect(res.summary).toMatch(/总表里还是旧名字/);
  });

  it('撞上别的群占用的名字时拒掉，并说清为什么（重名之后「记到 X」就分不出来）', async () => {
    await createProject('印度纪录片');
    const other = await createProject('春节品牌片', { chatId: 'oc_group002' });
    const res = await getAction('rename_diary_project')!.run(
      { name: '印度纪录片' },
      makeCtx({ client: other.ctx.client, chatId: 'oc_group002', messageId: 'om_rn3' })
    );
    expect(res.summary).toMatch(/已经有一个叫/);
    // 名字没动。
    expect(store.getProjectByChat(APP_ID, 'oc_group002')!.name).toBe('春节品牌片');
  });

  it('改成同一个名字时说「本来就叫这个」，不谎称改过', async () => {
    // 回「已改名」会让用户以为刚才那次没生效、再说一遍。
    const { ctx } = await createProject('印度纪录片');
    const res = await getAction('rename_diary_project')!.run({ name: '印度纪录片' }, ctx);
    expect(res.summary).toMatch(/本来就叫/);
    expect(res.summary).not.toContain('已改名');
  });

  it('没绑项目的群里改名 → 指向「先建项目」，不报错', async () => {
    const res = await getAction('rename_diary_project')!.run(
      { name: '随便' },
      makeCtx({ client: fakeClient().client, chatId: 'oc_nowhere' })
    );
    expect(res.summary).toMatch(/还没有对应的项目/);
    expect(res.summary).toContain('新建项目');
  });

  it('名字前后的空格去掉（语音转文字经常带一个尾空格）', async () => {
    const { ctx, project } = await createProject('印度纪录片');
    await getAction('rename_diary_project')!.run({ name: '  印度纪录片二期  ' }, ctx);
    expect(store.getProjectById(project.id)!.name).toBe('印度纪录片二期');
  });

  it('改完名字之后按**新**名字能在私聊里找到（findProjectByName 走的是库）', async () => {
    const { ctx } = await createProject('印度纪录片');
    await getAction('rename_diary_project')!.run({ name: '印度纪录片二期' }, ctx);
    expect(store.findProjectByName(APP_ID, '印度纪录片二期')).toBeTruthy();
    expect(store.findProjectByName(APP_ID, '印度纪录片')).toBeUndefined();
  });

  it('改完名字之后快照里也是新名字（prompt 里的指代要跟着变）', async () => {
    const { ctx, project } = await createProject('印度纪录片');
    seedRecord(project.id, { content: '一条记录' });
    await getAction('rename_diary_project')!.run({ name: '印度纪录片二期' }, ctx);
    expect(buildDiaryContext(APP_ID, CHAT_ID).projectName).toBe('印度纪录片二期');
  });
});

// ==================== 总结群聊（req 7）====================
//
// 这个动作和其余所有动作有两处本质区别，测的就是这两处：
//   1. 它**主动读用户的聊天**（别的动作只看 @ 我的那一句）。所以「丢了什么」
//      必须数出来说清 —— 一句「今天群里没什么可记的」在"真没聊正事"、
//      "全是图片"、"消息太多只读了后半截" 三种情况下完全同形。
//   2. 它把**LLM 写的字**落进日志表，和用户的原话并排。所以每条都要标成
//      chat_digest（migration 069）、正文顶一行标记、回帖里明说是归纳的。
//      少了这些，日志表就不能再当「当时到底怎么说的」来用了 —— 而那是它唯一的用途。

describe('digest_chat', () => {
  const T = (hhmm: string) => Date.parse(`2026-08-10T${hhmm}:00+08:00`);

  // 时间钉死在 2026-08-10 12:00（北京时间）。动作里的范围是拿 Date.now() 算的，
  // 不钉的话「今天 0 点那个 start_time」这条断言明天就红了 —— 而它测的正是
  // 「参数传的是秒不是毫秒」，是这个接口最容易踩的一处。
  // 只 fake Date：fake 掉定时器会让 SDK 那侧的 await 卡住。
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T('12:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 摘要 LLM 的返回。和复盘共用同一个 mock，所以每个用例自己设。 */
  function digestReturns(items: string[]) {
    llm.content = JSON.stringify({ items });
  }

  async function digest(
    messages: RawMessage[],
    params: Record<string, unknown> = {},
    ctxOverrides: Partial<ActionContext> = {}
  ) {
    seedApp();
    const { project } = await createProject();
    const fake = fakeClient({ messages });
    const ctx = makeCtx({ client: fake.client, messageId: 'om_digest_cmd', ...ctxOverrides });
    const res = await getAction('digest_chat')!.run(params, ctx);
    return { ...fake, ctx, res, project };
  }

  it('抽出来的每条都落库、标成 chat_digest，正文带「群聊摘要」标记', async () => {
    // 标记是**必须**的：日志表里模型写的话和用户的原话并排放着，
    // 分不出来的话整张表就不能当证据用了。069 不加表格列（老项目的表没有那一列，
    // 写未知字段名会让整批同步失败），所以标记只能写在正文里。
    digestReturns(['李四说客户要求把 logo 改大', '王五说设备周三到']);
    const { res, project } = await digest([
      rawText('客户要求把 logo 改大', { name: '李四', ms: T('10:00') }),
      rawText('设备周三到', { name: '王五', ms: T('11:00') }),
    ]);

    const rows = store.listRecords(project.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.origin).toBe('chat_digest');
      expect(r.content).toContain('【群聊摘要');
      // source_text 留空：这条不是谁的原话，没有可对账的东西。
      // 塞进 200 条群聊只会让日志表变成聊天记录的副本。
      expect(r.source_text).toBe('');
      // 记录人是**发指令的人**，不是模型 —— 出了问题该找他核对。
      expect(r.author_open_id).toBe('ou_sender');
    }
    expect(res.summary).toContain('logo 改大');
    expect(res.data?.item_count).toBe(2);
  });

  it('回帖里明说这几条是**归纳**的，不是原话', async () => {
    // 表里那行只有一个前缀，而群里这条回帖是当事人**唯一**会看的一眼 ——
    // 写错了当场就能纠正，错过这一眼那句话就永久留在日志里了。
    digestReturns(['李四说客户要求把 logo 改大']);
    const { res } = await digest([rawText('客户要求把 logo 改大', { name: '李四' })]);
    expect(res.summary).toMatch(/归纳|不是谁的原话/);
  });

  it('一条指令写多行，幂等键要错开 —— 飞书重投时不能只剩一条', async () => {
    // (message_id, step_index) 是幂等键，而这里一条指令要写 N 行。
    // 不错开 step_index 的话，第 2..N 条各自撞上第 1 条的键被判成重复丢掉：
    // 表里只剩一条，而回帖说「已记 3 条」。
    digestReturns(['甲', '乙', '丙']);
    const { project } = await digest([rawText('三件事', { name: '李四' })]);
    const rows = store.listRecords(project.id);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.step_index)).size).toBe(3);
  });

  it('飞书重投同一条指令时不再写第二遍，也不谎称又记了几条', async () => {
    digestReturns(['李四说客户要求把 logo 改大']);
    seedApp();
    const { project } = await createProject();
    const msgs = [rawText('客户要求把 logo 改大', { name: '李四' })];
    const ctx1 = makeCtx({ client: fakeClient({ messages: msgs }).client, messageId: 'om_same' });
    await getAction('digest_chat')!.run({}, ctx1);
    const ctx2 = makeCtx({ client: fakeClient({ messages: msgs }).client, messageId: 'om_same' });
    const again = await getAction('digest_chat')!.run({}, ctx2);

    expect(store.listRecords(project.id)).toHaveLength(1);
    expect(again.summary).toContain('已经记过了');
    expect(again.data?.duplicate).toBe(true);
  });

  it('模型返回空数组是正常结果，且要说清「读了多少条」', async () => {
    // 群里聊一天闲天很常见，digest.ts 的 prompt 明确鼓励返回空数组（宁可不记也不编）。
    // 但这条回帖必须和「一条消息都没读到」区分开 —— 两者用户能做的事不一样。
    digestReturns([]);
    const { res, project } = await digest([
      rawText('中午吃什么', { name: '李四' }),
      rawText('随便', { name: '王五' }),
    ]);
    expect(store.listRecords(project.id)).toHaveLength(0);
    expect(res.summary).toContain('读了 2 条');
    expect(res.summary).toMatch(/没挑出/);
    expect(res.data?.item_count).toBe(0);
  });

  it('一条消息都没读到时**不花 AI 额度**，并说清跳过了什么', async () => {
    // 「今天群里没什么可记的」在"真没人说话"和"全是图片我读不了"两种情况下
    // 是同一句话，而处置完全不同（后者用户可以自己补一句「记一下……」）。
    const { res } = await digest([
      { message_id: 'om_img', msg_type: 'image', create_time: String(T('10:00')), sender: { id: 'ou_a', sender_type: 'user' }, body: { content: '{}' } },
      rawText('收到', { name: '李四' }),
    ]);
    expect(llm.calls).toHaveLength(0);
    expect(res.summary).toContain('1 条图片');
    expect(res.summary).toMatch(/1 条「收到」/);
  });

  it('助理自己的回帖和 @ 助理的指令都不进摘要（否则它开始总结自己）', async () => {
    // 不滤的话摘要会写「助理确认任务已创建」—— 那是我们自己制造的信息，
    // 不是群里发生的事，却会以「今天的进展」的身份落进日志表。
    digestReturns(['李四说客户要求把 logo 改大']);
    const BOT = 'ou_bot';
    const { res } = await digest(
      [
        rawText('✅ 任务已创建', { sender: BOT, type: 'app', name: '助理' }),
        rawText('@_user_1 记一下客户要改 logo', {
          name: '李四',
          mentions: [{ key: '@_user_1', name: '助理', id: BOT }],
        }),
        rawText('客户要求把 logo 改大', { name: '李四' }),
      ],
      {},
      { botOpenId: BOT }
    );
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed).not.toContain('任务已创建');
    expect(fed).not.toContain('记一下客户要改 logo');
    expect(fed).toContain('客户要求把 logo 改大');
    expect(res.summary).toContain('1 条 @ 我的指令');
    expect(res.summary).toContain('1 条机器人消息');
  });

  it('@ 占位符还原成真名（不还原摘要里会写「@_user_1 说要改 logo」）', async () => {
    digestReturns(['王五说 logo 交给张三']);
    await digest([
      rawText('logo 交给 @_user_1 做', {
        name: '王五',
        mentions: [{ key: '@_user_1', name: '张三', id: 'ou_zhangsan' }],
      }),
    ]);
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed).toContain('@张三');
    expect(fed).not.toContain('@_user_1');
  });

  it('撤回的消息不进摘要（原样喂进去，摘要里会出现一句英文提示）', async () => {
    digestReturns([]);
    const { res } = await digest([
      rawText('This message was recalled', { name: '李四', deleted: true }),
      rawText('客户要求把 logo 改大', { name: '李四' }),
    ]);
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed).not.toContain('recalled');
    expect(res.summary).toContain('1 条已撤回');
  });

  it('富文本（会议纪要那种）也要读 —— 群里最值得记的往往就是它', async () => {
    // 只认 text 的话，摘要会漏掉一整天里唯一有信息量的那条消息，
    // 同时报告「今天没什么可记的」。
    digestReturns(['李四发了周三评审的会议纪要']);
    await digest([
      {
        message_id: 'om_post',
        msg_type: 'post',
        create_time: String(T('14:00')),
        sender: { id: 'ou_lisi', sender_type: 'user', sender_name: '李四' },
        body: {
          content: JSON.stringify({
            title: '周三评审纪要',
            content: [[{ tag: 'text', text: '方案 B 通过' }], [{ tag: 'img', image_key: 'x' }, { tag: 'text', text: '下周一交片' }]],
          }),
        },
      },
    ]);
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed).toContain('周三评审纪要');
    expect(fed).toContain('方案 B 通过');
    expect(fed).toContain('下周一交片');
  });

  it('读消息传给飞书的是**秒**，而返回的时间按毫秒解析', async () => {
    // 这个接口两侧单位不一致（参数秒 / 返回毫秒）。传毫秒进去的后果不是报错，
    // 是范围落在几万年以后 —— 一条消息都读不到，而回帖说「今天没什么可记的」。
    digestReturns([]);
    const { calls } = await digest([rawText('随便说一句', { ms: T('10:00') })]);
    const p = calls.messageList[0].params;
    expect(p.container_id_type).toBe('chat');
    expect(p.container_id).toBe(CHAT_ID);
    // 今天 0 点，按秒。
    expect(Number(p.start_time)).toBe(Date.parse('2026-08-10T00:00:00+08:00') / 1000);
    expect(String(p.start_time)).not.toContain('000000');
    // 喂给模型的行里带的是能看懂的时间，说明毫秒解析没错。
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed).toContain('10:00');
  });

  it('读满上限时丢掉的是**最早**那批，并且如实说出来', async () => {
    // 倒着翻页的理由就在这里：正着翻的话一个刷了 800 条的群，读到的是**最早**
    // 那 500 条 —— 摘要里全是上午的闲聊，下午定的方案一条都没有，
    // 而回帖只说「更早的没读进来」，意思正好相反。
    digestReturns(['随便一条']);
    const many: RawMessage[] = [];
    // 倒序给（真接口也是倒序返回）：第 0 条是最新的。
    for (let i = 0; i < 620; i += 1) {
      many.push(rawText(`第${i}句`, { id: `om_m${i}`, ms: T('10:00') - i * 1000 }));
    }
    const { res } = await digest(many);
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    // 最新的（第 0 句）在，最早的（第 619 句）不在。
    expect(fed).toContain('第0句');
    expect(fed).not.toContain('第619句');
    expect(res.summary).toMatch(/消息太多/);
    expect(res.data?.truncated).toBe(true);
  });

  it('喂给模型的行是**正序**的（倒着读因果关系是反的）', async () => {
    digestReturns([]);
    await digest([
      rawText('那就按这个来', { name: '王五', ms: T('11:00') }),
      rawText('用方案 B 吧', { name: '李四', ms: T('10:00') }),
    ]);
    const fed = String((llm.calls[0]?.req as any).messages[1].content);
    expect(fed.indexOf('用方案 B 吧')).toBeLessThan(fed.indexOf('那就按这个来'));
  });

  it('同一段时间总结第二次时说清「第 2 份」，但**不拦**', async () => {
    // 上午总结过、下午又聊了两小时是常态，拦掉等于让下午的事永远进不了日志。
    // 但不说的话，日志里会出现几条内容七成重合的摘要，看表的人会以为
    // 群里真的把同一件事讨论了好几轮。
    digestReturns(['甲', '乙']);
    seedApp();
    const { project } = await createProject();
    const run = async (messageId: string, text: string) => {
      const fake = fakeClient({ messages: [rawText(text, { name: '李四' })] });
      return getAction('digest_chat')!.run({}, makeCtx({ client: fake.client, messageId }));
    };
    await run('om_first', '上午的事');
    digestReturns(['丙']);
    const second = await run('om_second', '下午的事');

    expect(second.summary).toContain('第 2 份');
    // 三条都在（2 + 1），第二次没被拦掉。
    expect(store.listRecords(project.id)).toHaveLength(3);
  });

  it('时间范围超过 3 天时**明说做不到**并指向复盘，不静默降级成「今天」', async () => {
    // 静默按今天办的后果：用户要的是「这个月」，拿到一份只覆盖今天的摘要，
    // 却写着「已记入日志」—— 而那几条会永久留在表里。
    seedApp();
    await createProject();
    const run = async (params: Record<string, unknown>) => {
      const fake = fakeClient({ messages: [rawText('随便')] });
      const res = await getAction('digest_chat')!.run(params, makeCtx({ client: fake.client }));
      return { fake, res };
    };

    const forMonth = await run({ range: 'this_month' });
    expect(forMonth.res.summary).toMatch(/最多读 3 天/);
    expect(forMonth.res.summary).toContain('复盘');
    // 一次接口都不调、一次额度都不花：范围不合法时**没有任何降级路径**。
    expect(llm.calls).toHaveLength(0);
    expect(forMonth.fake.calls.messageList).toHaveLength(0);

    const forTen = await run({ range: 'recent_days', days: 10 });
    expect(forTen.res.summary).toMatch(/最多读 3 天/);
    expect(forTen.fake.calls.messageList).toHaveLength(0);
  });

  it('没绑项目的群里指向「先建项目」，一次接口都不调', async () => {
    seedApp();
    const fake = fakeClient({ messages: [rawText('随便')] });
    const res = await getAction('digest_chat')!.run(
      {},
      makeCtx({ client: fake.client, chatId: 'oc_nowhere' })
    );
    expect(res.summary).toContain('新建项目');
    expect(fake.calls.messageList).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('读不到消息时**抛**，不降级成「今天没什么可记的」', async () => {
    // 那句降级看起来完全正常，而实际是缺权限。抛出去才能被 feishuError.ts
    // 翻译成「缺哪个权限 + 一键申请链接」。
    seedApp();
    await createProject();
    const fake = fakeClient({ failMessageList: true });
    await expect(
      getAction('digest_chat')!.run({}, makeCtx({ client: fake.client }))
    ).rejects.toThrow(/group_msg/);
  });

  it('同步到多维表格失败只带一句 warning，记录照样在库里', async () => {
    digestReturns(['李四说客户要求把 logo 改大']);
    seedApp();
    const { project } = await createProject();
    const fake = fakeClient({
      messages: [rawText('客户要求把 logo 改大', { name: '李四' })],
      failBatchCreate: true,
    });
    const res = await getAction('digest_chat')!.run({}, makeCtx({ client: fake.client }));
    expect(store.listRecords(project.id)).toHaveLength(1);
    expect(res.summary).toMatch(/还没同步/);
  });

  it('额度记在绑应用的平台账号上，用的是 fast 档', async () => {
    digestReturns(['一条']);
    await digest([rawText('随便说一句')]);
    const opts = llm.calls[0].opts;
    expect(opts.userId).toBe('user-1');
    expect(opts.source).toBe('feishu');
    expect(opts.operation).toBe('diary_chat_digest');
    expect(opts.tier).toBe('fast');
  });

  it('统计里摘要单独计数，不混进「用户记了多少条」', async () => {
    // 混在一个 record_count 里的话，40 条记录读起来像 40 条一手事实，
    // 而其中 30 条可能是自动生成的。
    digestReturns(['甲', '乙']);
    const { project } = await digest([rawText('两件事', { name: '李四' })]);
    seedRecord(project.id, { content: '这是人手记的' });
    const stats = store.projectStats(APP_ID)[project.id];
    expect(stats.record_count).toBe(3);
    expect(stats.digest_count).toBe(2);
  });
});

// ==================== 项目现状快照（req 6 的多轮那一半）====================

describe('buildDiaryContext', () => {
  it('没绑项目的群拿到一份空快照，而不是抛错', async () => {
    // 「没绑项目」是常态，不是错误：绝大多数群一开始都没绑。
    const ctx = buildDiaryContext(APP_ID, 'oc_nowhere');
    expect(ctx.projectName).toBeNull();
    expect(ctx.tasks).toEqual([]);
    expect(ctx.records).toEqual([]);
    expect(renderDiaryContext(ctx)).toBe('');
  });

  it('只列未完成的任务，已完成/已取消的只报个数', async () => {
    // 已关闭任务的**内容**对选动作没有帮助，但**个数**有：它让模型知道
    // 用户说的那个任务可能在没列出来的那批里，从而不会回「没有这个任务」。
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary: '在办的活' }, ctx);
    await getAction('create_task')!.run(
      { summary: '做完的活', status: 'done' },
      makeCtx({ client: fakeClient().client, messageId: 'om_done' })
    );
    await getAction('create_task')!.run(
      { summary: '不做了的活', status: 'cancelled' },
      makeCtx({ client: fakeClient().client, messageId: 'om_cancel' })
    );

    const snap = buildDiaryContext(APP_ID, CHAT_ID);
    expect(snap.projectName).toBe(project.name);
    expect(snap.tasks.join('\n')).toContain('在办的活');
    expect(snap.tasks.join('\n')).not.toContain('做完的活');
    expect(snap.openTaskTotal).toBe(1);
    expect(snap.closedTaskCount).toBe(2);
  });

  it('任务行带负责人、起止、状态，起止只到天（分钟对模型没用，字符要每条付）', async () => {
    const { ctx } = await createProject();
    await getAction('create_task')!.run(
      {
        summary: '设计项目 logo',
        assignee: '李四',
        start: '2026-08-10T09:00:00+08:00',
        due: '2026-08-13T18:00:00+08:00',
        status: 'doing',
      },
      { ...ctx, mentions: [{ openId: 'ou_lisi', name: '李四' }] }
    );
    const line = buildDiaryContext(APP_ID, CHAT_ID).tasks[0];
    expect(line).toContain('设计项目 logo');
    expect(line).toContain('李四');
    expect(line).toContain('2026-08-10');
    expect(line).toContain('2026-08-13');
    expect(line).toContain('进行中');
    expect(line).not.toMatch(/\d{2}:\d{2}/);
  });

  it('缺开始时间的任务写「未定」而不是空着（空着读起来像没这一列）', async () => {
    const { ctx } = await createProject();
    await getAction('create_task')!.run(
      { summary: '交片', due: '2026-08-13T18:00:00+08:00' },
      ctx
    );
    expect(buildDiaryContext(APP_ID, CHAT_ID).tasks[0]).toContain('未定 → 2026-08-13');
  });

  it('记录取**最近**几条并按正序排（正序 LIMIT 会截掉最近那些）', async () => {
    const { project } = await createProject();
    const day = 86400_000;
    const base = Date.parse('2026-08-01T10:00:00+08:00');
    for (let i = 0; i < 8; i += 1) {
      seedRecord(project.id, { content: `第${i}条`, ms: base + i * day, messageId: `om_r${i}` });
    }
    const snap = buildDiaryContext(APP_ID, CHAT_ID);
    expect(snap.recordTotal).toBe(8);
    // 最近 5 条（3..7），且按时间正序 —— 读起来是事情发生的顺序。
    expect(snap.records).toHaveLength(5);
    expect(snap.records[0]).toContain('第3条');
    expect(snap.records[4]).toContain('第7条');
  });

  it('长记录截断成一行（用户会把整封邮件贴进来）', async () => {
    const { project } = await createProject();
    seedRecord(project.id, { content: `客户说\n${'很'.repeat(200)}长` });
    const line = buildDiaryContext(APP_ID, CHAT_ID).records[0];
    expect(line).not.toContain('\n');
    expect(line.length).toBeLessThan(80);
    expect(line).toContain('…');
  });

  it('别的群的项目不会串进来（一个群一个项目，快照也要按群隔离）', async () => {
    const a = await createProject('本群项目');
    await createProject('别的群项目', { chatId: 'oc_group002' });
    await getAction('create_task')!.run({ summary: '本群的活' }, a.ctx);
    await getAction('create_task')!.run(
      { summary: '别群的活' },
      makeCtx({ client: fakeClient().client, chatId: 'oc_group002', messageId: 'om_other' })
    );

    const snap = buildDiaryContext(APP_ID, CHAT_ID);
    expect(snap.projectName).toBe('本群项目');
    expect(snap.tasks.join('\n')).toContain('本群的活');
    expect(snap.tasks.join('\n')).not.toContain('别群的活');
  });

  it('没绑项目的群里派的活（project_id 为 NULL）不会出现在任何项目的快照里', async () => {
    await createProject();
    await getAction('create_task')!.run(
      { summary: '游离的活' },
      makeCtx({ client: fakeClient().client, chatId: 'oc_nowhere', messageId: 'om_free' })
    );
    expect(buildDiaryContext(APP_ID, CHAT_ID).tasks.join('\n')).not.toContain('游离的活');
  });
});

describe('注册表约束', () => {
  const DIARY = [
    'create_diary_project',
    'rename_diary_project',
    'list_diary_projects',
    'add_diary_record',
    'review_diary',
    'digest_chat',
  ];

  it('每个动作都注册了，且都声明了飞书权限点', () => {
    for (const name of DIARY) {
      const a = getAction(name)!;
      expect(a).toBeTruthy();
      expect(a.scopes.length).toBeGreaterThan(0);
      expect(a.examples.length).toBeGreaterThan(0);
    }
    // list 的例句必须覆盖「找链接」这个说法 —— 那是它存在的理由，
    // 而用户嘴里说出来的往往是「表格链接发一下」而不是「项目列表」。
    expect(getAction('list_diary_projects')!.examples.join(' ')).toMatch(/链接/);
    // 建表要 bitable:app，收链接分享 + 授权给群要 drive:drive。
    expect(getAction('create_diary_project')!.scopes).toEqual(
      expect.arrayContaining(['bitable:app', 'drive:drive'])
    );
  });

  it('参数里不出现任何 id / token —— 模型一看到就会往里编', () => {
    // chat_id 来自事件本身，app_token / table_id / record_id 全部由 project 反查。
    // 编一个出来的后果不是报错，是记录进了别的项目而回帖说「已记录」。
    for (const name of DIARY) {
      const a = getAction(name)!;
      for (const [key, doc] of Object.entries(a.params)) {
        expect(key).not.toMatch(/chat_id|app_token|table_id|record_id|_id$/);
        expect(doc).not.toMatch(/app_token|table_id|record_id|oc_[a-z]/);
      }
    }
  });

  it('range 参数只让模型给枚举值，且明确禁止输出日期', () => {
    // 让它直接给起止时间的后果不是报错 —— 是一份写着「本周」、实际取了上周记录的复盘。
    const doc = getAction('review_diary')!.params.range;
    for (const key of RANGE_KEYS) expect(doc).toContain(key);
    expect(doc).toMatch(/不要输出具体日期|由系统计算/);
  });

  it('记录动作的参数说明要求原样照抄，并和 create_task 划清界限', () => {
    const a = getAction('add_diary_record')!;
    expect(a.params.content).toMatch(/原样照抄/);
    // 「记一下明天要交片」听起来很像待办 —— 这是三个动作里最容易被误选的一处。
    expect(a.description).toContain('create_task');
  });

  it('list 和 review 的分工写进了描述里（一个给链接、一个看内容）', () => {
    // 「项目总表在哪」被误选成 review_diary 的话，用户拿到的是一份总结，
    // 而他要的是个链接 —— 而且白花了一次归纳的额度。
    const a = getAction('list_diary_projects')!;
    expect(a.description).toContain('review_diary');
    expect(a.description).toMatch(/不看日志内容|不看内容/);
  });

  it('改名紧挨着建项目（隔远了会被误选成「新建」，而那条路只会回「本群已有项目」）', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(names.indexOf('rename_diary_project') - names.indexOf('create_diary_project')).toBe(1);
    // 而且它自己要说清「这只改名字」，以及和 create / update_task 的分界。
    const a = getAction('rename_diary_project')!;
    expect(a.description).toContain('create_diary_project');
    expect(a.description).toContain('update_task');
  });

  it('复盘和总结群聊互相点名（串了之后用户拿到的东西是反的）', () => {
    // 「总结一下」绝大多数时候要的是复盘，所以复盘排在前面；
    // 但光靠顺序不够 —— 位置只改变"先看到谁"，规则才说明"为什么不是那个"。
    const names = ACTIONS.map((a) => a.name);
    expect(names.indexOf('digest_chat') - names.indexOf('review_diary')).toBe(1);
    expect(getAction('digest_chat')!.description).toContain('review_diary');
    // 分界线是「读的是什么」：一个读群聊原话，一个读已经落库的日志。
    expect(getAction('digest_chat')!.description).toMatch(/群聊|聊天记录/);
  });

  it('总结群聊的范围参数只给三个能读完的窗口，不给 all / this_month', () => {
    // 允许长范围的后果不是报错 —— 是读了 500 条、用了最后 200 条，
    // 产出一份写着「本月」实际只覆盖最后半天的摘要，而它会落进日志表。
    const doc = getAction('digest_chat')!.params.range;
    expect(doc).toContain('today');
    expect(doc).not.toContain('this_month');
    expect(doc).not.toMatch(/\ball\b/);
    expect(doc).toMatch(/不要输出具体日期|由系统计算/);
  });

  it('读群聊的权限**不进**必需清单（那是最难批的一档，而这功能是可选的）', () => {
    // 混进去的后果：每个人的接入流程都卡在一项大部分人用不到的权限上。
    // 但也不能凭空消失 —— 必须作为可选权限单独列出来并说清「开了能干什么」，
    // 否则「总结群聊」在所有人那里都缺权限，而没人知道要去开。
    expect(allRequiredScopes()).not.toContain('im:message.group_msg');
    const groups = optionalScopeGroups();
    expect(groups.flatMap((g) => g.scopes)).toContain('im:message.group_msg');
    expect(groups.map((g) => g.feature).join(' ')).toMatch(/群聊/);
    // 权限点仍然声明在动作上（删掉的话后台就没法说它属于哪个功能）。
    expect(getAction('digest_chat')!.scopes).toContain('im:message.group_msg');
  });

  it('日记动作紧挨着，且整块排在任务动作之前（模型顺着读，先撞上谁就选谁）', () => {
    const names = ACTIONS.map((a) => a.name);
    const idx = DIARY.map((n) => names.indexOf(n));
    // 挨在一起：中间夹一个任务动作，「记一下」就会被误选成建任务。
    expect(Math.max(...idx) - Math.min(...idx)).toBe(DIARY.length - 1);
    // 排在任务之前。这一条是为「添加新项目，XX 纪录片」→「✅ 任务已创建」那个
    // 事故加的：日记块原先在末尾（9-12 位）、create_task 在第 3 位，模型顺着读
    // 先撞上 create_task 就停了。反了的话回帖是一句看着像成功的谎。
    const tasks = ['create_task', 'update_task'].map((n) => names.indexOf(n));
    expect(Math.max(...idx)).toBeLessThan(Math.min(...tasks));
  });

  it('「看任务」排在复盘后面（「进度怎么样」两个都说得通，而多数时候要的是复盘）', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(names.indexOf('list_tasks')).toBeGreaterThan(names.indexOf('review_diary'));
    // 光靠顺序不够：它自己要点名说清「我看的是任务，不是日志」。
    expect(getAction('list_tasks')!.description).toContain('review_diary');
  });
});

// ==================== 从任务表读回（070）====================
//
// 这一组是「表格就是数据源」兑现的地方，守的三件事都属于「出错时会伪装成成功」：
//   1. 读失败回「没有在办任务」—— 一句语法正常的好消息，而真相是权限掉了；
//   2. 有人手加了个进展选项（「待验收」），那条活在清单里凭空消失；
//   3. 读满上限只列了一部分，而回帖看着像「一共就这些」。

describe('list_tasks 从任务表读回', () => {
  /** 建项目 + 派一个活，返回那张任务管理表的 id。 */
  async function seed(summary = '设计项目 logo', extra: Record<string, unknown> = {}) {
    const { ctx, project } = await createProject();
    await getAction('create_task')!.run({ summary, ...extra }, ctx);
    const fresh = store.getProjectById(project.id)!;
    return { project: fresh, tableId: fresh.task_base_table_id };
  }

  it('群成员在表里改了进展，助理读到的就是改过的那个（这就是"同步"）', async () => {
    // 用户要的「和飞书状态同步」靠的不是双向写，是**只有一份数据**。
    const { tableId } = await seed();
    editRow(tableId, '设计项目 logo', { 进展: '进行中', 最新进展记录: '初稿出了' });

    const fake = fakeClient();
    const res = await getAction('list_tasks')!.run({}, makeCtx({ client: fake.client }));

    expect(res.summary).toContain('设计项目 logo');
    expect(res.summary).toContain('进行中');
    expect(res.summary).toContain('初稿出了');
  });

  it('表里标成已完成的不再算在办（库里那份压根不参与判断）', async () => {
    const { tableId } = await seed();
    editRow(tableId, '设计项目 logo', { 进展: '已完成' });

    const fake = fakeClient();
    const res = await getAction('list_tasks')!.run({}, makeCtx({ client: fake.client }));

    expect(res.summary).toMatch(/没有在办任务/);
    // 但要说清「表里其实有一条，只是做完了」—— 否则用户以为活丢了。
    expect(res.summary).toContain('1 条');
    // 而库里那条还是 todo：这正是为什么判断不能问库。
    const rows = store.findTasksByKeyword({ appId: APP_ID, senderOpenId: 'ou_sender' });
    expect(rows[0].status).toBe('todo');
  });

  it('**读失败必须报错，绝不能回「没有在办任务」**', async () => {
    // 这是这一整片改动里最容易犯、后果最像成功的错：权限掉了 / 接口挂了 /
    // 表被删了，降级成空列表的话回帖是一句好消息，用户以为活都干完了。
    await seed();
    const fake = fakeClient({ failRecordSearch: true });
    await expect(
      getAction('list_tasks')!.run({}, makeCtx({ client: fake.client }))
    ).rejects.toThrow();
  });

  it('有人自己加了个进展选项时，那条活仍然算在办，并照他写的字显示', async () => {
    // 单选列的选项在飞书界面上能随手加。归成"不在办"等于这条活凭空消失，
    // 而按 statusLabel 兜底显示成「待开始」等于替他改答案。
    const { tableId } = await seed();
    editRow(tableId, '设计项目 logo', { 进展: '待验收' });

    const fake = fakeClient();
    const res = await getAction('list_tasks')!.run({}, makeCtx({ client: fake.client }));

    expect(res.summary).toContain('设计项目 logo');
    expect(res.summary).toContain('待验收');
    expect(res.summary).not.toContain('待开始');
  });

  it('只看某个人的活时，名字查不到要抛错，不能退化成列出所有人的', async () => {
    // 退化的后果：他问「李四手上有什么」，拿到一屏所有人的活，
    // 而回帖里没有任何地方说过「我没找到李四」。
    const { tableId } = await seed();
    putRow(tableId, { 任务描述: '别人的活', 任务执行人: [{ id: 'ou_other', name: '王五' }], 进展: '进行中' });

    const fake = fakeClient();
    await expect(
      getAction('list_tasks')!.run({ owner: '李四' }, makeCtx({ client: fake.client }))
    ).rejects.toThrow();

    // 名字能查到时按 open_id 过滤（不是按名字模糊匹配）。
    const res = await getAction('list_tasks')!.run(
      { mine: true },
      makeCtx({ client: fakeClient().client })
    );
    expect(res.summary).toContain('设计项目 logo');
    expect(res.summary).not.toContain('别人的活');
  });

  it('行数超过读取上限时必须说「清单可能不全」', async () => {
    // 「只读到前 300 条」和「一共就这些」在回帖里完全同形。
    const { tableId } = await seed();
    for (let i = 0; i < 320; i += 1) {
      putRow(tableId, { 任务描述: `活 ${i}`, 进展: '进行中' });
    }
    const fake = fakeClient();
    const res = await getAction('list_tasks')!.run({}, makeCtx({ client: fake.client }));
    expect(res.summary).toMatch(/可能不全/);
  });
});
