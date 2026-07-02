import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrator.js';
import { allMigrations } from './migrations/index.js';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  const dbPath = path.resolve(process.cwd(), 'data/app.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_key TEXT,
      api_base_url TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER,
      request_summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_logs_source ON ai_logs(source, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_date ON ai_logs(created_at);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_summaries (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      up_to_message_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consultant_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consultant_summaries (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      up_to_message_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('image-text', 'video')),
      status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting', 'predicted', 'published', 'retro-ready', 'retrospected')),
      cover_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_predictions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      scores JSON NOT NULL,
      predicted_metrics JSON NOT NULL,
      confidence TEXT,
      reasoning TEXT,
      locked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_actuals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      reads INTEGER,
      likes INTEGER,
      collects INTEGER,
      comments INTEGER,
      publish_url TEXT,
      published_at TEXT,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_retros (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      analysis TEXT NOT NULL,
      accuracy_score REAL,
      insights JSON,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scoring_rules (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL CHECK(type IN ('image-text', 'video')),
      dimensions JSON NOT NULL,
      notes TEXT,
      effective_from TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES content_messages(id),
      project_id TEXT NOT NULL REFERENCES content_projects(id),
      signal TEXT NOT NULL CHECK(signal IN ('adopted', 'dismissed')),
      context TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_inspirations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      source TEXT,
      tags TEXT,
      images TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      path, title, body, tags,
      content='', tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      last_modified TEXT
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      manifest_path TEXT NOT NULL,
      is_native INTEGER DEFAULT 0
    );
  `);

  runMigrations(db, allMigrations);

  console.log('[mmPla] Database initialized.');
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}
