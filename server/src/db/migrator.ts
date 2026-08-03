import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  up: (db: Database.Database) => void;
  /**
   * 事务提交后执行的收尾动作，返回 true 表示需要执行。
   *
   * 存在的唯一原因是 VACUUM 之类不能在事务内运行的语句：
   * up() 整体跑在 db.transaction 里，直接调 VACUUM 会报
   * "cannot VACUUM from within a transaction"。
   * after() 只在本次真正应用了该迁移时调用，重跑不会触发。
   */
  after?: (db: Database.Database) => void;
}

export function initMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT id FROM migrations').all() as { id: string }[];
  return new Set(rows.map(r => r.id));
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  initMigrationTable(db);
  const applied = getAppliedMigrations(db);

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString()
      );
    });

    run();
    console.log(`[migrate] Applied: ${migration.id}`);

    // 收尾动作在事务外跑，失败不回滚迁移本身：
    // 迁移已经记账了，为一个清理步骤把数据改动一起退回来只会更糟。
    if (migration.after) {
      try {
        migration.after(db);
      } catch (e) {
        console.error(`[migrate] ${migration.id} 的收尾动作失败:`, (e as Error).message);
      }
    }
  }
}
