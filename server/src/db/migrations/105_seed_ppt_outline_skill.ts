import type { Migration } from '../migrator.js';

// 播种「展示稿提纲 · 补充规范」skill，并绑到 slot `ppt-outline`。
//
// 为什么播一份模板而不是留空：这个 slot 的价值全在「写什么」上，而后台那个下拉里
// 没绑东西的时候，界面上完全看不出这里可以配 —— 这个能力于是等于不存在。
// 示例全部是注释性的句子，不改也不影响行为（它是**追加**在 `library/outline-craft.md`
// 后面的，冲突时以那份为准，见 outlineChatService.buildSystem）。
//
// 这份 body 里**不许出现输出格式和那对提纲标记**：标记由代码写进 prompt 也由代码抠出来
// （硬规则 3）。在这里再写一遍的话，改了代码那边之后这份里的旧标记还在，模型照着旧的写，
// 表现是「聊得很好但一直不出提纲」，而每一轮都是一次真实调用。
//
// 沿用 056 的做法：INSERT OR IGNORE，已存在就不覆盖（后台可能已经改过了）。
const BODY = `以下规则用来补充本账号的行业习惯和表达偏好。
不要在这里写输出格式、提纲的开始/结束标记、分页规则 —— 那些由系统保证，
写在这里无效，写错了还会让每一轮都白花一次额度。

## 我常讲的场合

（例如：）

- 大部分是给甲方讲方案，结尾一定要有「下一步怎么配合」那一页
- 内部复盘时不要写「感谢聆听」这类客套页

## 我们的说法

（把行业/公司内部叫法写下来，例如：）

- 我们叫「交付节奏」，不叫「项目排期」
- 提到产品时用全称，不要缩写

## 结构偏好

（例如：）

- 开头先讲结论，不要先铺行业背景
- 每一页的标题写成一句有动词的话，不要写「关于XX的介绍」
- 一份 30 分钟的稿子控制在 12-16 页

## 底线

- 我没给的数字、客户名、时间一个都不要编 —— 编出来的会被逐字排进页面，
  而那一页读起来和真的一模一样。
`;

export const migration_105: Migration = {
  id: '105_seed_ppt_outline_skill',
  up(db) {
    const now = new Date().toISOString();

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      'ppt-outline',
      'ppt-outline',
      '展示稿提纲 · 补充规范',
      '「生成提纲」对话页用的补充规范：行业说法、结构偏好、常讲的场合。追加在平台那份提纲规范后面，不覆盖它。',
      BODY,
      now,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run('ppt-outline-main', 'ppt-outline', BODY, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run('ppt-outline', 'ppt-outline', now);
  },
};
