import type { Migration } from '../migrator.js';

// 每个飞书应用自己的「本企业补充规则」。
//
// ── 为什么不能继续用 skill slot ──
// `prompt_skill_bindings` 的主键就是 `slot` 一列，`getSkillForSlot()` 查的是
// `WHERE slot = ?` —— 全平台一份。而这段内容的全部作用是描述**某一家公司**
// 怎么说话（他们把「大区会」叫什么、说「下班前」指几点、哪个部门叫什么简称）。
// 多租户下共用一份的后果是 A 公司写的术语进了 B 公司的 prompt：不致命
// （这段只影响"怎么听懂人话"，动作清单/JSON 格式/open_id 约束都在代码里），
// 但语义上就是错的，而且 B 公司的人无从知道自己的助理为什么偶尔理解偏了。
//
// ── 为什么键是 app_id 而不是 user_id ──
// 一个平台账号可以绑多个应用，而**一个应用 = 一个飞书租户**。按账号存的话，
// 一个代理商账号帮三家公司各绑一个应用时，三家又共用一段，等于把问题从
// 平台级缩到账号级而没消掉。名册（057）和会话（058）都按 app_id 隔离，
// 理由一样：这些数据描述的是那个企业，不是那个平台账号。
//
// ── 为什么是一列文本，而不是接进 skill 注册表 ──
// 后台 skill 注册表有多文件、{{ref:xxx}} 展开、enable 开关、slot 绑定 ——
// 那是给平台做提示词工程用的机械。企业用户要的只有一件事：写下我们公司怎么说话。
// 给他一个文本框，比给他「建 skill → 加文件 → 绑 slot」三步流程更可能真被填。
//
// 平台那份（migration 056 播的示例模板）**退化成默认值**：应用自己填了就用
// 应用的，不叠加。那份模板本身是说明性的示例，垫在公司规则底下只是噪音。
export const migration_059: Migration = {
  id: '059_feishu_intent_supplement',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_apps)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'intent_supplement')) {
      db.exec(`ALTER TABLE feishu_apps ADD COLUMN intent_supplement TEXT NOT NULL DEFAULT ''`);
    }
  },
};
