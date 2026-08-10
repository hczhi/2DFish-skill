import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';
import { ACTIONS, getAction, allRequiredScopes } from './index.js';
import { strList, type ActionContext } from './types.js';
import { toTaskTimestamp, parseIso, fmtForHuman, fmtDate } from './time.js';
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
  // 068 之后 create_task 会落一行，而 update_task **先查这张表**再退回日志 ——
  // 不清的话上一个用例建的任务会成为下一个用例的候选，「反查」那一组会全线歧义。
  db.prepare('DELETE FROM feishu_project_tasks').run();
  db.prepare('DELETE FROM feishu_diary_projects').run();
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
  it('任务 due 是毫秒字符串（写成秒会落到 1970 年，而且不报错）', () => {
    const ms = 1_800_000_000_000; // 2027-01-15 左右
    expect(toTaskTimestamp(ms)).toBe('1800000000000');
  });

  it('fmtDate 给「到天」的日期，用飞书租户时区切', () => {
    // 2026-08-05T23:30:00Z = 北京时间 8 月 6 日 07:30 —— 服务器在 UTC 上跑时
    // 用本地时区会把这条记录记到前一天。
    expect(fmtDate(Date.parse('2026-08-05T23:30:00Z'))).toBe('2026-08-06');
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
    // guid 只能从执行日志反查（见 recent.ts）。
    // 参数说明会原样进 prompt，所以这里守的是"prompt 里根本没有这个概念"。
    for (const a of ACTIONS) {
      for (const [key, doc] of Object.entries(a.params)) {
        expect(key).not.toMatch(/guid|event_id|record_id|task_id/);
        expect(doc).not.toMatch(/guid|event_id|record_id/);
      }
    }
  });

  it('改动作声明了对应的飞书权限点', () => {
    expect(getAction('update_task')!.scopes).toContain('task:task:write');
  });

  it('删掉的那几个动作真的不在注册表里了（留着就仍然会被误选）', () => {
    // 这不是洁癖：动作清单原样进 prompt，只要还在表里，模型就仍然可能把
    // 「给张三派个任务，明天开始」拆成建任务 + 建日程两步。
    for (const gone of [
      'send_message',
      'create_calendar_event',
      'update_calendar_event',
      'delete_calendar_event',
      'query_freebusy',
    ]) {
      expect(getAction(gone)).toBeUndefined();
    }
    // 连带的权限点也该从接入指引里消失 —— 让用户去开一批用不到的权限，
    // 是把绑定流程里最容易卡住的一步无谓地加长。
    const scopes = allRequiredScopes();
    expect(scopes.filter((s) => s.startsWith('calendar:'))).toEqual([]);
  });

  it('allRequiredScopes 含接收和回复消息的权限（漏了就完全没反应）', () => {
    const scopes = allRequiredScopes();
    expect(scopes).toContain('im:message.group_at_msg:readonly');
    expect(scopes).toContain('im:message.p2p_msg:readonly');
    // 回帖的权限。以前它由 send_message 动作带进来，那个动作删掉之后
    // 它成了没有主人的必需权限 —— 少了它整个模块静默。
    expect(scopes).toContain('im:message:send_as_bot');
    expect(scopes).toContain('task:task:write');
    // 名册同步的权限也要在总清单里 —— 少了它「没 @ 到的人也能被指名」不成立，
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

  it('没 @ 到的人按名册指派 —— 群里那个人常常不在场', async () => {
    seedDirectory([{ openId: 'ou_lisi', name: '李四', dept: '销售部' }]);
    const create = vi.fn().mockResolvedValue({ data: { task: { guid: 'g1' } } });
    const ctx = makeCtx({ client: taskClient(create), mentions: [] });

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

describe('反查「哪个任务」', () => {
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

  // 空格差异不该决定成败。中文里空格可有可无，同一个标题两次说出来空格位置
  // 常常不一样（建的时候输入法自动加了、改的时候顺手打的）。
  // 不归一化的表现是一句**自相矛盾**的话：「没找到和「xzy8月飞书skill开发」
  // 对得上的任务。我最近帮你建过这些：· xzy8 月飞书 skill 开发」——
  // 用户看到自己要的东西就列在那儿却说找不到，只会认定助理坏了。
  it('关键词和标题的空格不一致时仍然能命中', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g_ws', title: 'xzy8 月飞书 skill 开发' } });
    seedCommand({ action: 'create_task', data: { guid: 'g_other', title: '完全无关的另一件事' } });
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: 'xzy8月飞书skill开发', completed: true },
      makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
    );
    expect(patch.mock.calls[0][0].path.task_guid).toBe('g_ws');
  });

  it('反过来也行：标题没空格、用户说的带空格', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g_ws2', title: '季度报告初稿' } });
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    await getAction('update_task')!.run(
      { task: '季度报告 初稿', completed: true },
      makeCtx({ client: { task: { v2: { task: { patch } } } } as unknown as Client })
    );
    expect(patch.mock.calls[0][0].path.task_guid).toBe('g_ws2');
  });

  it('归一化只吃空白，不放宽成模糊匹配（多个候选照旧拒绝）', async () => {
    seedCommand({ action: 'create_task', data: { guid: 'g1', title: '季度报告 初稿' } });
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
      makeCtx({ client: taskClient({ addMembers }) })
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
        makeCtx({ client: taskClient({ patch, addMembers }) })
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

