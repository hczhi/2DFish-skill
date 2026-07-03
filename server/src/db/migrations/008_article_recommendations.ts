import type { Migration } from '../migrator.js';

export const migration_008: Migration = {
  id: '008_article_recommendations',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discover_article_recommendations (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        recommended_article_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(article_id, recommended_article_id, locale),
        FOREIGN KEY (article_id) REFERENCES discover_articles(id) ON DELETE CASCADE,
        FOREIGN KEY (recommended_article_id) REFERENCES discover_articles(id) ON DELETE CASCADE
      );
    `);
  },
};
