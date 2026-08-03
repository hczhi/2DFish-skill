import type { Migration } from '../migrator.js';
import { encryptSecret, isEncrypted } from '../../core/secrets.js';

// 把库里已有的第三方密钥就地加密。
//
// 之前 system_config.platform_api_key / web_search_api_key / cos_secret_key、
// ai_providers.api_key、tender_user_preferences.feishu_app_secret 全是明文。
// SQLite 就是一个文件，备份、误传、一次注入都能把整表读走 —— 这些 key
// 能直接产生账单或读写飞书数据，泄一次就得全部重开。
//
// 三点设计取舍：
//   1. encryptSecret 幂等（认前缀），所以这条迁移重跑不会把密文再套一层。
//   2. 只挑非空且未加密的行动，空值保持空 —— 上层用「空 = 未配置」判断。
//   3. 不动 users 表的 api_key（用户自填的 key）—— 那是另一批列，
//      放在后续迁移里单独处理，避免这条迁移横跨太多表难以回滚。
// up() 加密了几条，供 after() 判断要不要 VACUUM。
// 模块私有变量：migrator 保证同一条迁移的 up → after 在同一进程里紧接着跑。
let encryptedCount = 0;

export const migration_050: Migration = {
  id: '050_encrypt_secrets',
  up(db) {
    const SYSTEM_CONFIG_SECRET_KEYS = ['platform_api_key', 'web_search_api_key', 'cos_secret_key', 'cos_secret_id'];

    let n = 0;

    const cfgRows = db
      .prepare(
        `SELECT key, value FROM system_config WHERE key IN (${SYSTEM_CONFIG_SECRET_KEYS.map(() => '?').join(',')})`
      )
      .all(...SYSTEM_CONFIG_SECRET_KEYS) as Array<{ key: string; value: string }>;
    const updCfg = db.prepare('UPDATE system_config SET value = ? WHERE key = ?');
    for (const r of cfgRows) {
      if (!r.value || isEncrypted(r.value)) continue;
      updCfg.run(encryptSecret(r.value), r.key);
      n++;
    }

    if (tableExists(db, 'ai_providers')) {
      const rows = db.prepare('SELECT id, api_key FROM ai_providers').all() as Array<{ id: string; api_key: string }>;
      const upd = db.prepare('UPDATE ai_providers SET api_key = ? WHERE id = ?');
      for (const r of rows) {
        if (!r.api_key || isEncrypted(r.api_key)) continue;
        upd.run(encryptSecret(r.api_key), r.id);
        n++;
      }
    }

    if (columnExists(db, 'tender_user_preferences', 'feishu_app_secret')) {
      const rows = db
        .prepare('SELECT user_id, feishu_app_secret FROM tender_user_preferences')
        .all() as Array<{ user_id: string; feishu_app_secret: string }>;
      const upd = db.prepare('UPDATE tender_user_preferences SET feishu_app_secret = ? WHERE user_id = ?');
      for (const r of rows) {
        if (!r.feishu_app_secret || isEncrypted(r.feishu_app_secret)) continue;
        upd.run(encryptSecret(r.feishu_app_secret), r.user_id);
        n++;
      }
    }

    encryptedCount = n;
    if (n > 0) console.log(`[migration] 已加密 ${n} 条明文密钥`);
  },

  // UPDATE 只是把新值写进新页，装着明文的旧页进 freelist 但内容不清零 ——
  // 实测迁移跑完后 `strings app.db` 依然能原样捞出 sk-... 和 COS 凭据。
  // 不做这一步，整条迁移对「.db 文件被拷走」这个主要威胁等于没生效，
  // 而那正是加密要防的东西。
  //
  // 放在 after 里是因为 VACUUM 不能在事务内执行（up() 整体跑在事务里）。
  // 代价是重写一遍整个库文件，几 MB 的库耗时可以忽略，且只发生一次。
  after(db) {
    // 全新库没有任何明文要清，跳过：VACUUM 要重写整个库文件，
    // 而且打一行「已清除残留明文」的日志会让人误以为刚刚真有明文被处理。
    if (encryptedCount === 0) return;
    db.exec('VACUUM');
    console.log('[migration] 已 VACUUM，清除数据库空闲页中残留的明文密钥');
  },
};

function tableExists(db: any, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function columnExists(db: any, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}
