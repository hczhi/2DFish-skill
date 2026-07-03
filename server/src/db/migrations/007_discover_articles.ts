import type { Migration } from '../migrator.js';

export const migration_007: Migration = {
  id: '007_discover_articles',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discover_articles (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        cover_image TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '',
        bg_color TEXT NOT NULL DEFAULT '#f0f5ff',
        avatar_color TEXT NOT NULL DEFAULT '#0077ff',
        sort_order INTEGER NOT NULL DEFAULT 0,
        visible_locales TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        static_generated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discover_article_contents (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        seo_title TEXT NOT NULL DEFAULT '',
        seo_description TEXT NOT NULL DEFAULT '',
        seo_keywords TEXT NOT NULL DEFAULT '',
        UNIQUE(article_id, locale),
        FOREIGN KEY (article_id) REFERENCES discover_articles(id) ON DELETE CASCADE
      );
    `);
  },
};
