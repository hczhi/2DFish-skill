import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';
import { ACTIONS, getAction, allRequiredScopes } from './index.js';
import { strList, type ActionContext } from './types.js';
import { toTaskTimestamp, toEventTimestamp, parseIso, fmtForHuman } from './time.js';
import { replaceDirectory } from '../directory/store.js';

// 动作层测两类东西：
//   1. 时间戳单位 —— 任务要毫秒、日程要秒，写反了不会报错，只会把日程排到 1970 年；
//   2. open_id 的来源约束 —— LLM 会编 ou_xxx，把消息发给错误的人是不可接受的。
//      加名册（migration 057）之后来源变成两个：mentions[] 和本地名册，
//      两者都不经过模型。这一层的测试守的就是「除此之外的 open_id 一律进不来」，
//      以及歧义（同名、离职、查不到）**绝不自动挑一个**。

const APP_ID = 'cli_test001';

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_directory_users').run();
  db.prepare('DELETE FROM feishu_directory_departments').run();
  // 改/删动作靠这张表反查 guid / event_id（见 recent.ts），所以每个用例都要清干净。
  db.prepare('DELETE FROM feishu_commands').run();
});

/**
 * 伪造一条"助理之前建过东西"的执行日志，供改/删动作反查。
 *
 * 形状要和 dispatcher 落库那一段完全一致（`{summary, steps:[{action, ...data}]}`），
 * 否则测的就不是真实链路了。
 */
