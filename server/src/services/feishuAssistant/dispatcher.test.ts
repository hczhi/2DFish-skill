import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../db/index.js';
import { encryptSecret } from '../../core/secrets.js';
import {
  claimEvent,
  cleanupOldCommands,
  cleanupOldEvents,
  listCommands,
  reapZombieCommands,
} from './commandLog.js';
import { listChats } from './chatStore.js';
import { handleMessage, type InboundMessage, type DispatchDeps } from './dispatcher.js';
import { getAction } from './actions/index.js';
import type { FeishuApp } from './appStore.js';

// 这里测的是三件"错了会很难查"的事：
//   1. 同一条 message_id 只能被受理一次 —— 飞书成功也重推，重复执行会建出两个任务；
//   2. 群白名单必须在受理之前拦下，否则任何人拉机器人进群就能烧本账号的额度；
//   3. 无论成败都要落一条终态日志 + 回一句话，否则用户只看到「@ 了没反应」。
//
// parseIntent 被 mock 掉：它要真的调 LLM，而这里要验的是调度逻辑本身。
// MAX_STEPS 用真值：dispatcher 会把它写进截断警告里（「最多 N 件」）。
// vi.mock 是整模块替换，漏掉它取的时候就直接抛 —— 而抛在 execute 里只会
// 变成一句「❌ 执行失败」，看起来像业务逻辑坏了。
vi.mock('./intent.js', async (importOriginal) => ({
  MAX_STEPS: (await importOriginal<typeof import('./intent.js')>()).MAX_STEPS,
  parseIntent: vi.fn(),
}));
import { parseIntent, type ParsedIntent } from './intent.js';

/**
 * 补全 ParsedIntent 的默认字段。
 *
 * 用例关心的只有 steps，但 droppedSteps 是必填的（截断必须被上报，
 * 见 intent.ts）。用这个包一层，比在十几处 mock 里各写一遍 `droppedSteps: 0`
 * 更不容易漏 —— 以后再加字段也只改这一个地方。
 */
function intent(partial: Partial<ParsedIntent> & Pick<ParsedIntent, 'steps'>): ParsedIntent {
  return { droppedSteps: 0, ...partial };
}

// 建表走真实迁移链（DB_PATH 已由 test/setup.ts 指到临时目录）。
beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_commands').run();
  db.prepare('DELETE FROM feishu_events').run();
  db.prepare('DELETE FROM feishu_apps').run();
  db.prepare('DELETE FROM feishu_chats').run();
  vi.mocked(parseIntent).mockReset();
});

