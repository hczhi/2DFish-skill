import type { Migration } from '../migrator.js';

export const migration_019: Migration = {
  id: '019_tender_system',
  up(db) {
    // Public tender library - all scraped bid announcements
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenders (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'gdgpo',
        notice_id TEXT NOT NULL,
        title TEXT NOT NULL,
        publish_date TEXT NOT NULL,
        deadline TEXT DEFAULT '',
        budget TEXT DEFAULT '',
        budget_amount REAL DEFAULT 0,
        purchaser_name TEXT DEFAULT '',
        agency_name TEXT DEFAULT '',
        region_name TEXT DEFAULT '',
        region_code TEXT DEFAULT '',
        project_code TEXT DEFAULT '',
        notice_type TEXT DEFAULT '',
        procurement_method TEXT DEFAULT '',
        content_text TEXT DEFAULT '',
        content_html TEXT DEFAULT '',
        url TEXT DEFAULT '',
        attachments TEXT DEFAULT '[]',
        contact_name TEXT DEFAULT '',
        contact_phone TEXT DEFAULT '',
        keyword TEXT DEFAULT '',
        raw_data TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(platform, notice_id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tenders_platform ON tenders(platform)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tenders_publish_date ON tenders(publish_date DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tenders_region ON tenders(region_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tenders_purchaser ON tenders(purchaser_name)`);

    // User keyword configuration
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_user_keywords (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user(id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tender_keywords_user ON tender_user_keywords(user_id)`);

    // User client relationships
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_user_clients (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        relationship_score INTEGER NOT NULL DEFAULT 5,
        payment_credit TEXT NOT NULL DEFAULT 'normal',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user(id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tender_clients_user ON tender_user_clients(user_id)`);

    // User preferences (budget, region, qualifications)
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_user_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        budget_min REAL DEFAULT 0,
        budget_max REAL DEFAULT 0,
        allow_below_min_for_vip INTEGER DEFAULT 0,
        preferred_regions TEXT DEFAULT '[]',
        acceptable_regions TEXT DEFAULT '[]',
        excluded_regions TEXT DEFAULT '[]',
        qualifications TEXT DEFAULT '[]',
        case_tags TEXT DEFAULT '[]',
        excluded_types TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user(id)
      )
    `);

    // Recommendations - per user per tender scoring
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_recommendations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tender_id TEXT NOT NULL,
        total_score REAL NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'filter',
        score_business REAL DEFAULT 0,
        score_budget REAL DEFAULT 0,
        score_qualification REAL DEFAULT 0,
        score_relationship REAL DEFAULT 0,
        score_region REAL DEFAULT 0,
        score_timeliness REAL DEFAULT 0,
        ai_reason TEXT DEFAULT '',
        risk_notes TEXT DEFAULT '',
        is_read INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, tender_id),
        FOREIGN KEY (user_id) REFERENCES user(id),
        FOREIGN KEY (tender_id) REFERENCES tenders(id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_recommendations_user ON tender_recommendations(user_id, total_score DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recommendations_tier ON tender_recommendations(user_id, tier)`);

    // Crawl logs
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_crawl_logs (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        total_found INTEGER DEFAULT 0,
        new_added INTEGER DEFAULT 0,
        duplicates INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        error_message TEXT DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT ''
      )
    `);
  },
};
