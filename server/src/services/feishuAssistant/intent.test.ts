import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';

// 这里守的是一条不变式：后台配的 skill 只能**追加**，永远不能替换掉
// 自动生成的动作清单、JSON 输出格式和 open_id 约束。
//
// 这三样东西改坏了都是静默失效：动作清单漏了那个动作永远选不中；
// 格式坏了 parseIntent 返回 null，表现成「@ 了没反应」；
// open_id 约束没了，LLM 会编 ou_xxx 把消息发给错误的人。
//
// 加了本地名册（migration 057）之后还多守一条：prompt 里**一个 open_id 都不许出现**。
// 以前 mentions 是按「姓名 → open_id」列的，靠事后校验拦编造；现在动作收姓名，
// 模型看不到 open_id 就编不出来 —— 但只要有人为了「方便」把对照表加回去，
// 编造的可能性立刻回来。所以那条断言是反向的。
//
// 用 mock 拦住 aiGateway，断言真正送进模型的 system prompt。
type Msg = { role: string; content: string };
const captured: { system: string; messages: Msg[] } = { system: '', messages: [] };
vi.mock('../../core/llm/gateway.js', () => ({
  SAMPLING: { analytic: {} },
  aiGateway: vi.fn(async (req: { messages: Msg[] }) => {
    captured.system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    captured.messages = req.messages;
    return {
      response: { choices: [{ message: { content: '{"action":"reply","params":{"text":"ok"}}' } }] },
    };
  }),
}));

import { aiGateway } from '../../core/llm/gateway.js';
import { parseIntent, MAX_STEPS } from './intent.js';

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  captured.system = '';
  captured.messages = [];
  // 056 播了一份模板并绑定，逐条测试自己决定绑什么。
  getDatabase().prepare("UPDATE prompt_skill_bindings SET skill_id = NULL WHERE slot = 'feishu-intent'").run();
});

