import type { Migration } from '../migrator.js';

// 接入点级别的「不使用深度思考」开关。
//
// 为什么是一列而不是 extra_json 里的一个键：extra_json 是后台一个自由文本框，
// 拼成 `noThink` / `no_thinking` / `"true"` 的后果是**完全静默** —— 保存成功、
// 界面和生效了一模一样，而每次调用照旧带思维链跑。这个开关本来就是为了治
// 「一切正常，只是慢十倍」，用一个自己也会静默失败的载体存它没有意义。
//
// 缺省 0（照旧思考）：勾上等于替所有走这条接入点的模块做决定，那必须是管理员的
// 一次明确动作，不能是升级之后突然全站都不想了 —— 靠长链推理的那些任务质量会掉，
// 而它们不报错，只是结论变浅。
//
// 语义是**单向的：只能强制关**（gateway 里跟调用方传的值取「或」）。反过来让它
// 强制开的话，consult 对话/草稿、标讯抽取/评分那几条写死 `noThinking: true` 的
// 路径会被后台一个勾选框悄悄改回慢的那一版 —— 那几处关掉它治的是截断和「等四分钟」，
// 不是省钱，而退回去之后现象只是「怎么又变慢了 / 又解析失败了」。
export const migration_087: Migration = {
  id: '087_provider_no_thinking',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ai_providers)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'no_thinking')) {
      db.exec(`ALTER TABLE ai_providers ADD COLUMN no_thinking INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
