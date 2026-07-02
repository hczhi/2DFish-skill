import type { Migration } from '../migrator.js';

export const migration_004: Migration = {
  id: '004_home_content',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS home_modules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        featured INTEGER NOT NULL DEFAULT 0,
        require_auth INTEGER NOT NULL DEFAULT 0,
        image_url TEXT NOT NULL DEFAULT '',
        bg_color TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1,
        grid_span TEXT NOT NULL DEFAULT '1x1',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS home_feeds (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '',
        bg_color TEXT NOT NULL DEFAULT '#f0f5ff',
        avatar_color TEXT NOT NULL DEFAULT '#0077ff',
        link TEXT NOT NULL DEFAULT '',
        likes INTEGER NOT NULL DEFAULT 0,
        image_height INTEGER NOT NULL DEFAULT 200,
        sort_order INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
