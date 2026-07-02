import type { Migration } from '../migrator.js';

export const migration_006: Migration = {
  id: '006_seo_config',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS seo_pages (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
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
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS seo_global (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Seed global SEO settings
    const now = new Date().toISOString();
    const globals = [
      ['site_name', 'QiaoNan'],
      ['site_description', 'AI 驱动的效率工具平台，集成智慧看板、AI 顾问、内容创作等多款独立应用'],
      ['site_url', ''],
      ['default_og_image', ''],
      ['google_verification', ''],
      ['bing_verification', ''],
    ];
    const stmt = db.prepare('INSERT INTO seo_global (key, value, updated_at) VALUES (?, ?, ?)');
    for (const [key, value] of globals) {
      stmt.run(key, value, now);
    }

    // Seed default pages
    const pages = [
      { path: '/', title: 'QiaoNan - AI 效率工具平台', description: '集成多款 AI 应用的效率工具平台，包含智慧看板、AI顾问、内容创作工作台等', keywords: 'AI工具,效率平台,知识管理,智慧看板,AI顾问', priority: 1.0 },
      { path: '/fish', title: '摸鱼缸 - AI 桌面养鱼游戏 | QiaoNan', description: 'AI 驱动的桌面养鱼游戏，摸鱼模式一键隐藏，趣味休闲减压小工具', keywords: '摸鱼游戏,AI养鱼,桌面宠物,休闲游戏', priority: 0.8 },
      { path: '/board', title: '智慧看板 - 东方智慧翻页卡 | QiaoNan', description: '论语·易经·佛法为你解惑，每日一句东方智慧，AI 解读经典哲学', keywords: '智慧看板,论语,易经,佛法,每日一句', priority: 0.8 },
      { path: '/synap', title: '知识管理 - AI 对话与创作工作台 | QiaoNan', description: 'AI 对话、顾问咨询、内容创作、文件管理一体化工作台', keywords: 'AI对话,知识管理,内容创作,AI顾问', priority: 0.7 },
    ];
    const pageStmt = db.prepare(`
      INSERT INTO seo_pages (id, path, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', '', '', '', 0, '', ?, 'weekly', ?, ?)
    `);
    for (const p of pages) {
      const id = `seo_${p.path.replace(/\//g, '_') || 'home'}`;
      pageStmt.run(id, p.path, p.title, p.description, p.keywords, p.priority, now, now);
    }
  },
};