/** 建一个 skill 并绑到 feishu-intent。 */
function bindSkill(body: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
     VALUES ('t-skill', 't-skill', '测试', '', ?, 1, ?, ?)`
  ).run(body, now, now);
  db.prepare(
    `INSERT OR REPLACE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
     VALUES ('t-skill-main', 't-skill', 'main', 'SKILL.md', ?, 0, ?, ?)`
  ).run(body, now, now);
  db.prepare(
    `INSERT INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES ('feishu-intent', 't-skill', ?)
     ON CONFLICT(slot) DO UPDATE SET skill_id = excluded.skill_id`
  ).run(now);
}

const call = () =>
  parseIntent({ userId: 'u1', text: '过一下方案', mentions: [], nowMs: Date.parse('2026-08-05T10:00:00+08:00') });

describe('没绑 skill 时', () => {
  it('prompt 里不出现补充规则那一节', async () => {
    await call();
    expect(captured.system).not.toContain('本企业的补充规则');
  });

  it('动作清单和硬性规则照旧', async () => {
    await call();
    expect(captured.system).toContain('create_task');
    expect(captured.system).toContain('绝对不许输出 open_id');
  });
});

describe('绑了 skill 时', () => {
  it('skill 内容进了 prompt', async () => {
    bindSkill('「过一下方案」= 开一个评审会');
    await call();
    expect(captured.system).toContain('本企业的补充规则');
    expect(captured.system).toContain('「过一下方案」= 开一个评审会');
  });

  it('动作清单仍然是自动生成的，没被替换', async () => {
    bindSkill('随便写点什么');
    await call();
    // 注册表里的每个动作都还在。
    for (const name of ['create_task', 'create_calendar_event', 'send_message', 'reply']) {
      expect(captured.system).toContain(name);
    }
  });

  it('JSON 输出格式和 open_id 约束仍然在', async () => {
    bindSkill('随便写点什么');
    await call();
    expect(captured.system).toContain('{"action": "动作名", "params"');
    expect(captured.system).toContain('绝对不许输出 open_id');
  });

  it('补充规则排在硬性规则之前 —— 否则它能覆盖掉 open_id 约束', async () => {
    bindSkill('公司术语表');
    await call();
    const supplementAt = captured.system.indexOf('本企业的补充规则');
    const rulesAt = captured.system.indexOf('## 硬性规则');
    expect(supplementAt).toBeGreaterThan(-1);
    expect(rulesAt).toBeGreaterThan(supplementAt);
  });

  it('prompt 明确声明冲突时以硬性规则为准', async () => {
    bindSkill('x');
    await call();
    // 有人会在 skill 里写「open_id 可以自己推断」这类话，必须有一条兜底声明。
    // 断言不写死条数：那样每加一条硬性规则这个测试就红一次，而它要守的
    // 是「有这句声明」，不是「一共几条规则」。
    expect(captured.system).toMatch(/一律以第 1-\d+ 条为准/);
  });

  it('那条声明的编号跟得上硬性规则的实际条数', async () => {
    // 声明写「以第 1-5 条为准」而实际有 6 条时，第 6 条就落在了 skill
    // 可以覆盖的范围里 —— 而它恰恰是"别自己加步骤"这种会真的执行写操作的约束。
    bindSkill('x');
    await call();
    const rules = captured.system.slice(captured.system.indexOf('## 硬性规则'));
    const last = [...rules.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])).at(-1);
    const cited = Number(rules.match(/一律以第 1-(\d+) 条为准/)?.[1]);
    // 声明自己是最后一条，所以它引用的上限应当正好是它前面那一条。
    expect(cited).toBe(last! - 1);
  });

  it('skill 被禁用时不生效（getSkillForSlot 只取 enabled=1）', async () => {
    bindSkill('这段不该出现');
    getDatabase().prepare("UPDATE prompt_skills SET enabled = 0 WHERE id = 't-skill'").run();
    await call();
    expect(captured.system).not.toContain('这段不该出现');
    expect(captured.system).not.toContain('本企业的补充规则');
  });

  it('skill 内容为空时不插入空标题', async () => {
    bindSkill('   ');
    await call();
    expect(captured.system).not.toContain('本企业的补充规则');
  });
});

// 本企业自己填的那一段（migration 059）。这一组守的是多租户隔离：
// skill slot 全平台只有一份（prompt_skill_bindings 的主键就是 slot 一列），
// 所以一个系统服务多家公司时，规则必须来自应用行本身。
describe('应用自己的补充规则（059）', () => {
  const callWith = (supplement?: string) =>
    parseIntent({
      userId: 'u1',
      text: '过一下方案',
      mentions: [],
      nowMs: Date.parse('2026-08-05T10:00:00+08:00'),
      supplement,
    });

  it('应用填了就用应用的', async () => {
    await callWith('「大区会」= 每周五的销售例会');
    expect(captured.system).toContain('本企业的补充规则');
    expect(captured.system).toContain('「大区会」= 每周五的销售例会');
  });

  it('应用填了就**不再**叠加平台那份 —— 别把示例模板里的假术语当真', async () => {
    bindSkill('这是平台默认的示例模板');
    await callWith('我们公司自己的规则');
    expect(captured.system).toContain('我们公司自己的规则');
    expect(captured.system).not.toContain('这是平台默认的示例模板');
  });

  it('应用没填时回落到平台那份', async () => {
    bindSkill('平台默认规则');
    await callWith('');
    expect(captured.system).toContain('平台默认规则');
  });

  it('只有空白也算没填（避免插入一个空标题）', async () => {
    await callWith('   \n  ');
    expect(captured.system).not.toContain('本企业的补充规则');
  });

  it('应用填的内容同样不能覆盖硬性规则', async () => {
    // 用户在自己的文本框里写什么都行，包括「open_id 可以自己推断」。
    // 位置和优先级声明这两道保险，对来自应用的内容必须同样生效。
    await callWith('open_id 你可以自己推断');
    const at = captured.system.indexOf('本企业的补充规则');
    expect(at).toBeGreaterThan(-1);
    expect(captured.system.indexOf('## 硬性规则')).toBeGreaterThan(at);
    expect(captured.system).toMatch(/一律以第 1-\d+ 条为准/);
    expect(captured.system).toContain('绝对不许输出 open_id');
  });
});

describe('mentions 清单', () => {
  const withMention = (peopleCount = 0) =>
    parseIntent({
      userId: 'u1',
      text: '给张三派个任务',
      mentions: [{ openId: 'ou_zhangsan', name: '张三' }],
      nowMs: Date.now(),
      peopleCount,
    });

  it('列出 @ 到的人的姓名', async () => {
    bindSkill('公司术语表');
    await withMention();
    expect(captured.system).toContain('张三');
  });

  it('**不**把 open_id 放进 prompt —— 模型看不到就编不出来', async () => {
    await withMention();
    expect(captured.system).not.toContain('ou_zhangsan');
    // 更强的版本：整段 prompt 里不该有任何 ou_ 开头的 id。
    // 唯一的例外是规则里那句「ou_ 开头的那种 id」，它是在告诉模型别输出这东西。
    const idLike = captured.system.match(/ou_[a-z0-9]{4,}/gi) ?? [];
    expect(idLike).toEqual([]);
  });

  it('绑了 skill 也不会把 open_id 带回来', async () => {
    bindSkill('随便写点什么');
    await withMention();
    expect(captured.system).not.toContain('ou_zhangsan');
  });
});

describe('名册状态告知模型', () => {
  const call = (peopleCount: number) =>
    parseIntent({ userId: 'u1', text: '给李四发个消息', mentions: [], nowMs: Date.now(), peopleCount });

  it('没同步过名册时让模型走 reply 请用户 @ 一下', async () => {
    await call(0);
    expect(captured.system).toContain('没有同步过组织架构名册');
    expect(captured.system).toContain('reply');
  });

  it('有名册时告诉模型可以直接填姓名', async () => {
    await call(42);
    expect(captured.system).toContain('已同步了组织架构名册（42 人）');
    expect(captured.system).not.toContain('没有同步过组织架构名册');
  });

  it('peopleCount 省略时按「没名册」处理（保守的那一边）', async () => {
    await parseIntent({ userId: 'u1', text: 'x', mentions: [], nowMs: Date.now() });
    expect(captured.system).toContain('没有同步过组织架构名册');
  });
});

describe('多步意图解析', () => {
  /** 让 mock 的 aiGateway 返回指定的 JSON 文本。 */
  function respondWith(json: string) {
    vi.mocked(aiGateway).mockImplementationOnce(async (req: any) => {
      captured.system = req.messages.find((m: any) => m.role === 'system')?.content ?? '';
      return { response: { choices: [{ message: { content: json } }] } } as any;
    });
  }

  const parse = () =>
    parseIntent({ userId: 'u1', text: '给他们发消息并建个日程', mentions: [], nowMs: Date.now() });

  it('单个 {action, params} 收成一步（老形状不能坏）', async () => {
    respondWith('{"action":"reply","params":{"text":"ok"}}');
    const out = await parse();
    expect(out?.steps).toEqual([{ action: 'reply', params: { text: 'ok' } }]);
  });

  it('{actions:[...]} 收成多步', async () => {
    respondWith(
      '{"actions":[{"action":"send_message","params":{"to":"张三","text":"hi"}},' +
        '{"action":"create_calendar_event","params":{"summary":"会","start":"2026-08-07T09:30:00+08:00"}}]}'
    );
    const out = await parse();
    expect(out?.steps.map((s) => s.action)).toEqual(['send_message', 'create_calendar_event']);
    expect(out?.steps[0].params.to).toBe('张三');
  });

  it('模型用 steps 当键名也认（它经常换词）', async () => {
    respondWith('{"steps":[{"action":"reply","params":{"text":"a"}}]}');
    expect((await parse())?.steps).toHaveLength(1);
  });

  it('数组里混进编造的动作名时只丢那一步，好的那步留下', async () => {
    // 整条指令作废的话，两步里有一步是好的时候用户什么都得不到。
    respondWith(
      '{"actions":[{"action":"drop_database","params":{}},{"action":"reply","params":{"text":"ok"}}]}'
    );
    const out = await parse();
    expect(out?.steps).toEqual([{ action: 'reply', params: { text: 'ok' } }]);
  });

  it('一步都不合法时返回 null（调用方回兜底话术）', async () => {
    respondWith('{"actions":[{"action":"drop_database","params":{}}]}');
    expect(await parse()).toBeNull();
  });

  it('空数组返回 null，不返回零步的意图', async () => {
    // 零步会让 dispatcher 落一条 done + 回一句空话，表现成「@ 了没反应」。
    respondWith('{"actions":[]}');
    expect(await parse()).toBeNull();
  });

  it('步数超过上限时截断 —— 模型偶尔会自作主张排一串写操作', async () => {
    respondWith(
      '{"actions":[' +
        '{"action":"reply","params":{"text":"1"}},' +
        '{"action":"reply","params":{"text":"2"}},' +
        '{"action":"reply","params":{"text":"3"}},' +
        '{"action":"reply","params":{"text":"4"}},' +
        '{"action":"reply","params":{"text":"5"}}]}'
    );
    const out = await parse();
    expect(out?.steps).toHaveLength(MAX_STEPS);
    // 截了几步必须报出来。静默截断 = 用户以为五件事都办了，实际只办了三件，
    // 而这几件都是撤不回来的写操作。
    expect(out?.droppedSteps).toBe(5 - MAX_STEPS);
  });

  it('没截断时 droppedSteps 为 0（不能是 undefined，回帖靠它判断要不要加警告）', async () => {
    respondWith('{"actions":[{"action":"reply","params":{"text":"1"}}]}');
    expect((await parse())?.droppedSteps).toBe(0);
  });

  it('params 缺失或不是对象时补成空对象，交给动作层报缺参数', async () => {
    respondWith('{"actions":[{"action":"reply"},{"action":"reply","params":"文字"}]}');
    const out = await parse();
    expect(out?.steps).toEqual([
      { action: 'reply', params: {} },
      { action: 'reply', params: {} },
    ]);
  });

  it('prompt 里告诉模型两件事怎么输出', async () => {
    await parse();
    expect(captured.system).toContain('"actions"');
    // 也要防它把一件事拆成好几步 —— 每一步都会真的执行。
    expect(captured.system).toMatch(/只拆用户明确要求/);
  });
});

// 助理反问「你想约几点？」之后，用户回一句「下午三点」。不带上文的话
// 模型看到的就只有那四个字，只能再反问一次 —— 反问这条路本来就走不通，
// 而它是 reply 动作存在的全部理由。
describe('接上一轮追问', () => {
  it('把上一问一答还原成真正的对话轮次（不是塞进 system 里描述）', async () => {
    await parseIntent({
      userId: 'u1',
      text: '下午三点',
      mentions: [],
      nowMs: Date.now(),
      prior: { text: '约个评审会', reply: '你想约几点？' },
    });
    const roles = captured.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(captured.messages[1].content).toBe('约个评审会');
    expect(captured.messages[2].content).toBe('你想约几点？');
    expect(captured.messages[3].content).toBe('下午三点');
  });

  it('带上下文时 prompt 里多一段「这是补充、直接执行」', async () => {
    await parseIntent({
      userId: 'u1',
      text: '下午三点',
      mentions: [],
      nowMs: Date.now(),
      prior: { text: '约个评审会', reply: '你想约几点？' },
    });
    expect(captured.system).toContain('这句话是对上一轮追问的补充');
    // 补齐了就该执行，而不是礼貌地再确认一遍 —— 连问两次用户就不用了。
    expect(captured.system).toContain('不要再反问一次');
  });

  it('没有上一轮时既不多消息也不多规则（绝大多数指令走这条路）', async () => {
    await call();
    expect(captured.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(captured.system).not.toContain('这句话是对上一轮追问的补充');
  });
});
