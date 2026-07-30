import type { Migration } from '../migrator.js';

// 修正 046。
//
// 046 最初的版本把「全部标讯」的同步状态位做成了 tenders.bitable_synced_at 单列，
// 那是错的：标讯数据全平台共享，而多维表格是 per-user 的（每家公司在自己飞书里建应用）。
// 单列状态位会被第一个用户写满，第二家公司的「全部标讯」表就永久收不到数据，且静默无错。
// 046 已在部分库上执行过（迁移记录只认 id，改文件不会重跑），所以修正放在这里。
//
// 本迁移做三件事，全部幂等：
// 1. 建 per-user 状态位关联表（046 新版本也会建，这里是给已跑过旧版的库补上）
// 2. 删掉 tenders 上那条为旧设计建的索引
// 3. 删掉 tenders.bitable_synced_at 遗留列（必须先删索引，否则 DROP COLUMN 会失败）
export const migration_047: Migration = {
  id: '047_tender_bitable_sync_fix',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_bitable_sync (
        user_id   TEXT NOT NULL,
        tender_id TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, tender_id)
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tender_bitable_sync_user
      ON tender_bitable_sync (user_id, tender_id)
    `);

    db.exec('DROP INDEX IF EXISTS idx_tenders_bitable_sync');

    // DROP COLUMN 需要 SQLite ≥ 3.35。低版本就留着这一列不管 ——
    // 代码里已经不再读写它，留着只是多占一列，不影响正确性。
    const cols = db.prepare('PRAGMA table_info(tenders)').all() as any[];
    if (cols.some((c: any) => c.name === 'bitable_synced_at')) {
      try {
        db.exec('ALTER TABLE tenders DROP COLUMN bitable_synced_at');
      } catch {
        /* 旧版 SQLite 不支持 DROP COLUMN，忽略 */
      }
    }
  },
};
