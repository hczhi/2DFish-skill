import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  up: (db: Database.Database) => void;
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
  }
}
