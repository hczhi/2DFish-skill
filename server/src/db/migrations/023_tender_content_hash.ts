import { createHash } from 'crypto';
import type { Migration } from '../migrator.js';

export const migration_023: Migration = {
  id: '023_tender_content_hash',
  up(db) {
    // Add content_hash column
    const cols = db.prepare('PRAGMA table_info(tenders)').all() as any[];
    if (!cols.some((c: any) => c.name === 'content_hash')) {
      db.exec(`ALTER TABLE tenders ADD COLUMN content_hash TEXT DEFAULT ''`);
    }

    // Backfill existing rows: md5(platform + ':' + title)
    const rows = db.prepare("SELECT id, platform, title FROM tenders WHERE content_hash = '' OR content_hash IS NULL").all() as any[];
    const updateStmt = db.prepare('UPDATE tenders SET content_hash = ? WHERE id = ?');
    for (const row of rows) {
      const hash = createHash('md5').update(`${row.platform}:${row.title}`).digest('hex');
      updateStmt.run(hash, row.id);
    }

    // Create unique index on content_hash (replaces platform+notice_id uniqueness)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_content_hash ON tenders(content_hash)`);
  },
};
