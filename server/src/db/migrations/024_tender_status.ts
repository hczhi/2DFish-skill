import type { Migration } from '../migrator.js';

export const migration_024: Migration = {
  id: '024_tender_status',
  up(db) {
    // Add status column to tenders table
    const cols = db.prepare('PRAGMA table_info(tenders)').all() as any[];
    if (!cols.some((c: any) => c.name === 'status')) {
      db.exec(`ALTER TABLE tenders ADD COLUMN status TEXT DEFAULT 'draft'`);
    }

    // Backfill: tenders that already have recommendations get 'scored',
    // tenders that have ai_extracted get 'extracted', rest stay 'draft'
    db.exec(`
      UPDATE tenders SET status = 'scored'
      WHERE id IN (SELECT DISTINCT tender_id FROM tender_recommendations)
      AND (status IS NULL OR status = 'draft')
    `);
    db.exec(`
      UPDATE tenders SET status = 'extracted'
      WHERE ai_extracted IS NOT NULL AND ai_extracted != ''
      AND (status IS NULL OR status = 'draft')
    `);
  },
};
