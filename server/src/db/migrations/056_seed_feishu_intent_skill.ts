import type { Migration } from '../migrator.js';

// 播种飞书助理的「指令理解补充规则」skill，并绑定到 slot feishu-intent。
//
// 为什么给的是一份带示例的模板而不是空 skill：这个 slot 的价值全在
// 「写什么」上，而管理员面对一个空文本框通常不知道该写什么，
// 于是这个功能就等于不存在。示例全部注释掉，绑定后不改也不影响行为。
//
// 沿用 040 的做法：INSERT OR IGNORE，已存在就不覆盖（后台可能已经改过了）。
const BODY = `以下规则用于帮助助理听懂本企业的说话方式。
不要在这里写输出格式、动作清单或 open_id 相关的规则 —— 那些由系统保证，
写在这里无效，写错了还可能让指令解析失效。

## 术语与简称

（把公司内部叫法翻译成助理能理解的意思，例如：）

- 「过一下方案」= 开一个评审会
- 「拉个会」= 创建日程
- 「报一下」「同步一下」= 给对方发消息，不是建任务

## 时间习惯

（例如：）

- 「早会」默认指 09:30
- 「下班前」默认指当天 18:00
- 说「周会」时默认为每周一 10:00

## 部门与职责

（例如：）

- 提到「验收」「上线」相关的事，默认建任务而不是日程
- 提到「客户」相关的事，任务标题里带上客户名

## 倾向

- 用户说得模糊时，宁可用 reply 问一句，也不要猜着建任务或发消息。
`;

export const migration_056: Migration = {
  id: '056_seed_feishu_intent_skill',
  up(db) {
    const now = new Date().toISOString();

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      'feishu-intent',
      'feishu-intent',
      '飞书助理 · 指令理解补充规则',
      '让助理听懂本企业的术语、简称、时间习惯。追加在自动生成的解析 prompt 上，不覆盖动作清单和输出格式。',
      BODY,
      now,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run('feishu-intent-main', 'feishu-intent', BODY, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run('feishu-intent', 'feishu-intent', now);
  },
};
