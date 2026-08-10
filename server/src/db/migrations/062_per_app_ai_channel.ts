import type { Migration } from '../migrator.js';

// 「用户 → 应用」两级 AI 接入配置：在专属渠道（migration 052）之下再切一层，
// 让同一个用户的不同应用可以用不同的 key、不同的模型、不同的每日额度。
//
// ── 为什么用 source 字符串当「应用」，而不是新造一套 app 主键 ──
// gateway 的每次调用本来就带 `source`（'xhs' / 'tender' / 'feishu' / …，共 9 个字面量，
// 全部硬编码在 40 多个调用点里，没有一处是动态拼接的），而且它已经写进 ai_logs
// 用于统计。拿它当 scope 意味着**一个调用点都不用改**：
// 加一列、改解析函数，全站立刻具备按应用分流的能力。
//
// 代价是「配置里写的 app 名字必须和代码里的 source 一模一样」——
// 写错一个字符的表现是「配了但永远不生效」，而不是报错。
// 所以 core/llm/apps.ts 里有一份 AI_APPS 白名单：
//   - 后台下拉框只从它生成，管理员不可能手写错；
//   - 有一个测试扫全仓库的 `source: 'xxx'` 字面量，漏进白名单就红。
// 别把这一列改成自由文本输入。
//
// ── ai_providers.scope_app ──
// ''（默认）= 该 owner 的通用配置，行为与升级前完全一致。
// 有值 = 只在这个应用里生效。
// 解析顺序（同一 owner 内）：app+tier → app+default → 通用+tier → 通用+default。
//
// 为什么这里**允许**回落到通用配置，而 052 的跨 owner 回落是禁止的：
// 052 禁止的是「用户以为在花自己的钱、实际烧平台 key」——付钱的人变了，
// 是隐形成本。而这里回落的两条 provider 属于**同一个 owner**，钱的归属不变，
// 变的只是用哪一把自己的 key。二者不是同一类问题。
// 但「回落」这件事必须在配置时说出来，不能只在运行时发生：
// 后台面板会逐个应用显式列出「xhs / strong 未配 → 将使用本用户通用 strong」。
//
// ── ai_app_quota ──
// ai_quota 的主键是 user_id 一列，天然装不下「按应用限额」。新表是
// (user_id, app) 复合主键，语义是**额外的天花板，不替代用户总额**：
// 「这个用户一天总共 100 次，其中 xhs 最多 20 次」。
// 没有行 = 该应用不受应用级限制（所以这张表是纯 opt-in，老用户零影响）。
//
// 关键一条：**应用级额度对专属渠道用户同样生效。**
// 专属渠道之所以绕过 ai_quota，是因为那是「平台默认限流」，
// 而用户烧的是自己的 key，平台没有理由限他。但应用级额度是管理员
// 为这个用户的这个应用**特意配的一个数**，绕过它等于这个功能对
// 「有自己 token 的用户」完全失效 —— 而那恰好是提这个需求的场景。
export const migration_062: Migration = {
  id: '062_per_app_ai_channel',
  up(db) {
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

    if (!cols('ai_providers').includes('scope_app')) {
      // NOT NULL DEFAULT '' 而不是可空：解析里到处要拿它和 '' 比，
      // 混进 NULL 会让 `scope_app = ''` 漏掉老行（SQL 里 NULL = '' 是 NULL，不是真）。
      db.exec(`ALTER TABLE ai_providers ADD COLUMN scope_app TEXT NOT NULL DEFAULT ''`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_app_quota (
        user_id TEXT NOT NULL,
        app TEXT NOT NULL,
        daily_limit INTEGER NOT NULL DEFAULT 0,
        used_today INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT NOT NULL,
        PRIMARY KEY (user_id, app)
      );
    `);

    // 解析走的是 (owner, kind, scope_app, tier, enabled)，把 scope_app 加进索引。
    // 052 的 idx_ai_providers_owner 不删：列表页按 owner 查还在用它。
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_providers_owner_scope
        ON ai_providers (owner_user_id, kind, scope_app, tier, enabled);
    `);
  },
};
