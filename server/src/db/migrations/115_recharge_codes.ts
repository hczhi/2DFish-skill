import type { Migration } from '../migrator.js';

// 充值码：给已有的应用 key 加点数（淘宝/小红书发货发的是码，不是新 key —— 发新 key 的话稿子留在旧卡上）。
//
// status 三态：unused（生成了还没发出去）→ issued（管理员标了「已发放」）→ used（买家充进了某把 key）。
// 「已发放」只是后台记账用的：买家拿到一张管理员忘了标发放的码照样能充，拒掉的话他付了钱却看到一句报错。
//
// 两条边界：
// ① 置 used 和加点数必须在同一个事务里，且 UPDATE 带 `status != 'used'` 条件 —— 先读再写的话双击/两个标签页
//    会各自看见「未使用」，同一张码加两遍点，而两次都回「充值成功」。
// ② 和 key 一样只停不删（这里压根没有删除）：删了的话买家拿着码来问「为什么充不上」时查不到它去哪了。
export const migration_115: Migration = {
  id: '115_recharge_codes',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recharge_codes (
        id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        code_enc TEXT NOT NULL,
        code_prefix TEXT NOT NULL,
        points INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        batch_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unused',
        issued_at TEXT,
        used_at TEXT,
        used_key_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recharge_codes_app ON recharge_codes(app, created_at DESC)`);
  },
};
