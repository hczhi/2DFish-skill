import type { Migration } from '../migrator.js';

/**
 * BP 分析对第三方开放（品牌咨询的 key / iframe 嵌入）。
 *
 * - `sdk_pk / external_uid`：嵌入版的归属键（同 consult 085）。嵌入版所有终端用户共用绑定账号的 user_id，
 *   只按 user_id 查的话 A 客户的 BP 出现在 B 客户的列表里，而那是一列正常的报告。
 * - `points_key_id / points_held / charged`：key 用户一份报告固定点数（bp/billing.ts）。冻结额要落库：
 *   报告在后台跑几分钟，进程重启时内存里的冻结记录没了，那几百点会永远冻在 app_keys.frozen 里
 *   （余额看着够、可用点数却莫名少一截）。启动收尸时按这一列解冻。
 * - `bp_usage`：每个 owner（key / pk）每天开跑几次（新建 + 续跑 + 重跑都算）。一份报告约 30 次联网检索，
 *   而嵌入用的 pk 是公开字符串 —— 不封顶的话白名单域名内一个循环就能刷几百份。
 */
export const migration_128: Migration = {
  id: '128_bp_third_party',
  up(db) {
    const cols = new Set((db.prepare(`PRAGMA table_info(bp_reports)`).all() as { name: string }[]).map((c) => c.name));
    const add = (name: string, ddl: string) => { if (!cols.has(name)) db.exec(`ALTER TABLE bp_reports ADD COLUMN ${ddl}`); };
    add('sdk_pk', 'sdk_pk TEXT');
    add('external_uid', 'external_uid TEXT');
    add('points_key_id', 'points_key_id TEXT');
    add('points_held', 'points_held INTEGER NOT NULL DEFAULT 0');
    add('charged', 'charged INTEGER NOT NULL DEFAULT 0');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bp_reports_owner ON bp_reports (user_id, sdk_pk, external_uid, created_at);
      CREATE TABLE IF NOT EXISTS bp_usage (
        owner TEXT NOT NULL,
        day TEXT NOT NULL,
        runs INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner, day)
      );
    `);
  },
};
