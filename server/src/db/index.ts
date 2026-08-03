import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrator.js';
import { allMigrations } from './migrations/index.js';

let db: Database.Database | null = null;

/** 数据库文件路径。DB_PATH 用于测试隔离，不设时仍是生产/开发的 data/app.db。 */
export function getDatabasePath(): string {
  return process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(process.cwd(), 'data/app.db');
}

export function initDatabase(): Database.Database {
  const dbPath = getDatabasePath();
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
      request_body TEXT,
      response_body TEXT,
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

    -- 这里原本还建了 content_projects / content_drafts / content_predictions /
    -- content_actuals / content_retros / content_messages / content_feedback /
    -- content_inspirations / scoring_rules / skills / files / knowledge_fts。
    -- 全部 0 行且除本文件外没有任何 SQL 引用，已由 migrations/051 删除：
    -- content_* 那套被 xhs 模块的表重做了，skills 被 prompt_skills 取代，
    -- files/knowledge_fts 的写入逻辑从未实现。
    -- 建表语句必须一并删掉，否则下次启动会照原样重建，051 就白跑了。
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