let seedSeq = 0;
function seedCommand(input: {
  action: string;
  data: Record<string, unknown>;
  summary?: string;
  senderOpenId?: string;
  appId?: string;
  status?: 'done' | 'failed';
  ageMs?: number;
}) {
  const id = `cmd_${Math.abs(Math.round(Number(process.hrtime.bigint() % 100000000n)))}_${seedSeq++}`;
  const createdAt = new Date(Date.now() - (input.ageMs ?? 1000)).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_commands
         (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
          text, action, status, result, created_at)
       VALUES (?, ?, 'u1', ?, 'oc_chat', 'group', ?, '张三', 'x', ?, ?, ?, ?)`
    )
    .run(
      id,
      input.appId ?? APP_ID,
      id,
      input.senderOpenId ?? 'ou_sender',
      input.action,
      input.status ?? 'done',
      JSON.stringify({
        summary: input.summary ?? '',
        steps: [{ action: input.action, summary: input.summary ?? '', ...input.data }],
      }),
      createdAt
    );
  return id;
}

/** 往名册里塞几个人。source 用 contact（带部门），需要无部门场景时单独传。 */
function seedDirectory(
  users: Array<{
    openId: string;
    name: string;
    dept?: string;
    deptIds?: string[];
    title?: string;
    resigned?: boolean;
  }>,
  departments: Array<{ id: string; name: string; parent?: string }> = []
) {
  replaceDirectory(
    APP_ID,
    users.map((u) => ({
      openId: u.openId,
      name: u.name,
      departmentIds: u.deptIds,
      departmentNames: u.dept ?? '',
      jobTitle: u.title ?? '',
      isResigned: u.resigned,
    })),
    departments.map((d) => ({
      department_id: d.id,
      name: d.name,
      parent_id: d.parent ?? '0',
      member_count: null,
    }))
  );
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    client: {} as Client,
    appId: APP_ID,
    senderOpenId: 'ou_sender',
    senderName: '张三',
    chatId: 'oc_chat',
    chatType: 'group',
    messageId: 'om_msg_001',
    mentions: [],
    ...overrides,
  };
}

describe('时间戳单位', () => {
  it('任务 due 是毫秒，日程 start 是秒', () => {
    const ms = 1_800_000_000_000; // 2027-01-15 左右
    expect(toTaskTimestamp(ms)).toBe('1800000000000');
    expect(toEventTimestamp(ms)).toBe('1800000000');
    // 两者相差正好 1000 倍 —— 写反了日程会落到 1970 年。
    expect(Number(toTaskTimestamp(ms)) / Number(toEventTimestamp(ms))).toBe(1000);
  });

  it('parseIso 解析带时区偏移的 ISO 8601', () => {
    const ms = parseIso('2026-08-05T15:00:00+08:00', '开始时间');
    expect(new Date(ms).toISOString()).toBe('2026-08-05T07:00:00.000Z');
  });

  it('parseIso 对非法时间抛出可读原因（会回帖给用户）', () => {
    expect(() => parseIso('下周三下午', '开始时间')).toThrow(/开始时间/);
    expect(() => parseIso('下周三下午', '开始时间')).toThrow(/不是合法时间/);
  });

  it('fmtForHuman 固定用飞书租户时区，不跟随服务器本地时区', () => {
    // 2026-08-05T07:00:00Z = 北京时间 15:00
    const out = fmtForHuman(Date.parse('2026-08-05T07:00:00Z'));
    expect(out).toContain('15:00');
    expect(out).toContain('2026');
  });
});

describe('注册表', () => {
  it('动作名唯一，getAction 能取到每一个', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(getAction(name)?.name).toBe(name);
  });

  it('未知动作名返回 undefined（dispatcher 靠这个兜底）', () => {
    expect(getAction('drop_database')).toBeUndefined();
    expect(getAction('')).toBeUndefined();
  });

  it('每个动作都有描述、参数文档和例句 —— 这些直接进 LLM prompt', () => {
    for (const a of ACTIONS) {
      expect(a.description.length).toBeGreaterThan(0);
      expect(a.examples.length).toBeGreaterThan(0);
      // reply 不调飞书接口，所以允许零权限；其余动作必须声明权限点，
      // 否则接入指引里会漏项，用户到时候只能拿着 error code 猜。
      if (a.name !== 'reply') expect(a.scopes.length).toBeGreaterThan(0);
    }
  });

  it('改/删动作不向 LLM 暴露任何 id 参数 —— 它一看到就会往里编', () => {
    // guid / event_id / calendar_id 只能从执行日志反查（见 recent.ts）。
    // 参数说明会原样进 prompt，所以这里守的是"prompt 里根本没有这个概念"。
    for (const a of ACTIONS) {
      for (const [key, doc] of Object.entries(a.params)) {
        expect(key).not.toMatch(/guid|event_id|calendar_id|task_id/);
        expect(doc).not.toMatch(/guid|event_id|calendar_id/);
      }
    }
  });

  it('每个改/删动作都声明了对应的飞书权限点', () => {
    expect(getAction('update_task')!.scopes).toContain('task:task:write');
    expect(getAction('update_calendar_event')!.scopes).toContain('calendar:calendar.event:update');
    // 删除是独立权限点，只开 update 会撞一个 99991672。
    expect(getAction('delete_calendar_event')!.scopes).toContain('calendar:calendar.event:delete');
    // 两个动作都会先读一次（改时长 / 报出删的是哪一场），所以 read 也得在清单里。
    expect(allRequiredScopes()).toContain('calendar:calendar.event:read');
    expect(allRequiredScopes()).toContain('calendar:calendar.event:delete');
  });

  it('allRequiredScopes 含接收消息的事件权限（漏了就完全收不到 @）', () => {
    const scopes = allRequiredScopes();
    expect(scopes).toContain('im:message.group_at_msg:readonly');
    expect(scopes).toContain('im:message.p2p_msg:readonly');
    expect(scopes).toContain('task:task:write');
    // 名册同步的权限也要在总清单里 —— 少了它「私聊里指名同事」不成立，
    // 而这不属于任何单个动作，最容易在加动作时被忘掉。
    expect(scopes).toContain('contact:user.base:readonly');
    expect(scopes).toContain('im:chat:readonly');
    // 去重过
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

describe('strList 容错', () => {
  it('数组原样收下，去掉空白项', () => {
    expect(strList({ a: ['张三', ' ', '李四 '] }, 'a')).toEqual(['张三', '李四']);
  });

  it('单个字符串也收 —— 只有一个人时模型经常不给数组', () => {
    expect(strList({ a: '张三' }, 'a')).toEqual(['张三']);
  });

  it('逗号分隔（中英文顿号都算）拆开', () => {
    expect(strList({ a: '张三,李四，王五、赵六' }, 'a')).toEqual(['张三', '李四', '王五', '赵六']);
  });

  it('缺失/非字符串返回空数组，不抛', () => {
    expect(strList({}, 'a')).toEqual([]);
    expect(strList({ a: 42 }, 'a')).toEqual([]);
    expect(strList({ a: [1, '张三'] }, 'a')).toEqual(['张三']);
  });
});

describe('reply 动作', () => {
  it('不调任何飞书接口，原样回文案', async () => {
    const res = await getAction('reply')!.run({ text: '需要你 @ 一下对方' }, makeCtx());
    expect(res.summary).toBe('需要你 @ 一下对方');
  });

  it('缺 text 时抛出可读错误', async () => {
    await expect(getAction('reply')!.run({}, makeCtx())).rejects.toThrow();
  });
});

describe('send_message 的收件人约束', () => {
  const imClient = (create: ReturnType<typeof vi.fn>) =>
    ({ im: { message: { create } } }) as unknown as Client;

  it('LLM 编造的 open_id 一律拒绝（不在 mentions、名册也不按 id 查）', async () => {
    seedDirectory([{ openId: 'ou_zhangsan', name: '张三' }]);
    const ctx = makeCtx({ mentions: [{ openId: 'ou_zhangsan', name: '张三' }] });
    await expect(
      getAction('send_message')!.run({ to: 'ou_fabricated', text: '在吗' }, ctx)
    ).rejects.toThrow(/@ 一下/);
  });

  it('即使填的是发言人自己的 open_id，没 @ 也拒绝', async () => {
    const ctx = makeCtx({ mentions: [] });
    await expect(
      getAction('send_message')!.run({ to_open_id: 'ou_sender', text: 'hi' }, ctx)
    ).rejects.toThrow(/@ 一下/);
  });

  it('@ 到的人优先于名册 —— 事件自带的 open_id 比可能过期的名册更可信', async () => {
    // 名册里「张三」是另一个 open_id（比如同步之后有人离职换号）。
    seedDirectory([{ openId: 'ou_stale', name: '张三' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({
      mentions: [{ openId: 'ou_fresh', name: '张三' }],
      client: imClient(create),
    });

    const res = await getAction('send_message')!.run({ to: '张三', text: 'hi' }, ctx);

    expect(create.mock.calls[0][0].data.receive_id).toBe('ou_fresh');
    expect(res.data?.resolved_from).toBe('mention');
  });

  it('按姓名发送，并带幂等 uuid', async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({
      mentions: [{ openId: 'ou_zhangsan', name: '张三' }],
      client: imClient(create),
    });

    const res = await getAction('send_message')!.run({ to: '张三', text: '会议改到三点' }, ctx);

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg.params.receive_id_type).toBe('open_id');
    expect(arg.data.receive_id).toBe('ou_zhangsan');
    // 正文带上转达署名（发言人是「张三」），原话原样跟在后面。
    expect(JSON.parse(arg.data.content).text).toBe('张三 让我转告你：\n会议改到三点');
    // 幂等键：飞书重推时对方不会收到两遍。
    expect(arg.data.uuid).toContain('om_msg_001');
    expect(arg.data.uuid.length).toBeLessThanOrEqual(50);
    expect(res.summary).toContain('张三');
  });

  it('私聊里（没有任何 @）靠名册也能发出去 —— 这就是名册存在的理由', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四', dept: '销售部' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', mentions: [], client: imClient(create) });

    const res = await getAction('send_message')!.run({ to: '李四', text: '方案过了' }, ctx);

    expect(create.mock.calls[0][0].data.receive_id).toBe('ou_lisi');
    expect(res.data?.resolved_from).toBe('directory');
    // 来源要标出来：万一同名查错了，用户当场就能看见。
    expect(res.summary).toContain('通讯录');
  });

  it('名册里查不到时不发送，并提示可以 @ 一下', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const create = vi.fn();
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    await expect(
      getAction('send_message')!.run({ to: '王五', text: 'hi' }, ctx)
    ).rejects.toThrow(/没有找到「王五」/);
    expect(create).not.toHaveBeenCalled();
  });

  it('同名多个时**绝不挑一个**，把部门列出来让用户重说', async () => {
    seedDirectory([
      { openId: 'ou_a', name: '李四', dept: '销售部' },
      { openId: 'ou_b', name: '李四', dept: '技术部' },
    ]);
    const create = vi.fn();
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    const run = getAction('send_message')!.run({ to: '李四', text: 'hi' }, ctx);
    await expect(run).rejects.toThrow(/2 个叫「李四」/);
    await expect(run).rejects.toThrow(/销售部/);
    expect(create).not.toHaveBeenCalled();
  });

  it('离职的人明确说「已离职」，不能含糊成「找不到」', async () => {
    seedDirectory([{ openId: 'ou_gone', name: '赵六', resigned: true }]);
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(vi.fn()) });
    await expect(
      getAction('send_message')!.run({ to: '赵六', text: 'hi' }, ctx)
    ).rejects.toThrow(/离职/);
  });

  it('一人在职一人同名离职时，选在职那个', async () => {
    seedDirectory([
      { openId: 'ou_old', name: '钱七', resigned: true },
      { openId: 'ou_new', name: '钱七' },
    ]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    await getAction('send_message')!.run({ to: '钱七', text: 'hi' }, ctx);
    expect(create.mock.calls[0][0].data.receive_id).toBe('ou_new');
  });

  it('姓名里的空格/大小写差异不影响匹配（写入和查询共用归一化）', async () => {
    seedDirectory([{ openId: 'ou_tom', name: 'Tom Lee' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    await getAction('send_message')!.run({ to: 'tomlee', text: 'hi' }, ctx);
    expect(create.mock.calls[0][0].data.receive_id).toBe('ou_tom');
  });

  it('不做前缀/模糊匹配 —— 「张」不该命中「张三」', async () => {
    seedDirectory([{ openId: 'ou_zs', name: '张三' }]);
    const create = vi.fn();
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    await expect(getAction('send_message')!.run({ to: '张', text: 'hi' }, ctx)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('名册是按 app 隔离的 —— 别的应用的人查不到', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const create = vi.fn();
    const ctx = makeCtx({ appId: 'cli_other', chatType: 'p2p', client: imClient(create) });

    await expect(getAction('send_message')!.run({ to: '李四', text: 'hi' }, ctx)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('create_task', () => {
  function taskClient(create: ReturnType<typeof vi.fn>): Client {
    return { task: { v2: { task: { create } } } } as unknown as Client;
  }

  it('未指派时负责人是发言人自己', async () => {
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1', url: 'https://applink' } } });
    const ctx = makeCtx({ client: taskClient(create) });

    const res = await getAction('create_task')!.run({ summary: '写季度报告' }, ctx);

    const arg = create.mock.calls[0][0];
    expect(arg.data.members).toEqual([{ id: 'ou_sender', type: 'user', role: 'assignee' }]);
    // 没提截止时间就不该带 due，不能自己编一个。
    expect(arg.data.due).toBeUndefined();
    expect(arg.data.client_token).toContain('om_msg_001');
    // url 直接透传飞书返回的 applink，不自己拼域名。
    expect(res.summary).toContain('https://applink');
  });

  it('指派给 @ 到的人时负责人换成对方', async () => {
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({
      client: taskClient(create),
      mentions: [{ openId: 'ou_lisi', name: '李四' }],
    });

    const res = await getAction('create_task')!.run(
      { summary: '整理客户名单', assignee: '李四' },
      ctx
    );

    expect(create.mock.calls[0][0].data.members[0].id).toBe('ou_lisi');
    expect(res.summary).toContain('李四');
  });

  it('私聊里按名册指派给同事', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四', dept: '销售部' }]);
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({ client: taskClient(create), chatType: 'p2p', mentions: [] });

    const res = await getAction('create_task')!.run(
      { summary: '把合同发出来', assignee: '李四' },
      ctx
    );

    expect(create.mock.calls[0][0].data.members[0].id).toBe('ou_lisi');
    expect(res.data?.resolved_from).toBe('directory');
    expect(res.summary).toContain('通讯录');
  });

  it('指定的负责人解析不出来时**抛错**，不静默回落到发言人', async () => {
    // 这是本文件里最要紧的一条。回落的话「给李四建个任务」会变成
    // 一个建在自己头上的任务 —— 看起来成功了，用户要过几天才发现李四不知情。
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({ client: taskClient(create), mentions: [] });

    await expect(
      getAction('create_task')!.run({ summary: '随便一个任务', assignee: '李四' }, ctx)
    ).rejects.toThrow(/没有找到「李四」/);
    expect(create).not.toHaveBeenCalled();
  });

  it('LLM 编造的 assignee_open_id 也抛错（老参数名同样不放过）', async () => {
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({ client: taskClient(create), mentions: [] });

    await expect(
      getAction('create_task')!.run({ summary: 'x', assignee_open_id: 'ou_fabricated' }, ctx)
    ).rejects.toThrow(/@ 一下/);
    expect(create).not.toHaveBeenCalled();
  });

  it('due 按毫秒传给飞书', async () => {
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({ client: taskClient(create) });

    await getAction('create_task')!.run(
      { summary: '交报告', due: '2026-08-07T18:00:00+08:00' },
      ctx
    );

    const due = create.mock.calls[0][0].data.due;
    expect(due.timestamp).toBe(String(Date.parse('2026-08-07T18:00:00+08:00')));
    expect(due.is_all_day).toBe(false);
  });

  it('缺 summary 时抛出可读错误，不发请求', async () => {
    const create = vi.fn();
    const ctx = makeCtx({ client: taskClient(create) });
    await expect(getAction('create_task')!.run({}, ctx)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('create_calendar_event', () => {
  function calClient(parts: {
    primary?: ReturnType<typeof vi.fn>;
    createEvent?: ReturnType<typeof vi.fn>;
    addAttendee?: ReturnType<typeof vi.fn>;
  }) {
    return {
      calendar: {
        v4: {
          calendar: { primary: parts.primary ?? vi.fn() },
          calendarEvent: { create: parts.createEvent ?? vi.fn() },
          calendarEventAttendee: { create: parts.addAttendee ?? vi.fn() },
        },
      },
    } as unknown as Client;
  }

  const primaryOk = () =>
    vi.fn().mockResolvedValue({ data: { calendars: [{ calendar: { calendar_id: 'cal_bot' } }] } });

  it('start_time 用秒，缺 end 时默认加一小时', async () => {
    const createEvent = vi.fn().mockResolvedValue({
      data: { event: { event_id: 'ev1', app_link: 'https://applink/ev1' } },
    });
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({ client: calClient({ primary: primaryOk(), createEvent, addAttendee }) });

    const res = await getAction('create_calendar_event')!.run(
      { summary: '评审会', start: '2026-08-05T15:00:00+08:00' },
      ctx
    );

    const data = createEvent.mock.calls[0][0].data;
    const startSec = Date.parse('2026-08-05T15:00:00+08:00') / 1000;
    expect(data.start_time.timestamp).toBe(String(startSec));
    // 默认一小时。
    expect(Number(data.end_time.timestamp) - Number(data.start_time.timestamp)).toBe(3600);
    expect(res.summary).toContain('https://applink/ev1');
  });

  it('把发言人加成参与者（日程建在机器人日历上，人得被邀请进去）', async () => {
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({
      client: calClient({
        primary: primaryOk(),
        createEvent: vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1' } } }),
        addAttendee,
      }),
    });

    await getAction('create_calendar_event')!.run(
      { summary: '评审会', start: '2026-08-05T15:00:00+08:00' },
      ctx
    );

    const attendees = addAttendee.mock.calls[0][0].data.attendees;
    expect(attendees.map((a: any) => a.user_id)).toContain('ou_sender');
  });

  it('加参与者失败时不算整体失败 —— 日程已经建出来了，让用户重下指令会建出第二个', async () => {
    const ctx = makeCtx({
      client: calClient({
        primary: primaryOk(),
        createEvent: vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1' } } }),
        addAttendee: vi.fn().mockRejectedValue(new Error('没有 calendar:calendar 权限')),
      }),
    });

    const res = await getAction('create_calendar_event')!.run(
      { summary: '评审会', start: '2026-08-05T15:00:00+08:00' },
      ctx
    );

    // 不抛错，但要在回复里说清参与者没加上，否则用户以为对方会收到邀请。
    expect(res.summary).toContain('评审会');
    expect(res.summary).toMatch(/参与|邀请/);
  });

  it('缺 start 时抛出可读错误，不发请求', async () => {
    const createEvent = vi.fn();
    const ctx = makeCtx({ client: calClient({ primary: primaryOk(), createEvent }) });
    await expect(
      getAction('create_calendar_event')!.run({ summary: '评审会' }, ctx)
    ).rejects.toThrow();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('attendees 里的姓名按名册解析，和发言人一起进参与人（去重）', async () => {
    seedDirectory([
      { openId: 'ou_lisi', name: '李四' },
      { openId: 'ou_wangwu', name: '王五' },
    ]);
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({
      chatType: 'p2p',
      client: calClient({
        primary: primaryOk(),
        createEvent: vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1' } } }),
        addAttendee,
      }),
    });

    await getAction('create_calendar_event')!.run(
      { summary: '过方案', start: '2026-08-05T15:00:00+08:00', attendees: ['李四', '王五'] },
      ctx
    );

    const ids = addAttendee.mock.calls[0][0].data.attendees.map((a: { user_id: string }) => a.user_id);
    expect(ids).toEqual(['ou_sender', 'ou_lisi', 'ou_wangwu']);
  });

  it('attendees 和 mentions 重复时只算一个人', async () => {
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({
      mentions: [{ openId: 'ou_lisi', name: '李四' }],
      client: calClient({
        primary: primaryOk(),
        createEvent: vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1' } } }),
        addAttendee,
      }),
    });

    await getAction('create_calendar_event')!.run(
      { summary: '过方案', start: '2026-08-05T15:00:00+08:00', attendees: '李四' },
      ctx
    );

    const ids = addAttendee.mock.calls[0][0].data.attendees.map((a: { user_id: string }) => a.user_id);
    expect(ids).toEqual(['ou_sender', 'ou_lisi']);
  });

  it('attendees 解析失败时在**建日程之前**就抛错，不留下孤儿日程', async () => {
    const createEvent = vi.fn();
    const ctx = makeCtx({
      chatType: 'p2p',
      client: calClient({ primary: primaryOk(), createEvent }),
    });

    await expect(
      getAction('create_calendar_event')!.run(
        { summary: '过方案', start: '2026-08-05T15:00:00+08:00', attendees: ['查无此人'] },
        ctx
      )
    ).rejects.toThrow();
    // 关键：日程接口一次都没被调用。反过来的话用户会得到一个没人参加的
    // 日程 + 一句报错，还得自己去飞书里删。
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('query_freebusy', () => {
  const fbClient = (batch: ReturnType<typeof vi.fn>) =>
    ({ calendar: { v4: { freebusy: { batch } } } }) as unknown as Client;

  /** 2026-08-06 周四。用带偏移的 ISO 传参，和 LLM 实际输出的格式一致。 */
  const THU = '2026-08-06';
  const iso = (h: number, m = 0) =>
    `${THU}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`;

  const okBatch = (items: Array<{ start: number; end: number }>, userId = 'ou_lisi') =>
    vi.fn().mockResolvedValue({
      code: 0,
      data: {
        freebusy_lists: [
          {
            user_id: userId,
            freebusy_items: items.map((i) => ({ start_time: iso(i.start), end_time: iso(i.end) })),
          },
        ],
      },
    });

  it('回的是「什么时候有空」，不是「什么时候忙」', async () => {
    // 用户问的就是空闲。把忙区间原样列回去等于把减法退给他，而那是他提问的目的。
    seedDirectory([{ openId: 'ou_lisi', name: '李四', dept: '技术部' }]);
    const batch = okBatch([{ start: 10, end: 11 }]);
    const ctx = makeCtx({ chatType: 'p2p', client: fbClient(batch) });

    const res = await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0) },
      ctx
    );

    expect(res.summary).toContain('09:00-10:00');
    expect(res.summary).toContain('11:00-18:00');
    expect(res.summary).toContain('李四');
  });

  it('time_min/time_max 是 RFC 3339，不是日程接口那种 unix 秒', async () => {
    // 同一个 calendar 命名空间下两种时间格式，写反了飞书直接报参数错。
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const batch = okBatch([]);
    await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(batch) })
    );

    const data = batch.mock.calls[0][0].data;
    expect(data.time_min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(data.time_max).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(data.time_min).not.toMatch(/^\d{10}$/);
    // 窗口被裁到工作时间：查一整天时问的是 09:00-18:00，不是 00:00-23:59。
    expect(data.time_min).toContain('T09:00:00');
    expect(data.time_max).toContain('T18:00:00');
  });

  it('多个人一次 batch 调完，不是每人一个请求', async () => {
    seedDirectory([
      { openId: 'ou_lisi', name: '李四' },
      { openId: 'ou_wangwu', name: '王五' },
    ]);
    const batch = okBatch([]);
    await getAction('query_freebusy')!.run(
      { people: ['李四', '王五'], start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(batch) })
    );

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0].data.user_ids).toEqual(['ou_lisi', 'ou_wangwu']);
    expect(batch.mock.calls[0][0].params.user_id_type).toBe('open_id');
  });

  it('没点名谁就查发言人自己（「我明天有空吗」）', async () => {
    const batch = okBatch([], 'ou_sender');
    const res = await getAction('query_freebusy')!.run(
      { start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(batch) })
    );
    expect(batch.mock.calls[0][0].data.user_ids).toEqual(['ou_sender']);
    expect(res.summary).toContain('张三');
  });

  it('全天开会的人不能被报成有空', async () => {
    // 补集算反的后果就是这一条：用户按一个假的空闲去约会。
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const ctx = makeCtx({ chatType: 'p2p', client: fbClient(okBatch([{ start: 9, end: 18 }])) });

    const res = await getAction('query_freebusy')!.run({ people: ['李四'], start: iso(0) }, ctx);

    expect(res.summary).toContain('没有空档');
    expect(res.summary).not.toContain('全天有空');
  });

  it('飞书一个忙区间都没返回时要警告 —— 这和"真的全天空闲"同形', async () => {
    // 日历没对应用开放、或人不在可用范围里时，飞书不报错，只是返回空。
    // 不警告的话用户会拿一个查不到的结果当"他全天有空"。
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const ctx = makeCtx({ chatType: 'p2p', client: fbClient(okBatch([])) });

    const res = await getAction('query_freebusy')!.run({ people: ['李四'], start: iso(0) }, ctx);

    expect(res.summary).toContain('⚠️');
    expect(res.summary).toContain('日历');
    expect(res.data?.people).toMatchObject([{ no_busy_returned: true }]);
  });

  it('查不到人的忙闲也带上「可用范围」这条线索', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const res = await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(okBatch([])) })
    );
    expect(res.summary).toContain('可用范围');
  });

  it('姓名解析失败时不发请求 —— 查错人的忙闲会让用户按错时间约会', async () => {
    const batch = vi.fn();
    await expect(
      getAction('query_freebusy')!.run(
        { people: ['查无此人'], start: iso(0) },
        makeCtx({ chatType: 'p2p', client: fbClient(batch) })
      )
    ).rejects.toThrow();
    expect(batch).not.toHaveBeenCalled();
  });

  it('LLM 编造的 open_id 一样拒绝', async () => {
    const batch = vi.fn();
    await expect(
      getAction('query_freebusy')!.run(
        { people: ['ou_fabricated'], start: iso(0) },
        makeCtx({ chatType: 'p2p', client: fbClient(batch) })
      )
    ).rejects.toThrow(/@ 一下/);
    expect(batch).not.toHaveBeenCalled();
  });

  it('缺 start 时抛出可读错误', async () => {
    await expect(
      getAction('query_freebusy')!.run({ people: ['李四'] }, makeCtx({ chatType: 'p2p' }))
    ).rejects.toThrow(/哪段时间/);
  });

  it('整段落在周末时说明原因，不假装查了', async () => {
    const batch = vi.fn();
    const res = await getAction('query_freebusy')!.run(
      { start: '2026-08-08T00:00:00+08:00' }, // 周六
      makeCtx({ chatType: 'p2p', client: fbClient(batch) })
    );
    expect(batch).not.toHaveBeenCalled();
    expect(res.summary).toContain('工作日');
    expect(res.data?.no_window).toBe(true);
  });

  it('范围超过 7 天时截断，并在回帖里说清楚', async () => {
    // 静默截断会让用户以为问到的是两周，实际只看了一周。
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const res = await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0), end: '2026-08-27T18:00:00+08:00' },
      makeCtx({ chatType: 'p2p', client: fbClient(okBatch([])) })
    );
    expect(res.data?.truncated).toBe(true);
    expect(res.summary).toContain('7 天');
  });

  it('回帖里说明只能看忙闲、看不到日程内容', async () => {
    // 用户问的是「查他的日程」，期待看到会议标题。不说明会引来一轮追问。
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const res = await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(okBatch([{ start: 10, end: 11 }])) })
    );
    expect(res.summary).toMatch(/日程内容|看不到/);
  });

  it('名册匹配来的人要标来源 —— 同名查错时用户能立刻看出来', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四', dept: '技术部' }]);
    const res = await getAction('query_freebusy')!.run(
      { people: ['李四'], start: iso(0) },
      makeCtx({ chatType: 'p2p', client: fbClient(okBatch([{ start: 10, end: 11 }])) })
    );
    expect(res.summary).toContain('按通讯录姓名匹配');
    expect(res.data?.people).toMatchObject([{ resolved_from: 'directory' }]);
  });

  it('声明了忙闲权限点 —— 「读取日程信息」不覆盖它', async () => {
    expect(getAction('query_freebusy')!.scopes).toContain('calendar:calendar.free_busy:read');
    expect(allRequiredScopes()).toContain('calendar:calendar.free_busy:read');
  });
});

describe('send_message 的转达署名', () => {
  const imClient = (create: ReturnType<typeof vi.fn>) =>
    ({ im: { message: { create } } }) as unknown as Client;
  const sentText = (create: ReturnType<typeof vi.fn>) =>
    JSON.parse(create.mock.calls[0][0].data.content).text as string;

  // 消息是机器人发的，收件人看到的是机器人头像。少了署名，「明天的会议改到三点」
  // 就是一条没有主人的通知 —— 收件人不知道是谁改的、该找谁确认，
  // 也可能回复机器人（而机器人不会把回复转回给发起人）。

  it('正文前面加上「谁让我转告的」', async () => {
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '洪成智', client: imClient(create) });

    await getAction('send_message')!.run({ to: '滕佳伟', text: '要不要喝咖啡' }, ctx);

    expect(sentText(create)).toBe('洪成智 让我转告你：\n要不要喝咖啡');
  });

  it('署名和正文之间用换行 —— 原文可能是多行的', async () => {
    // 拼成同一行会把第二行之后的内容和署名割裂开。
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '洪成智', client: imClient(create) });

    await getAction('send_message')!.run(
      { to: '滕佳伟', text: '两件事：\n1. 会议改到三点\n2. 记得带方案' },
      ctx
    );

    const out = sentText(create);
    expect(out.startsWith('洪成智 让我转告你：\n')).toBe(true);
    expect(out).toContain('1. 会议改到三点');
    expect(out).toContain('2. 记得带方案');
  });

  it('原话一字不改 —— 署名只是加在前面', async () => {
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '洪成智', client: imClient(create) });

    await getAction('send_message')!.run({ to: '滕佳伟', text: '明天上午 10:00 前给我' }, ctx);
    expect(sentText(create).endsWith('明天上午 10:00 前给我')).toBe(true);
  });

  it('sender_name 是空的时候查名册补上', async () => {
    // 飞书事件里的 sender_name 偶尔就是空的。署名缺失会让收件人收到一条
    // 没有主人的通知，所以值得多查一次主键索引。
    seedDirectory([
      { openId: 'ou_teng', name: '滕佳伟' },
      { openId: 'ou_sender', name: '洪成智' },
    ]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '', client: imClient(create) });

    await getAction('send_message')!.run({ to: '滕佳伟', text: 'hi' }, ctx);
    expect(sentText(create)).toBe('洪成智 让我转告你：\nhi');
  });

  it('事件里的名字优先于名册 —— 名册是快照，可能过期', async () => {
    seedDirectory([
      { openId: 'ou_teng', name: '滕佳伟' },
      { openId: 'ou_sender', name: '旧名字' },
    ]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '新名字', client: imClient(create) });

    await getAction('send_message')!.run({ to: '滕佳伟', text: 'hi' }, ctx);
    expect(sentText(create)).toContain('新名字');
    expect(sentText(create)).not.toContain('旧名字');
  });

  it('两边都拿不到名字时不署名，也不写成「有人让我转告你」', async () => {
    // 匿名署名比没有署名更糟：收件人会以为是匿名消息或系统故障。
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({
      chatType: 'p2p',
      senderName: '',
      senderOpenId: 'ou_not_in_directory',
      client: imClient(create),
    });

    await getAction('send_message')!.run({ to: '滕佳伟', text: '要不要喝咖啡' }, ctx);

    const out = sentText(create);
    expect(out).toBe('要不要喝咖啡');
    expect(out).not.toContain('有人');
    expect(out).not.toContain('让我转告');
  });

  it('只有空白的 sender_name 视为没有名字', async () => {
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({
      chatType: 'p2p',
      senderName: '   ',
      senderOpenId: 'ou_not_in_directory',
      client: imClient(create),
    });

    await getAction('send_message')!.run({ to: '滕佳伟', text: 'hi' }, ctx);
    expect(sentText(create)).toBe('hi');
  });

  it('日志里存的是**实际发出去的**正文，含署名', async () => {
    // 对方说「收到的不对」时，要能拿日志和他的截图对上。
    seedDirectory([{ openId: 'ou_teng', name: '滕佳伟' }]);
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({ chatType: 'p2p', senderName: '洪成智', client: imClient(create) });

    const res = await getAction('send_message')!.run({ to: '滕佳伟', text: 'hi' }, ctx);
    expect(res.data?.sent_text).toBe(sentText(create));
    expect(res.data?.sent_text).toContain('洪成智');
  });

  it('prompt 里明确要求 LLM 不要自己加署名（否则会重复两遍）', () => {
    const doc = getAction('send_message')!.params.text;
    expect(doc).toMatch(/不要自己加|不要.*署名/);
    expect(doc).toContain('第一人称');
  });

  it('群里也署名 —— 转达关系和聊天类型无关', async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const ctx = makeCtx({
      chatType: 'group',
      senderName: '洪成智',
      mentions: [{ openId: 'ou_teng', name: '滕佳伟' }],
      client: imClient(create),
    });

    await getAction('send_message')!.run({ to: '滕佳伟', text: 'hi' }, ctx);
    expect(sentText(create)).toContain('洪成智 让我转告你');
  });
});

describe('按部门群发', () => {
  const imClient = (create: ReturnType<typeof vi.fn>) =>
    ({ im: { message: { create } } }) as unknown as Client;
  const okCreate = () => vi.fn().mockResolvedValue({ code: 0, data: {} });
  const recipients = (create: ReturnType<typeof vi.fn>) =>
    create.mock.calls.map((c) => c[0].data.receive_id as string);

  /** 事业部（od_bu）下挂两个组，人挂在子部门上 —— 真实组织架构的常见形状。 */
  function seedBu() {
    seedDirectory(
      [
        { openId: 'ou_a', name: '甲', deptIds: ['od_g1'], dept: '销赞云事业部 / 一组' },
        { openId: 'ou_b', name: '乙', deptIds: ['od_g1'], dept: '销赞云事业部 / 一组' },
        { openId: 'ou_c', name: '丙', deptIds: ['od_g2'], dept: '销赞云事业部 / 二组' },
        { openId: 'ou_boss', name: '丁', deptIds: ['od_bu'], dept: '销赞云事业部' },
        { openId: 'ou_out', name: '戊', deptIds: ['od_other'], dept: '财务部' },
      ],
      [
        { id: 'od_bu', name: '销赞云事业部' },
        { id: 'od_g1', name: '一组', parent: 'od_bu' },
        { id: 'od_g2', name: '二组', parent: 'od_bu' },
        { id: 'od_other', name: '财务部' },
      ]
    );
  }

  it('「给某事业部所有人发」把子部门里的人也算进去', async () => {
    // 事业部通常只是个容器，人挂在下面各个组上。只查本级会只发给几个领导，
    // 而用户以为整个部门都通知到了。
    seedBu();
    const create = okCreate();
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    const res = await getAction('send_message')!.run(
      { departments: ['销赞云事业部'], text: '周五九点半开会' },
      ctx
    );

    expect(recipients(create).sort()).toEqual(['ou_a', 'ou_b', 'ou_boss', 'ou_c']);
    // 别的部门的人一个都不能进来。
    expect(recipients(create)).not.toContain('ou_out');
    expect(res.summary).toContain('4 人');
    expect(res.summary).toContain('销赞云事业部');
  });

  it('群发时每个人一个幂等 uuid —— 共用一个会被飞书吞掉后面所有人', async () => {
    // 这条是本组里最阴的：共用 uuid 时接口全部返回成功，我们回帖「已通知 4 人」，
    // 实际只有第一个人收到。
    seedBu();
    const create = okCreate();
    await getAction('send_message')!.run(
      { departments: ['销赞云事业部'], text: 'hi' },
      makeCtx({ chatType: 'p2p', client: imClient(create) })
    );

    const uuids = create.mock.calls.map((c) => c[0].data.uuid as string);
    expect(new Set(uuids).size).toBe(uuids.length);
    for (const u of uuids) expect(u.length).toBeLessThanOrEqual(50);
  });

  it('同一条指令重放时每个人的 uuid 不变（重推不会收到两遍）', async () => {
    seedBu();
    const first = okCreate();
    const second = okCreate();
    const args = { departments: ['销赞云事业部'], text: 'hi' };
    await getAction('send_message')!.run(args, makeCtx({ chatType: 'p2p', client: imClient(first) }));
    await getAction('send_message')!.run(args, makeCtx({ chatType: 'p2p', client: imClient(second) }));

    const key = (c: ReturnType<typeof vi.fn>) =>
      c.mock.calls.map((x) => `${x[0].data.receive_id}=${x[0].data.uuid}`).sort();
    expect(key(first)).toEqual(key(second));
  });

  it('同一指令的不同步骤里 uuid 不同 —— 否则第二条消息被静默吞掉', async () => {
    seedDirectory([{ openId: 'ou_a', name: '甲' }]);
    const create = okCreate();
    const client = imClient(create);
    await getAction('send_message')!.run(
      { to: '甲', text: '第一件事' },
      makeCtx({ chatType: 'p2p', client, stepIndex: 0 })
    );
    await getAction('send_message')!.run(
      { to: '甲', text: '第二件事' },
      makeCtx({ chatType: 'p2p', client, stepIndex: 1 })
    );
    expect(create.mock.calls[0][0].data.uuid).not.toBe(create.mock.calls[1][0].data.uuid);
  });

  it('部门群发不发给发起人自己', async () => {
    // 他不需要收到一条自己让机器人转告的话，执行结果已经在会话里了。
    seedBu();
    const create = okCreate();
    const ctx = makeCtx({ chatType: 'p2p', senderOpenId: 'ou_a', client: imClient(create) });

    await getAction('send_message')!.run({ departments: ['销赞云事业部'], text: 'hi' }, ctx);
    expect(recipients(create)).not.toContain('ou_a');
    expect(recipients(create).sort()).toEqual(['ou_b', 'ou_boss', 'ou_c']);
  });

  it('但明确点自己的名字时照发 —— 那是他真的想发给自己', async () => {
    seedDirectory([{ openId: 'ou_me', name: '我自己' }]);
    const create = okCreate();
    const ctx = makeCtx({ chatType: 'p2p', senderOpenId: 'ou_me', client: imClient(create) });

    await getAction('send_message')!.run({ to: '我自己', text: '备忘' }, ctx);
    expect(recipients(create)).toEqual(['ou_me']);
  });

  it('部门 + 点名的人重复时只发一条', async () => {
    seedBu();
    const create = okCreate();
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    await getAction('send_message')!.run(
      { to: ['甲'], departments: ['销赞云事业部'], text: 'hi' },
      ctx
    );
    expect(recipients(create).filter((r) => r === 'ou_a')).toHaveLength(1);
  });

  it('离职的人不在群发名单里', async () => {
    // 算进去会撞一堆发送失败，而用户完全不知道那几个失败是正常的。
    seedDirectory(
      [
        { openId: 'ou_a', name: '甲', deptIds: ['od_s'] },
        { openId: 'ou_gone', name: '前员工', deptIds: ['od_s'], resigned: true },
      ],
      [{ id: 'od_s', name: '销售部' }]
    );
    const create = okCreate();
    await getAction('send_message')!.run(
      { departments: ['销售部'], text: 'hi' },
      makeCtx({ chatType: 'p2p', client: imClient(create) })
    );
    expect(recipients(create)).toEqual(['ou_a']);
  });

  it('部门名查不到时不发任何消息，并提示去看已同步的部门', async () => {
    seedBu();
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['不存在的部'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow(/没有找到叫「不存在的部」的部门/);
    expect(create).not.toHaveBeenCalled();
  });

  it('同名部门**绝不挑一个** —— 挑错就是群发给一批不相干的人', async () => {
    seedDirectory(
      [
        { openId: 'ou_a', name: '甲', deptIds: ['od_s1'] },
        { openId: 'ou_b', name: '乙', deptIds: ['od_s2'] },
      ],
      [
        { id: 'od_s1', name: '销售部', parent: 'od_north' },
        { id: 'od_s2', name: '销售部', parent: 'od_south' },
      ]
    );
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['销售部'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow(/2 个叫「销售部」的部门/);
    expect(create).not.toHaveBeenCalled();
  });

  it('部门名不做模糊匹配 —— 「销售部」不该命中「销售一部」', async () => {
    seedDirectory([{ openId: 'ou_a', name: '甲', deptIds: ['od_s1'] }], [
      { id: 'od_s1', name: '销售一部' },
    ]);
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['销售部'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('部门存在但一个人都没有时说清是同步问题，不是「查不到部门」', async () => {
    seedDirectory([], [{ id: 'od_empty', name: '空部门' }]);
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['空部门'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow(/没有成员/);
    expect(create).not.toHaveBeenCalled();
  });

  it('部门里只剩发起人自己时明确说明，不发空消息', async () => {
    seedDirectory([{ openId: 'ou_me', name: '我', deptIds: ['od_s'] }], [
      { id: 'od_s', name: '销售部' },
    ]);
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['销售部'], text: 'hi' },
        makeCtx({ chatType: 'p2p', senderOpenId: 'ou_me', client: imClient(create) })
      )
    ).rejects.toThrow(/只有你自己/);
    expect(create).not.toHaveBeenCalled();
  });

  it('超过群发上限时停下来让用户缩小范围，一条都不发', async () => {
    // 「给全公司发个消息」和「给销售部发个消息」在自然语言里长得一样，
    // 而消息发出去撤不回来。
    const many = Array.from({ length: 40 }, (_, i) => ({
      openId: `ou_${i}`,
      name: `员工${i}`,
      deptIds: ['od_all'],
    }));
    seedDirectory(many, [{ id: 'od_all', name: '全公司' }]);
    const create = vi.fn();

    await expect(
      getAction('send_message')!.run(
        { departments: ['全公司'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow(/40 人.*上限/s);
    expect(create).not.toHaveBeenCalled();
  });

  it('部分人发送失败时其余照发，并逐个点名没发到的人', async () => {
    // 可用范围（230013）是**逐人**生效的：同一次群发里有人成功有人失败很正常。
    // 中途 throw 会留下「发了一半、不知道发到谁」的状态。
    seedBu();
    const create = vi.fn().mockImplementation(async (arg: any) => {
      if (arg.data.receive_id === 'ou_c') {
        const e = new Error('Request failed with status code 400');
        (e as any).response = { data: { code: 230013, msg: 'Bot has NO availability' } };
        throw e;
      }
      return { code: 0, data: {} };
    });
    const ctx = makeCtx({ chatType: 'p2p', client: imClient(create) });

    const res = await getAction('send_message')!.run(
      { departments: ['销赞云事业部'], text: 'hi' },
      ctx
    );

    // 其余三个人照样发出去了。
    expect(recipients(create)).toHaveLength(4);
    expect(res.summary).toContain('已通知 3 人');
    // 失败的人要点名 —— 汇总成「1 人失败」用户不知道该单独补谁。
    expect(res.summary).toContain('丙');
    expect(res.summary).toContain('可用范围');
    expect(res.data?.failed).toMatchObject([{ name: '丙' }]);
  });

  it('一个人都没发成功时算整体失败，不回「已通知 0 人」', async () => {
    seedBu();
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('x'), {
        response: { data: { code: 230013, msg: 'Bot has NO availability' } },
      })
    );
    await expect(
      getAction('send_message')!.run(
        { departments: ['销赞云事业部'], text: 'hi' },
        makeCtx({ chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow(/一条都没发出去/);
  });

  it('名册按 app 隔离 —— 别的应用的部门查不到', async () => {
    seedBu();
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run(
        { departments: ['销赞云事业部'], text: 'hi' },
        makeCtx({ appId: 'cli_other', chatType: 'p2p', client: imClient(create) })
      )
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('多个点名的人一次发完（to 收数组）', async () => {
    seedDirectory([
      { openId: 'ou_a', name: '甲' },
      { openId: 'ou_b', name: '乙' },
    ]);
    const create = okCreate();
    const res = await getAction('send_message')!.run(
      { to: ['甲', '乙'], text: 'hi' },
      makeCtx({ chatType: 'p2p', client: imClient(create) })
    );
    expect(recipients(create)).toEqual(['ou_a', 'ou_b']);
    expect(res.summary).toContain('2 人');
  });

  it('到底发给谁一个都没说时抛错，不静默什么都不做', async () => {
    const create = vi.fn();
    await expect(
      getAction('send_message')!.run({ text: 'hi' }, makeCtx({ client: imClient(create) }))
    ).rejects.toThrow(/收件人/);
    expect(create).not.toHaveBeenCalled();
  });

  it('单人发送的日志字段保持原样（老的排障习惯还在读它）', async () => {
    seedDirectory([{ openId: 'ou_a', name: '甲' }]);
    const create = okCreate();
    const res = await getAction('send_message')!.run(
      { to: '甲', text: 'hi' },
      makeCtx({ chatType: 'p2p', client: imClient(create) })
    );
    expect(res.data?.to_open_id).toBe('ou_a');
    expect(res.data?.to_name).toBe('甲');
    expect(res.data?.resolved_from).toBe('directory');
  });

  it('群发的正文和单发完全一样（署名只加一次）', async () => {
    seedBu();
    const create = okCreate();
    await getAction('send_message')!.run(
      { departments: ['销赞云事业部'], text: '周五开会' },
      makeCtx({ chatType: 'p2p', senderName: '洪成智', client: imClient(create) })
    );
    const texts = create.mock.calls.map((c) => JSON.parse(c[0].data.content).text as string);
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe('洪成智 让我转告你：\n周五开会');
  });
});

describe('按部门建日程', () => {
  function calClient(addAttendee: ReturnType<typeof vi.fn>, createEvent?: ReturnType<typeof vi.fn>) {
    return {
      calendar: {
        v4: {
          calendar: {
            primary: vi
              .fn()
              .mockResolvedValue({ data: { calendars: [{ calendar: { calendar_id: 'cal_bot' } }] } }),
          },
          calendarEvent: {
            create:
              createEvent ?? vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1' } } }),
          },
          calendarEventAttendee: { create: addAttendee },
        },
      },
    } as unknown as Client;
  }

  function seedBu() {
    seedDirectory(
      [
        { openId: 'ou_a', name: '甲', deptIds: ['od_g1'] },
        { openId: 'ou_b', name: '乙', deptIds: ['od_g1'] },
        { openId: 'ou_c', name: '丙', deptIds: ['od_bu'] },
      ],
      [
        { id: 'od_bu', name: '销赞云事业部' },
        { id: 'od_g1', name: '一组', parent: 'od_bu' },
      ]
    );
  }

  it('整个部门（含子部门）都成为参与人', async () => {
    seedBu();
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({ chatType: 'p2p', client: calClient(addAttendee) });

    await getAction('create_calendar_event')!.run(
      {
        summary: '周会',
        start: '2026-08-07T09:30:00+08:00',
        attendee_departments: ['销赞云事业部'],
      },
      ctx
    );

    const ids = addAttendee.mock.calls[0][0].data.attendees.map((a: any) => a.user_id);
    expect(ids.sort()).toEqual(['ou_a', 'ou_b', 'ou_c', 'ou_sender']);
  });

  it('发起人一定在参与人里 —— 和群发消息相反，这里不能排除他', async () => {
    // 排除掉他自己就看不到这个日程了。
    seedDirectory([{ openId: 'ou_a', name: '甲', deptIds: ['od_s'] }], [
      { id: 'od_s', name: '销售部' },
    ]);
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({
      chatType: 'p2p',
      senderOpenId: 'ou_a',
      client: calClient(addAttendee),
    });

    await getAction('create_calendar_event')!.run(
      { summary: '周会', start: '2026-08-07T09:30:00+08:00', attendee_departments: ['销售部'] },
      ctx
    );

    const ids = addAttendee.mock.calls[0][0].data.attendees.map((a: any) => a.user_id);
    expect(ids).toEqual(['ou_a']);
  });

  it('部门解析失败时**建日程之前**就抛错，不留下孤儿日程', async () => {
    const createEvent = vi.fn();
    const ctx = makeCtx({
      chatType: 'p2p',
      client: calClient(vi.fn(), createEvent),
    });

    await expect(
      getAction('create_calendar_event')!.run(
        {
          summary: '周会',
          start: '2026-08-07T09:30:00+08:00',
          attendee_departments: ['不存在的部'],
        },
        ctx
      )
    ).rejects.toThrow(/没有找到叫「不存在的部」的部门/);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('参与人很多时回帖给人数而不是把名字列到淹掉', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      openId: `ou_${i}`,
      name: `员工${i}`,
      deptIds: ['od_big'],
    }));
    seedDirectory(many, [{ id: 'od_big', name: '大部门' }]);
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const ctx = makeCtx({ chatType: 'p2p', client: calClient(addAttendee) });

    const res = await getAction('create_calendar_event')!.run(
      { summary: '全员会', start: '2026-08-07T09:30:00+08:00', attendee_departments: ['大部门'] },
      ctx
    );

    // 26 = 25 个成员 + 发起人。人数必须给，用户要据此判断范围对不对。
    expect(res.summary).toContain('26 人');
  });

  it('日程的部门参与人也受群发上限约束', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      openId: `ou_${i}`,
      name: `员工${i}`,
      deptIds: ['od_all'],
    }));
    seedDirectory(many, [{ id: 'od_all', name: '全公司' }]);
    const createEvent = vi.fn();
    await expect(
      getAction('create_calendar_event')!.run(
        { summary: 'x', start: '2026-08-07T09:30:00+08:00', attendee_departments: ['全公司'] },
        makeCtx({ chatType: 'p2p', client: calClient(vi.fn(), createEvent) })
      )
    ).rejects.toThrow(/上限/);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('日程参数扩展（视频会议 / 地点 / 提醒 / 重复）', () => {
  function calClient(createEvent: ReturnType<typeof vi.fn>) {
    return {
      calendar: {
        v4: {
          calendar: {
            primary: vi
              .fn()
              .mockResolvedValue({ data: { calendars: [{ calendar: { calendar_id: 'cal_bot' } }] } }),
          },
          calendarEvent: { create: createEvent },
          calendarEventAttendee: { create: vi.fn().mockResolvedValue({ code: 0 }) },
        },
      },
    } as unknown as Client;
  }

  const okEvent = (extra: Record<string, unknown> = {}) =>
    vi.fn().mockResolvedValue({ data: { event: { event_id: 'ev1', ...extra } } });

  it('说了线上开会才带 vchat，没说不带（多开一个会议链接是"做了没要求的事"）', async () => {
    const on = okEvent({ vchat: { meeting_url: 'https://vc.feishu.cn/j/123' } });
    const res = await getAction('create_calendar_event')!.run(
      { summary: '会', start: '2026-08-05T15:00:00+08:00', video_meeting: true },
      makeCtx({ client: calClient(on) })
    );
    expect(on.mock.calls[0][0].data.vchat).toEqual({ vc_type: 'vc' });
    expect(res.summary).toContain('https://vc.feishu.cn/j/123');

    const off = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: '会', start: '2026-08-05T15:00:00+08:00' },
      makeCtx({ client: calClient(off) })
    );
    expect(off.mock.calls[0][0].data.vchat).toBeUndefined();
  });

  it('说了线上但飞书没给链接时要明说 —— 用户会照着回帖去找那个链接', async () => {
    const res = await getAction('create_calendar_event')!.run(
      { summary: '会', start: '2026-08-05T15:00:00+08:00', video_meeting: true },
      makeCtx({ client: calClient(okEvent()) })
    );
    expect(res.summary).toMatch(/视频会议链接没生成|没生成/);
  });

  it('地点和提醒原样传，且回帖里说出来', async () => {
    const createEvent = okEvent();
    const res = await getAction('create_calendar_event')!.run(
      {
        summary: '评审',
        start: '2026-08-05T15:00:00+08:00',
        location: '三楼会议室',
        remind_minutes: 10,
      },
      makeCtx({ client: calClient(createEvent) })
    );
    const data = createEvent.mock.calls[0][0].data;
    expect(data.location).toEqual({ name: '三楼会议室' });
    // 日程这边字段叫 minutes（任务那边才是 relative_fire_minute），写反了不会报错。
    expect(data.reminders).toEqual([{ minutes: 10 }]);
    expect(res.summary).toContain('三楼会议室');
    expect(res.summary).toContain('10 分钟');
  });

  it('提醒分钟数填歪了不影响建日程（日程本身才是用户要的）', async () => {
    const createEvent = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: '会', start: '2026-08-05T15:00:00+08:00', remind_minutes: '一会儿' },
      makeCtx({ client: calClient(createEvent) })
    );
    expect(createEvent).toHaveBeenCalled();
    expect(createEvent.mock.calls[0][0].data.reminders).toBeUndefined();
  });

  it('每周重复：BYDAY 按开始时间算，不依赖服务端怎么解释 DTSTART', async () => {
    const createEvent = okEvent();
    // 2026-08-05 是周三。
    const res = await getAction('create_calendar_event')!.run(
      { summary: '例会', start: '2026-08-05T09:30:00+08:00', repeat: 'weekly' },
      makeCtx({ client: calClient(createEvent) })
    );
    expect(createEvent.mock.calls[0][0].data.recurrence).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=WE');
    // 重复日程必须明说，而且要说清没有结束日期时怎么收场。
    expect(res.summary).toContain('重复日程');
    expect(res.summary).toMatch(/没有结束日期/);
  });

  it('双周 = INTERVAL=2，每月按日期，每天不带 BYDAY', async () => {
    const bi = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: 'x', start: '2026-08-05T09:30:00+08:00', repeat: 'biweekly' },
      makeCtx({ client: calClient(bi) })
    );
    expect(bi.mock.calls[0][0].data.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE');

    const mo = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: 'x', start: '2026-08-05T09:30:00+08:00', repeat: 'monthly' },
      makeCtx({ client: calClient(mo) })
    );
    expect(mo.mock.calls[0][0].data.recurrence).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5');

    const da = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: 'x', start: '2026-08-05T09:30:00+08:00', repeat: 'daily' },
      makeCtx({ client: calClient(da) })
    );
    expect(da.mock.calls[0][0].data.recurrence).toBe('FREQ=DAILY;INTERVAL=1');
  });

  it('repeat_until 拼成 UTC basic 格式的 UNTIL，并在回帖里说到哪天为止', async () => {
    const createEvent = okEvent();
    const res = await getAction('create_calendar_event')!.run(
      {
        summary: '例会',
        start: '2026-08-05T09:30:00+08:00',
        repeat: 'weekly',
        repeat_until: '2026-12-31T18:00:00+08:00',
      },
      makeCtx({ client: calClient(createEvent) })
    );
    const rule = createEvent.mock.calls[0][0].data.recurrence as string;
    expect(rule).toMatch(/UNTIL=\d{8}T\d{6}Z$/);
    expect(res.summary).toContain('2026');
    // 有结束日期时就不该再吓用户"去删掉整个重复日程"。
    expect(res.summary).not.toMatch(/没有结束日期/);
  });

  it('没说重复就绝不建成重复日程 —— 认不出来的 repeat 值当作没说', async () => {
    for (const repeat of [undefined, '', '偶尔', 'sometimes', '下周一']) {
      const createEvent = okEvent();
      await getAction('create_calendar_event')!.run(
        { summary: 'x', start: '2026-08-05T09:30:00+08:00', ...(repeat === undefined ? {} : { repeat }) },
        makeCtx({ client: calClient(createEvent) })
      );
      expect(createEvent.mock.calls[0][0].data.recurrence).toBeUndefined();
    }
  });

  it('模型给中文「每周」也认 —— 静默失效会让例会变成一次性日程', async () => {
    const createEvent = okEvent();
    await getAction('create_calendar_event')!.run(
      { summary: '例会', start: '2026-08-05T09:30:00+08:00', repeat: '每周' },
      makeCtx({ client: calClient(createEvent) })
    );
    expect(createEvent.mock.calls[0][0].data.recurrence).toContain('FREQ=WEEKLY');
  });

  it('data 里存标题和 id —— 改/删日程靠它反查', async () => {
    const res = await getAction('create_calendar_event')!.run(
      { summary: '需求评审', start: '2026-08-05T15:00:00+08:00' },
      makeCtx({ client: calClient(okEvent()) })
    );
    expect(res.data).toMatchObject({ title: '需求评审', event_id: 'ev1', calendar_id: 'cal_bot' });
  });
});

describe('反查「哪个任务/日程」', () => {
  const anyClient = () =>
    ({
      task: {
        v2: {
          task: { patch: vi.fn().mockResolvedValue({ code: 0 }) },
        },
      },
    }) as unknown as Client;

  it('一条都没建过时说「我只能改我自己帮你建的」，不说「没找到」', async () => {
    // 这个区别是有意的：「没找到」会让用户以为是搜索没搜到，反复换措辞重试，
    // 而真正的原因是他手动建的东西我们根本看不见。
    await expect(
      getAction('update_task')!.run({ task: '季度报告', completed: true }, makeCtx({ client: anyClient() }))
    ).rejects.toThrow(/只能改我自己帮你建的/);
  });

  it('关键词命中多个时**绝不挑一个**，列出来让用户重说', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g1', title: '季度报告初稿' } });
    seedCommand({ action: 'create_task', data: { guid: 'g2', title: '季度报告终稿' } });
    const patch = vi.fn();
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', completed: true },
        makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
      )
    ).rejects.toThrow(/不敢替你挑/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('没给关键词、候选不止一个时也不默认取最近那个', async () => {
    // 「那个任务完成了」里的"那个"指的是他心里想的那件事，不一定是时间上最近的。
    seedCommand({ action: 'create_task', data: { guid: 'g1', title: 'A' }, ageMs: 5000 });
    seedCommand({ action: 'create_task', data: { guid: 'g2', title: 'B' }, ageMs: 1000 });
    const patch = vi.fn();
    await expect(
      getAction('update_task')!.run(
        { completed: true },
        makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
      )
    ).rejects.toThrow(/不确定你说的是哪个/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('没给关键词但只有一个候选时可以确定', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g_only', title: '唯一任务' } });
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { completed: true },
      makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
    );
    expect(patch.mock.calls[0][0].path.task_guid).toBe('g_only');
  });

  it('只看本人本应用的记录 —— 跨人是改别人的东西，跨应用是跨企业', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g_other', title: '别人的任务' }, senderOpenId: 'ou_lisi' });
    seedCommand({ action: 'create_task', data: { guid: 'g_app', title: '别家的任务' }, appId: 'cli_other' });
    await expect(
      getAction('update_task')!.run({ completed: true }, makeCtx({ client: anyClient() }))
    ).rejects.toThrow(/只能改我自己帮你建的/);
  });

  it('整条指令 failed 但任务确实建出来了的，也算候选', async () => {
    // result 里只有成功的那几步：「建任务 + 发通知」在第二步失败时整条记 failed，
    // 不收它的话用户明明看到任务在飞书里，助理却说「我没帮你建过任务」。
    seedCommand({ action: 'create_task', data: { guid: 'g_half', title: '半成功任务' }, status: 'failed' });
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { completed: true },
      makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
    );
    expect(patch.mock.calls[0][0].path.task_guid).toBe('g_half');
  });

  it('老日志行没有 title 时从回帖文案里剥标题（不能变成一个空选项）', async () => {
    seedCommand({
      action: 'create_task',
      data: { guid: 'g_old' },
      summary: '✅ 任务已创建：**写季度报告**\n负责人：张三',
    });
    seedCommand({ action: 'create_task', data: { guid: 'g2', title: '另一件事' } });
    await expect(
      getAction('update_task')!.run({ completed: true }, makeCtx({ client: anyClient() }))
    ).rejects.toThrow(/写季度报告/);
  });

  it('id 字段不全的老日志行排除掉（拿它调接口只会撞一个莫名的参数错误）', async () => {
    seedCommand({ action: 'create_calendar_event', data: { event_id: 'ev_old', title: '没日历 id 的日程' } });
    await expect(
      getAction('update_calendar_event')!.run({ start: '2026-08-09T16:00:00+08:00' }, makeCtx())
    ).rejects.toThrow(/只能改我自己帮你建的/);
  });

  it('已删掉的日程不再是候选（否则会拿死 id 去 patch，或者重复发一次取消通知）', async () => {
    seedCommand({
      action: 'create_calendar_event',
      data: { event_id: 'ev_gone', calendar_id: 'cal_bot', title: '取消了的会' },
      ageMs: 5000,
    });
    seedCommand({
      action: 'delete_calendar_event',
      data: { event_id: 'ev_gone', calendar_id: 'cal_bot', title: '取消了的会', deleted: true },
      ageMs: 1000,
    });
    await expect(
      getAction('delete_calendar_event')!.run({ event: '取消了的会' }, makeCtx())
    ).rejects.toThrow(/只能改我自己帮你建的/);
  });

  it('改过标题之后按新名字也能找到（改动作自己的日志行也算候选）', async () => {
    seedCommand({
      action: 'create_calendar_event',
      data: { event_id: 'ev1', calendar_id: 'cal_bot', title: '需求评审' },
      ageMs: 5000,
    });
    seedCommand({
      action: 'update_calendar_event',
      data: { event_id: 'ev1', calendar_id: 'cal_bot', title: 'V2 需求评审' },
      ageMs: 1000,
    });
    const patch = vi.fn().mockResolvedValue({ data: { event: {} } });
    const res = await getAction('update_calendar_event')!.run(
      { event: 'V2 需求评审', location: '五楼' },
      makeCtx({
        client: {
          calendar: {
            v4: {
              calendarEvent: { patch, get: vi.fn().mockRejectedValue(new Error('x')) },
              calendarEventAttendee: { create: vi.fn() },
            },
          },
        } as unknown as Client,
      })
    );
    // 同一个 event_id 出现两次只算一个候选，且用的是最新那行的标题。
    expect(patch).toHaveBeenCalledTimes(1);
    expect(res.summary).toContain('V2 需求评审');
  });
});

describe('update_task', () => {
  function taskClient(parts: {
    patch?: ReturnType<typeof vi.fn>;
    addMembers?: ReturnType<typeof vi.fn>;
    addReminders?: ReturnType<typeof vi.fn>;
    comment?: ReturnType<typeof vi.fn>;
  }) {
    return {
      task: {
        v2: {
          task: {
            patch: parts.patch ?? vi.fn().mockResolvedValue({ code: 0 }),
            addMembers: parts.addMembers ?? vi.fn().mockResolvedValue({ code: 0 }),
            addReminders: parts.addReminders ?? vi.fn().mockResolvedValue({ code: 0 }),
          },
          comment: { create: parts.comment ?? vi.fn().mockResolvedValue({ code: 0 }) },
        },
      },
    } as unknown as Client;
  }

  beforeEach(() => {
    seedCommand({
      action: 'create_task',
      data: { guid: 'g_task', title: '写季度报告', url: 'https://applink/task' },
    });
  });

  it('标记完成 = 写 completed_at，且 update_fields 只列这一个', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    const res = await getAction('update_task')!.run(
      { task: '季度报告', completed: true },
      makeCtx({ client: taskClient({ patch }) })
    );
    const body = patch.mock.calls[0][0].data;
    expect(body.update_fields).toEqual(['completed_at']);
    expect(Number(body.task.completed_at)).toBeGreaterThan(0);
    expect(res.summary).toContain('已标记完成');
  });

  it('取消完成 = completed_at 写 "0"', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告', completed: false },
      makeCtx({ client: taskClient({ patch }) })
    );
    expect(patch.mock.calls[0][0].data.task.completed_at).toBe('0');
  });

  it('completed 认不出来时当作没说，不能猜成 true', async () => {
    // 把一个还没做的任务标记成完成，用户是不会再回来看的。
    const patch = vi.fn();
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', completed: '也许吧' },
        makeCtx({ client: taskClient({ patch }) })
      )
    ).rejects.toThrow(/没说清/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('改截止时间用毫秒（任务和日程单位不同，写反了会排到 1970 年）', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告', due: '2026-08-07T18:00:00+08:00' },
      makeCtx({ client: taskClient({ patch }) })
    );
    const body = patch.mock.calls[0][0].data;
    expect(body.update_fields).toEqual(['due']);
    expect(body.task.due.timestamp).toBe(String(Date.parse('2026-08-07T18:00:00+08:00')));
  });

  it('没提到的字段一律不进 update_fields —— 列了名字就会被清空', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告', summary: '写年度报告' },
      makeCtx({ client: taskClient({ patch }) })
    );
    expect(patch.mock.calls[0][0].data.update_fields).toEqual(['summary']);
  });

  it('加协作人按姓名解析，用 follower 角色（多设负责人会改变任务归谁）', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四' }]);
    const addMembers = vi.fn().mockResolvedValue({ code: 0 });
    const res = await getAction('update_task')!.run(
      { task: '季度报告', followers: ['李四'] },
      makeCtx({ chatType: 'p2p', client: taskClient({ addMembers }) })
    );
    expect(addMembers.mock.calls[0][0].data.members).toEqual([
      { id: 'ou_lisi', type: 'user', role: 'follower' },
    ]);
    expect(res.summary).toContain('李四');
  });

  it('协作人解析不出来时一个字段都不改（否则重下指令会把改好的再改一遍）', async () => {
    const patch = vi.fn();
    const addMembers = vi.fn();
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', due: '2026-08-07T18:00:00+08:00', followers: ['查无此人'] },
        makeCtx({ chatType: 'p2p', client: taskClient({ patch, addMembers }) })
      )
    ).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
    expect(addMembers).not.toHaveBeenCalled();
  });

  it('提醒用 relative_fire_minute（日程那边叫 minutes，两边不通用）', async () => {
    const addReminders = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告', remind_minutes: 60 },
      makeCtx({ client: taskClient({ addReminders }) })
    );
    expect(addReminders.mock.calls[0][0].data.reminders).toEqual([{ relative_fire_minute: 60 }]);
  });

  it('设提醒失败时补一句「任务要先有截止时间」—— 飞书的报错不会说这件事', async () => {
    const addReminders = vi.fn().mockRejectedValue(new Error('invalid request'));
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', remind_minutes: 60 },
        makeCtx({ client: taskClient({ addReminders }) })
      )
    ).rejects.toThrow(/先有截止时间/);
  });

  it('评论带上发言人署名，guid 走 data.resource_id 而不是 path', async () => {
    const comment = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告', comment: '数据还差三季度的' },
      makeCtx({ client: taskClient({ comment }) })
    );
    const body = comment.mock.calls[0][0];
    expect(body.path).toBeUndefined();
    expect(body.data.resource_id).toBe('g_task');
    expect(body.data.resource_type).toBe('task');
    expect(body.data.content).toContain('张三');
    expect(body.data.content).toContain('数据还差三季度的');
  });

  it('一句话里两件事只反查一次任务，两个接口都调到', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    const comment = vi.fn().mockResolvedValue({ code: 0 });
    const res = await getAction('update_task')!.run(
      { task: '季度报告', completed: true, comment: '搞定' },
      makeCtx({ client: taskClient({ patch, comment }) })
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(1);
    expect(res.summary).toContain('已标记完成');
    expect(res.summary).toContain('搞定');
  });

  it('部分成功时说清哪些已经生效（否则整条重下会把成功那部分再做一遍）', async () => {
    const res = await getAction('update_task')!.run(
      { task: '季度报告', completed: true, comment: '搞定' },
      makeCtx({
        client: taskClient({ comment: vi.fn().mockRejectedValue(new Error('评论接口挂了')) }),
      })
    );
    expect(res.summary).toContain('已标记完成');
    expect(res.summary).toMatch(/已经生效/);
    expect(res.summary).toMatch(/写评论失败/);
  });

  it('一件都没做成时抛错 —— 回「已更新」是在假装成功', async () => {
    await expect(
      getAction('update_task')!.run(
        { task: '季度报告', completed: true },
        makeCtx({ client: taskClient({ patch: vi.fn().mockRejectedValue(new Error('boom')) }) })
      )
    ).rejects.toThrow(/一处都没改成/);
  });

  it('什么都没说要改时提示能改什么，不空跑一趟', async () => {
    const patch = vi.fn();
    await expect(
      getAction('update_task')!.run({ task: '季度报告' }, makeCtx({ client: taskClient({ patch }) }))
    ).rejects.toThrow(/没说清/);
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('update_calendar_event / delete_calendar_event', () => {
  function calClient(parts: {
    patch?: ReturnType<typeof vi.fn>;
    get?: ReturnType<typeof vi.fn>;
    del?: ReturnType<typeof vi.fn>;
    addAttendee?: ReturnType<typeof vi.fn>;
  }) {
    return {
      calendar: {
        v4: {
          calendarEvent: {
            patch: parts.patch ?? vi.fn().mockResolvedValue({ data: { event: {} } }),
            get: parts.get ?? vi.fn().mockRejectedValue(new Error('no get')),
            delete: parts.del ?? vi.fn().mockResolvedValue({ code: 0 }),
          },
          calendarEventAttendee: {
            create: parts.addAttendee ?? vi.fn().mockResolvedValue({ code: 0 }),
          },
        },
      },
    } as unknown as Client;
  }

  const getOk = (startSec: number, endSec: number, extra: Record<string, unknown> = {}) =>
    vi.fn().mockResolvedValue({
      data: {
        event: {
          start_time: { timestamp: String(startSec) },
          end_time: { timestamp: String(endSec) },
          ...extra,
        },
      },
    });

  beforeEach(() => {
    seedCommand({
      action: 'create_calendar_event',
      data: {
        event_id: 'ev1',
        calendar_id: 'cal_bot',
        title: '需求评审',
        app_link: 'https://applink/ev1',
      },
    });
  });

  it('只给新开始时间时按原时长顺延结束时间（否则会出现结束早于开始）', async () => {
    const s = Date.parse('2026-08-05T10:00:00+08:00') / 1000;
    const patch = vi.fn().mockResolvedValue({ data: { event: {} } });
    await getAction('update_calendar_event')!.run(
      { event: '需求评审', start: '2026-08-05T16:00:00+08:00' },
      makeCtx({ client: calClient({ patch, get: getOk(s, s + 5400) }) })
    );
    const data = patch.mock.calls[0][0].data;
    // 原时长 90 分钟要保住。
    expect(Number(data.end_time.timestamp) - Number(data.start_time.timestamp)).toBe(5400);
    expect(data.start_time.timestamp).toBe(String(Date.parse('2026-08-05T16:00:00+08:00') / 1000));
  });

  it('读不到原时长时退回一小时，但改时间这件事照做', async () => {
    const patch = vi.fn().mockResolvedValue({ data: { event: {} } });
    await getAction('update_calendar_event')!.run(
      { event: '需求评审', start: '2026-08-05T16:00:00+08:00' },
      makeCtx({ client: calClient({ patch }) })
    );
    const data = patch.mock.calls[0][0].data;
    expect(Number(data.end_time.timestamp) - Number(data.start_time.timestamp)).toBe(3600);
  });

  it('没提到的字段一个都不传 —— 飞书是「传了才改」，传空会清掉原值', async () => {
    const patch = vi.fn().mockResolvedValue({ data: { event: {} } });
    await getAction('update_calendar_event')!.run(
      { event: '需求评审', location: '五楼会议室' },
      makeCtx({ client: calClient({ patch }) })
    );
    expect(patch.mock.calls[0][0].data).toEqual({ location: { name: '五楼会议室' } });
  });

  it('追加参与人只加不踢', async () => {
    seedDirectory([{ openId: 'ou_wangwu', name: '王五' }]);
    const addAttendee = vi.fn().mockResolvedValue({ code: 0 });
    const res = await getAction('update_calendar_event')!.run(
      { event: '需求评审', attendees: ['王五'] },
      makeCtx({ chatType: 'p2p', client: calClient({ addAttendee }) })
    );
    const ids = addAttendee.mock.calls[0][0].data.attendees.map((a: { user_id: string }) => a.user_id);
    // 发言人不重复加进去（他本来就在里面），这一点和建日程时相反。
    expect(ids).toEqual(['ou_wangwu']);
    expect(res.summary).toContain('王五');
  });

  it('改的是重复日程时要说明作用于整个系列', async () => {
    getDatabase().prepare('DELETE FROM feishu_commands').run();
    seedCommand({
      action: 'create_calendar_event',
      data: {
        event_id: 'ev_rec',
        calendar_id: 'cal_bot',
        title: '周例会',
        recurrence: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
      },
    });
    const res = await getAction('update_calendar_event')!.run(
      { event: '周例会', location: '五楼' },
      makeCtx({ client: calClient({}) })
    );
    expect(res.summary).toMatch(/整个系列/);
  });

  it('改标题后 data 里存的是新标题（否则下一句按新名字反查不到）', async () => {
    const res = await getAction('update_calendar_event')!.run(
      { event: '需求评审', summary: 'V2 需求评审' },
      makeCtx({ client: calClient({}) })
    );
    expect(res.data).toMatchObject({ title: 'V2 需求评审' });
  });

  it('什么都没说要改时不空跑一趟', async () => {
    const patch = vi.fn();
    await expect(
      getAction('update_calendar_event')!.run({ event: '需求评审' }, makeCtx({ client: calClient({ patch }) }))
    ).rejects.toThrow(/没说清/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('删日程必须通知参与人（别人日历上已经有这个会了）', async () => {
    const del = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('delete_calendar_event')!.run(
      { event: '需求评审' },
      makeCtx({ client: calClient({ del }) })
    );
    // 这个参数是字符串 "true" 不是布尔。
    expect(del.mock.calls[0][0].params.need_notification).toBe('true');
    expect(del.mock.calls[0][0].path).toEqual({ calendar_id: 'cal_bot', event_id: 'ev1' });
  });

  it('删完的回帖要报出删的是哪一场 —— 删完用户已经没法自己核对了', async () => {
    const s = Date.parse('2026-08-05T15:00:00+08:00') / 1000;
    const res = await getAction('delete_calendar_event')!.run(
      { event: '需求评审' },
      makeCtx({ client: calClient({ get: getOk(s, s + 3600) }) })
    );
    expect(res.summary).toContain('需求评审');
    expect(res.summary).toContain(fmtForHuman(s * 1000));
    expect(res.summary).toMatch(/不可撤销|取消通知/);
  });

  it('读不到原定时间也照样删（用户要的是删掉），只是少写一行', async () => {
    const del = vi.fn().mockResolvedValue({ code: 0 });
    const res = await getAction('delete_calendar_event')!.run(
      { event: '需求评审' },
      makeCtx({ client: calClient({ del }) })
    );
    expect(del).toHaveBeenCalled();
    expect(res.summary).toContain('需求评审');
    expect(res.summary).not.toContain('原定时间');
  });

  it('删的是重复日程时点明整个系列都删了', async () => {
    const s = Date.parse('2026-08-05T09:30:00+08:00') / 1000;
    const res = await getAction('delete_calendar_event')!.run(
      { event: '需求评审' },
      makeCtx({
        client: calClient({ get: getOk(s, s + 1800, { recurrence: 'FREQ=WEEKLY;INTERVAL=1' }) }),
      })
    );
    expect(res.summary).toMatch(/整个系列/);
  });

  it('删除歧义时绝不替用户猜一个删掉', async () => {
    seedCommand({
      action: 'create_calendar_event',
      data: { event_id: 'ev2', calendar_id: 'cal_bot', title: '需求评审补充场' },
    });
    const del = vi.fn();
    await expect(
      getAction('delete_calendar_event')!.run({ event: '需求评审' }, makeCtx({ client: calClient({ del }) }))
    ).rejects.toThrow(/不敢替你挑/);
    expect(del).not.toHaveBeenCalled();
  });
});
