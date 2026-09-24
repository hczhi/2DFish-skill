import type { Migration } from '../migrator.js';

// 应用 key 的冻结点数：一次 AI 调用开始前先冻结它的价，成功才结算成流水里的一笔 charge，
// 失败就解冻。可用点数 = balance − frozen。
//
// 不先冻结、结算时才扣的话，两个并发请求都会在余额只够一次时放行（各自都看见「够」），
// 余额最后被拒扣、而两次调用都已经花了平台的钱。
export const migration_113: Migration = {
  id: '113_app_key_frozen',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(app_keys)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'frozen')) {
      db.exec('ALTER TABLE app_keys ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0');
    }
  },
};
