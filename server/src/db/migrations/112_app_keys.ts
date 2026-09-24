import type { Migration } from '../migrator.js';

// 售卖型应用 key（淘宝发卡 / 网页购买）：对外没有登录注册，一把 key = 一个用户，只对一个应用有效。
//
// 和 SDK pk（084 / 100）不是一回事：pk 是写在第三方页面里的公开串，防线是域名白名单；
// 这里的 key 是**秘密**，谁拿到谁就能花里面的点数、看里面的稿子。
//
// 三条边界：
// ① 余额只允许通过 `app_key_ledger` 变动（同一个事务里改 balance + 插一行流水）。
//    只改 balance 的话买家说「我没用却扣了」时拿不出任何一行对得上的记录，而列表上的余额
//    看起来完全正常。流水的 balance_after 就是对账依据。
// ② 不提供 DELETE，只停用：删掉 key 连带删流水 = 那笔钱的来龙去脉没了；只删 key 不删流水 =
//    一堆指向空行的记录。
// ③ 明文另存一份 AES-GCM（`key_enc`）：批量生成之后要贴进淘宝自动发货、买家丢了 key 找客服，
//    都要能再看一次。查找仍走 sha256（`key_hash`），不解密比对。
export const migration_112: Migration = {
  id: '112_app_keys',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_keys (
        id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_enc TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        batch_id TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        user_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_app_keys_app ON app_keys(app, created_at DESC)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_key_ledger (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        operation TEXT NOT NULL DEFAULT '',
        ai_log_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_app_key_ledger_key ON app_key_ledger(key_id, created_at DESC)`);
  },
};
