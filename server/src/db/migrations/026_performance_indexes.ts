import type { Migration } from '../migrator.js';

export const migration_026: Migration = {
  id: '026_performance_indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
      CREATE INDEX IF NOT EXISTS idx_tenders_publish_date ON tenders(publish_date);
      CREATE INDEX IF NOT EXISTS idx_tenders_keyword ON tenders(keyword);
      CREATE INDEX IF NOT EXISTS idx_tenders_platform_status ON tenders(platform, status);
      CREATE INDEX IF NOT EXISTS idx_recommendations_user_created ON tender_recommendations(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_recommendations_user_tier ON tender_recommendations(user_id, tier);
      CREATE INDEX IF NOT EXISTS idx_recommendations_tender ON tender_recommendations(tender_id);
    `);
  },
};
