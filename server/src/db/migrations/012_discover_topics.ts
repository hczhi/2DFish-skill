import type { Migration } from '../migrator.js';

export const migration_012: Migration = {
  id: '012_discover_topics',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discover_topics (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        cover_image TEXT DEFAULT '',
        icon TEXT DEFAULT '',
        bg_color TEXT DEFAULT '#f0f5ff',
        template TEXT DEFAULT 'default',
        sort_order INTEGER DEFAULT 0,
        visible_locales TEXT DEFAULT '[]',
        status TEXT DEFAULT 'draft',
        static_generated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discover_topic_contents (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        seo_title TEXT DEFAULT '',
        seo_description TEXT DEFAULT '',
        seo_keywords TEXT DEFAULT '',
        FOREIGN KEY (topic_id) REFERENCES discover_topics(id) ON DELETE CASCADE,
        UNIQUE(topic_id, locale)
      );

      ALTER TABLE discover_articles ADD COLUMN topic_id TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_discover_articles_topic ON discover_articles(topic_id);
    `);
  },
};
