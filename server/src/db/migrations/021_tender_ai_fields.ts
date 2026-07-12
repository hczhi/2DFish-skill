import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const migration_021: Migration = {
  id: '021_tender_ai_fields',
  up(db) {
    addColumnIfNotExists(db, 'tenders', 'ai_extracted', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tenders', 'project_type', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tenders', 'project_location', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tenders', 'deadline', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tenders', 'qualification_requirements', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tenders', 'project_summary', "TEXT DEFAULT ''");

    addColumnIfNotExists(db, 'tender_recommendations', 'ai_analysis', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_recommendations', 'ai_strategy', "TEXT DEFAULT ''");
  },
};