function makeApp(overrides: Partial<FeishuApp> = {}): FeishuApp {
  const now = new Date().toISOString();
  const app: FeishuApp = {
    id: 'app-row-1',
    user_id: 'user-1',
    name: '测试助理',
    app_id: 'cli_test001',
    app_secret: encryptSecret('secret'),
    enabled: 1,
    allowed_chats: '[]',
    conn_state: 'connected',
    conn_error: null,
    conn_at: now,
    dir_sync_state: 'idle',
    dir_sync_error: null,
    dir_sync_at: null,
    dir_user_count: 0,
    dir_source: '',
    intent_supplement: '',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  getDatabase()
    .prepare(
      `INSERT INTO feishu_apps
         (id, user_id, name, app_id, app_secret, enabled, allowed_chats, conn_state, conn_error, conn_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      app.id, app.user_id, app.name, app.app_id, app.app_secret, app.enabled,
      app.allowed_chats, app.conn_state, app.conn_error, app.conn_at, app.created_at, app.updated_at
    );
  return app;
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'om_msg_001',
    chatId: 'oc_chat_001',
    chatType: 'group',
    senderOpenId: 'ou_sender',
    senderName: '张三',
    text: '明天下午三点开个评审会',
    mentions: [],
    ...overrides,
  };
}

/** 收集回帖内容，并给出一个可等待执行完成的 promise。 */
function makeDeps(app: FeishuApp): { deps: DispatchDeps; replies: string[]; settled: Promise<void> } {
  const replies: string[] = [];
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((r) => { resolveSettled = r; });
  const deps: DispatchDeps = {
    app,
    client: {} as Client,
    reply: async (_chatId, markdown) => {
      replies.push(markdown);
      resolveSettled();
    },
  };
  return { deps, replies, settled };
}

describe('claimEvent 去重', () => {
  it('同一条 message_id 第二次登记返回 false', () => {
    const now = new Date().toISOString();
    expect(claimEvent('om_dup', 'cli_x', now)).toBe(true);
    expect(claimEvent('om_dup', 'cli_x', now)).toBe(false);
  });

  it('不同 message_id 互不影响', () => {
    const now = new Date().toISOString();
    expect(claimEvent('om_a', 'cli_x', now)).toBe(true);
    expect(claimEvent('om_b', 'cli_x', now)).toBe(true);
  });

  it('cleanupOldEvents 只删超期的行', () => {
    const db = getDatabase();
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    const fresh = new Date().toISOString();
    db.prepare('INSERT INTO feishu_events (message_id, app_id, received_at) VALUES (?, ?, ?)')
      .run('om_old', 'cli_x', old);
    db.prepare('INSERT INTO feishu_events (message_id, app_id, received_at) VALUES (?, ?, ?)')
      .run('om_fresh', 'cli_x', fresh);

    expect(cleanupOldEvents(7)).toBe(1);
    const left = db.prepare('SELECT message_id FROM feishu_events').all() as Array<{ message_id: string }>;
    expect(left.map((r) => r.message_id)).toEqual(['om_fresh']);
  });
});

describe('指令日志的保留期与收尸', () => {
  /** 造一条指定状态/时间的指令。 */
  function seed(id: string, status: string, createdAt: string) {
    getDatabase()
      .prepare(
        `INSERT INTO feishu_commands
           (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
            text, status, created_at)
         VALUES (?, 'cli_x', 'user-1', ?, 'oc_x', 'group', 'ou_s', '张三', 'x', ?, ?)`
      )
      .run(id, `om-${id}`, status, createdAt);
  }

  const statusOf = (id: string) =>
    (getDatabase().prepare('SELECT status, error FROM feishu_commands WHERE id = ?').get(id) as
      | { status: string; error: string | null }
      | undefined);

  it('cleanupOldCommands 只删超期的行', () => {
    // 这张表每条 @ 消息一行、还带原文，是本模块长得最快的表。
    // 在加上保留期之前它是无限增长的 —— 一年就是几万行原始聊天内容躺在库里。
    seed('c-old', 'done', new Date(Date.now() - 30 * 86400_000).toISOString());
    seed('c-fresh', 'done', new Date().toISOString());
    expect(cleanupOldCommands(14)).toBe(1);
    expect(statusOf('c-old')).toBeUndefined();
    expect(statusOf('c-fresh')).toBeTruthy();
  });

  it('reapZombieCommands 把 pending / running 标成 failed', () => {
    // 这些指令全靠内存里那个游离的 execute() promise 驱动，进程一没就必然死了。
    // 不收尸的话日志里永远留着一行 running —— 用户以为还在办，继续等。
    seed('c-pending', 'pending', new Date().toISOString());
    seed('c-running', 'running', new Date().toISOString());
    expect(reapZombieCommands()).toBe(2);
    expect(statusOf('c-pending')!.status).toBe('failed');
    expect(statusOf('c-running')!.status).toBe('failed');
    // 错误话术要提示"可能已部分生效"：多步指令可能真的做了一半。
    expect(statusOf('c-running')!.error).toContain('部分生效');
  });

  it('reapZombieCommands 不动已经是终态的行', () => {
    seed('c-done', 'done', new Date().toISOString());
    seed('c-ignored', 'ignored', new Date().toISOString());
    expect(reapZombieCommands()).toBe(0);
    expect(statusOf('c-done')!.status).toBe('done');
    expect(statusOf('c-ignored')!.status).toBe('ignored');
  });
});

describe('handleMessage 受理判定', () => {
  it('重复推送的同一条消息只受理一次', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: { text: '好' } }] }));

    const first = makeDeps(app);
    expect(handleMessage(makeMsg(), first.deps)).toBe('accepted');
    await first.settled;

    // 完全相同的 message_id 再来一次 —— 飞书的重推行为。
    const second = makeDeps(app);
    expect(handleMessage(makeMsg(), second.deps)).toBe('duplicate');
    expect(second.replies).toEqual([]);

    // 关键断言：日志里只有一条，说明动作没被执行第二遍。
    const { total } = listCommands({ userId: 'user-1' });
    expect(total).toBe(1);
  });

  it('白名单外的群直接拒收，不落日志也不消耗额度', () => {
    const app = makeApp({ allowed_chats: JSON.stringify(['oc_allowed']) });
    const { deps, replies } = makeDeps(app);

    expect(handleMessage(makeMsg({ chatId: 'oc_other' }), deps)).toBe('not_allowed');
    expect(replies).toEqual([]);
    expect(vi.mocked(parseIntent)).not.toHaveBeenCalled();
    expect(listCommands({ userId: 'user-1' }).total).toBe(0);
  });

  it('白名单内的群正常受理', async () => {
    const app = makeApp({ allowed_chats: JSON.stringify(['oc_allowed']) });
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: { text: '收到' } }] }));
    const { deps, settled } = makeDeps(app);

    expect(handleMessage(makeMsg({ chatId: 'oc_allowed' }), deps)).toBe('accepted');
    await settled;
  });

  it('空白名单 = 不限群（首次接入时不该被卡住）', async () => {
    const app = makeApp({ allowed_chats: '[]' });
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] }));
    const { deps, settled } = makeDeps(app);

    expect(handleMessage(makeMsg({ chatId: 'oc_whatever' }), deps)).toBe('accepted');
    await settled;
  });

});

// 助理只在群聊里工作。这一组守的是「拒绝，但**说出来**」——
// 白名单外的群是静默拦（回话等于向任意群暴露自己），而私聊必须回一句：
// 用户是特意来找机器人说话的，没反应和"坏了"完全同形。
describe('只在群聊里工作', () => {
  it('私聊被拒，回一句「到群里说」，不花额度也不落指令日志', async () => {
    const app = makeApp();
    const { deps, replies, settled } = makeDeps(app);

    expect(handleMessage(makeMsg({ chatType: 'p2p', chatId: 'oc_p2p' }), deps)).toBe('p2p_rejected');
    await settled;

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('群聊');
    // 这两条是重点：意图解析没被调用（= 没花 AI 额度），
    // 也没有指令日志行（那张表是"已受理指令"的日志）。
    expect(vi.mocked(parseIntent)).not.toHaveBeenCalled();
    expect(listCommands({ userId: 'user-1' }).total).toBe(0);
  });

  it('私聊也去重 —— 飞书重推不该让用户连收五条同样的拒绝', async () => {
    const app = makeApp();
    const first = makeDeps(app);
    expect(handleMessage(makeMsg({ chatType: 'p2p' }), first.deps)).toBe('p2p_rejected');
    await first.settled;

    const second = makeDeps(app);
    expect(handleMessage(makeMsg({ chatType: 'p2p' }), second.deps)).toBe('duplicate');
    expect(second.replies).toEqual([]);
  });

  it('私聊不受群白名单影响 —— 一律拒，白名单空着也一样', async () => {
    // 以前这里是「私聊不受群白名单限制」（= 一律放行）。反过来了：
    // 空白名单意味着"不限**群**"，从来不意味着"私聊也行"。
    const app = makeApp({ allowed_chats: '[]' });
    const { deps, settled } = makeDeps(app);

    expect(handleMessage(makeMsg({ chatType: 'p2p', chatId: 'oc_p2p' }), deps)).toBe('p2p_rejected');
    await settled;
    expect(vi.mocked(parseIntent)).not.toHaveBeenCalled();
  });

  it('回帖失败也不抛（游离 promise，抛出去只会变成 unhandledRejection）', () => {
    const app = makeApp();
    const deps: DispatchDeps = {
      app,
      client: {} as Client,
      reply: async () => { throw new Error('飞书挂了'); },
    };
    expect(() => handleMessage(makeMsg({ chatType: 'p2p' }), deps)).not.toThrow();
  });
});

describe('handleMessage 执行与日志', () => {
  it('成功执行后落 done 并回帖', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [{ action: 'reply', params: { text: '已收到，需要我建个日程吗？' } }],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands).toHaveLength(1);
    expect(commands[0].status).toBe('done');
    expect(commands[0].action).toBe('reply');
    expect(commands[0].duration_ms).not.toBeNull();
    expect(replies[0]).toContain('已收到');
  });

  it('意图解析返回 null 时落 ignored 并回兜底话术', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(null);
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg({ text: '???' }), deps);
    await settled;

    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands[0].status).toBe('ignored');
    // 兜底必须回一句 —— 否则表现成「@ 了没反应」。
    expect(replies[0]).toContain('没太听懂');
  });

  it('动作抛错时落 failed，并把真实原因回给用户', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: {} }] }));
    const { deps, replies, settled } = makeDeps(app);

    // reply 动作要求 text 参数，params 为空会抛出可读错误。
    handleMessage(makeMsg(), deps);
    await settled;

    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands[0].status).toBe('failed');
    expect(commands[0].error).toBeTruthy();
    // 错误原文要透出去：缺权限/时间说不清这类问题用户能自己解决，
    // 兜成「出错了」就永远卡住。
    expect(replies[0]).toContain('执行失败');
    expect(replies[0]).toContain(commands[0].error!);
  });

  it('缺权限时把结构化原因一起落库（后台据此渲染一键补权限）', async () => {
    const app = makeApp();
    // 复刻 SDK 抛出的形状：AxiosError 上挂 response.data，message 是那句废话。
    const axiosLike = new Error('Request failed with status code 400');
    (axiosLike as unknown as { response: { data: unknown } }).response = {
      data: {
        code: 99991672,
        msg: '应用尚未开通所需的应用身份权限：[task:task:write, task:task:writeonly]',
        log_id: 'LOG_X',
      },
    };
    vi.mocked(parseIntent).mockRejectedValue(axiosLike);
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const row = getDatabase()
      .prepare('SELECT error_detail FROM feishu_commands LIMIT 1')
      .get() as { error_detail: string | null };
    const detail = JSON.parse(row.error_detail!);

    expect(detail.kind).toBe('scope_denied');
    expect(detail.scopes).toEqual(['task:task:write', 'task:task:writeonly']);
    // 飞书这次没在 msg 里给链接，靠应用自己的 app_id 兜底拼出来。
    expect(detail.apply_url).toContain('cli_test001');
    // 回帖里也不该出现那句废话。
    expect(replies[0]).not.toContain('status code 400');
    expect(replies[0]).toContain('task:task:write');
  });

  it('非飞书错误也落 detail，但标成 api_error', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockRejectedValue(new Error('今日 AI 额度已用完'));
    const { deps, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const row = getDatabase()
      .prepare('SELECT error_detail FROM feishu_commands LIMIT 1')
      .get() as { error_detail: string | null };
    expect(JSON.parse(row.error_detail!).kind).toBe('api_error');
  });

  it('parseIntent 自身抛错也要落 failed 并回帖', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockRejectedValue(new Error('今日 AI 额度已用完'));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands[0].status).toBe('failed');
    expect(replies[0]).toContain('今日 AI 额度已用完');
  });

  it('空正文直接 ignored，不调 LLM', async () => {
    const app = makeApp();
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg({ text: '   ' }), deps);
    await settled;

    expect(vi.mocked(parseIntent)).not.toHaveBeenCalled();
    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands[0].status).toBe('ignored');
    expect(replies[0]).toContain('没太听懂');
  });

  it('回帖失败不影响日志落终态', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] }));

    let called = false;
    const deps: DispatchDeps = {
      app,
      client: {} as Client,
      reply: async () => { called = true; throw new Error('网络抖动'); },
    };

    handleMessage(makeMsg(), deps);
    // 回帖抛错被 safeReply 吞掉，等一轮微任务队列即可看到终态。
    await vi.waitFor(() => {
      expect(called).toBe(true);
      expect(listCommands({ userId: 'user-1' }).commands[0]?.status).toBe('done');
    });
  });
});

describe('listCommands 过滤', () => {
  it('按 status 和 app_id 筛选', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] }));

    const a = makeDeps(app);
    handleMessage(makeMsg({ messageId: 'om_1' }), a.deps);
    await a.settled;

    vi.mocked(parseIntent).mockResolvedValue(null);
    const b = makeDeps(app);
    handleMessage(makeMsg({ messageId: 'om_2' }), b.deps);
    await b.settled;

    expect(listCommands({ userId: 'user-1', status: 'done' }).total).toBe(1);
    expect(listCommands({ userId: 'user-1', status: 'ignored' }).total).toBe(1);
    expect(listCommands({ userId: 'user-1', appId: 'cli_test001' }).total).toBe(2);
    expect(listCommands({ userId: 'user-1', appId: 'cli_nope' }).total).toBe(0);
    // 别人的账号看不到这些记录。
    expect(listCommands({ userId: 'user-2' }).total).toBe(0);
  });
});

describe('一句话两件事（多步执行）', () => {
  // 「给他们发消息，并建个日程」是很自然的说法。只支持一步的年代，
  // 这种句子的结果是 LLM 挑一件做掉、另一件**静默消失** —— 用户以为都办了。

  it('两步都执行，两句结果都回给用户', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: '第一件事办好了' } },
        { action: 'reply', params: { text: '第二件事也办好了' } },
      ],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('第一件事办好了');
    expect(replies[0]).toContain('第二件事也办好了');
    const { commands } = listCommands({ userId: 'user-1' });
    expect(commands[0].status).toBe('done');
    // 日志的 action 列要能看出这条指令做了几件事。
    expect(commands[0].action).toBe('reply + reply');
  });

  it('按顺序执行 —— 「先发通知再建日程」的顺序是用户说的顺序', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: 'A' } },
        { action: 'reply', params: { text: 'B' } },
      ],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0].indexOf('A')).toBeLessThan(replies[0].indexOf('B'));
  });

  it('第二步失败时保留第一步的结果，并说清哪一步没做成', async () => {
    // 这是多步里最要紧的一条：只回一句报错的话，用户不知道消息其实已经发出去了，
    // 重下一遍就会发第二遍。
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: '消息已经发出去了' } },
        { action: 'reply', params: {} }, // 缺 text，reply 会抛错
      ],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('消息已经发出去了');
    expect(replies[0]).toContain('⚠️');
    // 必须明说「前面的已经生效了」，否则用户会整条重下。
    expect(replies[0]).toMatch(/已经生效|重复执行/);

    const { commands } = listCommands({ userId: 'user-1' });
    // 做成了一半算 failed —— 有一件事没办到，不能记成成功。
    expect(commands[0].status).toBe('failed');
    expect(commands[0].error).toBeTruthy();
  });

  it('第一步就失败时和以前的单步失败完全一样', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: {} },
        { action: 'reply', params: { text: '这一步不该被执行' } },
      ],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('执行失败');
    // 后面的步骤不再执行：多半会以同样的原因失败，而每次失败都会
    // 在回帖里堆一段权限说明。
    expect(replies[0]).not.toContain('这一步不该被执行');
    expect(listCommands({ userId: 'user-1' }).commands[0].status).toBe('failed');
  });

  it('第一步失败时缺权限的结构化原因照样落库', async () => {
    // 前面那条路径是新写的（不再重新抛给外层 catch），所以要单独守一下
    // error_detail 没丢 —— 少了它后台就渲染不出「一键补权限」按钮。
    const app = makeApp();
    // 复刻 SDK 抛出的形状：AxiosError 上挂 response.data。
    const axiosLike = new Error('Request failed with status code 400');
    (axiosLike as unknown as { response: { data: unknown } }).response = {
      data: { code: 230013, msg: 'Bot has NO availability to this user', log_id: 'LOG_Y' },
    };
    // 让**动作里那次飞书调用**抛（而不是让参数校验抛）：这条路径要验的是
    // describeCommandError 在多步循环里也认得 axios 形状。
    // 塞一个只有 task.v2.task.create 的假 client —— 断言 kind 而不只是
    // 「error_detail 非空」，否则假 client 少一层属性抛出 TypeError 时测试照样绿。
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [{ action: 'create_task', params: { summary: '写季度报告' } }],
    }));
    const { deps, settled } = makeDeps(app);
    deps.client = {
      task: { v2: { task: { create: async () => { throw axiosLike; } } } },
    } as unknown as Client;
    handleMessage(makeMsg(), deps);
    await settled;

    const row = getDatabase()
      .prepare('SELECT status, error_detail FROM feishu_commands LIMIT 1')
      .get() as { status: string; error_detail: string | null };
    expect(row.status).toBe('failed');
    expect(JSON.parse(row.error_detail!).kind).toBe('availability_denied');
  });

  it('步骤里混进一个不存在的动作名时，好的那一步照做', async () => {
    // parseIntent 会滤掉编造的动作名，但注册表在运行中被改过也可能走到这。
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: '这一步是好的' } },
        { action: 'drop_database', params: {} },
      ],
    }));
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('这一步是好的');
    expect(replies[0]).toContain('未知动作');
  });

  it('result 里保留顶层 summary —— 前端日志详情读的是这个字段', async () => {
    // 两个日志页都是 `JSON.parse(row.result).summary`，取不到就把整段 JSON
    // 糊在页面上。多步改造很容易只留 steps 数组而把它漏掉。
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: '第一步' } },
        { action: 'reply', params: { text: '第二步' } },
      ],
    }));
    const { deps, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const parsed = JSON.parse(listCommands({ userId: 'user-1' }).commands[0].result!);
    expect(parsed.summary).toContain('第一步');
    expect(parsed.summary).toContain('第二步');
    expect(parsed.steps).toHaveLength(2);
  });

  it('半成功时 result.summary 只含做成了的那几步', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: '这步成了' } },
        { action: 'reply', params: {} },
      ],
    }));
    const { deps, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    const row = listCommands({ userId: 'user-1' }).commands[0];
    const parsed = JSON.parse(row.result!);
    expect(parsed.summary).toBe('这步成了');
    // 失败原因走 error / error_detail，不在 result 里重复一遍。
    expect(parsed.summary).not.toContain('⚠️');
    expect(row.error).toBeTruthy();
  });

  it('每一步拿到自己的 stepIndex —— 幂等键要靠它区分', async () => {
    // 两步共用一个 client_token/uuid 时，第二个会被飞书静默判成重复：
    // 接口返回成功，我们回帖「已创建」，实际只有一个。
    const app = makeApp();
    const seen: Array<number | undefined> = [];
    vi.mocked(parseIntent).mockResolvedValue(intent({
      steps: [
        { action: 'reply', params: { text: 'a' } },
        { action: 'reply', params: { text: 'b' } },
      ],
    }));
    const replyAction = getAction('reply')!;
    const orig = replyAction.run;
    replyAction.run = async (params, ctx) => {
      seen.push(ctx.stepIndex);
      return orig.call(replyAction, params, ctx);
    };
    try {
      const { deps, settled } = makeDeps(app);
      handleMessage(makeMsg(), deps);
      await settled;
    } finally {
      replyAction.run = orig;
    }

    expect(seen).toEqual([0, 1]);
  });
});

describe('超上限被截断时要说出来', () => {
  it('回帖里点明「后面 N 件没有执行」，并落进 result', async () => {
    // 静默截断和「一件事静默消失」是同一个失败模式，而多步支持本来就是
     // 为了消灭后者：用户以为都办了，实际只办了前几件撤不回来的写操作。
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(
      intent({ steps: [{ action: 'reply', params: { text: '办了' } }], droppedSteps: 2 })
    );
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('没有执行');
    expect(replies[0]).toContain('2 件');
    const parsed = JSON.parse(listCommands({ userId: 'user-1' }).commands[0].result!);
    expect(parsed.dropped_steps).toBe(2);
    // 顶层 summary 只放做成了的那几步，警告不该混进去（前端日志详情读它）。
    expect(parsed.summary).toBe('办了');
  });

  it('没截断时回帖里没有这段警告（绝大多数指令走这条路）', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(
      intent({ steps: [{ action: 'reply', params: { text: '办了' } }] })
    );
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).not.toContain('没有执行');
    expect(JSON.parse(listCommands({ userId: 'user-1' }).commands[0].result!).dropped_steps)
      .toBeUndefined();
  });
});

describe('白名单外的会话要留痕', () => {
  it('拦下的同时在会话表上累加计数', () => {
    // 「@ 了没反应 + 日志里什么都没有」和「事件根本没进来」（连接断了、
    // 权限没发版）完全同形，而处置完全相反。计数是区分这两者的唯一线索。
    const app = makeApp({ allowed_chats: JSON.stringify(['oc_allowed']) });
    const { deps } = makeDeps(app);

    handleMessage(makeMsg({ chatId: 'oc_outside' }), deps);
    handleMessage(makeMsg({ messageId: 'om_2', chatId: 'oc_outside' }), deps);

    const rows = listChats(app.app_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].chat_id).toBe('oc_outside');
    expect(rows[0].reject_count).toBe(2);
    expect(rows[0].source).toBe('rejected');
  });

  it('不写指令日志 —— 否则任何人拉机器人进群就能往别人日志里灌行', () => {
    const app = makeApp({ allowed_chats: JSON.stringify(['oc_allowed']) });
    const { deps } = makeDeps(app);
    handleMessage(makeMsg({ chatId: 'oc_outside' }), deps);
    expect(listCommands({ userId: 'user-1' }).total).toBe(0);
    // 也不该占掉去重表的名额：以后放行了，这条消息还该能被正常处理。
    expect(claimEvent('om_msg_001', app.app_id, new Date().toISOString())).toBe(true);
  });
});

describe('「收到了」的表情', () => {
  it('在解析之前就贴，贴在用户自己那条消息上', async () => {
    // 回帖必然来得很晚（要调 LLM，忙时还排队），这十几秒里用户看到的是
    // 「@ 了没反应」—— 和真坏了同形，他会再 @ 一遍（被去重挡掉，更像没反应）。
    const app = makeApp();
    const order: string[] = [];
    vi.mocked(parseIntent).mockImplementation(async () => {
      order.push('parse');
      return intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] });
    });
    const acked: string[] = [];
    const { deps, settled } = makeDeps(app);
    deps.ack = async (messageId) => {
      order.push('ack');
      acked.push(messageId);
    };

    handleMessage(makeMsg(), deps);
    await settled;

    expect(acked).toEqual(['om_msg_001']);
    expect(order).toEqual(['ack', 'parse']);
  });

  it('贴表情失败不影响执行（少个 reaction 权限是最常见的原因）', async () => {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(
      intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] })
    );
    const { deps, replies, settled } = makeDeps(app);
    deps.ack = async () => { throw new Error('permission denied'); };

    handleMessage(makeMsg(), deps);
    await settled;

    expect(listCommands({ userId: 'user-1' }).commands[0].status).toBe('done');
    expect(replies[0]).toContain('ok');
  });
});

describe('额度/繁忙这类状态不套「❌ 执行失败」', () => {
  it('额度用完时回的是提示语气，不是报错', async () => {
    // 红叉会让用户跑去查连接和权限，而他要做的只是找人加额度。
    const app = makeApp();
    const quotaErr = new Error('今日 AI 额度已用完');
    quotaErr.name = 'QuotaExceededError';
    vi.mocked(parseIntent).mockRejectedValue(quotaErr);
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).not.toContain('执行失败');
    const row = listCommands({ userId: 'user-1' }).commands[0];
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });

  it('并发闸拒绝时告诉用户「本次没有执行任何操作」', async () => {
    // 这句承诺的前提是闸只包住意图解析（此时一个写操作都没发生），
    // 见 concurrency.ts —— 挪动它的位置这条断言就该失败。
    const app = makeApp();
    const busy = new Error('现在有点忙，本次没有执行任何操作，稍后再说一遍就行。');
    busy.name = 'TooBusyError';
    vi.mocked(parseIntent).mockRejectedValue(busy);
    const { deps, replies, settled } = makeDeps(app);

    handleMessage(makeMsg(), deps);
    await settled;

    expect(replies[0]).toContain('没有执行任何操作');
    expect(replies[0]).not.toContain('执行失败');
  });
});

describe('接上一轮追问', () => {
  /** 造一条已完成的 reply 指令 —— 也就是「助理刚刚反问过」。 */
  function seedClarification(overrides: {
    chatId?: string;
    senderOpenId?: string;
    createdAt?: string;
    action?: string;
    status?: string;
  } = {}) {
    getDatabase()
      .prepare(
        `INSERT INTO feishu_commands
           (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
            text, action, params, status, result, created_at, completed_at)
         VALUES (?, 'cli_test001', 'user-1', ?, ?, 'group', ?, '张三',
                 '约个评审会', ?, '{}', ?, ?, ?, ?)`
      )
      .run(
        `cmd-prior-${overrides.createdAt ?? 'now'}-${overrides.senderOpenId ?? 'ou_sender'}`,
        `om_prior_${Math.abs(hash(JSON.stringify(overrides)))}`,
        overrides.chatId ?? 'oc_chat_001',
        overrides.senderOpenId ?? 'ou_sender',
        overrides.action ?? 'reply',
        overrides.status ?? 'done',
        JSON.stringify({ summary: '你想约几点？' }),
        overrides.createdAt ?? new Date().toISOString(),
        overrides.createdAt ?? new Date().toISOString()
      );
  }

  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  /** 取这次 parseIntent 实际收到的 prior。 */
  function priorArg() {
    return vi.mocked(parseIntent).mock.calls[0][0].prior;
  }

  async function run(msg: Partial<InboundMessage> = {}) {
    const app = makeApp();
    vi.mocked(parseIntent).mockResolvedValue(
      intent({ steps: [{ action: 'reply', params: { text: 'ok' } }] })
    );
    const { deps, settled } = makeDeps(app);
    handleMessage(makeMsg({ text: '下午三点', ...msg }), deps);
    await settled;
  }

  it('上一条是助理的反问时，把那一问一答带给解析器', async () => {
    // 不带上文的话模型只看到「下午三点」四个字，只能再反问一次 ——
    // 反问这条路本来就走不通，而它是 reply 动作存在的全部理由。
    seedClarification();
    await run();
    expect(priorArg()).toEqual({ text: '约个评审会', reply: '你想约几点？' });
  });

  it('上一条是写操作时不带 —— 「再记一条」不该重放一次日志', async () => {
    // 上一轮已经写过东西了，把它当上文带下去，模型会把「再来一条」理解成
    // 「照上次那条再做一遍」—— 于是日志里多一条一样的记录、任务建两个。
    seedClarification({ action: 'add_diary_record' });
    await run();
    expect(priorArg()).toBeUndefined();
  });

  it('换个人说话时不带 —— 群里 A 被反问、B 随口一句不该成为 A 的补充', async () => {
    seedClarification({ senderOpenId: 'ou_other' });
    await run();
    expect(priorArg()).toBeUndefined();
  });

  it('换个会话时不带', async () => {
    seedClarification({ chatId: 'oc_elsewhere' });
    await run();
    expect(priorArg()).toBeUndefined();
  });

  it('隔得太久时不带 —— 明天的一句「好」不该接上今天悬着的问题', async () => {
    seedClarification({ createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
    await run();
    expect(priorArg()).toBeUndefined();
  });

  it('本条自己不会被当成上一轮（startCommand 已经先插了一行）', async () => {
    await run();
    expect(priorArg()).toBeUndefined();
  });
});
