import { getDatabase } from '../../db/index.js';

// 模版上线状态。没有行 = 草稿。
export type TemplateStatus = 'draft' | 'live';
export const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function listTemplateStatus(): Record<string, TemplateStatus> {
  const rows = getDatabase().prepare('SELECT id, status FROM broll_templates').all() as { id: string; status: TemplateStatus }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

export function setTemplateStatus(id: string, status: TemplateStatus) {
  getDatabase()
    .prepare(
      `INSERT INTO broll_templates (id, status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    )
    .run(id, status, new Date().toISOString());
}
