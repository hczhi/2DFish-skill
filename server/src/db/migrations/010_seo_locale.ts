import type { Migration } from '../migrator.js';

export const migration_010: Migration = {
  id: '010_seo_locale',
  up(db) {
    // SQLite doesn't support dropping inline UNIQUE constraints, so recreate the table
    db.exec(`
      CREATE TABLE seo_pages_new (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'zh',
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '',
        og_title TEXT NOT NULL DEFAULT '',
        og_description TEXT NOT NULL DEFAULT '',
        og_image TEXT NOT NULL DEFAULT '',
        canonical TEXT NOT NULL DEFAULT '',
        no_index INTEGER NOT NULL DEFAULT 0,
        json_ld TEXT NOT NULL DEFAULT '',
        priority REAL NOT NULL DEFAULT 0.5,
        changefreq TEXT NOT NULL DEFAULT 'weekly',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(path, locale)
      )
    `);

    db.exec(`
      INSERT INTO seo_pages_new (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      SELECT id, path, 'zh', title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at
      FROM seo_pages
    `);

    db.exec(`DROP TABLE seo_pages`);
    db.exec(`ALTER TABLE seo_pages_new RENAME TO seo_pages`);

    // Seed English variants for existing pages
    const now = new Date().toISOString();
    const existingPages = db.prepare("SELECT * FROM seo_pages WHERE locale = 'zh'").all() as Array<{
      id: string; path: string; og_image: string; no_index: number;
      json_ld: string; priority: number; changefreq: string;
    }>;

    const enSeeds: Record<string, { title: string; description: string; keywords: string }> = {
      '/': {
        title: 'QiaoNan - AI Productivity Platform',
        description: 'An integrated AI app platform with smart dashboards, AI consultants, content creation tools and more',
        keywords: 'AI tools,productivity platform,knowledge management,smart dashboard,AI consultant',
      },
      '/fish': {
        title: 'Fish Tank - AI Desktop Fish Game | QiaoNan',
        description: 'AI-powered desktop fish raising game with stealth mode, a fun and relaxing stress relief tool',
        keywords: 'fish game,AI pet,desktop pet,casual game',
      },
      '/board': {
        title: 'Wisdom Board - Eastern Philosophy Cards | QiaoNan',
        description: 'Confucius, I Ching, Buddhist wisdom for daily guidance, AI-powered interpretation of classic philosophy',
        keywords: 'wisdom board,Confucius,I Ching,Buddhism,daily quote',
      },
      '/synap': {
        title: 'Knowledge Hub - AI Chat & Creative Workspace | QiaoNan',
        description: 'AI conversation, consultant, content creation and file management in one integrated workspace',
        keywords: 'AI chat,knowledge management,content creation,AI consultant',
      },
    };

    const stmt = db.prepare(`
      INSERT INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (?, ?, 'en', ?, ?, ?, '', '', ?, '', ?, ?, ?, ?, ?, ?)
    `);

    for (const page of existingPages) {
      const en = enSeeds[page.path];
      if (en) {
        stmt.run(
          `${page.id}_en`, page.path,
          en.title, en.description, en.keywords,
          page.og_image || '', page.no_index,
          page.json_ld || '', page.priority, page.changefreq,
          now, now
        );
      }
    }
  },
};
